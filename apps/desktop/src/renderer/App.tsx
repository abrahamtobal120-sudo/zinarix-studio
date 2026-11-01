import { useEffect, useRef, useState } from 'react';
import { runCommand } from './commands';
import { ChatPanel } from './components/Chat';
import { ActivityBar, StatusBar } from './components/Chrome';
import { EditorArea } from './components/Editor';
import { Explorer } from './components/Explorer';
import { GitPanel } from './components/GitPanel';
import { comboFromEvent } from './keys';
import { Modals } from './components/Modals';
import { NoticeBanner, UpdateBanner, introOnStart, noticeSeen } from './components/Plan';
import { RunPanel } from './components/RunPanel';
import { SupabasePanel } from './components/SupabasePanel';
import { VercelPanel } from './components/VercelPanel';
import { SearchView } from './components/Search';
import { TerminalPanel } from './components/Terminal';
import {
  api,
  applyTheme,
  getState,
  loadPrefs,
  openBrowserTab,
  refreshGitBadge,
  refreshLicense,
  openDropped,
  refreshModels,
  refreshSettings,
  resetDocs,
  setState,
  useStore,
} from './store';
import { t } from './i18n';

/** Drag handle that resizes a neighbour; persists nothing (kept simple on purpose). */
function Sash({ dir, onDrag }: { dir: 'x' | 'y'; onDrag: (delta: number) => void }) {
  const last = useRef(0);
  return (
    <div
      className={`sash sash-${dir}`}
      onMouseDown={(e) => {
        e.preventDefault();
        last.current = dir === 'x' ? e.clientX : e.clientY;
        const move = (ev: MouseEvent) => {
          const now = dir === 'x' ? ev.clientX : ev.clientY;
          onDrag(now - last.current);
          last.current = now;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          document.body.classList.remove('dragging');
        };
        document.body.classList.add('dragging');
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}

export function App() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const chatSplit = useStore((s) => Boolean(s.chatSplit));
  const chatList = useStore((s) => s.chatList);
  const toast = useStore((s) => s.toast);
  const [sideW, setSideW] = useState(320);
  const [chatW, setChatW] = useState(400);
  const [panelH, setPanelH] = useState(260);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Drop a folder (or a file) anywhere in the window to open it. Capture phase so the
  // editor does not swallow the drop as text.
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'));
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDragging(false);
    };
    const over = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (!file) return;
      const path = api().app.pathForFile(file);
      if (path) void openDropped(path);
    };
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('dragover', over, true);
    window.addEventListener('drop', drop, true);
    return () => {
      window.removeEventListener('dragenter', enter, true);
      window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('dragover', over, true);
      window.removeEventListener('drop', drop, true);
    };
  }, []);

  useEffect(() => {
    if (panelOpen) setTerminalMounted(true);
  }, [panelOpen]);

  // Two chats side by side need room: widen the panel (the user can still drag it).
  useEffect(() => {
    if (chatSplit) setChatW((w) => Math.max(w, Math.min(760, window.innerWidth * 0.55)));
  }, [chatSplit]);

  // The list of open chats takes room from the conversation: widen the panel for it.
  useEffect(() => {
    if (chatList) setChatW((w) => Math.max(w, Math.min(600, window.innerWidth * 0.45)));
  }, [chatList]);

  // Shortcuts customised in Settings (the built-in ones live in the app menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const custom = getState().prefs.keybindings;
      if (!Object.keys(custom).length) return;
      const combo = comboFromEvent(e);
      if (!combo) return;
      const id = Object.keys(custom).find((k) => custom[k] === combo);
      if (!id) return;
      e.preventDefault();
      e.stopPropagation();
      void runCommand(id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Changed-files badge on the Git icon.
  const workspaceRoot = useStore((s) => s.workspace?.root);
  const fsVersion = useStore((s) => s.fsVersion);
  useEffect(() => {
    const timer = setTimeout(() => void refreshGitBadge(), 400);
    return () => clearTimeout(timer);
  }, [workspaceRoot, fsVersion]);

  useEffect(() => {
    void (async () => {
      await Promise.all([refreshSettings(), loadPrefs(), refreshLicense()]);
      applyTheme(getState().settings.theme);
      setState({ workspace: await api().workspace.current() });
      await refreshModels().catch(() => undefined);
      // The guided setup (no AI connected yet) or what's new in this version, once.
      const s = getState();
      if (s.settings.intro)
        introOnStart(s.settings.version, s.models.length > 0 || Boolean(s.settings.defaultModel));
    })();
    return api().on((ev) => {
      if (ev.type === 'workspace') {
        if (getState().workspace?.root !== ev.workspace?.root) resetDocs();
        setState({ workspace: ev.workspace });
      }
      if (ev.type === 'fs:changed') setState((s) => ({ fsVersion: s.fsVersion + 1 }));
      if (ev.type === 'command') void runCommand(ev.command);
      if (ev.type === 'update')
        setState((s) => ({
          // "ready" (restart) wins over a later "available" for the same version.
          update:
            s.update?.state === 'ready' && s.update.version === ev.version
              ? s.update
              : { state: ev.state, version: ev.version, url: ev.url },
        }));
      if (ev.type === 'notice' && !noticeSeen(ev.id))
        setState({ notice: { id: ev.id, text: ev.text, url: ev.url } });
      if (ev.type === 'browser:show') openBrowserTab();
      // Another window changed models, keys, theme or preferences.
      if (ev.type === 'settings:changed')
        void (async () => {
          await Promise.all([refreshSettings(), loadPrefs(), refreshLicense()]);
          applyTheme(getState().settings.theme);
          void refreshModels();
        })();
    });
  }, []);

  return (
    <div className="app">
      <div className="main-row">
        <ActivityBar />
        {sidebar && (
          <>
            <aside className="sidebar" style={{ width: sideW }}>
              {sidebar === 'explorer' ? (
                <Explorer />
              ) : sidebar === 'git' ? (
                <GitPanel />
              ) : sidebar === 'run' ? (
                <RunPanel />
              ) : sidebar === 'vercel' ? (
                <VercelPanel />
              ) : sidebar === 'supabase' ? (
                <SupabasePanel />
              ) : (
                <SearchView />
              )}
            </aside>
            <Sash dir="x" onDrag={(d) => setSideW((w) => Math.min(900, Math.max(160, w + d)))} />
          </>
        )}
        <div className="center">
          <EditorArea />
          {terminalMounted && (
            <div style={{ display: panelOpen ? 'flex' : 'none', flexDirection: 'column' }}>
              <Sash dir="y" onDrag={(d) => setPanelH((h) => Math.min(800, Math.max(100, h - d)))} />
              <div style={{ height: panelH }} className="panel-wrap">
                <TerminalPanel />
              </div>
            </div>
          )}
        </div>
        {/* Kept mounted while hidden so the conversation survives toggling the panel. */}
        {chatOpen && (
          <Sash
            dir="x"
            onDrag={(d) => setChatW((w) => Math.min(chatSplit ? 1600 : 900, Math.max(280, w - d)))}
          />
        )}
        <aside className="chat-wrap" style={{ width: chatW, display: chatOpen ? 'flex' : 'none' }}>
          <ChatPanel />
        </aside>
      </div>
      <StatusBar />
      <Modals />
      <div className="app-banners">
        <NoticeBanner />
        <UpdateBanner />
      </div>
      {toast && <div className="toast">{toast}</div>}
      {dragging && (
        <div className="drop-overlay">
          <div className="drop-box">
            <div className="drop-icon">📂</div>
            {t('dropRelease')}
          </div>
        </div>
      )}
    </div>
  );
}
