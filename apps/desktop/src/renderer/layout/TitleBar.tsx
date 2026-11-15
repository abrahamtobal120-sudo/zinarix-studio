import { useEffect, useRef, useState } from 'react';
import { api, syncChrome, useStore } from '../store';
import { tl } from './i18nLayout';

/**
 * Fase 18: the window's own title bar. The system draws − □ × at the right (Windows, Linux)
 * or the traffic lights at the left (macOS); the menus are the app menu of main, opened
 * below their label, so their shortcuts keep working as before.
 */
export function TitleBar() {
  const mac = api().app.platform === 'darwin';
  const workspace = useStore((s) => s.workspace);
  const [menus, setMenus] = useState<string[]>([]);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (mac) return;
    void api()
      .app.menuBar()
      .then(setMenus)
      .catch(() => setMenus([]));
  }, [mac]);

  // High contrast turned on or off in the system: main takes Mica off (or puts it back).
  useEffect(() => {
    const mq = matchMedia('(forced-colors: active)');
    const on = () => void syncChrome();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  // Alt pressed and released alone focuses the menus, like a native menu bar.
  useEffect(() => {
    if (mac) return;
    let alone = false;
    const down = (e: KeyboardEvent) => {
      alone = e.key === 'Alt' && !e.ctrlKey && !e.shiftKey && !e.metaKey;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== 'Alt' || !alone) return;
      alone = false;
      const first = bar.current?.querySelector<HTMLButtonElement>('.titlebar-menu');
      if (!first) return;
      if (bar.current?.contains(document.activeElement))
        (document.activeElement as HTMLElement).blur();
      else first.focus();
    };
    const cancel = () => (alone = false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('mousedown', cancel, true);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('mousedown', cancel, true);
    };
  }, [mac]);

  const open = (i: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    void api().app.popupMenu(i, r.left, r.bottom);
  };

  const onKey = (e: React.KeyboardEvent<HTMLButtonElement>, i: number) => {
    const items = [...(bar.current?.querySelectorAll<HTMLButtonElement>('.titlebar-menu') ?? [])];
    const go = (n: number) => items[(n + items.length) % items.length]?.focus();
    if (e.key === 'Escape') return e.currentTarget.blur();
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (step) {
      e.preventDefault();
      go(i + step);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      open(i, e.currentTarget);
    }
  };

  const title = workspace
    ? `${workspace.name}${workspace.branch ? ` · ${workspace.branch}` : ''}`
    : 'Zinarix Studio';

  return (
    <div className={mac ? 'titlebar mac' : 'titlebar'} ref={bar}>
      {!mac && <img className="titlebar-logo" src="./logo.svg" alt="" />}
      {menus.length > 0 && (
        <div className="titlebar-menus" role="menubar" aria-label={tl('lyMenuBar')}>
          {menus.map((label, i) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              className="titlebar-menu"
              tabIndex={i === 0 ? 0 : -1}
              onClick={(e) => open(i, e.currentTarget)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="titlebar-title" title={workspace?.root}>
        {title}
      </div>
    </div>
  );
}
