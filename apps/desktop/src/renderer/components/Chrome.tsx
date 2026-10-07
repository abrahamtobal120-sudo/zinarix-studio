import { useEffect, useState } from 'react';
import { runCommand } from '../commands';
import { t } from '../i18n';
import { api, getState, openDropped, setState, useStore } from '../store';

export function ActivityBar() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const item = (active: boolean, title: string, icon: string, onClick: () => void) => (
    <button
      className={`activity ${active ? 'active' : ''}`}
      title={title}
      aria-label={title}
      onClick={onClick}
    >
      {icon}
    </button>
  );
  return (
    <nav className="activity-bar">
      {item(sidebar === 'explorer', t('explorer'), '🗂', () =>
        setState({ sidebar: sidebar === 'explorer' ? null : 'explorer' }),
      )}
      {item(sidebar === 'search', t('search'), '🔍', () =>
        setState({ sidebar: sidebar === 'search' ? null : 'search' }),
      )}
      {item(chatOpen, t('chat'), '✨', () => setState({ chatOpen: !chatOpen }))}
      {item(panelOpen, t('terminal'), '⌨', () => setState({ panelOpen: !panelOpen }))}
      <div className="spacer" />
      {item(false, t('usageTitle'), '📊', () => setState({ modal: { kind: 'usage' } }))}
      {item(false, t('providers'), '🔑', () => setState({ modal: { kind: 'providers' } }))}
      {item(false, 'Paleta de comandos', '⚙', () => setState({ modal: { kind: 'palette' } }))}
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
  const active = useStore((s) => s.active);
  const tabs = useStore((s) => s.tabs);
  const dirty = tabs.filter((x) => x.dirty).length;
  const [provider, ...rest] = (settings.defaultModel ?? '').split('/');
  return (
    <footer className="status-bar">
      <span className="status-item" onClick={() => void api().workspace.openDialog()}>
        📁 {workspace?.name ?? t('openFolder')}
      </span>
      {workspace?.branch && <span className="status-item">⎇ {workspace.branch}</span>}
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
      {settings.localOnly && (
        <span className="status-item local" onClick={() => void runCommand('ai.toggleLocal')}>
          🔒 {t('localOnly')}
        </span>
      )}
      <span
        className="status-item model"
        title={t('pickModel')}
        onClick={() => setState({ modal: { kind: 'models' } })}
      >
        ⚡ {settings.defaultModel ? `${provider} · ${rest.join('/')}` : t('noModel')}
      </span>
      <span
        className="status-item"
        title={t('usageTitle')}
        onClick={() => setState({ modal: { kind: 'usage' } })}
      >
        📊 {usd(settings.todayUsd)} {t('today')}
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
            <button className="big" onClick={() => setState({ modal: { kind: 'providers' } })}>
              🔑 {t('connectProvider')}
            </button>
          </div>
          <div className="welcome-keys">
            {row('Apertura rápida', 'Ctrl+P', 'quickOpen')}
            {row('Paleta de comandos', 'Ctrl+Shift+P', 'palette')}
            {row(t('aiEdit'), 'Ctrl+K', 'ai.edit')}
            {row('Preguntar a la IA', 'Ctrl+L', 'ai.askSelection')}
            {row(t('pickModel'), 'Ctrl+Alt+M', 'ai.pickModel')}
            {row(t('terminal'), 'Ctrl+`', 'view.terminal')}
          </div>
        </>
      )}
    </div>
  );
}
