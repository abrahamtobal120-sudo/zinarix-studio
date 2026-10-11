import { Icon } from './Icon';
import { useCallback, useEffect, useState } from 'react';
import type {
  GitBranchView,
  GitCommitView,
  GitFileView,
  GitHubStatus,
  GitStatusView,
} from '../../shared/api';
import { t } from '../i18n';
import { api, askText, openFile, setState, toast, useStore } from '../store';
import { runInTerminal } from './Terminal';
import { fileIcon } from './icons';

/** Letter and color class for a porcelain status. */
function badge(f: GitFileView, staged: boolean): { letter: string; cls: string } {
  if (f.conflict) return { letter: '!', cls: 'conflict' };
  if (f.untracked) return { letter: 'U', cls: 'added' };
  const c = staged ? f.index : f.work;
  const map: Record<string, [string, string]> = {
    M: ['M', 'modified'],
    A: ['A', 'added'],
    D: ['D', 'deleted'],
    R: ['R', 'renamed'],
    C: ['C', 'renamed'],
    T: ['T', 'modified'],
  };
  const [letter, cls] = map[c] ?? [c, 'modified'];
  return { letter, cls };
}

const errText = (e: unknown) =>
  String((e as Error).message ?? e).replace(/^Error invoking[^:]*: (Error: )?/, '');

export function GitPanel() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const [st, setSt] = useState<GitStatusView | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [view, setView] = useState<'changes' | 'history' | 'branches'>('changes');
  const [log, setLog] = useState<GitCommitView[]>([]);
  const [branches, setBranches] = useState<GitBranchView[]>([]);
  const [gh, setGh] = useState<GitHubStatus | null>(null);
  const [amend, setAmend] = useState(false);

  const refresh = useCallback(async () => {
    if (!workspace) return;
    try {
      const s = await api().git.status();
      setSt(s);
      setState({ gitChanges: s.files.length });
    } catch (e) {
      toast(errText(e));
    }
  }, [workspace]);

  useEffect(() => {
    void refresh();
  }, [refresh, fsVersion]);
  useEffect(() => {
    void api().github.status().then(setGh);
  }, []);
  useEffect(() => {
    if (!st?.isRepo) return;
    if (view === 'history') void api().git.log().then(setLog);
    if (view === 'branches') void api().git.branches().then(setBranches);
  }, [view, st?.isRepo, st?.branch, fsVersion]);

  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await fn();
      if (done) toast(done);
    } catch (e) {
      toast(errText(e));
    } finally {
      setBusy(null);
      await refresh();
    }
  };

  if (!workspace) {
    return (
      <div className="explorer">
        <div className="sidebar-title">
          <span className="panel-title">{t('gitTitle').toUpperCase()}</span>
        </div>
        <div className="sidebar-empty">
          <p>{t('noFolder')}</p>
          <button className="primary" onClick={() => setState({ modal: { kind: 'clone' } })}>
            ⤓ {t('gitClone')}
          </button>
          <p />
          <button onClick={() => void api().workspace.openDialog()}>{t('openFolder')}</button>
        </div>
      </div>
    );
  }

  if (st && !st.isRepo) {
    return (
      <div className="explorer">
        <div className="sidebar-title">
          <span className="panel-title">{t('gitTitle').toUpperCase()}</span>
        </div>
        <div className="sidebar-empty">
          <p>{t('gitNoRepo')}</p>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() => void act('init', () => api().git.init(), t('gitInitDone'))}
          >
            {t('gitInit')}
          </button>
          <p />
          <button onClick={() => setState({ modal: { kind: 'clone' } })}>⤓ {t('gitClone')}</button>
        </div>
      </div>
    );
  }

  const staged = st?.files.filter((f) => !f.untracked && f.index !== ' ' && f.index !== '?') ?? [];
  const unstaged =
    st?.files.filter((f) => f.untracked || (f.work !== ' ' && f.work !== '?') || f.conflict) ?? [];

  const commit = () =>
    act(
      'commit',
      async () => {
        if (!staged.length && !amend) await api().git.stage([]);
        await api().git.commit(message, amend);
        setMessage('');
        setAmend(false);
      },
      t('gitCommitted'),
    );

  const generate = () =>
    act('ai', async () => {
      setMessage(await api().ai.commitMessage());
    });

  const row = (f: GitFileView, isStaged: boolean) => {
    const b = badge(f, isStaged);
    const name = f.path.split('/').pop()!;
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    return (
      <div
        key={`${isStaged ? 's' : 'u'}:${f.path}`}
        className="git-row"
        title={f.from ? `${f.from} → ${f.path}` : f.path}
        onClick={() => setState({ modal: { kind: 'diff', path: f.path, staged: isStaged } })}
      >
        <span className="git-icon">{fileIcon(f.path)}</span>
        <span className={`git-name ${b.cls}`}>{name}</span>
        <span className="git-dir">{dir}</span>
        <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
          {(isStaged ? f.index : f.work) !== 'D' && (
            <button title={t('gitOpenFile')} onClick={() => void openFile(f.path)}>
              <Icon name="file" size={15} />
            </button>
          )}
          {!isStaged && (
            <button
              title={t('gitDiscard')}
              onClick={() => {
                if (!confirm(t('gitDiscardConfirm', { name }))) return;
                void act('discard', () => api().git.discard([f.path]));
              }}
            >
              <Icon name="undo" size={15} />
            </button>
          )}
          <button
            title={isStaged ? t('gitUnstage') : t('gitStage')}
            onClick={() =>
              void act('stage', () =>
                isStaged ? api().git.unstage([f.path]) : api().git.stage([f.path]),
              )
            }
          >
            {isStaged ? '−' : '+'}
          </button>
        </span>
        <span className={`git-badge ${b.cls}`}>{b.letter}</span>
      </div>
    );
  };

  const sync = (op: 'pull' | 'push' | 'fetch') =>
    act(
      op,
      () => api().git.sync(op),
      t(op === 'pull' ? 'gitPulled' : op === 'push' ? 'gitPushed' : 'gitFetched'),
    );

  const hasRemote = (st?.remotes.length ?? 0) > 0;

  return (
    <div className="explorer git-panel">
      <div className="sidebar-title">
        <span className="panel-title">{t('gitTitle').toUpperCase()}</span>
        <span className="sidebar-actions">
          <button title={t('gitRefresh')} onClick={() => void refresh()}>
            <Icon name="refresh" size={15} />
          </button>
          {hasRemote && (
            <>
              <button
                title={t('gitPull')}
                disabled={busy !== null}
                onClick={() => void sync('pull')}
              >
                <Icon name="pull" size={15} />
              </button>
              <button
                title={t('gitPush')}
                disabled={busy !== null}
                onClick={() => void sync('push')}
              >
                <Icon name="push" size={15} />
              </button>
            </>
          )}
          <button
            title={t('gitStash')}
            onClick={() => void act('stash', () => api().git.stash('push'), t('gitStashed'))}
          >
            <Icon name="stash" size={15} />
          </button>
          <button
            title={t('gitStashPop')}
            onClick={() => void act('stash', () => api().git.stash('pop'), t('gitStashPopped'))}
          >
            <Icon name="download" size={15} />
          </button>
        </span>
      </div>

      <div className="git-branchbar">
        <button
          className="git-branch"
          title={t('gitBranches')}
          onClick={() => setView(view === 'branches' ? 'changes' : 'branches')}
        >
          <Icon name="branch" size={13} /> {st?.branch ?? '—'}
        </button>
        {st?.ahead || st?.behind ? (
          <span className="git-track" title={st?.upstream ?? ''}>
            {st.behind ? `↓${st.behind} ` : ''}
            {st.ahead ? `↑${st.ahead}` : ''}
          </span>
        ) : null}
        <span className="spacer" />
        <div className="git-tabs">
          {(['changes', 'history', 'branches'] as const).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>
              {t(v === 'changes' ? 'gitChanges' : v === 'history' ? 'gitHistory' : 'gitBranches')}
            </button>
          ))}
        </div>
      </div>

      {/* Remote / GitHub connector */}
      {!hasRemote && st?.isRepo && (
        <div className="git-connect">
          <div className="git-connect-title">
            <Icon name="cloud" size={15} /> {t('gitNoRemote')}
          </div>
          <div className="git-connect-actions">
            <button className="primary" onClick={() => setState({ modal: { kind: 'publish' } })}>
              {t('ghPublish')}
            </button>
            <button
              onClick={async () => {
                const url = (await askText(t('gitRemoteUrl')))?.trim();
                if (url) void act('remote', () => api().git.addRemote(url), t('gitRemoteAdded'));
              }}
            >
              {t('gitAddRemote')}
            </button>
          </div>
        </div>
      )}
      {gh && !gh.loggedIn && (
        <div className="git-gh-hint">
          {gh.installed ? t('ghNotLogged') : t('ghNotInstalled')}{' '}
          {gh.installed ? (
            <button
              className="link"
              onClick={() => {
                setState({ panelOpen: true });
                setTimeout(() => void runInTerminal('gh auth login --web'), 300);
              }}
            >
              {t('ghLogin')}
            </button>
          ) : (
            <button
              className="link"
              onClick={() => void api().app.openExternal('https://cli.github.com/')}
            >
              cli.github.com
            </button>
          )}
        </div>
      )}

      {view === 'changes' && (
        <>
          <div className="git-commit">
            <textarea
              value={message}
              rows={3}
              placeholder={t('gitMessage', { branch: st?.branch ?? '' })}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void commit();
                }
              }}
            />
            <div className="git-commit-bar">
              <button
                className="primary"
                disabled={
                  busy !== null || (!message.trim() && !amend) || (!st?.files.length && !amend)
                }
                onClick={() => void commit()}
                title="Ctrl+Enter"
              >
                <Icon name="check" size={14} />{' '}
                {staged.length || amend ? t('gitCommit') : t('gitCommitAll')}
              </button>
              <button
                disabled={busy !== null || !st?.files.length}
                onClick={() => void generate()}
                title={t('gitAiMessageTitle')}
              >
                {busy === 'ai' ? '…' : <Icon name="sparkles" size={14} />} {t('gitAiMessage')}
              </button>
              <label className="check" title={t('gitAmendTitle')}>
                <input
                  type="checkbox"
                  checked={amend}
                  disabled={!st?.hasCommits}
                  onChange={(e) => setAmend(e.target.checked)}
                />
                {t('gitAmend')}
              </label>
            </div>
          </div>
          <div className="tree git-list">
            {busy && (
              <div className="git-busy">
                <Icon name="clock" size={13} className="spin-slow" /> {busy}…
              </div>
            )}
            {staged.length > 0 && (
              <>
                <div className="git-group">
                  <span>
                    {t('gitStaged')} <span className="git-count">{staged.length}</span>
                  </span>
                  <button
                    title={t('gitUnstageAll')}
                    onClick={() => void act('stage', () => api().git.unstage([]))}
                  >
                    −
                  </button>
                </div>
                {staged.map((f) => row(f, true))}
              </>
            )}
            <div className="git-group">
              <span>
                {t('gitUnstaged')} <span className="git-count">{unstaged.length}</span>
              </span>
              {unstaged.length > 0 && (
                <span>
                  <button
                    title={t('gitDiscardAll')}
                    onClick={() => {
                      if (!confirm(t('gitDiscardAllConfirm', { n: unstaged.length }))) return;
                      void act('discard', () => api().git.discard(unstaged.map((f) => f.path)));
                    }}
                  >
                    <Icon name="undo" size={15} />
                  </button>
                  <button
                    title={t('gitStageAll')}
                    onClick={() => void act('stage', () => api().git.stage([]))}
                  >
                    +
                  </button>
                </span>
              )}
            </div>
            {unstaged.map((f) => row(f, false))}
            {st && st.files.length === 0 && (
              <div className="git-clean">
                <Icon name="check" size={14} /> {t('gitClean')}
              </div>
            )}
          </div>
        </>
      )}

      {view === 'history' && (
        <div className="tree git-list">
          {log.length === 0 && <div className="git-clean">{t('gitNoCommits')}</div>}
          {log.map((c) => (
            <div
              key={c.hash}
              className="git-commit-row"
              title={`${c.hash}\n${c.author} · ${c.date}`}
              onClick={() =>
                setState({ modal: { kind: 'commit', hash: c.hash, subject: c.subject } })
              }
            >
              <div className="git-commit-subject">
                {c.subject}
                {c.refs && (
                  <span className="git-refs">
                    {c.refs
                      .split(',')
                      .map((r) => r.trim().replace(/^HEAD -> /, ''))
                      .filter(Boolean)
                      .slice(0, 3)
                      .map((r) => (
                        <span key={r} className="git-ref">
                          {r}
                        </span>
                      ))}
                  </span>
                )}
              </div>
              <div className="git-commit-meta">
                <code>{c.short}</code> · {c.author} · {c.date}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'branches' && (
        <div className="tree git-list">
          <div className="git-group">
            <span>{t('gitBranches')}</span>
            <button
              title={t('gitNewBranch')}
              onClick={async () => {
                const name = (await askText(t('gitNewBranch')))?.trim();
                if (name)
                  void act('branch', async () => {
                    await api().git.checkout(name, true);
                    setBranches(await api().git.branches());
                  });
              }}
            >
              <Icon name="plus" size={15} />
            </button>
          </div>
          {branches.map((b) => (
            <div
              key={(b.remote ? 'r:' : 'l:') + b.name}
              className={`git-row ${b.current ? 'current' : ''}`}
              onClick={() => {
                if (b.current) return;
                void act(
                  'checkout',
                  async () => {
                    await api().git.checkout(b.name, false);
                    setBranches(await api().git.branches());
                  },
                  t('gitSwitched', { name: b.name }),
                );
              }}
            >
              <span className="git-icon">
                <Icon name={b.remote ? 'cloud' : 'branch'} size={14} />
              </span>
              <span className="git-name">{b.name}</span>
              <span className="git-dir">{b.upstream ?? ''}</span>
              {!b.current && !b.remote && (
                <span className="git-row-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    title={t('gitDeleteBranch')}
                    onClick={() => {
                      if (!confirm(t('gitDeleteBranchConfirm', { name: b.name }))) return;
                      void act('branch', async () => {
                        await api()
                          .git.deleteBranch(b.name, false)
                          .catch(async (e) => {
                            if (!confirm(t('gitForceDelete'))) throw e;
                            await api().git.deleteBranch(b.name, true);
                          });
                        setBranches(await api().git.branches());
                      });
                    }}
                  >
                    <Icon name="trash" size={14} />
                  </button>
                </span>
              )}
              {b.current && <span className="git-badge added">●</span>}
            </div>
          ))}
          {hasRemote && (
            <button className="link git-fetch" onClick={() => void sync('fetch')}>
              ⟳ {t('gitFetch')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
