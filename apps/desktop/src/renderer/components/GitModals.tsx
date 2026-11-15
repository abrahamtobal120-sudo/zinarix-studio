import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitHubRepoView, GitHubStatus } from '../../shared/api';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import { api, openFile, setState, toast, useStore } from '../store';
import { monacoTheme } from '../themes';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';

const close = () => setState({ modal: null });
/** Lines of a patch drawn at once; the rest behind "show all" (one <div> per line is slow). */
const PATCH_LINES = 5000;
const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(/^Error invoking[^:]*: (Error: )?/, '');

/** Side-by-side diff of one changed file (index vs working tree, or HEAD vs index). */
export function GitDiff({ path, staged }: { path: string; staged: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const theme = useStore((s) => s.settings.theme);
  const [data, setData] = useState<{ before: string; after: string } | null>(null);
  useEffect(() => {
    api()
      .git.diff(path, staged)
      .then(setData)
      .catch((e) => {
        toast(errText(e));
        close();
      });
  }, [path, staged]);
  useEffect(() => {
    if (!host.current || !data) return;
    const lang = languageFor(path);
    const a = monaco.editor.createModel(data.before, lang);
    const b = monaco.editor.createModel(data.after, lang);
    const diff = monaco.editor.createDiffEditor(host.current, {
      readOnly: true,
      automaticLayout: true,
      renderSideBySide: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      theme: monacoTheme(theme),
      fontSize: 13,
    });
    diff.setModel({ original: a, modified: b });
    return () => {
      diff.dispose();
      a.dispose();
      b.dispose();
    };
  }, [data, path, theme]);
  return (
    <ModalShell onClose={close} className="git-diff-modal" labelledBy="git-diff-title">
      <div className="git-diff-head">
        <b id="git-diff-title">{path}</b>
        <span className="dim">{staged ? t('gitDiffStaged') : t('gitDiffWorking')}</span>
        <span className="spacer" />
        <button
          onClick={() => {
            close();
            void openFile(path);
          }}
        >
          <Icon name="file" size={13} /> {t('gitOpenFile')}
        </button>
        <button onClick={close} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <div className="git-diff-host" ref={host} />
    </ModalShell>
  );
}

/** Patch of a commit from the history. */
export function CommitView({ hash, subject }: { hash: string; subject: string }) {
  const [text, setText] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    api()
      .git.show(hash)
      .then(setText)
      .catch((e) => setText(errText(e)));
  }, [hash]);
  const lines = useMemo(() => (text ?? '').split('\n'), [text]);
  const shown = all ? lines : lines.slice(0, PATCH_LINES);
  return (
    <ModalShell onClose={close} className="git-diff-modal" labelledBy="git-commit-title">
      <div className="git-diff-head">
        <b id="git-commit-title">{subject}</b>
        <code className="dim">{hash.slice(0, 10)}</code>
        <span className="spacer" />
        <button onClick={close} aria-label={t('close')} title={t('close')}>
          <Icon name="close" size={14} />
        </button>
      </div>
      <pre className="git-patch" aria-busy={text === null}>
        {text === null && <div className="dim">{t('loading')}</div>}
        {shown.map((l, i) => (
          <div
            key={i}
            className={
              l.startsWith('+') && !l.startsWith('+++')
                ? 'add'
                : l.startsWith('-') && !l.startsWith('---')
                  ? 'del'
                  : l.startsWith('@@')
                    ? 'hunk'
                    : ''
            }
          >
            {l || ' '}
          </div>
        ))}
        {!all && lines.length > PATCH_LINES && (
          <div>
            <button onClick={() => setAll(true)}>
              {t('gitPatchShowAll', { n: lines.length - PATCH_LINES })}
            </button>
          </div>
        )}
      </pre>
    </ModalShell>
  );
}

/** GitHub connector: your repositories (through `gh`) or any URL, cloned and opened. */
export function CloneRepo() {
  const [spec, setSpec] = useState('');
  const [gh, setGh] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepoView[]>([]);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api()
      .github.status()
      .then(async (s) => {
        setGh(s);
        if (s.loggedIn)
          setRepos(
            await api()
              .github.repos()
              .catch(() => []),
          );
      });
  }, []);
  const shown = useMemo(() => {
    const q = filter.toLowerCase();
    return repos.filter(
      (r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
    );
  }, [repos, filter]);

  const clone = async (s: string) => {
    if (!s.trim()) return;
    setBusy(true);
    try {
      const ws = await api().github.clone(s.trim());
      if (ws) {
        toast(t('gitCloned', { name: ws.name }));
        close();
      }
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      onClose={() => !busy && close()}
      onBackdrop={busy ? null : close}
      className="usage gh-modal"
      labelledBy="gh-clone-title"
    >
      <button
        className="modal-x"
        onClick={close}
        disabled={busy}
        aria-label={t('close')}
        title={t('close')}
      >
        <Icon name="close" size={16} />
      </button>
      <h2 id="gh-clone-title">
        <Icon name="download" size={16} /> {t('gitClone')}
      </h2>
      <p className="dim">{t('gitCloneIntro')}</p>
      <div className="gh-row">
        <input
          autoFocus
          value={spec}
          aria-label={t('phGitClone')}
          placeholder={t('phGitClone')}
          onChange={(e) => setSpec(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void clone(spec)}
        />
        <button
          className="primary"
          disabled={busy || !spec.trim()}
          onClick={() => void clone(spec)}
        >
          {busy ? '…' : t('gitCloneBtn')}
        </button>
      </div>
      <div className="gh-section">
        <div className="gh-section-title">
          <span>GitHub</span>
          {gh?.loggedIn && <span className="dim">@{gh.user}</span>}
        </div>
        {!gh && <div className="dim">…</div>}
        {gh && !gh.loggedIn && (
          <div className="dim">
            {gh.installed ? t('ghNotLogged') : t('ghNotInstalled')}{' '}
            {!gh.installed && (
              <button
                className="link"
                onClick={() => void api().app.openExternal('https://cli.github.com/')}
              >
                cli.github.com
              </button>
            )}
          </div>
        )}
        {gh?.loggedIn && (
          <>
            <input
              className="gh-filter"
              value={filter}
              aria-label={t('ghFilter', { n: repos.length })}
              placeholder={t('ghFilter', { n: repos.length })}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div className="gh-repos">
              {shown.map((r) => (
                <div
                  key={r.name}
                  className="gh-repo"
                  {...pressable(() => !busy && void clone(r.name))}
                >
                  <div className="gh-repo-name">
                    <Icon name={r.private ? 'lock' : 'globe'} size={13} /> {r.name}
                  </div>
                  {r.description && <div className="dim gh-repo-desc">{r.description}</div>}
                </div>
              ))}
              {repos.length > 0 && shown.length === 0 && (
                <div className="dim">{t('noResults')}</div>
              )}
            </div>
          </>
        )}
      </div>
    </ModalShell>
  );
}

/** A file that should rarely be public: secrets, keys, dependencies. */
function sensitiveKind(path: string): string | null {
  const name = path.split('/').pop() ?? path;
  if (/(^|\/)node_modules\//.test(path)) return 'node_modules/';
  if (/^\.env(\..+)?$/.test(name) && !/\.(example|sample|template)$/.test(name)) return '.env';
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(name)) return name;
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return `*.${name.split('.').pop()!.toLowerCase()}`;
  return null;
}
const GITIGNORE: Record<string, string> = {
  'node_modules/': 'node_modules/',
  '.env': '.env\n.env.*\n!.env.example',
};

interface PublishReview {
  files: string[];
  /** Sensitive matches, grouped by pattern (node_modules counts as one). */
  sensitive: { kind: string; paths: string[] }[];
  hasGitignore: boolean;
}

/** What `git add -A` + push would upload, best effort with the existing git APIs. */
async function reviewPublish(): Promise<PublishReview> {
  let st = await api().git.status();
  // Publishing initializes the repository anyway; doing it now makes .gitignore count.
  if (!st.isRepo) {
    await api().git.init();
    st = await api().git.status();
  }
  const files = st.hasCommits
    ? await api().workspace.listFiles()
    : st.files.filter((f) => !f.work.includes('D')).map((f) => f.path);
  const groups = new Map<string, string[]>();
  for (const p of files) {
    const k = sensitiveKind(p);
    if (!k) continue;
    const arr = groups.get(k);
    if (arr) arr.push(p);
    else groups.set(k, [p]);
  }
  return {
    files,
    sensitive: [...groups].map(([kind, paths]) => ({ kind, paths })),
    hasGitignore: files.includes('.gitignore'),
  };
}

/** Creates a GitHub repository from the open folder and uploads it. */
export function PublishRepo() {
  const workspace = useStore((s) => s.workspace);
  const [gh, setGh] = useState<GitHubStatus | null>(null);
  const [name, setName] = useState(workspace?.name ?? '');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<PublishReview | null>(null);
  useEffect(() => {
    void api().github.status().then(setGh);
  }, []);

  const check = async () => {
    setBusy(true);
    try {
      setReview(await reviewPublish());
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  /** Adds the sensitive patterns found to .gitignore, then checks again. */
  const ignoreSensitive = async () => {
    if (!review) return;
    setBusy(true);
    try {
      const prev = review.hasGitignore
        ? (await api().workspace.readFile('.gitignore')).content
        : '';
      const add = review.sensitive.map((g) => GITIGNORE[g.kind] ?? g.kind).join('\n');
      const sep = prev && !prev.endsWith('\n') ? '\n' : '';
      await api().workspace.writeFile('.gitignore', `${prev}${sep}${add}\n`);
      setReview(await reviewPublish());
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = async () => {
    setBusy(true);
    try {
      const st = await api().git.status();
      if (!st.isRepo) await api().git.init();
      const after = await api().git.status();
      if (!after.hasCommits) {
        await api().git.stage([]);
        await api().git.commit(t('gitFirstCommit'), false);
      }
      const url = await api().github.publish(name, vis, desc);
      toast(t('ghPublished', { url }));
      close();
      if (/^https:\/\//.test(url)) void api().app.openExternal(url);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      onClose={() => !busy && close()}
      onBackdrop={busy ? null : close}
      className="usage gh-modal"
      labelledBy="gh-publish-title"
    >
      <button
        className="modal-x"
        onClick={close}
        disabled={busy}
        aria-label={t('close')}
        title={t('close')}
      >
        <Icon name="close" size={16} />
      </button>
      <h2 id="gh-publish-title">
        <Icon name="cloud" size={16} /> {t('ghPublish')}
      </h2>
      {gh && !gh.loggedIn ? (
        <p>
          {gh.installed ? t('ghNotLogged') : t('ghNotInstalled')}{' '}
          {!gh.installed && (
            <button
              className="link"
              onClick={() => void api().app.openExternal('https://cli.github.com/')}
            >
              cli.github.com
            </button>
          )}
        </p>
      ) : (
        <>
          <p className="dim">{t('ghPublishIntro')}</p>
          <label className="settings-field">
            <span>{t('ghRepoName')}</span>
            <input value={name} disabled={!!review} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="settings-field">
            <span>{t('ghRepoDesc')}</span>
            <input value={desc} onChange={(e) => setDesc(e.target.value)} />
          </label>
          <div className="gh-vis">
            <label className="check">
              <input type="radio" checked={vis === 'private'} onChange={() => setVis('private')} />
              <Icon name="lock" size={13} /> {t('ghPrivate')}
            </label>
            <label className="check">
              <input type="radio" checked={vis === 'public'} onChange={() => setVis('public')} />
              <Icon name="globe" size={13} /> {t('ghPublic')}
            </label>
          </div>
          {review && (
            <div className="gh-section">
              <div className="gh-section-title">
                <span>{t('ghReviewTitle', { n: review.files.length })}</span>
              </div>
              {review.sensitive.length > 0 && (
                <div className="err" role="alert">
                  <Icon name="warning" size={13} /> {t('ghReviewSensitive')}
                  <ul>
                    {review.sensitive.map((g) => (
                      <li key={g.kind}>
                        <code>{g.kind}</code>{' '}
                        {g.kind === 'node_modules/'
                          ? t('ghReviewFiles', { n: g.paths.length })
                          : g.paths.slice(0, 5).join(', ') +
                            (g.paths.length > 5 ? ` (+${g.paths.length - 5})` : '')}
                      </li>
                    ))}
                  </ul>
                  <button disabled={busy} onClick={() => void ignoreSensitive()}>
                    {review.hasGitignore ? t('ghReviewAddIgnore') : t('ghReviewCreateIgnore')}
                  </button>
                </div>
              )}
              {!review.hasGitignore && review.sensitive.length === 0 && (
                <p className="dim small">{t('ghReviewNoIgnore')}</p>
              )}
              <div className="gh-repos">
                {review.files.slice(0, 300).map((p) => (
                  <div key={p} className={`dim small ${sensitiveKind(p) ? 'err' : ''}`}>
                    {p}
                  </div>
                ))}
                {review.files.length > 300 && (
                  <div className="dim small">
                    {t('ghReviewMore', { n: review.files.length - 300 })}
                  </div>
                )}
                {review.files.length === 0 && <div className="dim">{t('ghReviewEmpty')}</div>}
              </div>
            </div>
          )}
          <div className="gh-row end">
            <button onClick={() => (review ? setReview(null) : close())} disabled={busy}>
              {review ? t('back') : t('cancel')}
            </button>
            <button
              className={review?.sensitive.length ? 'danger' : 'primary'}
              disabled={busy || !gh?.loggedIn || !name.trim()}
              onClick={() => void (review ? publish() : check())}
            >
              {busy ? (
                '…'
              ) : (
                <>
                  <Icon name="cloud" size={13} />{' '}
                  {!review
                    ? t('ghReviewBtn')
                    : review.sensitive.length
                      ? t('ghPublishAnyway')
                      : t('ghPublishBtn')}
                </>
              )}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}
