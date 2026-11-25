import { useEffect, useRef } from 'react';
import type { Prefs } from '../../shared/api';
import { tabKeyDown } from '../a11y';
import { attachDebugToEditor } from '../debug';
import { attachGitGutter } from '../gitGutter';
import { type EditorSplit, SPLIT_DEFAULT, ratioAt } from '../editorSplit';
import { attachInlineReview } from '../inlineReview';
import { t } from '../i18n';
import { monaco } from '../monaco';
import {
  activateSide,
  attachSideEditor,
  closeSide,
  closeSideTab,
  focusEditorGroup,
  getDoc,
  getState,
  setSplitRatio,
  setState,
  useStore,
} from '../store';
import { monacoTheme } from '../themes';
import { Icon } from './Icon';

export function prefOptions(p: Prefs): monaco.editor.IEditorOptions {
  return {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    wordWrap: p.wordWrap ? 'on' : 'off',
    minimap: { enabled: p.minimap },
    lineNumbers: p.lineNumbers ? 'on' : 'off',
    inlineSuggest: { enabled: true, mode: 'subwordSmart' },
  };
}

/**
 * B1: the side editor group. A second Monaco editor beside the main one, with its own tabs.
 * It shows documents that are open in the main group too (same model, so both views stay in
 * sync), each with its own scroll and cursor here.
 */
export function SideEditor({ split }: { split: EditorSplit }) {
  const prefs = useStore((s) => s.prefs);
  const tabs = useStore((s) => s.tabs);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  /** Scroll and cursor of each file in this group (the main group keeps its own). */
  const views = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
  const shown = useRef<string | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      model: null,
      ...prefOptions(getState().prefs),
      automaticLayout: true,
      theme: monacoTheme(getState().settings.theme),
      fontLigatures: true,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      stickyScroll: { enabled: true },
      scrollBeyondLastLine: false,
      padding: { top: 6 },
      glyphMargin: true,
    });
    const dbg = attachDebugToEditor(ed);
    const gitMarks = attachGitGutter(ed);
    // C4: an AI edit asked from this group is reviewed here, with the same keys.
    const aiReview = attachInlineReview(ed);
    editorRef.current = ed;
    attachSideEditor(ed);
    const subs = [
      ed.onDidFocusEditorText(() => focusEditorGroup(1)),
      ed.onDidChangeCursorPosition((e) => {
        if (getState().editorFocus === 1)
          setState({ cursor: { line: e.position.lineNumber, column: e.position.column } });
      }),
    ];
    return () => {
      for (const s of subs) s.dispose();
      dbg.dispose();
      gitMarks.dispose();
      aiReview.dispose();
      attachSideEditor(null);
      editorRef.current = null;
      ed.dispose();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions(prefOptions(prefs));
  }, [prefs]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    if (shown.current && shown.current !== split.active)
      views.current.set(shown.current, ed.saveViewState());
    const doc = getDoc(split.active);
    if (ed.getModel() !== (doc?.model ?? null)) {
      ed.setModel(doc?.model ?? null);
      const view = views.current.get(split.active);
      if (view) ed.restoreViewState(view);
    }
    shown.current = split.active;
    for (const p of views.current.keys()) if (!split.paths.includes(p)) views.current.delete(p);
    if (doc && getState().editorFocus === 1) ed.focus();
  }, [split.active, split.paths]);

  const ratio = useStore((s) => s.splitRatio);
  const side = useRef<HTMLDivElement>(null);
  /** The share for a pointer at `x`, measured on the row both groups live in. */
  const shareAt = (x: number): number | null => {
    const row = side.current?.parentElement?.getBoundingClientRect();
    return row ? ratioAt(x, row.left, row.width) : null;
  };

  return (
    <div
      className="editor-side"
      ref={side}
      style={{ flexGrow: 1 - ratio }}
      onMouseDownCapture={() => focusEditorGroup(1)}
    >
      <div
        className="editor-split-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('editorSplitResize')}
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={Math.round(ratio * 100)}
        title={t('editorSplitResize')}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          e.currentTarget.classList.add('dragging');
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const r = shareAt(e.clientX);
          if (r !== null) setSplitRatio(r, false);
        }}
        onPointerUp={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          e.currentTarget.releasePointerCapture(e.pointerId);
          e.currentTarget.classList.remove('dragging');
          setSplitRatio(getState().splitRatio);
        }}
        onDoubleClick={() => setSplitRatio(SPLIT_DEFAULT)}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0;
          if (e.key === 'Home' || e.key === 'Enter') setSplitRatio(SPLIT_DEFAULT);
          else if (step) setSplitRatio(getState().splitRatio + step);
          else return;
          e.preventDefault();
        }}
      />
      <div className="tabs" role="tablist" aria-label={t('editorSplitRight')}>
        {split.paths.map((path) => {
          const tab = tabs.find((x) => x.path === path);
          const on = path === split.active;
          return (
            <div
              key={path}
              role="tab"
              aria-selected={on}
              tabIndex={on ? 0 : -1}
              className={`tab ${on ? 'active' : ''}`}
              title={path}
              onClick={() => activateSide(path)}
              onKeyDown={(e) =>
                tabKeyDown(
                  e,
                  () => activateSide(path),
                  () => closeSideTab(path),
                )
              }
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeSideTab(path);
                }
              }}
            >
              <span className="tab-name">{tab?.name ?? path.split('/').pop()}</span>
              <button
                className={`tab-close ${tab?.dirty ? 'dirty' : ''}`}
                aria-label={t('close')}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  closeSideTab(path);
                }}
              >
                {tab?.dirty ? '●' : <Icon name="x" size={13} />}
              </button>
            </div>
          );
        })}
        <div className="spacer" />
        <button
          className="max-btn"
          title={t('editorCloseSide')}
          aria-label={t('editorCloseSide')}
          onClick={() => closeSide()}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="editor-host" ref={host} />
    </div>
  );
}
