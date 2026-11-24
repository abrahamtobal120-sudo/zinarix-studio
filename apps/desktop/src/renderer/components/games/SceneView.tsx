import { useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  askText,
  getDoc,
  getEditor,
  openFile,
  save,
  setState,
  setTabViewer,
  toast,
  useStore,
} from '../../store';
import { confirmDialog } from '../../confirm';
import { Icon } from '../Icon';
import {
  godotString,
  parseTscn,
  relToRes,
  resToRel,
  sceneTree,
  type TscnNode,
} from '../../../shared/games';
import {
  addNode,
  attachScript,
  colorFromHex,
  COMMON_NODE_TYPES,
  hexFromColor,
  moveNode,
  removeNode,
  renameNode,
  scriptTemplate,
  setNodeProp,
  validPropKey,
  valueKind,
  valueLike,
  applyScriptRenames,
  scriptRenames,
  type NodeRename,
} from '../../../shared/tscnEdit';
import { runGame } from './GamesPanel';
import { tgm } from './gamesStrings';
import './games.css';

/**
 * Godot scene viewer (Fase 6 del plan de funciones): a .tscn as its node tree with each node's
 * class, script, instanced scene, groups, changed properties and signals. It edits the same
 * document as the text view (properties, nodes, scripts), so Ctrl+Z / Ctrl+S work as usual and
 * the tree follows the text live.
 */

/** Selected node of each scene (path → node path). */
const lastSelected = new Map<string, string>();
let lastGroup = '';
let lastAt = 0;

/** Replaces the document text with the smallest edit, as one undo step (or merged into the last one of the same group). */
function applyText(path: string, next: string, group = ''): boolean {
  const d = getDoc(path);
  if (!d) return false;
  const m = d.model;
  const cur = m.getValue();
  if (next === cur) return false;
  let a = 0;
  while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
  let b = 0;
  while (
    b < cur.length - a &&
    b < next.length - a &&
    cur[cur.length - 1 - b] === next[next.length - 1 - b]
  )
    b++;
  const from = m.getPositionAt(a);
  const to = m.getPositionAt(cur.length - b);
  const merge = group && group === lastGroup && Date.now() - lastAt < 800;
  if (!merge) m.pushStackElement();
  m.pushEditOperations(
    [],
    [
      {
        range: {
          startLineNumber: from.lineNumber,
          startColumn: from.column,
          endLineNumber: to.lineNumber,
          endColumn: to.column,
        },
        text: next.slice(a, next.length - b),
      },
    ],
    () => null,
  );
  lastGroup = group;
  lastAt = Date.now();
  return true;
}

type Kind = 'two' | 'three' | 'ui' | 'node';
const UI =
  /^(Control|Label|RichTextLabel|Button|.*Button|.*Container|Panel|PanelContainer|ColorRect|TextureRect|NinePatchRect|LineEdit|TextEdit|CodeEdit|ProgressBar|.*Slider|SpinBox|ItemList|Tree|TabBar|TabContainer|MenuBar|ScrollBar|.*ScrollBar|Separator|.*Separator|ReferenceRect|SubViewportContainer|GraphEdit|GraphNode|VideoStreamPlayer)$/;
function kindOf(n: TscnNode): Kind {
  if (/3D$/.test(n.type) || n.type === 'WorldEnvironment') return 'three';
  if (
    /2D$/.test(n.type) ||
    n.type === 'TileMap' ||
    n.type === 'TileMapLayer' ||
    n.type === 'Polygon2D'
  )
    return 'two';
  if (UI.test(n.type)) return 'ui';
  return 'node';
}

function useDocText(path: string): string {
  const doc = getDoc(path);
  const [text, setText] = useState(() => doc?.model.getValue() ?? '');
  useEffect(() => {
    const d = getDoc(path);
    if (!d) return;
    setText(d.model.getValue());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sub = d.model.onDidChangeContent(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setText(d.model.getValue()), 150);
    });
    return () => {
      clearTimeout(timer);
      sub.dispose();
    };
  }, [path, doc]);
  return text;
}

export function SceneView({ path }: { path: string }) {
  const text = useDocText(path);
  const scene = useMemo(() => parseTscn(text), [text]);
  const tree = useMemo(() => sceneTree(scene.nodes), [scene]);
  // Kept per scene, so coming back to the tab (e.g. after a rename opened its scripts) keeps it.
  const [selected, setSelectedState] = useState(() => lastSelected.get(path) ?? '.');
  const setSelected = (p: string) => {
    lastSelected.set(path, p);
    setSelectedState(p);
  };
  const [filter, setFilter] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [projectDir, setProjectDir] = useState<string | null | undefined>(undefined);

  // The Godot project this scene belongs to (the deepest one that contains it).
  useEffect(() => {
    let alive = true;
    void api()
      .games.scan()
      .then((s) => {
        const p = s.godot
          .filter((g) => !g.dir || path.startsWith(`${g.dir}/`))
          .sort((a, b) => b.dir.length - a.dir.length)[0];
        if (alive) setProjectDir(p ? p.dir : null);
      })
      .catch(() => alive && setProjectDir(null));
    return () => {
      alive = false;
    };
  }, [path]);

  const node = scene.nodes.find((n) => n.path === selected) ?? scene.nodes[0];
  const rel = (res: string | undefined) =>
    res && projectDir !== undefined && projectDir !== null ? resToRel(res, projectDir) : null;
  const resOfScene = projectDir != null ? path.slice(projectDir ? projectDir.length + 1 : 0) : null;

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (q)
      return tree.filter(
        (t) => t.node.name.toLowerCase().includes(q) || t.node.type.toLowerCase().includes(q),
      );
    const out: typeof tree = [];
    let hideBelow: number | null = null;
    for (const t of tree) {
      if (hideBelow !== null && t.depth > hideBelow) continue;
      hideBelow = null;
      out.push(t);
      if (collapsed.has(t.node.path)) hideBelow = t.depth;
    }
    return out;
  }, [tree, filter, collapsed]);

  const toggle = (p: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(p)) n.delete(p);
      else n.add(p);
      return n;
    });

  const showInText = (line: number) => {
    setTabViewer(path, undefined);
    setTimeout(() => {
      const ed = getEditor();
      if (!ed) return;
      ed.revealLineInCenter(line);
      ed.setPosition({ lineNumber: line, column: 1 });
      ed.focus();
    }, 50);
  };

  const signals = node
    ? scene.connections.filter((c) => c.from === node.path || c.to === node.path)
    : [];
  const dirty = useStore((s) => s.tabs.find((t) => t.path === path)?.dirty ?? false);
  const [adding, setAdding] = useState<{ name: string; type: string } | null>(null);
  const [newProp, setNewProp] = useState<{ key: string; value: string } | null>(null);

  /** Runs an edit on the current text; errors become a toast. */
  const edit = (fn: (text: string) => string, group = ''): boolean => {
    const d = getDoc(path);
    if (!d) return false;
    try {
      return applyText(path, fn(d.model.getValue()), group);
    } catch (e) {
      toast(tgm('editError', { err: (e as Error).message }));
      return false;
    }
  };
  const undo = () => getDoc(path)?.model.undo();
  const redo = () => getDoc(path)?.model.redo();

  const rename = async (n: TscnNode) => {
    const name = (await askText(tgm('renameAsk'), n.name))?.trim();
    if (!name || name === n.name) return;
    let to = '';
    let before = '';
    let rn: NodeRename | undefined;
    let refs = 0;
    if (
      !edit((t) => {
        before = t;
        const r = renameNode(t, n.path, name);
        to = r.path;
        rn = r.rename;
        refs = r.refs;
        return r.text;
      })
    )
      return;
    setSelected(to);
    if (!rn) return;
    // The scripts of the scene's nodes: their $Paths / get_node("…") follow the new name, as
    // unsaved changes in their own tabs (Ctrl+Z there undoes them).
    const changed: string[] = [];
    let total = refs;
    for (const sr of scriptRenames(before, [rn])) {
      const file = projectDir == null ? null : resToRel(sr.res, projectDir);
      if (!file) continue;
      try {
        if (!getDoc(file)) {
          await openFile(file);
          await openFile(path);
        }
        const d = getDoc(file);
        if (!d) continue;
        const r = applyScriptRenames(d.model.getValue(), sr);
        if (r.count && applyText(file, r.code)) {
          changed.push(`${file.split('/').pop()} (${r.count})`);
          total += r.count;
        }
      } catch {
        /* a script that cannot be opened is left as it is */
      }
    }
    if (changed.length) toast(tgm('renameScripts', { files: changed.join(', ') }));
    else if (total) toast(tgm('renameRefs', { n: total }));
  };
  const remove = async (n: TscnNode) => {
    if (n.path === '.') return;
    if (
      !(await confirmDialog(tgm('removeAsk', { name: n.name }), {
        danger: true,
        okLabel: tgm('remove'),
      }))
    )
      return;
    if (edit((t) => removeNode(t, n.path)))
      setSelected(n.parent === '.' || n.parent === null ? '.' : n.parent);
  };
  const addChild = () => {
    if (!node || !adding) return;
    let to = '';
    if (
      edit((t) => {
        const r = addNode(t, node.path, adding.name.trim(), adding.type.trim());
        to = r.path;
        return r.text;
      })
    ) {
      setAdding(null);
      setSelected(to);
    }
  };
  /** Creates <scene folder>/<node>.gd (when missing) with a starter script and attaches it. */
  const newScript = async (n: TscnNode) => {
    if (projectDir == null) return;
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const base =
      n.name
        .replace(/[^\w-]+/g, '_')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .toLowerCase() || 'script';
    const file = `${folder ? `${folder}/` : ''}${base}.gd`;
    const res = relToRes(file, projectDir);
    if (!res) return;
    const exists = await api()
      .workspace.readFile(file)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      await api().workspace.writeFile(file, scriptTemplate(n.type || 'Node'));
      toast(tgm('scriptCreated', { file }));
    }
    if (edit((t) => attachScript(t, n.path, res))) void openFile(file);
  };
  const pickScript = async (n: TscnNode) => {
    const res = (await askText(tgm('attachAsk', { name: n.name }), n.script ?? 'res://'))?.trim();
    if (!res || res === n.script) return;
    edit((t) => attachScript(t, n.path, res));
  };
  const addProp = () => {
    if (!node || !newProp) return;
    const key = newProp.key.trim();
    if (!validPropKey(key)) return toast(tgm('editError', { err: key || '?' }));
    if (edit((t) => setNodeProp(t, node.path, key, newProp.value.trim()))) setNewProp(null);
  };

  const onKeys = (e: React.KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void save(path, false);
      return;
    }
    if ((e.target as HTMLElement).closest('input, textarea, select')) return;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (e.key === 'F2' && node) {
      e.preventDefault();
      void rename(node);
    } else if (e.key === 'Delete' && node && node.path !== '.') {
      e.preventDefault();
      void remove(node);
    }
  };

  return (
    <div className="gm-scene-view" onKeyDown={onKeys}>
      <div className="gm-scene-bar">
        <span className="gm-name">{scene.nodes[0]?.name ?? path.split('/').pop()}</span>
        <span className="gm-dim">{tgm('nodes', { n: scene.nodes.length })}</span>
        {dirty && <span className="gm-unsaved">{tgm('unsaved')}</span>}
        <div className="spacer" />
        <button
          className="btn ghost gm-small"
          title={`${tgm('undo')} (Ctrl+Z)`}
          aria-label={tgm('undo')}
          onClick={undo}
        >
          <Icon name="undo" size={13} />
        </button>
        <button
          className="btn ghost gm-small"
          title={`${tgm('redo')} (Ctrl+Y)`}
          aria-label={tgm('redo')}
          onClick={redo}
        >
          <Icon name="redo" size={13} />
        </button>
        {projectDir != null && resOfScene && (
          <>
            <button
              className="btn gm-small"
              title={tgm('runScene')}
              onClick={() => {
                void runGame(projectDir, path);
                setState({ sidebar: 'games' });
              }}
            >
              <Icon name="play" size={13} /> {tgm('runScene')}
            </button>
            <button
              className="btn ghost gm-small"
              onClick={() =>
                void api()
                  .games.openEditor(projectDir, path)
                  .catch((e: Error) => toast(tgm('error', { err: e.message })))
              }
            >
              {tgm('editor')}
            </button>
          </>
        )}
        <button
          className="btn ghost gm-small"
          title={tgm('textHint')}
          onClick={() => setTabViewer(path, undefined)}
        >
          {'</>'} {tgm('text')}
        </button>
      </div>
      {projectDir === null && <div className="gm-scene-note">{tgm('notInProject')}</div>}
      {!scene.nodes.length ? (
        <div className="gm-empty">{tgm('noScene')}</div>
      ) : (
        <div className="gm-scene-main">
          <div className="gm-tree" role="tree" aria-label={tgm('sceneTitle')}>
            <input
              className="gm-filter"
              value={filter}
              placeholder={tgm('filter')}
              onChange={(e) => setFilter(e.target.value)}
            />
            {visible.map(({ node: n, depth, children }) => (
              <div
                key={n.path}
                role="treeitem"
                aria-selected={n.path === node?.path}
                aria-expanded={children ? !collapsed.has(n.path) : undefined}
                tabIndex={0}
                className={`gm-tnode ${n.path === node?.path ? 'on' : ''}`}
                style={{ paddingLeft: 6 + (filter ? 0 : depth) * 14 }}
                onClick={() => setSelected(n.path)}
                onDoubleClick={() => showInText(n.line)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') showInText(n.line);
                  if (e.key === ' ' && children) {
                    e.preventDefault();
                    toggle(n.path);
                  }
                }}
              >
                <span
                  className="gm-twisty"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (children) toggle(n.path);
                  }}
                >
                  {children > 0 && (
                    <Icon name={collapsed.has(n.path) ? 'chevron' : 'chevronDown'} size={12} />
                  )}
                </span>
                <span className={`gm-dot ${kindOf(n)}`} aria-hidden />
                <span className="gm-tname">{n.name}</span>
                <span className="gm-dim">
                  {n.instance ? `⧉ ${n.instance.split('/').pop()}` : n.type}
                </span>
                {n.script && (
                  <span className="gm-badge" title={n.script}>
                    <Icon name="code" size={11} />
                  </span>
                )}
                {n.groups.length > 0 && (
                  <span className="gm-badge" title={n.groups.join(', ')}>
                    #
                  </span>
                )}
              </div>
            ))}
          </div>
          {node && (
            <div className="gm-props" aria-label={tgm('props')}>
              <div className="gm-subtitle">
                <span className={`gm-dot ${kindOf(node)}`} aria-hidden />
                {node.name}
                <div className="spacer" />
                <button className="btn ghost gm-small" onClick={() => showInText(node.line)}>
                  {tgm('goLine')}
                </button>
              </div>
              <div className="gm-node-actions">
                <button
                  className="btn ghost gm-small"
                  title={`${tgm('rename')} (F2)`}
                  onClick={() => void rename(node)}
                >
                  <Icon name="edit" size={12} /> {tgm('rename')}
                </button>
                <button
                  className="btn ghost gm-small"
                  onClick={() => setAdding({ name: '', type: 'Node2D' })}
                >
                  <Icon name="plus" size={12} /> {tgm('addChild')}
                </button>
                {node.path !== '.' && (
                  <>
                    <button
                      className="btn ghost gm-small"
                      title={tgm('moveUp')}
                      aria-label={tgm('moveUp')}
                      onClick={() => edit((t) => moveNode(t, node.path, -1))}
                    >
                      <Icon name="arrowUp" size={12} />
                    </button>
                    <button
                      className="btn ghost gm-small"
                      title={tgm('moveDown')}
                      aria-label={tgm('moveDown')}
                      onClick={() => edit((t) => moveNode(t, node.path, 1))}
                    >
                      <Icon name="arrowDown" size={12} />
                    </button>
                    <button
                      className="btn ghost gm-small gm-danger"
                      title={`${tgm('remove')} (Supr)`}
                      onClick={() => void remove(node)}
                    >
                      <Icon name="trash" size={12} /> {tgm('remove')}
                    </button>
                  </>
                )}
              </div>
              {adding && (
                <form
                  className="gm-add-node"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addChild();
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setAdding(null)}
                >
                  <div className="gm-dim">{tgm('addChildTitle', { parent: node.name })}</div>
                  <input
                    autoFocus
                    aria-label={tgm('nodeType')}
                    placeholder={tgm('nodeType')}
                    list="gm-node-types"
                    value={adding.type}
                    onChange={(e) => setAdding({ ...adding, type: e.target.value })}
                  />
                  <input
                    aria-label={tgm('nodeName')}
                    placeholder={adding.type || tgm('nodeName')}
                    value={adding.name}
                    onChange={(e) => setAdding({ ...adding, name: e.target.value })}
                  />
                  <datalist id="gm-node-types">
                    {COMMON_NODE_TYPES.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                  <button className="btn gm-small" type="submit" disabled={!adding.type.trim()}>
                    {tgm('add')}
                  </button>
                  <button
                    className="btn ghost gm-small"
                    type="button"
                    onClick={() => setAdding(null)}
                  >
                    {tgm('cancel')}
                  </button>
                </form>
              )}
              <dl className="gm-kv">
                <dt>{tgm('type')}</dt>
                <dd>{node.type || '—'}</dd>
                {node.instance && (
                  <>
                    <dt>{tgm('instance')}</dt>
                    <dd>
                      <button
                        className="gm-link"
                        disabled={!rel(node.instance)}
                        onClick={() => void openFile(rel(node.instance)!)}
                      >
                        {node.instance}
                      </button>
                    </dd>
                  </>
                )}
                <dt>{tgm('script')}</dt>
                <dd className="gm-script-row">
                  {node.script ? (
                    <>
                      <button
                        className="gm-link"
                        disabled={!rel(node.script)}
                        onClick={() => void openFile(rel(node.script)!)}
                      >
                        {node.script}
                      </button>
                      <button
                        className="btn ghost gm-small"
                        title={tgm('detachScript')}
                        aria-label={tgm('detachScript')}
                        onClick={() => edit((t) => attachScript(t, node.path, null))}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </>
                  ) : (
                    <>
                      {projectDir != null && (
                        <button className="btn ghost gm-small" onClick={() => void newScript(node)}>
                          <Icon name="filePlus" size={12} /> {tgm('newScript')}
                        </button>
                      )}
                      <button className="btn ghost gm-small" onClick={() => void pickScript(node)}>
                        {tgm('attachScript')}
                      </button>
                    </>
                  )}
                </dd>
                {node.groups.length > 0 && (
                  <>
                    <dt>{tgm('groups')}</dt>
                    <dd>{node.groups.join(', ')}</dd>
                  </>
                )}
              </dl>
              <div className="gm-subtitle">
                {tgm('props')}
                <div className="spacer" />
                <button
                  className="btn ghost gm-small"
                  onClick={() => setNewProp({ key: '', value: '' })}
                >
                  <Icon name="plus" size={12} /> {tgm('addProp')}
                </button>
              </div>
              {Object.keys(node.props).length ? (
                <dl className="gm-kv mono" title={tgm('editHint')}>
                  {Object.entries(node.props).map(([k, v]) => (
                    <PropRow
                      key={`${node.path}:${k}`}
                      k={k}
                      v={v}
                      onSet={(value, group) =>
                        edit((t) => setNodeProp(t, node.path, k, value), group)
                      }
                      onRemove={() => edit((t) => setNodeProp(t, node.path, k, null))}
                    />
                  ))}
                </dl>
              ) : (
                <div className="gm-dim">{tgm('noProps')}</div>
              )}
              {newProp && (
                <form
                  className="gm-add-prop"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addProp();
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setNewProp(null)}
                >
                  <input
                    autoFocus
                    className="mono"
                    aria-label={tgm('propName')}
                    placeholder={tgm('propName')}
                    value={newProp.key}
                    onChange={(e) => setNewProp({ ...newProp, key: e.target.value })}
                  />
                  <input
                    className="mono"
                    aria-label={tgm('propValue')}
                    placeholder={tgm('propValue')}
                    value={newProp.value}
                    onChange={(e) => setNewProp({ ...newProp, value: e.target.value })}
                  />
                  <button
                    className="btn gm-small"
                    type="submit"
                    disabled={!newProp.key.trim() || !newProp.value.trim()}
                  >
                    {tgm('add')}
                  </button>
                  <button
                    className="btn ghost gm-small"
                    type="button"
                    onClick={() => setNewProp(null)}
                  >
                    {tgm('cancel')}
                  </button>
                </form>
              )}
              {signals.length > 0 && (
                <>
                  <div className="gm-subtitle">{tgm('signals')}</div>
                  {signals.map((c, i) => (
                    <div key={i} className="gm-signal mono">
                      {c.from === '.' ? scene.nodes[0]?.name : c.from}.{c.signal} →{' '}
                      {c.to === '.' ? scene.nodes[0]?.name : c.to}.{c.method}()
                    </div>
                  ))}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One property: click to edit; booleans are a checkbox and colors a color picker. */
function PropRow({
  k,
  v,
  onSet,
  onRemove,
}: {
  k: string;
  v: string;
  onSet: (value: string, group?: string) => boolean;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const kind = valueKind(v);
  const input = useRef<HTMLInputElement>(null);
  const commit = () => {
    if (draft === null) return;
    const value = valueLike(v, draft);
    if (value === v || onSet(value)) setDraft(null);
    else input.current?.focus();
  };
  const start = () => setDraft(kind === 'string' ? godotString(v) : v);
  return (
    <div className="gm-kvrow">
      <dt title={k}>{k}</dt>
      <dd title={draft === null ? v : undefined}>
        {draft !== null ? (
          <input
            ref={input}
            autoFocus
            className="gm-prop-input mono"
            aria-label={k}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setDraft(null);
              }
            }}
          />
        ) : kind === 'bool' ? (
          <label className="gm-prop-bool">
            <input
              type="checkbox"
              aria-label={k}
              checked={v.trim() === 'true'}
              onChange={(e) => onSet(e.target.checked ? 'true' : 'false')}
            />
            {v}
          </label>
        ) : (
          <>
            {kind === 'color' && (
              <input
                type="color"
                className="gm-prop-color"
                aria-label={k}
                value={hexFromColor(v).hex}
                onChange={(e) =>
                  onSet(colorFromHex(e.target.value, hexFromColor(v).alpha), `color:${k}`)
                }
              />
            )}
            <button className="gm-prop-value" onClick={start}>
              {v.length > 160 ? `${v.slice(0, 160)}…` : v}
            </button>
          </>
        )}
        <button
          className="gm-prop-remove"
          title={tgm('removeProp')}
          aria-label={tgm('removeProp')}
          onClick={onRemove}
        >
          <Icon name="x" size={12} />
        </button>
      </dd>
    </div>
  );
}
