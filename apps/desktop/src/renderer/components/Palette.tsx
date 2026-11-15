import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ConversationView } from '../../shared/api';
import {
  bumpRecent,
  parseLine,
  parseQuery,
  prefixOf,
  rankItems,
  readRecent,
  recentKey,
  type PaletteRecent,
  type PaletteScope,
} from '../../shared/palette';
import { commands, runCommand } from '../commands';
import { t } from '../i18n';
import { tpal } from '../i18nPalette';
import { monaco } from '../monaco';
import {
  api,
  chooseModel,
  getEditor,
  getState,
  newChat,
  openFile,
  selectChat,
  setState,
  toast,
  useStore,
} from '../store';
import { fileIcon } from './icons';
import { fuzzy } from './QuickPick';
import { fuzzyMarks } from './Search';
import './palette.css';

/**
 * Fase 19: one palette for files, commands, symbols, chats and lines. The first character
 * picks the list (see shared/palette.ts); what was picked lately comes first.
 */

interface Row {
  /** Unique within the scope; also the key of its "used lately" entry. */
  id: string;
  label: string;
  detail?: string;
  hint?: string;
  group?: string;
  icon?: ReactNode;
  run: () => unknown;
}

const RECENT_KEY = 'zs.paletteRecent';

function loadRecent(): PaletteRecent {
  try {
    return readRecent(JSON.parse(localStorage.getItem(RECENT_KEY) ?? 'null'));
  } catch {
    return {};
  }
}

function saveRecent(r: PaletteRecent): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(r));
  } catch {
    // storage full or off: the order just is not remembered
  }
}

const close = () => setState({ modal: null });

interface Sym {
  name: string;
  kind: number;
  container: string;
  line: number;
  column: number;
}

/** Symbols of the editor's file, from whatever provider Monaco has (TS worker, LSP…). */
async function fileSymbols(): Promise<Sym[] | null> {
  const ed = getEditor();
  const model = ed?.getModel();
  if (!ed || !model) return null;
  // Monaco registers this command (the outline uses it); the editor's command service is
  // the only way to reach it from the standalone API.
  const svc = (
    ed as unknown as {
      _commandService?: { executeCommand(id: string, ...args: unknown[]): Promise<unknown> };
    }
  )._commandService;
  let top: monaco.languages.DocumentSymbol[] = [];
  try {
    top = ((await svc?.executeCommand('_executeDocumentSymbolProvider', model.uri)) ??
      []) as monaco.languages.DocumentSymbol[];
  } catch {
    top = [];
  }
  const out: Sym[] = [];
  const walk = (list: monaco.languages.DocumentSymbol[], container: string) => {
    for (const s of list) {
      const r = s.selectionRange ?? s.range;
      out.push({
        name: s.name,
        kind: s.kind,
        container,
        line: r.startLineNumber,
        column: r.startColumn,
      });
      if (s.children?.length) walk(s.children, container ? `${container}.${s.name}` : s.name);
    }
  };
  walk(top, '');
  return out;
}

function kindName(kind: number): string {
  const name = (monaco.languages.SymbolKind as unknown as Record<number, string>)[kind];
  return name ? name.toLowerCase() : '';
}

function goTo(line: number, column: number): void {
  const ed = getEditor();
  if (!ed) return;
  ed.setPosition({ lineNumber: line, column });
  ed.revealPositionInCenter({ lineNumber: line, column });
  ed.focus();
}

function openSaved(c: ConversationView): void {
  const there = getState().chats.find((x) => x.conversationId === c.id);
  if (there) return selectChat(there.id);
  const root = getState().workspace?.root;
  newChat({
    conversationId: c.id,
    ...(c.project && c.project !== root ? { folder: c.project } : {}),
  });
}

export function Palette({ initial = '' }: { initial?: string }) {
  const [query, setQuery] = useState(initial);
  const [index, setIndex] = useState(0);
  const [recent, setRecent] = useState(loadRecent);
  const [files, setFiles] = useState<string[] | null>(null);
  const [symbols, setSymbols] = useState<Sym[] | null | 'loading'>('loading');
  const [saved, setSaved] = useState<ConversationView[]>([]);
  const chats = useStore((s) => s.chats);
  const models = useStore((s) => s.models);
  const workspace = useStore((s) => s.workspace);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const uid = useId();
  const { scope, text } = parseQuery(query);

  // Each source loads the first time its scope is asked for.
  useEffect(() => {
    if (scope !== 'files' || files) return;
    if (!workspace) return setFiles([]);
    void api()
      .workspace.listFiles()
      .then(setFiles)
      .catch(() => setFiles([]));
  }, [scope, files, workspace]);
  useEffect(() => {
    if (scope !== 'symbols' || symbols !== 'loading') return;
    void fileSymbols().then(setSymbols);
  }, [scope, symbols]);
  useEffect(() => {
    if (scope !== 'chats') return;
    let live = true;
    const h = setTimeout(() => {
      void api()
        .ai.conversations(text, false)
        .then((r) => live && setSaved(r))
        .catch(() => live && setSaved([]));
    }, 120);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [scope, text]);

  const rows = useMemo<Row[]>(() => {
    switch (scope) {
      case 'files':
        return (files ?? []).map((f) => ({
          id: f,
          label: f.split('/').pop()!,
          detail: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '',
          icon: fileIcon(f),
          group: tpal('palFiles'),
          run: () => openFile(f),
        }));
      case 'commands': {
        const all: Row[] = commands()
          .filter((c) => c.id !== 'palette' && c.id !== 'quickOpen')
          .map((c) => ({
            id: c.id,
            label: c.label,
            hint: c.keys,
            group: /^(ai|chat)\./.test(c.id) ? tpal('palAi') : tpal('palCommands'),
            run: () => runCommand(c.id),
          }));
        const ai = tpal('palAi');
        const out = [...all.filter((r) => r.group !== ai), ...all.filter((r) => r.group === ai)];
        // Models only when searched: there can be hundreds.
        if (text)
          for (const m of models)
            if (m.kind === 'chat') {
              const ref = `${m.provider}/${m.id}`;
              out.push({
                id: `model:${ref}`,
                label: m.label ?? m.id,
                detail: `${m.provider} · ${tpal('palUseModel')}`,
                group: tpal('palModels'),
                run: () => chooseModel(ref),
              });
            }
        return out;
      }
      case 'symbols':
        return Array.isArray(symbols)
          ? symbols.map((s, i) => ({
              id: `${i}:${s.name}`,
              label: s.name,
              detail: s.container,
              hint: kindName(s.kind),
              group: tpal('palSymbols'),
              run: () => goTo(s.line, s.column),
            }))
          : [];
      case 'chats': {
        const open = new Set(chats.map((c) => c.conversationId).filter(Boolean));
        return [
          ...chats.map((c, i) => ({
            id: `open:${c.id}`,
            label: c.title || t('chatTabN', { n: i + 1 }),
            detail: c.waiting
              ? tpal('palChatWaiting')
              : c.busy
                ? tpal('palChatBusy')
                : (c.folder ?? ''),
            group: tpal('palChatsOpen'),
            run: () => selectChat(c.id),
          })),
          ...saved
            .filter((c) => !open.has(c.id))
            .map((c) => ({
              id: `saved:${c.id}`,
              label: c.title,
              detail: c.project ?? '',
              hint: tpal('palMessages', { n: c.messageCount }),
              group: tpal('palChatsSaved'),
              run: () => openSaved(c),
            })),
        ];
      }
      case 'line': {
        const model = getEditor()?.getModel();
        if (!model) return [];
        const max = model.getLineCount();
        const at = parseLine(text);
        if (!at) return [];
        const line = Math.min(at.line, max);
        return [
          {
            id: 'line',
            label: tpal('palGoLine', { line, col: at.column }),
            detail: at.line > max ? tpal('palLineOut', { max }) : '',
            group: tpal('palLine'),
            run: () => goTo(line, at.column),
          },
        ];
      }
    }
  }, [scope, files, symbols, chats, saved, models, text]);

  const shown = useMemo(() => {
    if (scope === 'line') return rows;
    const now = Date.now();
    const scored = rows.map((r) => ({
      item: r,
      key: recentKey(scope, r.id),
      score: text
        ? Math.max(fuzzy(text, r.label), fuzzy(text, `${r.detail ?? ''} ${r.group ?? ''}`) - 50)
        : 0,
    }));
    // Chats keep their own order (the saved ones come back already filtered by main).
    if (scope === 'chats' && !text) return rows;
    const ranked = rankItems(scored, recent, now, !text);
    return ranked.slice(0, scope === 'files' ? 100 : 300);
  }, [rows, scope, text, recent]);

  useEffect(() => setIndex(0), [query]);
  useEffect(() => {
    list.current?.querySelector('.pick-item.active')?.scrollIntoView({ block: 'nearest' });
  }, [index]);

  const pick = (r: Row) => {
    const next = bumpRecent(recent, recentKey(scope, r.id), Date.now());
    setRecent(next);
    saveRecent(next);
    close();
    try {
      const p = r.run();
      if (p instanceof Promise) p.catch((e: unknown) => toast(String((e as Error)?.message ?? e)));
    } catch (e) {
      toast(String((e as Error)?.message ?? e));
    }
  };

  const setScope = (s: PaletteScope) => {
    setQuery(prefixOf(s) + text);
    input.current?.focus();
  };

  const empty = (() => {
    if ((scope === 'symbols' || scope === 'line') && !getEditor()?.getModel())
      return tpal('palNoEditor');
    if (scope === 'files' && !workspace) return tpal('palNoFolder');
    if (scope === 'files' && !files) return tpal('palLoading');
    if (scope === 'symbols' && symbols === 'loading') return tpal('palLoading');
    if (scope === 'symbols' && !text) return tpal('palNoSymbols');
    if (scope === 'line') {
      const max = getEditor()?.getModel()?.getLineCount() ?? 0;
      return tpal('palLineHint', { max });
    }
    return null;
  })();

  // With an empty query the used-lately rows are marked as such (only for files and commands).
  const recentIds = useMemo(() => {
    if (text || (scope !== 'files' && scope !== 'commands')) return new Set<string>();
    return new Set(rows.filter((r) => recent[recentKey(scope, r.id)]).map((r) => r.id));
  }, [rows, recent, scope, text]);
  const groupOf = (r: Row) => (recentIds.has(r.id) ? tpal('palRecent') : r.group);

  const optId = (i: number) => `${uid}-opt-${i}`;
  const scopes: PaletteScope[] = ['files', 'commands', 'symbols', 'chats', 'line'];
  const scopeLabel: Record<PaletteScope, string> = {
    files: tpal('palScopeFiles'),
    commands: tpal('palScopeCommands'),
    symbols: tpal('palScopeSymbols'),
    chats: tpal('palScopeChats'),
    line: tpal('palScopeLine'),
  };

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div className="quick-pick palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          autoFocus
          role="combobox"
          aria-expanded={true}
          aria-autocomplete="list"
          aria-controls={`${uid}-list`}
          aria-activedescendant={shown[index] ? optId(index) : undefined}
          aria-label={tpal('palPlaceholder')}
          value={query}
          placeholder={tpal('palPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close();
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 1, shown.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === 'PageDown') {
              e.preventDefault();
              setIndex((i) => Math.min(i + 10, shown.length - 1));
            } else if (e.key === 'PageUp') {
              e.preventDefault();
              setIndex((i) => Math.max(i - 10, 0));
            } else if (e.key === 'Enter' && shown[index]) {
              e.preventDefault();
              pick(shown[index]!);
            }
          }}
        />
        <div
          className="pick-list"
          ref={list}
          id={`${uid}-list`}
          role="listbox"
          aria-label={tpal('palPlaceholder')}
        >
          {shown.map((r, i) => {
            const g = groupOf(r);
            const prev = i > 0 ? groupOf(shown[i - 1]!) : undefined;
            return (
              <div key={r.id} role="presentation">
                {g && !text && (i === 0 || prev !== g) && (
                  <div className="pick-group" role="presentation">
                    {g}
                  </div>
                )}
                <div
                  id={optId(i)}
                  role="option"
                  aria-selected={i === index}
                  className={`pick-item ${i === index ? 'active' : ''}`}
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => pick(r)}
                >
                  {r.icon && <span className="qo-icon">{r.icon}</span>}
                  <span className="pick-label">{text ? fuzzyMarks(text, r.label) : r.label}</span>
                  {r.detail && <span className="pick-detail">{r.detail}</span>}
                  {r.hint && <span className="pick-hint">{r.hint}</span>}
                </div>
              </div>
            );
          })}
          {shown.length === 0 && (
            <div className="pick-empty" role="status">
              {empty ?? t('noResults')}
            </div>
          )}
        </div>
        <div className="pick-footer palette-scopes" role="group">
          {scopes.map((s) => (
            <button
              key={s}
              type="button"
              className={`palette-scope ${s === scope ? 'on' : ''}`}
              aria-pressed={s === scope}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setScope(s)}
            >
              {prefixOf(s) && <kbd>{prefixOf(s)}</kbd>}
              {scopeLabel[s]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
