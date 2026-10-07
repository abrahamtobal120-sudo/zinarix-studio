import { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { t } from '../i18n';
import { api, setState, useStore } from '../store';

interface Term {
  id: number;
  xterm: XTerm;
  fit: FitAddon;
  el: HTMLDivElement;
}

const terms = new Map<number, Term>();
let unsubscribe: (() => void) | undefined;

function ensureListener(onExit: (id: number) => void): void {
  if (unsubscribe) return;
  unsubscribe = api().on((ev) => {
    if (ev.type === 'term:data') terms.get(ev.id)?.xterm.write(ev.data);
    if (ev.type === 'term:exit') onExit(ev.id);
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

  const create = async () => {
    const el = document.createElement('div');
    el.className = 'xterm-host';
    const xterm = new XTerm({
      fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, Consolas, monospace",
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: false,
      theme: xtermTheme(theme === 'dark'),
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
  };

  const kill = (id: number) => {
    void api().terminal.kill(id);
    const term = terms.get(id);
    term?.xterm.dispose();
    term?.el.remove();
    terms.delete(id);
    setIds((x) => {
      const rest = x.filter((i) => i !== id);
      setActive((a) => (a === id ? (rest.at(-1) ?? null) : a));
      if (!rest.length) setState({ panelOpen: false });
      return rest;
    });
  };

  useEffect(() => {
    ensureListener((id) => kill(id));
    if (!terms.size) void create();
    else {
      for (const term of terms.values()) host.current?.appendChild(term.el);
      setIds([...terms.keys()]);
      setActive([...terms.keys()].at(-1) ?? null);
    }
    runInTerminal = async (text: string) => {
      const id = active ?? [...terms.keys()].at(-1) ?? (await create());
      await api().terminal.write(id, text.replace(/\n$/, '') + '\r');
    };
  }, []);

  useEffect(() => {
    for (const term of terms.values()) {
      term.el.style.display = term.id === active ? 'block' : 'none';
      term.xterm.options.theme = xtermTheme(theme === 'dark');
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
              <button aria-label="kill" onClick={(e) => (e.stopPropagation(), kill(id))}>
                ×
              </button>
            </span>
          ))}
        </div>
        <span className="sidebar-actions">
          <button title="Nueva terminal" onClick={() => void create()}>
            ＋
          </button>
          <button title="Ocultar" onClick={() => setState({ panelOpen: false })}>
            ⌄
          </button>
        </span>
      </div>
      <div className="terminal-host" ref={host} />
    </div>
  );
}
