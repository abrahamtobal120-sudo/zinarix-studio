import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { tabKeyDown } from '../a11y';
import { t } from '../i18n';
import { monaco } from '../monaco';
import { registerInlineCompletions } from '../inline';
import { attachNextEdit } from '../nextEdit';
import { attachInlineReview } from '../inlineReview';
import { attachGitGutter } from '../gitGutter';
import { installLsp } from '../lsp';
import { attachDebugToEditor, installDebug } from '../debug';
import { installTests } from '../testExplorer';
import { DebugToolbar } from './DebugPanel';
import { monacoTheme } from '../themes';
import {
  BROWSER_TAB,
  PLAYGROUND_TAB,
  SECURITY_TAB,
  WHATSAPP_TAB,
  activate,
  attachEditor,
  focusEditorGroup,
  openToSide,
  closeTab,
  getDoc,
  getState,
  setState,
  toggleMaximized,
  useStore,
} from '../store';
import { BrowserPane } from './Browser';
import { Welcome } from './Chrome';
import { FileViewerPane } from './FileViewers';
import { tgm } from './games/gamesStrings';
import { tg } from './graphics/graphicsStrings';
import { isGcodePath, isScenePath, isSvgPath, setTabViewer } from '../store';
import { tc } from './cad/cadStrings';
import { lazyNamed } from '../lazy';
import { SideEditor, prefOptions } from './EditorSplit';
import { SymbolCrumbs } from './SymbolCrumbs';

// C2: loaded the first time they are shown (see lazy.tsx).
const PlaygroundPane = lazyNamed(() => import('./Playground'), 'PlaygroundPane');
const WhatsAppPane = lazyNamed(() => import('./WhatsApp'), 'WhatsAppPane');
const SecuritySection = lazyNamed(() => import('./SecuritySection'), 'SecuritySection');
const NotebookView = lazyNamed(() => import('./notebook/NotebookView'), 'NotebookView');
const VectorEditor = lazyNamed(() => import('./vector/VectorEditor'), 'VectorEditor');
const PaintView = lazyNamed(() => import('./paint/PaintView'), 'PaintView');
const SceneView = lazyNamed(() => import('./games/SceneView'), 'SceneView');
const CadPreview = lazyNamed(() => import('./cad/CadPreview'), 'CadPreview');
const ModelView = lazyNamed(() => import('./cad/ModelView'), 'ModelView');
const GcodeView = lazyNamed(() => import('./cad/GcodeView'), 'GcodeView');
const SkpView = lazyNamed(() => import('./sketchup/SketchupPanel'), 'SkpView');

export function EditorArea() {
  const prefs = useStore((s) => s.prefs);
  const tabs = useStore((s) => s.tabs);
  const maximized = useStore((s) => s.maximized === 'editor');
  const active = useStore((s) => s.active);
  const split = useStore((s) => s.split);
  const splitRatio = useStore((s) => s.splitRatio);
  const sideFocused = useStore((s) => s.editorFocus === 1 && !!s.split);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeTab = tabs.find((x) => x.path === active);

  useEffect(() => {
    if (!host.current) return;
    registerInlineCompletions();
    installLsp();
    installDebug();
    installTests();
    const ed = monaco.editor.create(host.current, {
      model: null,
      ...prefOptions(getState().prefs),
      automaticLayout: true,
      // Initial theme only; later changes go through monaco.editor.setTheme.
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
      // Breakpoints and the debugger's current line.
      glyphMargin: true,
    });
    const dbg = attachDebugToEditor(ed);
    // Fase 8: next-edit prediction (Tab jumps / applies).
    const nextEdit = attachNextEdit(ed);
    // C4: an AI edit (Ctrl+K) is reviewed here, block by block.
    const aiReview = attachInlineReview(ed);
    // B7: git marks beside the line numbers.
    const gitMarks = attachGitGutter(ed);
    editorRef.current = ed;
    attachEditor(ed);
    const sub = ed.onDidChangeCursorPosition((e) =>
      setState({ cursor: { line: e.position.lineNumber, column: e.position.column } }),
    );
    const focus = ed.onDidFocusEditorText(() => focusEditorGroup(0));
    return () => {
      sub.dispose();
      focus.dispose();
      dbg.dispose();
      nextEdit.dispose();
      aiReview.dispose();
      gitMarks.dispose();
      attachEditor(null);
      ed.dispose();
    };
  }, []);

  useEffect(() => {
    editorRef.current?.updateOptions(prefOptions(prefs));
    for (const m of monaco.editor.getModels()) m.updateOptions({ tabSize: prefs.tabSize });
  }, [prefs]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const doc = active ? getDoc(active) : undefined;
    doc?.model.updateOptions({ tabSize: getState().prefs.tabSize });
    ed.setModel(doc?.model ?? null);
    if (doc?.viewState) ed.restoreViewState(doc.viewState);
    else if (doc?.cursor) {
      // A tab brought back from the last session: put the cursor where it was.
      ed.setPosition({ lineNumber: doc.cursor.line, column: doc.cursor.column });
      ed.revealLineInCenter(doc.cursor.line);
    }
    if (doc) ed.focus();
  }, [active, tabs.length, activeTab?.viewer]);

  const isBrowser = active === BROWSER_TAB;
  const isSecurity = active === SECURITY_TAB;
  const hasBrowserTab = tabs.some((x) => x.path === BROWSER_TAB);
  const isWhatsApp = active === WHATSAPP_TAB;
  const hasWhatsAppTab = tabs.some((x) => x.path === WHATSAPP_TAB);
  const isPlayground = active === PLAYGROUND_TAB;
  const hasPlaygroundTab = tabs.some((x) => x.path === PLAYGROUND_TAB);
  const special = isBrowser || isSecurity || isWhatsApp || isPlayground;
  const showEditor = Boolean(activeTab && !activeTab.notice && !activeTab.viewer && !special);
  // Fase 7: a .scad shows its 3D view beside the code (hidden per file until shown again).
  const [cadHidden, setCadHidden] = useState<ReadonlySet<string>>(new Set());
  const isCad = showEditor && !!active && /\.scad$/i.test(active);
  return (
    <div className="editor-area" id="editor-tabpanel" role="tabpanel">
      {tabs.length > 0 && (
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.path}
              role="tab"
              aria-selected={tab.path === active}
              aria-controls="editor-tabpanel"
              tabIndex={tab.path === active || (!activeTab && tab === tabs[0]) ? 0 : -1}
              className={`tab ${tab.path === active ? 'active' : ''}`}
              title={tab.path}
              onClick={() => activate(tab.path)}
              onKeyDown={(e) =>
                tabKeyDown(
                  e,
                  () => activate(tab.path),
                  () => void closeTab(tab.path),
                )
              }
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  void closeTab(tab.path);
                }
              }}
            >
              <span className="tab-name">
                {tab.path === SECURITY_TAB && <Icon name="shield" size={13} />}
                {tab.path === WHATSAPP_TAB && <Icon name="whatsapp" size={13} />}
                {tab.path === PLAYGROUND_TAB && <Icon name="beaker" size={13} />}
                {tab.path === BROWSER_TAB && (
                  <svg
                    className="tab-globe"
                    width="13"
                    height="13"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path
                      d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.8 5.5 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.5-3.8-9S9.5 5.5 12 3z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    />
                  </svg>
                )}
                {tab.name}
              </span>
              <button
                className={`tab-close ${tab.dirty ? 'dirty' : ''}`}
                aria-label={t('close')}
                tabIndex={-1}
                onClick={(e) => {
                  e.stopPropagation();
                  void closeTab(tab.path);
                }}
              >
                {tab.dirty ? '●' : <Icon name="x" size={13} />}
              </button>
            </div>
          ))}
          <div className="spacer" />
          <button
            className="max-btn"
            title={t('editorSplitRight')}
            aria-label={t('editorSplitRight')}
            disabled={!showEditor}
            onClick={() => openToSide(active)}
          >
            <Icon name="columns" size={14} />
          </button>
          <button
            className={`max-btn ${maximized ? 'on' : ''}`}
            title={maximized ? t('restoreSize') : t('maximize')}
            aria-label={maximized ? t('restoreSize') : t('maximize')}
            onClick={() => toggleMaximized('editor')}
          >
            <Icon name={maximized ? 'minimize' : 'maximize'} size={14} />
          </button>
        </div>
      )}
      {activeTab && !special && (
        <div className="breadcrumbs">
          <span className="crumb-path">{activeTab.path.split('/').join(' › ')}</span>
          {showEditor && <SymbolCrumbs path={activeTab.path} />}
          {/* Fase 3B: an SVG open as text can go back to the design editor. */}
          {!activeTab.viewer && !activeTab.notice && isSvgPath(activeTab.path) && (
            <button
              className="crumb-action"
              title={tg('designHint')}
              onClick={() => setTabViewer(activeTab.path, 'design')}
            >
              <Icon name="palette" size={12} /> {tg('design')}
            </button>
          )}
          {/* Fase 6: a Godot scene open as text can go back to its node tree. */}
          {!activeTab.viewer && !activeTab.notice && isScenePath(activeTab.path) && (
            <button
              className="crumb-action"
              title={tgm('sceneHint')}
              onClick={() => setTabViewer(activeTab.path, 'scene')}
            >
              <Icon name="tree" size={12} /> {tgm('sceneTitle')}
            </button>
          )}
          {/* Fase 7: a G-code open as text can go back to its layers. */}
          {!activeTab.viewer && !activeTab.notice && isGcodePath(activeTab.path) && (
            <button className="crumb-action" onClick={() => setTabViewer(activeTab.path, 'gcode')}>
              <Icon name="layers" size={12} /> {tc('sliceOpen')}
            </button>
          )}
        </div>
      )}
      <div
        className={`editor-split ${split ? 'has-side' : ''} ${sideFocused ? 'side-focused' : ''}`}
        style={{ display: showEditor ? 'flex' : 'none' }}
      >
        <div
          className="editor-host"
          ref={host}
          style={split ? { flexGrow: splitRatio } : undefined}
        />
        {isCad && active && !cadHidden.has(active) && (
          <CadPreview
            key={active}
            path={active}
            onHide={() => setCadHidden((s) => new Set(s).add(active))}
          />
        )}
        {isCad && active && cadHidden.has(active) && (
          <button
            className="btn ghost cad-show"
            onClick={() =>
              setCadHidden((s) => {
                const n = new Set(s);
                n.delete(active);
                return n;
              })
            }
          >
            {tc('show')}
          </button>
        )}
        {split && <SideEditor split={split} />}
      </div>
      <div className="dbg-float">
        <DebugToolbar />
      </div>
      {activeTab?.notice && <div className="notice-pane">{activeTab.notice}</div>}
      {activeTab?.viewer === 'notebook' ? (
        <NotebookView key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'design' ? (
        <VectorEditor key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'paint' ? (
        <PaintView key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'scene' ? (
        <SceneView key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'model' ? (
        <ModelView key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'gcode' ? (
        <GcodeView key={activeTab.path} path={activeTab.path} />
      ) : activeTab?.viewer === 'sketchup' ? (
        <SkpView key={activeTab.path} path={activeTab.path} />
      ) : (
        activeTab?.viewer && <FileViewerPane key={activeTab.path} tab={activeTab} />
      )}
      {hasBrowserTab && <BrowserPane visible={isBrowser} />}
      {hasWhatsAppTab && <WhatsAppPane visible={isWhatsApp} />}
      {/* Kept mounted while open so runs keep streaming when you switch tabs. */}
      {hasPlaygroundTab && <PlaygroundPane visible={isPlayground} />}
      {isSecurity && <SecuritySection />}
      {!activeTab && <Welcome />}
    </div>
  );
}
