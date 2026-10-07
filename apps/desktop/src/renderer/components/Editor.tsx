import { useEffect, useRef } from 'react';
import { monaco } from '../monaco';
import { activate, attachEditor, closeTab, getDoc, setState, useStore } from '../store';
import { Welcome } from './Chrome';

export function EditorArea() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.settings.theme);
  const host = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const activeTab = tabs.find((x) => x.path === active);

  useEffect(() => {
    if (!host.current) return;
    const ed = monaco.editor.create(host.current, {
      model: null,
      automaticLayout: true,
      theme: theme === 'dark' ? 'vs-dark' : 'vs',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Consolas, monospace",
      fontLigatures: true,
      minimap: { enabled: true },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      stickyScroll: { enabled: true },
      tabSize: 2,
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
    const ed = editorRef.current;
    if (!ed) return;
    const doc = active ? getDoc(active) : undefined;
    ed.setModel(doc?.model ?? null);
    if (doc?.viewState) ed.restoreViewState(doc.viewState);
    if (doc) ed.focus();
  }, [active, tabs.length]);

  const showEditor = Boolean(activeTab && !activeTab.notice);
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
              <span className="tab-name">{tab.name}</span>
              <button
                className={`tab-close ${tab.dirty ? 'dirty' : ''}`}
                aria-label="Cerrar"
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
      {activeTab && <div className="breadcrumbs">{activeTab.path.split('/').join(' › ')}</div>}
      <div className="editor-host" ref={host} style={{ display: showEditor ? 'block' : 'none' }} />
      {activeTab?.notice && <div className="notice-pane">{activeTab.notice}</div>}
      {!activeTab && <Welcome />}
    </div>
  );
}
