import { useEffect, useRef, useState } from 'react';
import { runCommand } from './commands';
import { ChatPanel, runPhoneAction } from './components/Chat';
import { ActivityBar, StatusBar } from './components/Chrome';
import { EditorArea } from './components/Editor';
import { Explorer } from './components/Explorer';
import { GitPanel } from './components/GitPanel';
import { Icon } from './components/Icon';
import { comboFromEvent } from './keys';
import { Modals } from './components/Modals';
import { NoticeBanner, UpdateBanner, introOnStart, noticeSeen } from './components/Plan';
import { MailPanel } from './components/MailPanel';
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
  setState,
  switchWorkspace,
  toast as showToast,
  updateChat,
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

const CHAT_W_KEY = 'zs.chatWidth';
const SIDE_W_KEY = 'zs.sideWidth';
/** Room the editor keeps between the side bar and the chat, so neither squeezes it flat. */
const CENTER_MIN = 360;

/** The width the user last dragged the side bar to; otherwise a fifth of the window. */
function initialSideWidth(): number {
  const saved = Number(localStorage.getItem(SIDE_W_KEY));
  if (saved >= 160) return saved;
  return Math.round(Math.min(280, Math.max(200, window.innerWidth * 0.18)));
}

/** The width the user last dragged the chat to; otherwise about a third of the window. */
function initialChatWidth(): number {
  const saved = Number(localStorage.getItem(CHAT_W_KEY));
  if (saved >= 280) return Math.min(saved, window.innerWidth - 200);
  return Math.round(Math.min(640, Math.max(400, window.innerWidth * 0.36)));
}

export function App() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const chatSplit = useStore((s) => Boolean(s.chatSplit));
  const chatList = useStore((s) => s.chatList);
  const noTabs = useStore((s) => s.tabs.length === 0);
  const toast = useStore((s) => s.toast);
  const [sideW, setSideW] = useState(initialSideWidth);
  const [chatW, setChatW] = useState(initialChatWidth);
  const [winW, setWinW] = useState(window.innerWidth);
  const [panelH, setPanelH] = useState(260);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const maxWanted = useStore((s) => s.maximized);
  // Only an area that is showing can fill the window.
  const max =
    (maxWanted === 'side' && sidebar) ||
    (maxWanted === 'panel' && panelOpen) ||
    (maxWanted === 'editor' && !noTabs)
      ? maxWanted
      : null;
  const chatWide = chatOpen && noTabs && !panelOpen && !max;
  // On a narrow window the side bar gives way first, then the chat, so the editor keeps
  // CENTER_MIN. The dragged widths are kept and come back when the window grows.
  const room = winW - 48 - CENTER_MIN;
  const chatShown = chatOpen && !chatWide;
  const sideShown = sidebar
    ? Math.max(160, Math.min(sideW, room - (chatShown ? Math.min(chatW, 400) : 0)))
    : 0;
  const chatShownW = Math.max(280, Math.min(chatW, room - sideShown));
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
    const onResize = () => setWinW(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (panelOpen) setTerminalMounted(true);
  }, [panelOpen]);

  // The maximized area was closed: the next time it opens it comes back at its usual size.
  useEffect(() => {
    if (maxWanted && !max) setState({ maximized: null });
  }, [maxWanted, max]);

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
      void api().whatsapp.status().then((whatsapp) => setState({ whatsapp }));
      await refreshModels().catch(() => undefined);
      // The guided setup (no AI connected yet) or what's new in this version, once.
      const s = getState();
      if (s.settings.intro)
        introOnStart(s.settings.version, s.models.length > 0 || Boolean(s.settings.defaultModel));
    })();
    return api().on((ev) => {
      if (ev.type === 'workspace') switchWorkspace(ev.workspace);
      if (ev.type === 'fs:changed') setState((s) => ({ fsVersion: s.fsVersion + 1 }));
      if (ev.type === 'command') void runCommand(ev.command);
      if (ev.type === 'phone') runPhoneAction(ev.action);
      if (ev.type === 'phone:status') {
        if (ev.status.phones > getState().phone.phones) showToast(t('phonePaired'));
        setState({ phone: ev.status });
      }
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
      if (ev.type === 'whatsapp:status') setState({ whatsapp: ev.status });
      if (ev.type === 'chat:title')
        for (const c of getState().chats)
          if (c.conversationId === ev.conversationId) updateChat(c.id, { title: ev.title });
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
        {sidebar && (!max || max === 'side') && (
          <>
            <aside
              className="sidebar"
              style={max === 'side' ? { flex: 1, borderRight: 'none' } : { width: sideShown }}
            >
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
              ) : sidebar === 'mail' ? (
                <MailPanel />
              ) : (
                <SearchView />
              )}
            </aside>
            {!max && (
              <Sash
                dir="x"
                onDrag={(d) =>
                  setSideW(() => {
                    const next = Math.min(900, Math.max(160, sideShown + d));
                    localStorage.setItem(SIDE_W_KEY, String(Math.round(next)));
                    return next;
                  })
                }
              />
            )}
          </>
        )}
        {/* With no file open the chat takes the whole center, like a chat app. */}
        <div
          className={max === 'panel' ? 'center center-max-panel' : 'center'}
          style={chatWide || max === 'side' ? { display: 'none' } : undefined}
        >
          <EditorArea />
          {terminalMounted && (
            <div
              style={{
                display: panelOpen && max !== 'editor' ? 'flex' : 'none',
                flexDirection: 'column',
                ...(max === 'panel' ? { flex: 1, minHeight: 0 } : {}),
              }}
            >
              {!max && (
                <Sash
                  dir="y"
                  onDrag={(d) => setPanelH((h) => Math.min(800, Math.max(100, h - d)))}
                />
              )}
              <div
                style={max === 'panel' ? { flex: 1, minHeight: 0 } : { height: panelH }}
                className="panel-wrap"
              >
                <TerminalPanel />
              </div>
            </div>
          )}
        </div>
        {/* Kept mounted while hidden so the conversation survives toggling the panel. */}
        {chatOpen && !chatWide && !max && (
          <Sash
            dir="x"
            onDrag={(d) =>
              setChatW(() => {
                const next = Math.min(chatSplit ? 1600 : 900, Math.max(280, chatShownW - d));
                localStorage.setItem(CHAT_W_KEY, String(Math.round(next)));
                return next;
              })
            }
          />
        )}
        <aside
          className={chatWide ? 'chat-wrap chat-wide' : 'chat-wrap'}
          style={{
            width: chatWide ? undefined : chatShownW,
            display: chatOpen && !max ? 'flex' : 'none',
          }}
        >
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
            <div className="drop-icon">
              <Icon name="folder" size={30} />
            </div>
            {t('dropRelease')}
          </div>
        </div>
      )}
    </div>
  );
}
