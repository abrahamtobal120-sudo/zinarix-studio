import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  GitBranchView,
  ReviewFindingView,
  ReviewHistoryView,
  ReviewPrView,
  ReviewProgressView,
  ReviewSeverityView,
  ReviewSourceView,
  ReviewView,
} from '../../shared/api';
import { confirmDialog } from '../confirm';
import { errText } from '../errText';
import { t, type Key } from '../i18n';
import { openLink } from '../links';
import { api, attachToChat, newRequestId, openFile, toast, useStore } from '../store';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import './code-review.css';

const SEVERITIES: ReviewSeverityView[] = ['critical', 'high', 'medium', 'low'];
const SEV_KEY = {
  critical: 'crSevCritical',
  high: 'crSevHigh',
  medium: 'crSevMedium',
  low: 'crSevLow',
} as const satisfies Record<ReviewSeverityView, Key>;
const CAT_KEY = {
  bug: 'crCatBug',
  security: 'crCatSecurity',
  performance: 'crCatPerformance',
  reliability: 'crCatReliability',
  maintainability: 'crCatMaintainability',
} as const satisfies Record<ReviewFindingView['category'], Key>;

type Kind = ReviewSourceView['kind'];
const IGNORE_FILE = '.zinarix/review-ignore.json';

/** Plain-text version of a finding (copy, and the context sent to the agent). */
function findingText(f: ReviewFindingView): string {
  return [
    `[${t(SEV_KEY[f.severity])}] ${f.file}:${f.line} — ${f.title}`,
    f.detail,
    f.fix ? `${t('crFix')}: ${f.fix}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function markdown(r: ReviewView): string {
  const out = [
    `## ${r.title}`,
    '',
    t('crSummary', { n: r.findings.length, files: r.stats.reviewedFiles }),
    '',
  ];
  for (const f of r.findings)
    out.push(
      `### [${t(SEV_KEY[f.severity])}] \`${f.file}:${f.line}\` ${f.title}`,
      '',
      f.detail,
      ...(f.fix ? ['', `**${t('crFix')}:** ${f.fix}`] : []),
      '',
    );
  return out.join('\n');
}

export function CodeReview({ onClose, branch }: { onClose: () => void; branch?: string }) {
  const models = useStore((s) => s.models);
  const defaultModel = useStore((s) => s.settings.defaultModel);
  const chatModels = useMemo(
    () => models.filter((m) => m.kind === 'chat').map((m) => `${m.provider}/${m.id}`),
    [models],
  );
  const [kind, setKind] = useState<Kind>('local');
  const [base, setBase] = useState('');
  const [branches, setBranches] = useState<GitBranchView[]>([]);
  const [prs, setPrs] = useState<ReviewPrView[] | null>(null);
  const [prErr, setPrErr] = useState<string | null>(null);
  const [prNo, setPrNo] = useState<number | null>(null);
  const [reviewers, setReviewers] = useState<string[]>(() => (defaultModel ? [defaultModel] : []));
  const [verifier, setVerifier] = useState('');
  const [verify, setVerify] = useState(true);
  const [security, setSecurity] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<ReviewProgressView | null>(null);
  const [result, setResult] = useState<ReviewView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [minSev, setMinSev] = useState<ReviewSeverityView>('low');
  const [publishing, setPublishing] = useState(false);
  const [history, setHistory] = useState<ReviewHistoryView[]>([]);
  /** Finding whose "not a problem" form is open, and its reason. */
  const [ignoring, setIgnoring] = useState<{ id: string; reason: string } | null>(null);
  const runId = useRef<string | null>(null);

  const loadHistory = () =>
    void api()
      .review.history()
      .then(setHistory)
      .catch(() => undefined);

  const show = (r: ReviewView) => {
    setResult(r);
    setError(null);
    setIgnoring(null);
    setPicked(new Set(r.findings.filter((f) => f.severity !== 'low').map((f) => f.id)));
  };

  const openSaved = async (id: string) => {
    if (!id) {
      setResult(null);
      return;
    }
    try {
      show(await api().review.get(id));
    } catch (e) {
      toast(errText(e));
      loadHistory();
    }
  };

  const deleteSaved = async () => {
    if (!result) return;
    await api().review.delete(result.id);
    setResult(null);
    loadHistory();
  };

  const ignore = async (f: ReviewFindingView, reason: string) => {
    if (!result) return;
    try {
      show(await api().review.ignore(result.id, [f.id], reason.trim() || undefined));
      toast(t('crIgnoredToast'));
      loadHistory();
    } catch (e) {
      toast(errText(e));
    }
  };

  useEffect(loadHistory, []);

  useEffect(() => {
    void api()
      .git.branches()
      .then((list) => {
        setBranches(list);
        const main = list.find(
          (b) => !b.current && /^(origin\/)?(main|master|develop)$/.test(b.name),
        );
        setBase((b) => b || main?.name || list.find((x) => !x.current)?.name || '');
      })
      .catch(() => undefined);
    return api().on((ev) => {
      if (ev.type === 'review:progress' && ev.requestId === runId.current) setProgress(ev.progress);
    });
  }, []);

  useEffect(() => {
    if (kind !== 'pr' || prs) return;
    api()
      .review.prs()
      .then((list) => {
        setPrs(list);
        setPrNo(
          (n) => n ?? list.find((p) => p.branch === branch)?.number ?? list[0]?.number ?? null,
        );
      })
      .catch((e: unknown) => setPrErr(errText(e)));
  }, [kind, prs, branch]);

  // Abort a running review when the dialog closes.
  useEffect(() => () => void (runId.current && api().review.abort(runId.current)), []);

  const source: ReviewSourceView | null =
    kind === 'local'
      ? { kind: 'local' }
      : kind === 'branch'
        ? base
          ? { kind: 'branch', base }
          : null
        : prNo
          ? { kind: 'pr', number: prNo }
          : null;

  const start = async () => {
    if (!source) return;
    const id = newRequestId();
    runId.current = id;
    setRunning(id);
    setError(null);
    setResult(null);
    setProgress(null);
    try {
      const r = await api().review.run(id, {
        source,
        models: reviewers.filter(Boolean),
        verifier: verifier || undefined,
        verify,
        security,
      });
      if (runId.current !== id) return;
      show(r);
      loadHistory();
    } catch (e) {
      if (runId.current === id) setError(errText(e));
    } finally {
      if (runId.current === id) {
        runId.current = null;
        setRunning(null);
      }
    }
  };

  const cancel = () => {
    if (running) void api().review.abort(running);
    runId.current = null;
    setRunning(null);
  };

  const shown = useMemo(
    () =>
      (result?.findings ?? []).filter(
        (f) => SEVERITIES.indexOf(f.severity) <= SEVERITIES.indexOf(minSev),
      ),
    [result, minSev],
  );
  const counts = useMemo(() => {
    const c: Record<ReviewSeverityView, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const f of result?.findings ?? []) c[f.severity]++;
    return c;
  }, [result]);

  const publish = async () => {
    if (!result) return;
    const ids = [...picked];
    try {
      const p = await api().review.preview(result.id, ids);
      const ok = await confirmDialog(
        [
          t('crPublishConfirm', {
            n: ids.length - p.already,
            inline: p.inline,
            body: p.body,
            url: p.url,
          }),
          p.already ? t('crPublishAlready', { n: p.already }) : '',
          p.stale ? t('crPublishStale') : '',
        ]
          .filter(Boolean)
          .join('\n\n'),
        { okLabel: t('crPublish') },
      );
      if (!ok) return;
      setPublishing(true);
      const url = await api().review.publish(result.id, ids);
      setResult({ ...result, published: url });
      toast(t('crPublished'));
      loadHistory();
    } catch (e) {
      toast(errText(e));
    } finally {
      setPublishing(false);
    }
  };

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const setReviewer = (i: number, v: string) =>
    setReviewers((list) => {
      const n = [...list];
      n[i] = v;
      return n.filter((x, k) => x || k === 0).slice(0, 3);
    });

  const pct =
    progress && progress.phase !== 'done' && progress.total
      ? Math.round((progress.done / progress.total) * 100)
      : 0;

  return (
    <ModalShell onClose={onClose} className="code-review" labelledBy="code-review-title">
      <header className="cr-head">
        <h2 id="code-review-title">
          <Icon name="shield" size={16} /> {t('crTitle')}
        </h2>
        <button className="icon-btn" title={t('crClose')} onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {history.length > 0 && (
        <label className="cr-field cr-history" inert={running ? true : undefined}>
          <Icon name="clock" size={14} /> {t('crHistory')}
          <select
            value={result && history.some((h) => h.id === result.id) ? result.id : ''}
            onChange={(e) => void openSaved(e.target.value)}
          >
            <option value="">{t('crNewReview')}</option>
            {history.map((h) => (
              <option key={h.id} value={h.id}>
                {new Date(h.at).toLocaleString()} —{' '}
                {t('crHistoryItem', { title: h.title, n: h.findings })}
                {h.published ? ` (${t('crHistoryPublished')})` : ''}
              </option>
            ))}
          </select>
        </label>
      )}

      <div className="cr-setup" inert={running ? true : undefined}>
        <div className="cr-sources" role="radiogroup" aria-label={t('crSource')}>
          {(['local', 'branch', 'pr'] as const).map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={kind === k}
              className={kind === k ? 'on' : ''}
              onClick={() => setKind(k)}
            >
              <Icon
                name={k === 'local' ? 'edit' : k === 'branch' ? 'branch' : 'github'}
                size={14}
              />{' '}
              {t(k === 'local' ? 'crSrcLocal' : k === 'branch' ? 'crSrcBranch' : 'crSrcPr')}
            </button>
          ))}
        </div>
        {kind === 'branch' && (
          <label className="cr-field">
            {t('crBase')}
            <select value={base} onChange={(e) => setBase(e.target.value)}>
              {branches
                .filter((b) => !b.current)
                .map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {kind === 'pr' && (
          <label className="cr-field">
            {t('crPr')}
            {prErr ? (
              <span className="cr-warn">
                <Icon name="warning" size={13} /> {t('crPrError', { err: prErr })}
              </span>
            ) : !prs ? (
              <span className="cr-dim">…</span>
            ) : !prs.length ? (
              <span className="cr-dim">{t('crNoPrs')}</span>
            ) : (
              <select value={prNo ?? ''} onChange={(e) => setPrNo(Number(e.target.value))}>
                {prs.map((p) => (
                  <option key={p.number} value={p.number}>
                    #{p.number} {p.title}
                    {p.author ? ` — ${p.author}` : ''}
                    {p.draft ? ` (${t('crDraft')})` : ''}
                  </option>
                ))}
              </select>
            )}
          </label>
        )}
        <div className="cr-field">
          <span>{t('crModels')}</span>
          <div className="cr-models">
            {[...reviewers, ...(reviewers.length < 3 ? [''] : [])].map((m, i) => (
              <select
                key={i}
                aria-label={t('crReviewerN', { n: i + 1 })}
                value={m}
                onChange={(e) => setReviewer(i, e.target.value)}
              >
                <option value="">{i === 0 ? t('crDefaultModel') : t('crAddModel')}</option>
                {chatModels.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <span className="cr-dim">{t('crModelsHint')}</span>
        </div>
        <div className="cr-field cr-row">
          <label className="cr-check">
            <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} />
            {t('crVerify')}
          </label>
          {verify && (
            <select
              aria-label={t('crVerifier')}
              value={verifier}
              onChange={(e) => setVerifier(e.target.value)}
            >
              <option value="">{t('crVerifierSame')}</option>
              {chatModels.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          )}
          <label className="cr-check">
            <input
              type="checkbox"
              checked={security}
              onChange={(e) => setSecurity(e.target.checked)}
            />
            {t('crSecurity')}
          </label>
        </div>
      </div>

      <div className="cr-actions">
        {running ? (
          <>
            <div className="cr-progress" role="status">
              <span>
                {progress?.phase === 'verify'
                  ? t('crVerifying', { done: progress.done, total: progress.total })
                  : progress?.phase === 'review'
                    ? t('crReviewing', { done: progress.done, total: progress.total })
                    : t('crPreparing')}
              </span>
              <div className="cr-bar">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button onClick={cancel}>{t('crCancel')}</button>
          </>
        ) : (
          <button className="primary" disabled={!source} onClick={() => void start()}>
            <Icon name="play" size={14} /> {result ? t('crRunAgain') : t('crRun')}
          </button>
        )}
      </div>

      {error && (
        <div className="cr-error" role="alert">
          <Icon name="warning" size={14} /> {error}
        </div>
      )}

      {result && (
        <div className="cr-results">
          <div className="cr-summary">
            <strong>{result.title}</strong>
            <span className="cr-dim">
              {t('crSummary', { n: result.findings.length, files: result.stats.reviewedFiles })}
              {result.stats.falsePositives
                ? ` · ${t('crDiscarded', { n: result.stats.falsePositives })}`
                : ''}
              {result.stats.ignored
                ? ` · ${t('crIgnoredN', { n: result.stats.ignored, file: IGNORE_FILE })}`
                : ''}
              {result.usd ? ` · $${result.usd.toFixed(3)}` : ''}
            </span>
            <span className="spacer" />
            {SEVERITIES.map((s) => (
              <button
                key={s}
                className={`cr-chip sev-${s} ${minSev === s ? 'on' : ''}`}
                title={t('crFilterFrom', { sev: t(SEV_KEY[s]) })}
                onClick={() => setMinSev(s)}
              >
                {t(SEV_KEY[s])} {counts[s]}
              </button>
            ))}
          </div>
          {!!result.guidance?.length && (
            <div className="cr-dim cr-guidance">
              {t('crGuidance', {
                list: result.guidance
                  .map((g) => (g === 'rules' ? t('crGuidanceRules') : g))
                  .join(', '),
              })}
            </div>
          )}
          {result.errors.map((e) => (
            <div key={e.model} className="cr-warn">
              <Icon name="warning" size={13} />{' '}
              {t('crModelFailed', { model: e.model, err: e.error })}
            </div>
          ))}
          {!shown.length && (
            <div className="cr-empty">
              <Icon name="check" size={16} /> {t('crNone')}
            </div>
          )}
          <ul className="cr-list">
            {shown.map((f) => (
              <li key={f.id} className={`cr-finding sev-${f.severity}`}>
                <div className="cr-finding-head">
                  {result.canPublish && (
                    <input
                      type="checkbox"
                      aria-label={t('crPick')}
                      checked={picked.has(f.id)}
                      onChange={() => toggle(f.id)}
                    />
                  )}
                  <span className={`cr-sev sev-${f.severity}`}>{t(SEV_KEY[f.severity])}</span>
                  <span className="cr-cat">{t(CAT_KEY[f.category])}</span>
                  <strong className="cr-ftitle">{f.title}</strong>
                </div>
                <button
                  className="link cr-where"
                  title={t('crOpenAt')}
                  onClick={() => void openFile(f.file, { line: f.line, column: 1 })}
                >
                  {f.file}:{f.line}
                </button>
                {f.detail && <p className="cr-detail">{f.detail}</p>}
                {f.fix && (
                  <p className="cr-fix">
                    <strong>{t('crFix')}:</strong> {f.fix}
                  </p>
                )}
                <div className="cr-meta">
                  <span className={`cr-verdict ${f.verdict}`} title={f.verifyNote ?? ''}>
                    {f.source === 'scanner'
                      ? t('crScanner')
                      : f.verdict === 'confirmed'
                        ? t('crConfirmed')
                        : t('crPlausible')}
                  </span>
                  {f.source === 'ai' && <span className="cr-dim">{f.models.join(' · ')}</span>}
                  <span className="spacer" />
                  <button
                    className="link"
                    onClick={() => {
                      attachToChat({
                        source: `review:${f.file}:${f.line}`,
                        content: `${t('crFixPrompt')}\n\n${findingText(f)}`,
                      });
                      toast(t('crAttached'));
                    }}
                  >
                    <Icon name="agent" size={13} /> {t('crFixWithAgent')}
                  </button>
                  {f.fingerprint && ignoring?.id !== f.id && (
                    <button className="link" onClick={() => setIgnoring({ id: f.id, reason: '' })}>
                      <Icon name="close" size={13} /> {t('crIgnore')}
                    </button>
                  )}
                </div>
                {ignoring?.id === f.id && (
                  <form
                    className="cr-ignore"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ignore(f, ignoring.reason);
                    }}
                  >
                    <input
                      autoFocus
                      maxLength={500}
                      placeholder={t('crIgnoreReason')}
                      aria-label={t('crIgnoreReason')}
                      value={ignoring.reason}
                      onChange={(e) => setIgnoring({ id: f.id, reason: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          e.stopPropagation();
                          setIgnoring(null);
                        }
                      }}
                    />
                    <button type="submit" className="primary">
                      {t('crIgnoreOk')}
                    </button>
                    <button type="button" onClick={() => setIgnoring(null)}>
                      {t('crCancel')}
                    </button>
                    <span className="cr-dim">{t('crIgnoreHint', { file: IGNORE_FILE })}</span>
                  </form>
                )}
              </li>
            ))}
          </ul>
          <div className="cr-foot">
            <button
              onClick={() => {
                void navigator.clipboard.writeText(markdown(result));
                toast(t('crCopied'));
              }}
            >
              <Icon name="copy" size={14} /> {t('crCopyMd')}
            </button>
            {shown.length > 1 && (
              <button
                onClick={() => {
                  attachToChat({
                    source: `review:${result.id}`,
                    content: `${t('crFixAllPrompt')}\n\n${shown.map(findingText).join('\n\n')}`,
                  });
                  toast(t('crAttached'));
                }}
              >
                <Icon name="agent" size={14} /> {t('crFixAll', { n: shown.length })}
              </button>
            )}
            <button
              className="icon-btn"
              title={t('crDeleteReview')}
              onClick={() => void deleteSaved()}
            >
              <Icon name="trash" size={14} />
            </button>
            <span className="spacer" />
            {result.published ? (
              <button className="link" onClick={() => openLink(result.published!)}>
                <Icon name="external" size={14} /> {t('crSeePublished')}
              </button>
            ) : (
              result.canPublish && (
                <button
                  className="primary"
                  disabled={!picked.size || publishing}
                  onClick={() => void publish()}
                >
                  <Icon name="github" size={14} />{' '}
                  {publishing ? '…' : t('crPublishN', { n: picked.size })}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </ModalShell>
  );
}
