import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from 'react';
import type { DirEntry } from '../../shared/api';
import { t } from '../i18n';
import { confirmDialog } from '../confirm';
import {
  api,
  askText,
  closeTab,
  getState,
  openFile,
  renamePath,
  setState,
  toast,
  useStore,
} from '../store';
import { errText } from '../errText';
import { fileIcon, folderIcon } from './icons';
import { Icon } from './Icon';
import { SearchView } from './Search';
import { isStudioFile } from './video/videoCommands';
import { openStudio } from './video/videoStore';

interface Menu {
  x: number;
  y: number;
  entry: DirEntry | null;
}

export function Explorer() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const active = useStore((s) => s.active);
  // Search lives in the Explorer: sidebar 'search' is the Explorer with its search box open.
  const searching = useStore((s) => s.sidebar === 'search');
  const [searchActive, setSearchActive] = useState(false);
  const closeSearch = useCallback(() => {
    setSearchActive(false);
    setState({ sidebar: 'explorer' });
  }, []);
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set(['']));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // Folders that could not be read (permissions, gone...): shown as an error, not as empty.
  const [loadErr, setLoadErr] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuReturn = useRef<HTMLElement | null>(null);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number } | null>(null);

  const load = useCallback(async (dir: string) => {
    try {
      const list = await api().workspace.readDir(dir);
      setChildren((c) => ({ ...c, [dir]: list }));
      setLoadErr((m) => {
        if (!(dir in m)) return m;
        const n = { ...m };
        delete n[dir];
        return n;
      });
    } catch (e) {
      setChildren((c) => ({ ...c, [dir]: [] }));
      setLoadErr((m) => ({ ...m, [dir]: errText(e) }));
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setLoadErr({});
    setOpen(new Set(['']));
    if (workspace) void load('');
  }, [workspace, load]);

  // Re-read every expanded folder when the file system changes (not when folders are toggled).
  const reloadOpen = useEffectEvent(() => {
    if (!workspace) return;
    for (const dir of open) void load(dir);
  });
  useEffect(() => {
    reloadOpen();
  }, [fsVersion]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  // The menu is kept inside the window and takes the focus (first item) when it opens.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!menu || !el) {
      setMenuPos(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setMenuPos({
      x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)),
      y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)),
    });
    el.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [menu]);

  if (!workspace) {
    return (
      <div className="sidebar-empty">
        <p>{t('noFolder')}</p>
        <p className="dim small">{t('dropHint')}</p>
        <button className="primary" onClick={() => void api().workspace.openDialog()}>
          {t('openFolder')}
        </button>
      </div>
    );
  }

  const toggle = (dir: string) => {
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        void load(dir);
      }
      return n;
    });
  };

  const parentOf = (e: DirEntry | null) =>
    e ? (e.dir ? e.path : e.path.split('/').slice(0, -1).join('/')) : '';
  const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
  const refreshDir = (dir: string) => void load(dir);

  const create = async (kind: 'file' | 'dir', target: DirEntry | null) => {
    const name = (
      await askText(`${t(kind === 'file' ? 'newFile' : 'newFolder')} — ${t('namePrompt')}`)
    )?.trim();
    if (!name) return;
    const dir = parentOf(target);
    const path = join(dir, name);
    try {
      if (kind === 'file') {
        await api().workspace.createFile(path);
        await openFile(path);
      } else await api().workspace.createDir(path);
      setOpen((o) => new Set(o).add(dir));
      refreshDir(dir);
    } catch (e) {
      toast(errText(e));
    }
  };

  const rename = async (entry: DirEntry) => {
    const name = (await askText(t('namePrompt'), entry.name))?.trim();
    if (!name || name === entry.name) return;
    const dir = entry.path.split('/').slice(0, -1).join('/');
    const to = join(dir, name);
    try {
      await api().workspace.rename(entry.path, to);
      void renamePath(entry.path, to);
      refreshDir(dir);
    } catch (e) {
      toast(errText(e));
    }
  };

  const remove = async (entry: DirEntry) => {
    if (!(await confirmDialog(t('confirmDelete', { name: entry.name }), { danger: true }))) return;
    try {
      await api().workspace.trash(entry.path);
      for (const tab of getState().tabs)
        if (tab.path === entry.path || tab.path.startsWith(`${entry.path}/`))
          await closeTab(tab.path);
      refreshDir(entry.path.split('/').slice(0, -1).join('/'));
    } catch (e) {
      toast(errText(e));
    }
  };

  // Rows in screen order (the tree is flat in the DOM; nesting is told with aria-level).
  type FileRow = { e: DirEntry; depth: number; parent: string };
  type Row = FileRow | { err: string; depth: number; dir: string };
  const rows: Row[] = [];
  const walk = (dir: string, depth: number) => {
    const err = loadErr[dir];
    if (err !== undefined) {
      rows.push({ err, depth, dir });
      return;
    }
    for (const e of children[dir] ?? []) {
      rows.push({ e, depth, parent: dir });
      if (e.dir && open.has(e.path)) walk(e.path, depth + 1);
    }
  };
  walk('', 0);
  const items = rows.filter((r): r is FileRow => 'e' in r);
  // Roving tabindex: only one row is in the Tab order.
  const current =
    items.find((r) => r.e.path === focused) ?? items.find((r) => r.e.path === selected) ?? items[0];

  const focusRow = (path: string) => {
    setFocused(path);
    treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(path)}"]`)?.focus();
  };
  const activate = (e: DirEntry) => {
    setSelected(e.path);
    if (e.dir) toggle(e.path);
    else void openFile(e.path);
  };
  const openMenuAt = (el: HTMLElement, entry: DirEntry | null) => {
    const r = el.getBoundingClientRect();
    menuReturn.current = el;
    setMenu({ x: r.left + 16, y: r.bottom, entry });
  };
  const closeMenu = () => {
    setMenu(null);
    menuReturn.current?.focus();
  };
  const onRowKey = (k: React.KeyboardEvent<HTMLElement>, e: DirEntry, i: number) => {
    const go = (j: number) => {
      const r = items[Math.max(0, Math.min(items.length - 1, j))];
      if (r) focusRow(r.e.path);
    };
    switch (k.key) {
      case 'ArrowDown':
        go(i + 1);
        break;
      case 'ArrowUp':
        go(i - 1);
        break;
      case 'Home':
        go(0);
        break;
      case 'End':
        go(items.length - 1);
        break;
      case 'ArrowRight':
        if (!e.dir) return;
        if (!open.has(e.path)) toggle(e.path);
        else if (items[i + 1]?.parent === e.path) go(i + 1);
        break;
      case 'ArrowLeft': {
        const parent = items[i]?.parent ?? '';
        if (e.dir && open.has(e.path)) toggle(e.path);
        else if (parent) focusRow(parent);
        break;
      }
      case 'Enter':
        activate(e);
        break;
      case 'F2':
        void rename(e);
        break;
      case 'Delete':
        void remove(e);
        break;
      case 'F10':
        if (!k.shiftKey) return;
        setSelected(e.path);
        openMenuAt(k.currentTarget, e);
        break;
      case 'ContextMenu':
        setSelected(e.path);
        openMenuAt(k.currentTarget, e);
        break;
      default:
        return;
    }
    k.preventDefault();
    k.stopPropagation();
  };

  const renderRows = () =>
    rows.map((r) => {
      if (!('e' in r))
        return (
          <div
            key={`err:${r.dir}`}
            role="treeitem"
            aria-level={r.depth + 1}
            aria-disabled="true"
            aria-selected={false}
            className="tree-row tree-error"
            style={{ paddingLeft: 8 + r.depth * 12 }}
            title={r.err}
          >
            <span className="twisty" />
            <Icon name="warning" size={13} />
            <span className="tree-label">{t('explorerReadError', { err: r.err })}</span>
            <button className="link" onClick={() => void load(r.dir)}>
              {t('uxRetry')}
            </button>
          </div>
        );
      const { e, depth } = r;
      const i = items.indexOf(r);
      return (
        <div
          key={e.path}
          data-path={e.path}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={e.dir ? open.has(e.path) : undefined}
          aria-selected={e.path === selected}
          className={`tree-row ${e.path === active ? 'active' : ''} ${e.path === selected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={e.path}
          tabIndex={r === current ? 0 : -1}
          onFocus={() => setFocused(e.path)}
          onClick={() => activate(e)}
          onDoubleClick={() => {
            // Video, audio and .zvproj files open in Video Studio.
            if (e.dir || !isStudioFile(e.path)) return;
            void api()
              .video.workspacePath(e.path)
              .then((abs) => (abs ? openStudio(abs) : undefined));
          }}
          onKeyDown={(k) => onRowKey(k, e, i)}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setSelected(e.path);
            menuReturn.current = ev.currentTarget;
            setMenu({ x: ev.clientX, y: ev.clientY, entry: e });
          }}
        >
          <span className={`twisty ${open.has(e.path) ? 'open' : ''}`}>
            {e.dir && <Icon name="chevron" size={12} />}
          </span>
          <span className="file-icon">
            {e.dir ? folderIcon(e.name, open.has(e.path)) : fileIcon(e.name)}
          </span>
          <span className="tree-label">{e.name}</span>
        </div>
      );
    });

  const menuKey = (k: React.KeyboardEvent<HTMLDivElement>) => {
    const btns = [...k.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const at = btns.indexOf(document.activeElement as HTMLElement);
    if (k.key === 'Escape' || k.key === 'Tab') closeMenu();
    else if (k.key === 'ArrowDown') btns[(at + 1) % btns.length]?.focus();
    else if (k.key === 'ArrowUp') btns[(at - 1 + btns.length) % btns.length]?.focus();
    else if (k.key === 'Home') btns[0]?.focus();
    else if (k.key === 'End') btns[btns.length - 1]?.focus();
    else return;
    k.preventDefault();
    k.stopPropagation();
  };

  return (
    <div
      className="explorer"
      onContextMenu={(ev) => {
        ev.preventDefault();
        menuReturn.current = null;
        setMenu({ x: ev.clientX, y: ev.clientY, entry: null });
      }}
    >
      <div className="sidebar-title">
        <span>{workspace.name}</span>
        <span className="sidebar-actions">
          <button
            className={searching ? 'on' : ''}
            title={`${t('searchFiles')} (Ctrl+Shift+F)`}
            aria-label={t('searchFiles')}
            aria-pressed={searching}
            onClick={() => (searching ? closeSearch() : setState({ sidebar: 'search' }))}
          >
            <Icon name="search" size={15} />
          </button>
          <button
            title={t('newFile')}
            aria-label={t('newFile')}
            onClick={() => void create('file', null)}
          >
            <Icon name="filePlus" size={15} />
          </button>
          <button
            title={t('newFolder')}
            aria-label={t('newFolder')}
            onClick={() => void create('dir', null)}
          >
            <Icon name="folderPlus" size={15} />
          </button>
          <button
            title={t('refresh')}
            aria-label={t('refresh')}
            onClick={() => open.forEach((d) => void load(d))}
          >
            <Icon name="refresh" size={15} />
          </button>
        </span>
      </div>
      {searching && <SearchView embedded onActive={setSearchActive} onClose={closeSearch} />}
      <div
        className="tree"
        role="tree"
        aria-label={workspace.name}
        ref={treeRef}
        hidden={searching && searchActive}
      >
        {renderRows()}
      </div>
      {menu && (
        <div
          ref={menuRef}
          className="context-menu"
          role="menu"
          aria-label={menu.entry?.name ?? workspace.name}
          style={{
            left: menuPos?.x ?? menu.x,
            top: menuPos?.y ?? menu.y,
            visibility: menuPos ? undefined : 'hidden',
          }}
          onKeyDown={menuKey}
        >
          <button role="menuitem" tabIndex={-1} onClick={() => void create('file', menu.entry)}>
            {t('newFile')}
          </button>
          <button role="menuitem" tabIndex={-1} onClick={() => void create('dir', menu.entry)}>
            {t('newFolder')}
          </button>
          {menu.entry && (
            <>
              <hr role="separator" />
              <button role="menuitem" tabIndex={-1} onClick={() => void rename(menu.entry!)}>
                {t('rename')} (F2)
              </button>
              <button role="menuitem" tabIndex={-1} onClick={() => void remove(menu.entry!)}>
                {t('delete')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
