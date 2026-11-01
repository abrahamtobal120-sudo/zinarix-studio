import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { isDark } from '../themes';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { ChatContext } from '../../shared/api';
import { t } from '../i18n';
import { api, attachToChat, getState, setState, toast, useStore } from '../store';
import { Icon } from './Icon';

interface Term {
  id: number;
  xterm: XTerm;
  fit: FitAddon;
  el: HTMLDivElement;
  /** Shell shown on the tab ("PowerShell 7", "Git Bash", "admin"…). */
  name: string;
}

const terms = new Map<number, Term>();
let unsubscribe: (() => void) | undefined;
/** Exit handler of the mounted panel (null while the panel is hidden). */
let exitHandler: ((id: number) => void) | null = null;
/** First session being created, so a StrictMode re-run of the mount effect does not open a second one. */
let firstCreate: Promise<number | null> | null = null;
/** Session shown in the panel (module level so the chat and commands can reach it). */
let activeId: number | null = null;

/** Most recent lines sent to the chat when attaching a whole session. */
const MAX_LINES = 400;
const MAX_CHARS = 40_000;

/** Number shown on the tab ("1: shell") for a session. */
function terminalNumber(id: number): number {
  return [...terms.keys()].indexOf(id) + 1;
}

export interface TerminalSession {
  id: number;
  n: number;
  hasSelection: boolean;
}

/** Open terminal sessions, in tab order. */
export function listTerminals(): TerminalSession[] {
  return [...terms.values()].map((term, i) => ({
    id: term.id,
    n: i + 1,
    hasSelection: term.xterm.getSelection().trim().length > 0,
  }));
}

/** True when the keyboard focus is inside the terminal panel. */
export function terminalFocused(): boolean {
  return Boolean(document.activeElement?.closest('.terminal-host'));
}

/** Plain text of a session (wrapped rows joined, trailing blank rows dropped, tail only). */
function sessionText(term: Term): string {
  const buf = term.xterm.buffer.active;
  const lines: string[] = [];
  for (let i = 0; i < buf.length; i++) {
    const line = buf.getLine(i);
    if (!line) continue;
    const text = line.translateToString(true);
    if (line.isWrapped && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  const text = lines.slice(-MAX_LINES).join('\n');
  return text.length > MAX_CHARS ? text.slice(-MAX_CHARS) : text;
}

/**
 * Chat context for a session: its selected text, or the whole session when nothing is
 * selected ('auto'). Returns null when there is nothing to send.
 */
export function terminalContext(
  id: number,
  mode: 'auto' | 'session' | 'selection' = 'auto',
): ChatContext | null {
  const term = terms.get(id);
  if (!term) return null;
  const n = terminalNumber(id);
  const selected = term.xterm.getSelection();
  if (mode !== 'session' && selected.trim())
    return { source: `terminal:${n}:selection`, content: selected.slice(-MAX_CHARS) };
  if (mode === 'selection') return null;
  const content = sessionText(term);
  return content.trim() ? { source: `terminal:${n}`, content } : null;
}

/** Attaches a terminal session (or its selection) to the next chat message. */
export function sendTerminalToChat(
  id: number | null = activeId,
  mode: 'auto' | 'session' | 'selection' = 'auto',
): boolean {
  if (id === null || !terms.has(id)) {
    toast(t('termNone'));
    return false;
  }
  const ctx = terminalContext(id, mode);
  if (!ctx) {
    toast(t('termEmpty'));
    return false;
  }
  attachToChat(ctx);
  const n = terminalNumber(id);
  toast(ctx.source.endsWith(':selection') ? t('termSelAttached', { n }) : t('termAttached', { n }));
  return true;
}

/** Frees a session's xterm and DOM node. */
function disposeTerm(id: number): void {
  const term = terms.get(id);
  term?.xterm.dispose();
  term?.el.remove();
  terms.delete(id);
}

function ensureListener(): void {
  if (unsubscribe) return;
  unsubscribe = api().on((ev) => {
    if (ev.type === 'term:data') terms.get(ev.id)?.xterm.write(ev.data);
    if (ev.type === 'term:exit') {
      if (exitHandler) exitHandler(ev.id);
      else disposeTerm(ev.id);
    }
  });
}

/** xterm colors taken from the app theme, so the terminal blends with the rest of the window. */
function xtermTheme(dark: boolean) {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    background: v('--bg', dark ? '#1e1e1e' : '#ffffff'),
    foreground: v('--fg', dark ? '#cccccc' : '#333333'),
    cursor: v('--focus', dark ? '#aeafad' : '#333333'),
    cursorAccent: v('--bg', dark ? '#1e1e1e' : '#ffffff'),
    selectionBackground: v('--sel', dark ? '#264f78' : '#add6ff'),
  };
}

/** Sends text to the active terminal (used by "Run in terminal" in chat). */
export let runInTerminal: (text: string) => Promise<void> = async () => {};

export function TerminalPanel() {
  const theme = useStore((s) => s.settings.theme);
  const host = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<number[]>([]);
  const isWindows = navigator.userAgent.includes('Windows');
  const [active, setActive] = useState<number | null>(null);
  /** Shells installed on this machine (PowerShell, cmd, Git Bash, WSL…). */
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    void api()
      .terminal.profiles()
      .then(setProfiles, () => {});
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  const create = useCallback(async (admin = false, profile?: string): Promise<number | null> => {
    const el = document.createElement('div');
    el.className = 'xterm-host';
    const xterm = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: xtermTheme(isDark(getState().settings.theme)),
      scrollback: 5000,
    });
    const fit = new FitAddon();
    xterm.loadAddon(fit);
    host.current?.appendChild(el);
    xterm.open(el);
    fit.fit();
    let created: { id: number; name: string } | null;
    try {
      created = await api().terminal.create(
        Math.max(xterm.cols, 2),
        Math.max(xterm.rows, 1),
        admin,
        profile,
      );
    } catch (e) {
      xterm.dispose();
      el.remove();
      toast(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : String(e),
      );
      if (!terms.size) setState({ panelOpen: false });
      return null;
    }
    if (created === null) {
      // Windows without gsudo: an elevated PowerShell window opened instead.
      xterm.dispose();
      el.remove();
      toast(t('termAdminWindow'));
      return null;
    }
    const { id, name } = created;
    xterm.onData((d) => void api().terminal.write(id, d));
    xterm.onResize(({ cols, rows }) => void api().terminal.resize(id, cols, rows));
    terms.set(id, { id, xterm, fit, el, name });
    setIds((x) => [...x, id]);
    setActive(id);
    return id;
  }, []);

  const kill = useCallback((id: number) => {
    void api().terminal.kill(id);
    disposeTerm(id);
    setIds((x) => {
      const rest = x.filter((i) => i !== id);
      setActive((a) => (a === id ? (rest.at(-1) ?? null) : a));
      if (!rest.length) setState({ panelOpen: false });
      return rest;
    });
  }, []);

  useEffect(() => {
    ensureListener();
    exitHandler = kill;
    if (!terms.size && !firstCreate) {
      firstCreate = create().finally(() => {
        firstCreate = null;
      });
    } else {
      for (const term of terms.values()) host.current?.appendChild(term.el);
      setIds([...terms.keys()]);
      setActive([...terms.keys()].at(-1) ?? null);
    }
    runInTerminal = async (text: string) => {
      const id = activeId ?? [...terms.keys()].at(-1) ?? (await (firstCreate ?? create()));
      if (id === null) return;
      await api().terminal.write(id, text.replace(/\n$/, '') + '\r');
    };
    return () => {
      if (exitHandler === kill) exitHandler = null;
      runInTerminal = async () => {};
    };
  }, [create, kill]);

  useEffect(() => {
    activeId = active;
    for (const term of terms.values())
      term.el.style.display = term.id === active ? 'block' : 'none';
    // Next frame: the app theme's CSS variables are set by a parent effect that runs after this one.
    requestAnimationFrame(() => {
      for (const term of terms.values()) term.xterm.options.theme = xtermTheme(isDark(theme));
    });
    const term = active ? terms.get(active) : undefined;
    if (term) {
      requestAnimationFrame(() => {
        term.fit.fit();
        term.xterm.focus();
      });
    }
  }, [active, theme]);

  useEffect(() => {
    if (!host.current) return;
    const ro = new ResizeObserver(() => {
      const term = active ? terms.get(active) : undefined;
      if (term && term.el.offsetParent) term.fit.fit();
    });
    ro.observe(host.current);
    return () => ro.disconnect();
  }, [active]);

  const openMenu = (e: React.MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    setMenu((m) => (m ? null : { x: r.right, y: r.top }));
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{t('terminal').toUpperCase()}</span>
        <div
          className="term-tabs"
          role="tablist"
          onDoubleClick={(e) => e.target === e.currentTarget && void create()}
        >
          {ids.map((id, i) => {
            const name = terms.get(id)?.name ?? 'shell';
            const admin = /admin/i.test(name);
            return (
              <span
                key={id}
                role="tab"
                aria-selected={id === active}
                className={`term-tab ${id === active ? 'active' : ''} ${admin ? 'admin' : ''}`}
                title={`${i + 1}: ${name}`}
                onClick={() => setActive(id)}
                onAuxClick={(e) => e.button === 1 && kill(id)}
              >
                <Icon name={admin ? 'shield' : 'terminal'} size={12} />
                <span className="term-tab-name">
                  <span className="term-tab-n">{i + 1}</span> {name}
                </span>
                <button
                  className="term-tab-close"
                  aria-label={t('termKill')}
                  title={t('termKill')}
                  onClick={(e) => (e.stopPropagation(), kill(id))}
                >
                  <Icon name="x" size={11} />
                </button>
              </span>
            );
          })}
        </div>
        <span className="sidebar-actions">
          <button
            className="term-to-chat"
            title={t('termToChatTitle')}
            disabled={active === null}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => sendTerminalToChat(active)}
          >
            <Icon name="sparkles" size={13} /> {t('termToChat')}
          </button>
          <span className="term-split">
            <button title={t('termNew')} aria-label={t('termNew')} onClick={() => void create()}>
              <Icon name="plus" size={15} />
            </button>
            {profiles.length > 1 && (
              <button
                className={menu ? 'on' : ''}
                title={t('termPickShell')}
                aria-label={t('termPickShell')}
                aria-expanded={Boolean(menu)}
                onClick={openMenu}
              >
                <Icon name="chevronDown" size={11} />
              </button>
            )}
          </span>
          <button
            className="term-admin"
            title={isWindows ? t('termAdminWin') : t('termAdmin')}
            aria-label={isWindows ? t('termAdminWin') : t('termAdmin')}
            onClick={() => void create(true)}
          >
            <Icon name="shield" size={14} />
          </button>
          <span className="term-sep" />
          <button
            title={t('termHide')}
            aria-label={t('termHide')}
            onClick={() => setState({ panelOpen: false })}
          >
            <Icon name="x" size={14} />
          </button>
        </span>
      </div>
      <div className="terminal-host" ref={host} />
      {menu && (
        <div
          className="context-menu term-shell-menu"
          role="menu"
          style={{ right: window.innerWidth - menu.x, bottom: window.innerHeight - menu.y + 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="term-menu-head">{t('termOpenNew')}</div>
          {profiles.map((p, i) => (
            <button
              key={p.id}
              role="menuitem"
              onClick={() => (setMenu(null), void create(false, p.id))}
            >
              <Icon name="terminal" size={13} />
              <span>{p.name}</span>
              {i === 0 && <span className="term-menu-hint">{t('termDefault')}</span>}
            </button>
          ))}
          {isWindows && (
            <>
              <hr />
              <div className="term-menu-head">{t('termAdminHead')}</div>
              {profiles.map((p) => (
                <button
                  key={`admin-${p.id}`}
                  role="menuitem"
                  className="admin"
                  onClick={() => (setMenu(null), void create(true, p.id))}
                >
                  <Icon name="shield" size={13} />
                  <span>{p.name}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
