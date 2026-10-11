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
}

const terms = new Map<number, Term>();
let unsubscribe: (() => void) | undefined;
/** Exit handler of the mounted panel (null while the panel is hidden). */
let exitHandler: ((id: number) => void) | null = null;
/** First session being created, so a StrictMode re-run of the mount effect does not open a second one. */
let firstCreate: Promise<number> | null = null;
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

function xtermTheme(dark: boolean) {
  return dark
    ? {
        background: '#1e1e1e',
        foreground: '#cccccc',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
      }
    : {
        background: '#ffffff',
        foreground: '#333333',
        cursor: '#333333',
        selectionBackground: '#add6ff',
      };
}

/** Sends text to the active terminal (used by "Run in terminal" in chat). */
export let runInTerminal: (text: string) => Promise<void> = async () => {};

export function TerminalPanel() {
  const theme = useStore((s) => s.settings.theme);
  const host = useRef<HTMLDivElement>(null);
  const [ids, setIds] = useState<number[]>([]);
  const [active, setActive] = useState<number | null>(null);

  const create = useCallback(async () => {
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
    const id = await api().terminal.create(Math.max(xterm.cols, 2), Math.max(xterm.rows, 1));
    xterm.onData((d) => void api().terminal.write(id, d));
    xterm.onResize(({ cols, rows }) => void api().terminal.resize(id, cols, rows));
    terms.set(id, { id, xterm, fit, el });
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
      await api().terminal.write(id, text.replace(/\n$/, '') + '\r');
    };
    return () => {
      if (exitHandler === kill) exitHandler = null;
      runInTerminal = async () => {};
    };
  }, [create, kill]);

  useEffect(() => {
    activeId = active;
    for (const term of terms.values()) {
      term.el.style.display = term.id === active ? 'block' : 'none';
      term.xterm.options.theme = xtermTheme(isDark(theme));
    }
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

  return (
    <div className="panel">
      <div className="panel-header">
        <span className="panel-title">{t('terminal').toUpperCase()}</span>
        <div className="term-tabs">
          {ids.map((id, i) => (
            <span
              key={id}
              className={`term-tab ${id === active ? 'active' : ''}`}
              onClick={() => setActive(id)}
            >
              {i + 1}: shell
              <button
                aria-label={t('termKill')}
                title={t('termKill')}
                onClick={(e) => (e.stopPropagation(), kill(id))}
              >
                <Icon name="x" size={12} />
              </button>
            </span>
          ))}
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
          <button title={t('termNew')} onClick={() => void create()}>
            <Icon name="plus" size={15} />
          </button>
          <button title={t('termHide')} onClick={() => setState({ panelOpen: false })}>
            <Icon name="chevronDown" size={14} />
          </button>
        </span>
      </div>
      <div className="terminal-host" ref={host} />
    </div>
  );
}
