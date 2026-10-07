import { useCallback, useEffect, useState } from 'react';
import type { DirEntry } from '../../shared/api';
import { t } from '../i18n';
import { api, askText, closeTab, getState, openFile, renamePath, toast, useStore } from '../store';
import { fileIcon } from './icons';

interface Menu {
  x: number;
  y: number;
  entry: DirEntry | null;
}

export function Explorer() {
  const workspace = useStore((s) => s.workspace);
  const fsVersion = useStore((s) => s.fsVersion);
  const active = useStore((s) => s.active);
  const [children, setChildren] = useState<Record<string, DirEntry[]>>({});
  const [open, setOpen] = useState<Set<string>>(new Set(['']));
  const [menu, setMenu] = useState<Menu | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async (dir: string) => {
    try {
      const list = await api().workspace.readDir(dir);
      setChildren((c) => ({ ...c, [dir]: list }));
    } catch {
      setChildren((c) => ({ ...c, [dir]: [] }));
    }
  }, []);

  useEffect(() => {
    setChildren({});
    setOpen(new Set(['']));
    if (workspace) void load('');
  }, [workspace, load]);

  useEffect(() => {
    if (!workspace) return;
    for (const dir of open) void load(dir);
  }, [fsVersion]);

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

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
      toast(String((e as Error).message));
    }
  };

  const rename = async (entry: DirEntry) => {
    const name = (await askText(t('namePrompt'), entry.name))?.trim();
    if (!name || name === entry.name) return;
    const dir = entry.path.split('/').slice(0, -1).join('/');
    const to = join(dir, name);
    try {
      await api().workspace.rename(entry.path, to);
      renamePath(entry.path, to);
      refreshDir(dir);
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  const remove = async (entry: DirEntry) => {
    if (!confirm(t('confirmDelete', { name: entry.name }))) return;
    try {
      await api().workspace.trash(entry.path);
      for (const tab of getState().tabs)
        if (tab.path === entry.path || tab.path.startsWith(`${entry.path}/`)) closeTab(tab.path);
      refreshDir(entry.path.split('/').slice(0, -1).join('/'));
    } catch (e) {
      toast(String((e as Error).message));
    }
  };

  const renderDir = (dir: string, depth: number): React.ReactNode =>
    (children[dir] ?? []).map((e) => (
      <div key={e.path}>
        <div
          className={`tree-row ${e.path === active ? 'active' : ''} ${e.path === selected ? 'selected' : ''}`}
          style={{ paddingLeft: 8 + depth * 12 }}
          title={e.path}
          tabIndex={0}
          onClick={() => {
            setSelected(e.path);
            if (e.dir) toggle(e.path);
            else void openFile(e.path);
          }}
          onKeyDown={(k) => {
            if (k.key === 'F2') void rename(e);
            if (k.key === 'Delete') void remove(e);
            if (k.key === 'Enter') {
              if (e.dir) toggle(e.path);
              else void openFile(e.path);
            }
          }}
          onContextMenu={(ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            setSelected(e.path);
            setMenu({ x: ev.clientX, y: ev.clientY, entry: e });
          }}
        >
          <span className="twisty">{e.dir ? (open.has(e.path) ? '▾' : '▸') : ''}</span>
          <span className="file-icon">
            {e.dir ? (open.has(e.path) ? '📂' : '📁') : fileIcon(e.name)}
          </span>
          <span className="tree-label">{e.name}</span>
        </div>
        {e.dir && open.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ));

  return (
    <div
      className="explorer"
      onContextMenu={(ev) => {
        ev.preventDefault();
        setMenu({ x: ev.clientX, y: ev.clientY, entry: null });
      }}
    >
      <div className="sidebar-title">
        <span>{workspace.name.toUpperCase()}</span>
        <span className="sidebar-actions">
          <button title={t('newFile')} onClick={() => void create('file', null)}>
            ＋
          </button>
          <button title={t('newFolder')} onClick={() => void create('dir', null)}>
            🗀
          </button>
          <button title={t('refresh')} onClick={() => open.forEach((d) => void load(d))}>
            ⟳
          </button>
        </span>
      </div>
      <div className="tree">{renderDir('', 0)}</div>
      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={() => void create('file', menu.entry)}>{t('newFile')}</button>
          <button onClick={() => void create('dir', menu.entry)}>{t('newFolder')}</button>
          {menu.entry && (
            <>
              <hr />
              <button onClick={() => void rename(menu.entry!)}>{t('rename')} (F2)</button>
              <button onClick={() => void remove(menu.entry!)}>{t('delete')}</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
