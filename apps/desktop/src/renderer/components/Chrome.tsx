import { useEffect, useState, type CSSProperties } from 'react';
import { commands, runCommand } from '../commands';
import { pressable } from '../a11y';
import { t } from '../i18n';
import { Icon, TONE, type IconName } from './Icon';
import { PlanBadge } from './Plan';
import { tv } from './video/strings';
import { td } from '../i18nDebug';
import { tp } from '../i18nPlayground';
import { useProblemCounts } from './Problems';
import { useDebug } from '../debug';
import { toggleStudio, useV } from './video/videoStore';
import {
  BROWSER_TAB,
  PLAYGROUND_TAB,
  openPlaygroundTab,
  activate,
  api,
  getState,
  openBrowserTab,
  openDropped,
  openSecurityTab,
  openWhatsAppTab,
  WHATSAPP_TAB,
  setState,
  toggleMaximized,
  useStore,
} from '../store';

type Kind = 'view' | 'toggle' | 'action';
interface BarItem {
  key: string;
  title: string;
  icon: IconName;
  on: boolean;
  run: () => void;
  badge?: number;
  /** view: picks the side panel (accent marker); toggle: shows/hides something; action: opens a window. */
  kind: Kind;
}

/** The activity bar's buttons, shared with the "Más" panel so both open things the same way. */
function useBarItems() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const browserActive = useStore((s) => s.active === BROWSER_TAB);
  const whatsappActive = useStore((s) => s.active === WHATSAPP_TAB);
  const whatsappUnread = useStore((s) => s.whatsapp?.unread ?? 0);
  const active = useStore((s) => s.active);
  const gitChanges = useStore((s) => s.gitChanges);
  const sideMax = useStore((s) => s.maximized === 'side');
  const watchNew = useStore((s) => s.watch?.reports.filter((r) => !r.seen).length ?? 0);
  const videoOn = useV((s) => s.open && !s.minimized);
  type View = Exclude<typeof sidebar, null>;
  const view = (key: View, title: string, icon: IconName, badge?: number): BarItem => ({
    key,
    title,
    icon,
    badge,
    kind: 'view',
    on: sidebar === key,
    run: () => setState({ sidebar: sidebar === key ? null : key }),
  });
  const leaveTab = () => {
    const other = getState().tabs.find((x) => x.path !== BROWSER_TAB && x.path !== WHATSAPP_TAB);
    activate(other?.path ?? null);
  };
  const tool = (
    key: string,
    title: string,
    icon: IconName,
    kind: Kind,
    on: boolean,
    run: () => void,
    badge?: number,
  ): BarItem => ({ key, title, icon, kind, on, run, badge });
  const items = {
    explorer: view('explorer', t('explorer'), 'files'),
    search: view('search', t('search'), 'search'),
    git: view('git', t('gitTitle'), 'git', gitChanges),
    run: view('run', t('runTitle'), 'run'),
    debug: view('debug', td('dbgBarTip'), 'bug'),
    testing: view('testing', t('teBarTip'), 'beaker'),
    chat: tool('chat', t('chat'), 'agent', 'toggle', chatOpen, () =>
      setState({ chatOpen: !chatOpen }),
    ),
    watch: view('watch', t('wtBarTip'), 'eye', watchNew),
    design: tool('design', t('dzTitle'), 'palette', 'view', sidebar === 'design', () =>
      setState({ sidebar: sidebar === 'design' ? 'explorer' : 'design', maximized: null }),
    ),
    video: tool('video', tv('openStudioHint'), 'film', 'toggle', videoOn, toggleStudio),
    terminal: tool('terminal', t('terminal'), 'terminal', 'toggle', panelOpen, () =>
      setState({ panelOpen: !panelOpen }),
    ),
    vercel: view('vercel', 'Vercel', 'vercel'),
    supabase: view('supabase', 'Supabase', 'supabase'),
    gcloud: view('gcloud', 'Google Cloud', 'cloud'),
    mail: view('mail', t('mlTitle'), 'mail'),
    browser: tool('browser', t('browser'), 'globe', 'toggle', browserActive, () =>
      browserActive ? leaveTab() : openBrowserTab(),
    ),
    whatsapp: tool(
      'whatsapp',
      'WhatsApp',
      'whatsapp',
      'toggle',
      whatsappActive,
      () => (whatsappActive ? leaveTab() : openWhatsAppTab()),
      whatsappUnread,
    ),
    more: view('apps', t('appsTitle'), 'layers'),
    maximize: tool(
      'maximize',
      sideMax ? t('restoreSize') : t('maximizeSide'),
      sideMax ? 'minimize' : 'maximize',
      'toggle',
      sideMax,
      () => toggleMaximized('side'),
    ),
    security: tool('security', t('securityTitle'), 'shield', 'toggle', active === '::security', () =>
      openSecurityTab(),
    ),
    playground: tool(
      'playground',
      tp('pgOpen'),
      'sparkle',
      'toggle',
      active === PLAYGROUND_TAB,
      () => openPlaygroundTab(),
    ),
    usage: tool('usage', t('usageTitle'), 'chart', 'action', false, () =>
      setState({ modal: { kind: 'usage' } }),
    ),
    providers: tool('providers', t('providers'), 'key', 'action', false, () =>
      setState({ modal: { kind: 'providers' } }),
    ),
    palette: tool('palette', t('cmdPalette'), 'menu', 'action', false, () =>
      setState({ modal: { kind: 'palette' } }),
    ),
    settings: tool('settings', t('settings'), 'settings', 'action', false, () =>
      setState({ modal: { kind: 'settings' } }),
    ),
  };
  return { items, sidebar, browserActive, whatsappActive, whatsappUnread };
}

/**
 * Left bar, in groups: work (files, search, git, run, debug) · AI (chat, watcher) · create
 * (design, video, terminal) · cloud (Vercel, Supabase, Google Cloud) · messages and web (mail,
 * WhatsApp, browser) · and, at the bottom, security, usage, providers, palette and settings.
 * Every tool keeps its own button. Side views get an accent marker on the left; toggles
 * (chat, terminal...) only light up.
 */
export function ActivityBar() {
  const { items, sidebar, browserActive, whatsappActive } = useBarItems();
  const [tip, setTip] = useState<{ text: string; y: number } | null>(null);
  // The browser and WhatsApp are native views drawn above the page: over them the custom
  // tooltip would be hidden, so the system one is used instead.
  const nativeOver = (browserActive || whatsappActive) && !sidebar;
  const showTip = (el: HTMLElement, text: string) => {
    const r = el.getBoundingClientRect();
    setTip({ text, y: r.top + r.height / 2 });
  };
  const button = (it: BarItem) => {
    const n = it.badge ?? 0;
    const label = n ? t('badgeCount', { title: it.title, n: n > 99 ? '99+' : n }) : it.title;
    return (
      <button
        key={it.key}
        className={`activity${it.on ? ' active' : ''}${it.kind === 'view' ? ' is-view' : ''}`}
        title={nativeOver ? it.title : undefined}
        aria-label={label}
        aria-pressed={it.kind === 'action' ? undefined : it.on}
        onClick={() => {
          setTip(null);
          it.run();
        }}
        onMouseEnter={(e) => showTip(e.currentTarget, it.title)}
        onFocus={(e) => showTip(e.currentTarget, it.title)}
        onMouseLeave={() => setTip(null)}
        onBlur={() => setTip(null)}
      >
        <Icon name={it.icon} size={20} />
        {n ? (
          <span className="activity-badge" aria-hidden="true">
            {n > 99 ? '99+' : n}
          </span>
        ) : null}
      </button>
    );
  };
  const sep = (key: string) => <div key={key} className="activity-sep" aria-hidden="true" />;
  return (
    <nav className="activity-bar" aria-label={t('appsBar')}>
      {button(items.explorer)}
      {button(items.search)}
      {button(items.git)}
      {button(items.run)}
      {button(items.debug)}
      {button(items.testing)}
      {sep('s1')}
      {button(items.chat)}
      {button(items.watch)}
      {sep('s2')}
      {button(items.design)}
      {button(items.video)}
      {button(items.terminal)}
      {sep('s3')}
      {button(items.vercel)}
      {button(items.supabase)}
      {button(items.gcloud)}
      {sep('s4')}
      {button(items.mail)}
      {button(items.whatsapp)}
      {button(items.browser)}
      <div className="spacer" />
      {sidebar && sidebar !== 'design' && button(items.maximize)}
      {button(items.security)}
      {button(items.playground)}
      {button(items.usage)}
      {button(items.providers)}
      {button(items.palette)}
      {button(items.settings)}
      {tip && !nativeOver && (
        <div className="activity-tip" role="tooltip" style={{ top: tip.y }}>
          {tip.text}
        </div>
      )}
    </nav>
  );
}

/** "Más": the integrations and tools that do not have their own button in the bar. */
export function AppsPanel() {
  const { items } = useBarItems();
  const row = (it: BarItem, desc: string) => (
    <button
      key={it.key}
      className={`apps-item${it.on ? ' on' : ''}`}
      aria-pressed={it.kind === 'action' ? undefined : it.on}
      onClick={it.run}
    >
      <span className="apps-icon">
        <Icon name={it.icon} size={18} />
      </span>
      <span className="apps-text">
        <span className="apps-name">{it.title}</span>
        <span className="apps-desc">{desc}</span>
      </span>
      {it.badge ? <span className="apps-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
    </button>
  );
  return (
    <div className="explorer apps-panel">
      <div className="sidebar-title">
        <span className="panel-title">{t('appsTitle').toUpperCase()}</span>
      </div>
      <div className="apps-body">
        <div className="apps-section">{t('appsIntegrations')}</div>
        {row(items.vercel, t('appsVercel'))}
        {row(items.supabase, t('appsSupabase'))}
        {row(items.gcloud, t('appsGcloud'))}
        {row(items.mail, t('appsMail'))}
        {row(items.whatsapp, t('appsWhatsapp'))}
        {row(items.browser, t('appsBrowser'))}
        <div className="apps-section">{t('appsTools')}</div>
        {row(items.playground, tp('pgTab'))}
        {row(items.usage, t('appsUsage'))}
        {row(items.palette, t('appsPalette'))}
      </div>
    </div>
  );
}

function usd(n: number): string {
  return n < 0.01 && n > 0 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

function ProblemStatus() {
  const { errors, warnings } = useProblemCounts();
  return (
    <span
      className="status-item"
      title={td('probTitle')}
      aria-label={td('probCount', { e: errors, w: warnings })}
      {...pressable(() => setState({ panelOpen: true, panelView: 'problems' }))}
    >
      <span className={errors ? 'status-err' : ''}>⊗ {errors}</span>{' '}
      <span className={warnings ? 'status-warn' : ''}>⚠ {warnings}</span>
    </span>
  );
}

function DebugStatus() {
  const state = useDebug((v) => v.state);
  const name = useDebug((v) => v.name);
  if (state === 'idle') return null;
  return (
    <span
      className="status-item status-debug"
      title={td('dbgTitle')}
      {...pressable(() => setState({ sidebar: 'debug' }))}
    >
      <Icon name="bug" size={13} /> {name ?? td('dbgTitle')}
    </span>
  );
}

export function StatusBar() {
  const workspace = useStore((s) => s.workspace);
  const settings = useStore((s) => s.settings);
  const cursor = useStore((s) => s.cursor);
  const active = useStore((s) => (s.active?.startsWith('::') ? null : s.active));
  const tabs = useStore((s) => s.tabs);
  const prefs = useStore((s) => s.prefs);
  const gitChanges = useStore((s) => s.gitChanges);
  const dirty = tabs.filter((x) => x.dirty).length;
  const [provider, ...rest] = (settings.defaultModel ?? '').split('/');
  return (
    <footer className="status-bar">
      <span className="status-item" {...pressable(() => void api().workspace.openDialog())}>
        <Icon name="folder" size={13} /> {workspace?.name ?? t('openFolder')}
      </span>
      {workspace?.branch && (
        <span
          className="status-item"
          title={t('gitTitle')}
          {...pressable(() => setState({ sidebar: 'git' }))}
        >
          <Icon name="branch" size={13} /> {workspace.branch}
          {gitChanges > 0 ? ` · ${gitChanges}` : ''}
        </span>
      )}
      <ProblemStatus />
      <DebugStatus />
      {dirty > 0 && (
        <span className="status-item" {...pressable(() => void runCommand('file.saveAll'))}>
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
          {...pressable(() => void runCommand('ai.toggleInline'))}
        >
          <Icon name="agent" size={13} /> {t('inlineShort')}
        </span>
      )}
      {settings.localOnly && (
        <span className="status-item local" {...pressable(() => void runCommand('ai.toggleLocal'))}>
          <Icon name="lock" size={13} /> {t('localOnly')}
        </span>
      )}
      <span
        className="status-item model"
        title={t('pickModel')}
        {...pressable(() => setState({ modal: { kind: 'models' } }))}
      >
        <Icon name="bolt" size={13} />{' '}
        {settings.defaultModel ? `${provider} · ${rest.join('/')}` : t('noModel')}
      </span>
      <span
        className="status-item"
        title={t('usageTitle')}
        {...pressable(() => setState({ modal: { kind: 'usage' } }))}
      >
        <Icon name="chart" size={13} /> {usd(settings.todayUsd)} {t('today')}
      </span>
      <PlanBadge />
    </footer>
  );
}

export function Welcome() {
  const workspace = useStore((s) => s.workspace);
  const [recent, setRecent] = useState<{ path: string; name: string }[]>([]);
  useEffect(() => {
    if (!workspace) void api().workspace.recent().then(setRecent);
  }, [workspace]);
  // Shortcut text from the command table, so it shows ⌘ on macOS and the user's own bindings.
  const keyOf = new Map(commands().map((c) => [c.id, c.keys ?? ''] as const));
  const openFolder = () => void api().workspace.openDialog();
  const row = (label: string, id: string, icon: IconName) => (
    <div className="welcome-row" {...pressable(() => void runCommand(id))}>
      <span className="welcome-row-label">
        <span
          className="tone-badge"
          style={{ '--tone': TONE[icon] ?? 'var(--brand)' } as CSSProperties}
        >
          <Icon name={icon} size={14} />
        </span>
        {label}
      </span>
      {keyOf.get(id) ? <kbd>{keyOf.get(id)}</kbd> : null}
    </div>
  );
  return (
    <div className="welcome">
      <img className="welcome-logo" src="./logo.svg" alt="Zinarix Studio" />
      <h1>{t('welcomeTitle')}</h1>
      <p className="dim">{t('welcomeSub')}</p>
      {!workspace ? (
        <>
          {/* The whole zone is a mouse target; the button inside is the keyboard control (a
              role="button" around a <button> would nest two buttons). */}
          <div className="drop-zone" onClick={openFolder}>
            <div className="drop-icon">
              <Icon name="folder" size={30} />
            </div>
            <div className="drop-title">{t('dropHere')}</div>
            <div className="dim">{t('dropOr')}</div>
            <button
              className="primary big"
              onClick={(e) => {
                e.stopPropagation();
                openFolder();
              }}
            >
              {t('openFolder')}
            </button>
          </div>
          {recent.length > 0 && (
            <div className="recent">
              <div className="recent-title">{t('recentFolders')}</div>
              {recent.map((r) => (
                <div
                  key={r.path}
                  className="recent-row"
                  {...pressable(() => void openDropped(r.path))}
                  title={r.path}
                >
                  <span>
                    <Icon name="folder" size={13} /> {r.name}
                  </span>
                  <span className="dim">{r.path}</span>
                </div>
              ))}
            </div>
          )}
          <button className="link" onClick={() => setState({ modal: { kind: 'providers' } })}>
            <Icon name="key" size={13} /> {t('connectProvider')}
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
              <Icon name="agent" size={16} /> {t('chat')}
            </button>
          </div>
          <div className="welcome-keys">
            {row(t('welcomeQuickOpen'), 'quickOpen', 'search')}
            {row(t('cmdPalette'), 'palette', 'menu')}
            {row(t('aiEdit'), 'ai.edit', 'edit')}
            {row(t('welcomeAsk'), 'ai.askSelection', 'message')}
            {row(t('pickModel'), 'ai.pickModel', 'thinking')}
            {row(t('terminal'), 'view.terminal', 'terminal')}
          </div>
        </>
      )}
    </div>
  );
}
