import { useEffect, useMemo, useRef, useState } from 'react';
import type { GitHubRepoView, GitHubStatus } from '../../shared/api';
import { t } from '../i18n';
import { languageFor, monaco } from '../monaco';
import { api, openFile, setState, toast, useStore } from '../store';
import { monacoTheme } from '../themes';

const close = () => setState({ modal: null });
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
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="git-diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="git-diff-head">
          <b>{path}</b>
          <span className="dim">{staged ? t('gitDiffStaged') : t('gitDiffWorking')}</span>
          <span className="spacer" />
          <button
            onClick={() => {
              close();
              void openFile(path);
            }}
          >
            📄 {t('gitOpenFile')}
          </button>
          <button onClick={close}>×</button>
        </div>
        <div className="git-diff-host" ref={host} />
      </div>
    </div>
  );
}

/** Patch of a commit from the history. */
export function CommitView({ hash, subject }: { hash: string; subject: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    api()
      .git.show(hash)
      .then(setText)
      .catch((e) => setText(errText(e)));
  }, [hash]);
  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="git-diff-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="git-diff-head">
          <b>{subject}</b>
          <code className="dim">{hash.slice(0, 10)}</code>
          <span className="spacer" />
          <button onClick={close}>×</button>
        </div>
        <pre className="git-patch">
          {text.split('\n').map((l, i) => (
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
        </pre>
      </div>
    </div>
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
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="usage gh-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} disabled={busy} aria-label={t('close')}>
          ×
        </button>
        <h2>⤓ {t('gitClone')}</h2>
        <p className="dim">{t('gitCloneIntro')}</p>
        <div className="gh-row">
          <input
            autoFocus
            value={spec}
            placeholder="https://github.com/usuario/repo.git · usuario/repo"
            onChange={(e) => setSpec(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void clone(spec)}
          />
          <button
            className="primary"
            disabled={busy || !spec.trim()}
            onClick={() => void clone(spec)}
          >
            {busy ? '⏳' : t('gitCloneBtn')}
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
                placeholder={t('ghFilter', { n: repos.length })}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="gh-repos">
                {shown.map((r) => (
                  <div key={r.name} className="gh-repo" onClick={() => !busy && void clone(r.name)}>
                    <div className="gh-repo-name">
                      {r.private ? '🔒' : '📖'} {r.name}
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
      </div>
    </div>
  );
}

/** Creates a GitHub repository from the open folder and uploads it. */
export function PublishRepo() {
  const workspace = useStore((s) => s.workspace);
  const [gh, setGh] = useState<GitHubStatus | null>(null);
  const [name, setName] = useState(workspace?.name ?? '');
  const [desc, setDesc] = useState('');
  const [vis, setVis] = useState<'private' | 'public'>('private');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api().github.status().then(setGh);
  }, []);

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
    <div className="modal-backdrop" onMouseDown={busy ? undefined : close}>
      <div className="usage gh-modal" onMouseDown={(e) => e.stopPropagation()}>
        <button className="modal-x" onClick={close} disabled={busy} aria-label={t('close')}>
          ×
        </button>
        <h2>☁ {t('ghPublish')}</h2>
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
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label className="settings-field">
              <span>{t('ghRepoDesc')}</span>
              <input value={desc} onChange={(e) => setDesc(e.target.value)} />
            </label>
            <div className="gh-vis">
              <label className="check">
                <input
                  type="radio"
                  checked={vis === 'private'}
                  onChange={() => setVis('private')}
                />
                🔒 {t('ghPrivate')}
              </label>
              <label className="check">
                <input type="radio" checked={vis === 'public'} onChange={() => setVis('public')} />
                📖 {t('ghPublic')}
              </label>
            </div>
            <div className="gh-row end">
              <button onClick={close} disabled={busy}>
                {t('cancel')}
              </button>
              <button
                className="primary"
                disabled={busy || !gh?.loggedIn || !name.trim()}
                onClick={() => void publish()}
              >
                {busy ? '⏳' : `☁ ${t('ghPublishBtn')}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
