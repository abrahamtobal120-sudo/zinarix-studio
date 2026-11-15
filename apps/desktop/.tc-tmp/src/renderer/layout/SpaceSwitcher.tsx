import { useEffect, useRef, useState } from 'react';
import { SPACES, type SpaceId } from '../../shared/layout';
import { Icon, type IconName } from '../components/Icon';
import { spaceName, tl } from './i18nLayout';
import {
  goToSpace,
  resetCurrentSpace,
  togglePanelPosition,
  toggleZen,
  useLayout,
} from './layoutStore';

export const SPACE_ICONS: Record<SpaceId, IconName> = {
  code: 'code',
  agents: 'agent',
  design: 'palette',
  video: 'film',
  cloud: 'cloud',
};

/**
 * Status bar item: the current workspace, and a menu to change it. It moves to the title bar
 * with the native window work of Fase 18.
 */
export function SpaceSwitcher() {
  const space = useLayout((l) => l.space);
  const right = useLayout((l) => l.spaces[l.space].panelPosition === 'right');
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    items.current[SPACES.indexOf(space)]?.focus();
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', away, true);
    return () => window.removeEventListener('pointerdown', away, true);
  }, [open, space]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      box.current?.querySelector<HTMLElement>('.space-trigger')?.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = list.length;
      list[(i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n]?.focus();
    }
  };

  let k = 0;
  const ref = (el: HTMLButtonElement | null) => {
    items.current[k++] = el;
  };
  items.current = [];

  return (
    <div className="space-switch" ref={box}>
      <button
        type="button"
        className="status-item space-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        title={tl('lySpaces')}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name={SPACE_ICONS[space]} size={13} /> {spaceName(space)}
      </button>
      {open && (
        <div className="space-menu" role="menu" aria-label={tl('lySpaces')} onKeyDown={onMenuKey}>
          {SPACES.map((id) => (
            <button
              key={id}
              ref={ref}
              type="button"
              role="menuitemradio"
              aria-checked={id === space}
              className={id === space ? 'space-opt on' : 'space-opt'}
              onClick={() => run(() => goToSpace(id))}
            >
              <Icon name={SPACE_ICONS[id]} size={14} />
              <span>{spaceName(id)}</span>
              {id === space && <Icon name="check" size={13} />}
            </button>
          ))}
          <div className="space-sep" role="separator" />
          <button
            ref={ref}
            type="button"
            role="menuitem"
            className="space-opt"
            onClick={() => run(togglePanelPosition)}
          >
            <Icon name="columns" size={14} />
            <span>{right ? tl('lyPanelBottom') : tl('lyPanelRight')}</span>
          </button>
          <button
            ref={ref}
            type="button"
            role="menuitem"
            className="space-opt"
            onClick={() => run(toggleZen)}
          >
            <Icon name="maximize" size={14} />
            <span>{tl('lyZen')}</span>
          </button>
          <button
            ref={ref}
            type="button"
            role="menuitem"
            className="space-opt"
            onClick={() => run(resetCurrentSpace)}
          >
            <Icon name="undo" size={14} />
            <span>{tl('lyReset')}</span>
          </button>
        </div>
      )}
    </div>
  );
}
