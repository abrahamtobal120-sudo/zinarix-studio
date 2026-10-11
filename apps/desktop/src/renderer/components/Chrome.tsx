import { useEffect, useState } from 'react';
import { runCommand } from '../commands';
import { t } from '../i18n';
import { Icon, type IconName } from './Icon';
import {
  BROWSER_TAB,
  SECURITY_TAB,
  activate,
  api,
  getState,
  openBrowserTab,
  openDropped,
  openSecurityTab,
  setState,
  useStore,
} from '../store';

export function ActivityBar() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const browserActive = useStore((s) => s.active === BROWSER_TAB);
  const active = useStore((s) => s.active);
  const gitChanges = useStore((s) => s.gitChanges);
  const item = (
    active: boolean,
    title: string,
    icon: IconName,
    onClick: () => void,
    badge?: number,
  ) => (
    <button
      className={`activity ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      <Icon name={icon} size={21} />
      {badge ? <span className="activity-badge">{badge > 99 ? '99+' : badge}</span> : null}
    </button>
  );
  return (
    <nav className="activity-bar">
      {item(sidebar === 'explorer', t('explorer'), 'files', () =>
        setState({ sidebar: sidebar === 'explorer' ? null : 'explorer' }),
      )}
      {item(sidebar === 'search', t('search'), 'search', () =>
        setState({ sidebar: sidebar === 'search' ? null : 'search' }),
      )}
      {item(
        sidebar === 'git',
        t('gitTitle'),
        'git',
        () => setState({ sidebar: sidebar === 'git' ? null : 'git' }),
        gitChanges,
      )}
      {item(sidebar === 'run', t('runTitle'), 'run', () =>
        setState({ sidebar: sidebar === 'run' ? null : 'run' }),
      )}
      {item(chatOpen, t('chat'), 'sparkles', () => setState({ chatOpen: !chatOpen }))}
      {item(panelOpen, t('terminal'), 'terminal', () => setState({ panelOpen: !panelOpen }))}
      {item(browserActive, t('browser'), 'globe', () => {
        if (browserActive) {
          const other = getState().tabs.find((x) => x.path !== BROWSER_TAB);
          activate(other?.path ?? null);
        } else openBrowserTab();
      })}
      <div className="spacer" />
      {item(active === '::security', t('securityTitle'), 'shield', () => openSecurityTab())}
      {item(false, t('usageTitle'), 'chart', () => setState({ modal: { kind: 'usage' } }))}
      {item(false, t('providers'), 'key', () => setState({ modal: { kind: 'providers' } }))}
      {item(false, t('cmdPalette'), 'menu', () => setState({ modal: { kind: 'palette' } }))}
      {item(false, t('settings'), 'settings', () => setState({ modal: { kind: 'settings' } }))}
    </nav>
  );
}

function usd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

export function StatusBar() {
  const workspace = useStore((s) => s.workspace);
  const settings = useStore((s) => s.settings);
  const cursor = useStore((s) => s.cursor);
  const active = useStore((s) =>
    s.active === BROWSER_TAB || s.active === SECURITY_TAB ? null : s.active,
  );
  const tabs = useStore((s) => s.tabs);
  const prefs = useStore((s) => s.prefs);
  const gitChanges = useStore((s) => s.gitChanges);
  const dirty = tabs.filter((x) => x.dirty).length;
  const [provider, ...rest] = (settings.defaultModel ?? '').split('/');
  return (
    <footer className="status-bar">
      <span className="status-item" onClick={() => void api().workspace.openDialog()}>
        <Icon name="folder" size={13} /> {workspace?.name ?? t('openFolder')}
      </span>
      {workspace?.branch && (
        <span
          className="status-item"
          title={t('gitTitle')}
          onClick={() => setState({ sidebar: 'git' })}
        >
          <Icon name="branch" size={13} /> {workspace.branch}
          {gitChanges > 0 ? ` · ${gitChanges}✎` : ''}
        </span>
      )}
      {dirty > 0 && (
        <span className="status-item" onClick={() => void runCommand('file.saveAll')}>
          ● {dirty}
        </span>
      )}
      <span className="spacer" />
      {active && (
        <span className="status-item">{t('ln', { l: cursor.line, c: cursor.column })}</span>
      )}
      {active && <span className="status-item">{getState().active?.split('.').pop()}</span>}
      {active && (
        <span
          className={`status-item ${prefs.inlineCompletions ? '' : 'off'}`}
          title={t('setInlineHint')}
          onClick={() => void runCommand('ai.toggleInline')}
        >
          {prefs.inlineCompletions ? '✨' : '✧'} {t('inlineShort')}
        </span>
      )}
      {settings.localOnly && (
        <span className="status-item local" onClick={() => void runCommand('ai.toggleLocal')}>
          <Icon name="lock" size={13} /> {t('localOnly')}
        </span>
      )}
      <span
        className="status-item model"
        title={t('pickModel')}
        onClick={() => setState({ modal: { kind: 'models' } })}
      >
        <Icon name="bolt" size={13} />{' '}
        {settings.defaultModel ? `${provider} · ${rest.join('/')}` : t('noModel')}
      </span>
      <span
        className="status-item"
        title={t('usageTitle')}
        onClick={() => setState({ modal: { kind: 'usage' } })}
      >
        <Icon name="chart" size={13} /> {usd(settings.todayUsd)} {t('today')}
      </span>
    </footer>
  );
}

export function Welcome() {
  const workspace = useStore((s) => s.workspace);
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    if (!workspace) void api().workspace.recent().then(setRecent);
  }, [workspace]);
  const row = (label: string, keys: string, id: string) => (
    <div className="welcome-row" onClick={() => void runCommand(id)}>
      <span>{label}</span>
      <kbd>{keys}</kbd>
    </div>
  );
  return (
    <div className="welcome">
      <img className="welcome-logo" src="./logo.svg" alt="Zinarix Studio" />
      <h1>{t('welcomeTitle')}</h1>
      <p className="dim">{t('welcomeSub')}</p>
      {!workspace ? (
        <>
          <div className="drop-zone" onClick={() => void api().workspace.openDialog()}>
            <div className="drop-icon">📂</div>
            <div className="drop-title">{t('dropHere')}</div>
            <div className="dim">{t('dropOr')}</div>
            <button className="primary big">{t('openFolder')}</button>
          </div>
          {recent.length > 0 && (
            <div className="recent">
              <div className="recent-title">{t('recentFolders')}</div>
              {recent.map((r) => (
                <div
                  key={r.path}
                  className="recent-row"
                  onClick={() => void openDropped(r.path)}
                  title={r.path}
                >
                  <span>📁 {r.name}</span>
                  <span className="dim">{r.path}</span>
                </div>
              ))}
            </div>
          )}
          <button className="link" onClick={() => setState({ modal: { kind: 'providers' } })}>
            🔑 {t('connectProvider')}
          </button>
        </>
      ) : (
        <>
          <div className="welcome-actions">
            <button
              className="primary big"
              onClick={() => setState({ modal: { kind: 'providers' } })}
            >
              <Icon name="key" size={16} /> {t('connectProvider')}
            </button>
            <button className="big" onClick={() => setState({ chatOpen: true })}>
              <Icon name="sparkles" size={16} /> {t('chat')}
            </button>
          </div>
          <div className="welcome-keys">
            {row(t('welcomeQuickOpen'), 'Ctrl+P', 'quickOpen')}
            {row(t('cmdPalette'), 'Ctrl+Shift+P', 'palette')}
            {row(t('aiEdit'), 'Ctrl+K', 'ai.edit')}
            {row(t('welcomeAsk'), 'Ctrl+L', 'ai.askSelection')}
            {row(t('pickModel'), 'Ctrl+Alt+M', 'ai.pickModel')}
            {row(t('terminal'), 'Ctrl+`', 'view.terminal')}
          </div>
        </>
      )}
    </div>
  );
}
