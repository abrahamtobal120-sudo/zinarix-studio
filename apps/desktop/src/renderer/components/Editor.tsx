import { useEffect, useRef } from 'react';
import { t } from '../i18n';
import { monaco } from '../monaco';
import { registerInlineCompletions } from '../inline';
import { monacoTheme } from '../themes';
import type { Prefs } from '../../shared/api';
import {
  BROWSER_TAB,
  SECURITY_TAB,
  activate,
  attachEditor,
  closeTab,
  getDoc,
  getState,
  setState,
  useStore,
} from '../store';
import { BrowserPane } from './Browser';
import { SecuritySection } from './SecuritySection';
import { Welcome } from './Chrome';

function prefOptions(p: Prefs): monaco.editor.IEditorOptions {
  return {
    fontSize: p.fontSize,
    fontFamily: p.fontFamily,
    wordWrap: p.wordWrap ? 'on' : 'off',
    minimap: { enabled: p.minimap },
    lineNumbers: p.lineNumbers ? 'on' : 'off',
    inlineSuggest: { enabled: true, mode: 'subwordSmart' },
  };
}

export function EditorArea() {
  const prefs = useStore((s) => s.prefs);
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeTab = tabs.find((x) => x.path === active);

  useEffect(() => {
    if (!host.current) return;
    registerInlineCompletions();
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
    });
    editorRef.current = ed;
    attachEditor(ed);
    const sub = ed.onDidChangeCursorPosition((e) =>
      setState({ cursor: { line: e.position.lineNumber, column: e.position.column } }),
    );
    return () => {
      sub.dispose();
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
    if (doc) ed.focus();
  }, [active, tabs.length]);

  const isBrowser = active === BROWSER_TAB;
  const isSecurity = active === SECURITY_TAB;
  const hasBrowserTab = tabs.some((x) => x.path === BROWSER_TAB);
  const showEditor = Boolean(activeTab && !activeTab.notice && !isBrowser && !isSecurity);
  return (
    <div className="editor-area">
      {tabs.length > 0 && (
        <div className="tabs" role="tablist">
          {tabs.map((tab) => (
            <div
              key={tab.path}
              role="tab"
              aria-selected={tab.path === active}
              className={`tab ${tab.path === active ? 'active' : ''}`}
              title={tab.path}
              onClick={() => activate(tab.path)}
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  closeTab(tab.path);
                }
              }}
            >
              <span className="tab-name">
                {tab.path === SECURITY_TAB && '🛡️ '}
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
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.path);
                }}
              >
                {tab.dirty ? '●' : '×'}
              </button>
            </div>
          ))}
        </div>
      )}
      {activeTab && !isBrowser && (
        <div className="breadcrumbs">{activeTab.path.split('/').join(' › ')}</div>
      )}
      <div className="editor-host" ref={host} style={{ display: showEditor ? 'block' : 'none' }} />
      {activeTab?.notice && <div className="notice-pane">{activeTab.notice}</div>}
      {hasBrowserTab && <BrowserPane visible={isBrowser} />}
      {isSecurity && <SecuritySection />}
      {!activeTab && <Welcome />}
    </div>
  );
}
