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
import { ConfirmDialog } from './components/ConfirmDialog';
import { NoticeBanner, UpdateBanner, introOnStart, noticeSeen } from './components/Plan';
import { MailPanel } from './components/MailPanel';
import { WatchPanel } from './components/WatchPanel';
import { RunPanel } from './components/RunPanel';
import { SupabasePanel } from './components/SupabasePanel';
import { VercelPanel } from './components/VercelPanel';
import { GCloudPanel } from './components/GCloudPanel';
import { DesignPanel } from './components/DesignPanel';
import { SearchView } from './components/Search';
import { TerminalPanel } from './components/Terminal';
import { VideoStudioHost } from './components/video/VideoStudio';
import { isStudioFile } from './components/video/videoCommands';
import { getV as getVideo, openStudio } from './components/video/videoStore';
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

/** Pixels a separator moves per arrow key press. */
const SASH_STEP = 16;

/**
 * Drag handle that resizes a neighbour. `onStart` runs when a drag (or a key press) begins,
 * so the owner can sync its stored size with the size actually shown; `onDrag` then gets
 * the movement since the previous call (the owner adds it with a functional setState, so
 * every move builds on the latest size). Focusable: ←/→ (or ↑/↓) move it SASH_STEP px.
 */
function Sash({
  dir,
  label,
  onStart,
  onDrag,
}: {
  dir: 'x' | 'y';
  label: string;
  onStart?: () => void;
  onDrag: (delta: number) => void;
}) {
  const last = useRef(0);
  return (
    <div
      className={`sash sash-${dir}`}
      role="separator"
      // A vertical bar (between columns) resizes horizontally, and the other way round.
      aria-orientation={dir === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      title={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const back = dir === 'x' ? 'ArrowLeft' : 'ArrowUp';
        const fwd = dir === 'x' ? 'ArrowRight' : 'ArrowDown';
        if (e.key !== back && e.key !== fwd) return;
        e.preventDefault();
        onStart?.();
        onDrag(e.key === fwd ? SASH_STEP : -SASH_STEP);
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        onStart?.();
        last.current = dir === 'x' ? e.clientX : e.clientY;
        const cls = dir === 'x' ? 'dragging' : 'dragging-y';
        const move = (ev: MouseEvent) => {
          const now = dir === 'x' ? ev.clientX : ev.clientY;
          onDrag(now - last.current);
          last.current = now;
        };
        const up = () => {
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          document.body.classList.remove(cls);
        };
        document.body.classList.add(cls);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
      }}
    />
  );
}

const CHAT_W_KEY = 'zs.chatWidth';
const SIDE_W_KEY = 'zs.sideWidth';
const PANEL_H_KEY = 'zs.panelHeight';
/** Room the editor keeps between the side bar and the chat, so neither squeezes it flat. */
const CENTER_MIN = 360;
/** Height kept for the editor (and the status bar) above the bottom panel. */
const PANEL_ROOM = 180;
const PANEL_MIN = 100;

/** The height the user last dragged the bottom panel to. */
function initialPanelHeight(): number {
  const saved = Number(localStorage.getItem(PANEL_H_KEY));
  return saved >= PANEL_MIN ? saved : 260;
}

/** Notifications: their own component so a toast does not re-render the whole app. The live
 *  region is always mounted, so screen readers announce each new message. */
function Toast() {
  const toast = useStore((s) => s.toast);
  return (
    <div className="toast-live" role="status" aria-live="polite">
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

/** Changed-files badge on the Git icon. Separate, so `fs:changed` bursts (an agent writing
 *  many files) do not re-render the whole app. */
function GitBadgeWatcher() {
  const workspaceRoot = useStore((s) => s.workspace?.root);
  const fsVersion = useStore((s) => s.fsVersion);
  useEffect(() => {
    const timer = setTimeout(() => void refreshGitBadge(), 400);
    return () => clearTimeout(timer);
  }, [workspaceRoot, fsVersion]);
  return null;
}

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

/** Drop a folder (or a file) anywhere in the window to open it. Capture phase so the editor
 *  does not swallow the drop as text. Own component: the "dragging" state re-renders only
 *  the overlay. */
function DropOverlay() {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    // Images dropped on the chat's message box are attachments (Chat.tsx), not a folder to open.
    const onChatBox = (e: DragEvent) =>
      e.target instanceof Element &&
      Boolean(e.target.closest('.chat-input')) &&
      [...(e.dataTransfer?.items ?? [])].some(
        (i) => i.kind === 'file' && i.type.startsWith('image/'),
      );
    // Video Studio takes its own drops (media library, timeline).
    const onStudio = () => {
      const v = getVideo();
      return v.open && !v.minimized;
    };
    const hasFiles = (e: DragEvent) =>
      Boolean(e.dataTransfer?.types.includes('Files')) && !onChatBox(e) && !onStudio();
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
      // A video, an audio file or a video project opens Video Studio.
      if (path && isStudioFile(path)) void openStudio(path);
      else if (path) void openDropped(path);
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
  if (!dragging) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-box">
        <div className="drop-icon">
          <Icon name="folder" size={30} />
        </div>
        {t('dropRelease')}
      </div>
    </div>
  );
}

export function App() {
  const sidebar = useStore((s) => s.sidebar);
  const panelOpen = useStore((s) => s.panelOpen);
  const chatOpen = useStore((s) => s.chatOpen);
  const chatSplit = useStore((s) => Boolean(s.chatSplit));
  const chatList = useStore((s) => s.chatList);
  const noTabs = useStore((s) => s.tabs.length === 0);
  const [sideW, setSideW] = useState(initialSideWidth);
  const [chatW, setChatW] = useState(initialChatWidth);
  const [winW, setWinW] = useState(window.innerWidth);
  const [winH, setWinH] = useState(window.innerHeight);
  const [panelH, setPanelH] = useState(initialPanelHeight);
  const [terminalMounted, setTerminalMounted] = useState(false);
  const maxWanted = useStore((s) => s.maximized);
  // Only an area that is showing can fill the window.
  const max =
    (maxWanted === 'side' && sidebar) ||
    (maxWanted === 'panel' && panelOpen) ||
    (maxWanted === 'editor' && !noTabs)
      ? maxWanted
      : null;
  // The Panel de Edición takes the editor's place (and the side bar's): the chat stays.
  const design = sidebar === 'design';
  const chatWide = chatOpen && noTabs && !panelOpen && !max && !design;
  // On a narrow window the side bar gives way first, then the chat, so the editor keeps
  // CENTER_MIN. The dragged widths are kept and come back when the window grows.
  const room = winW - 48 - CENTER_MIN;
  const chatShown = chatOpen && !chatWide;
  // Two chats side by side (and the list of chats) need their own room: below this
  // each pane gets squeezed and its contents spill out.
  const chatMin = (chatSplit ? 620 : 280) + (chatList ? 190 : 0);
  const sideShown = sidebar && !design
    ? Math.max(160, Math.min(sideW, room - (chatShown ? Math.min(chatW, chatMin + 120) : 0)))
    : 0;
  const chatShownW = Math.min(
    Math.max(280, winW - 48 - sideShown - 160),
    Math.max(chatMin, Math.min(chatW, room - sideShown)),
  );
  // The bottom panel never takes the whole window: the editor keeps PANEL_ROOM px.
  const panelMax = Math.max(PANEL_MIN, winH - PANEL_ROOM);
  const panelShownH = Math.max(PANEL_MIN, Math.min(panelH, panelMax));

  // When the window shrinks so far that the editor would drop under CENTER_MIN, the list
  // of chats closes (the conversation stays). Only on resize: opening the list on a narrow
  // window is the user's choice.
  const layout = useRef({ center: 0, chatList: false, chatShown: false });
  layout.current = {
    center: winW - 48 - sideShown - (chatShown ? chatShownW : 0),
    chatList: Boolean(chatList),
    chatShown,
  };
  const prevWinW = useRef(winW);
  useEffect(() => {
    const shrank = winW < prevWinW.current;
    prevWinW.current = winW;
    const l = layout.current;
    if (shrank && l.chatShown && l.chatList && l.center < CENTER_MIN) setState({ chatList: false });
  }, [winW]);

  useEffect(() => {
    // One layout pass per frame while the window is being resized.
    let frame = 0;
    const onResize = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setWinW(window.innerWidth);
        setWinH(window.innerHeight);
      });
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(frame);
    };
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
      // The Settings recorder is capturing a new shortcut: let it see the keys.
      if ((e.target as Element | null)?.closest?.('.key-recorder')) return;
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

  // Separators. A drag starts from the size actually shown (it can be smaller than the stored
  // one on a narrow window), then each move adds its delta to the latest size; the result is
  // clamped and remembered for the next launch.
  const sideMaxW = 900;
  const chatMaxW = chatSplit ? 1600 : 900;
  const dragSide = (d: number) =>
    setSideW((w) => {
      const next = Math.min(sideMaxW, Math.max(160, w + d));
      localStorage.setItem(SIDE_W_KEY, String(Math.round(next)));
      return next;
    });
  const dragChat = (d: number) =>
    setChatW((w) => {
      const next = Math.min(chatMaxW, Math.max(280, w - d));
      localStorage.setItem(CHAT_W_KEY, String(Math.round(next)));
      return next;
    });
  const dragPanel = (d: number) =>
    setPanelH((h) => {
      const next = Math.min(panelMax, Math.max(PANEL_MIN, h - d));
      localStorage.setItem(PANEL_H_KEY, String(Math.round(next)));
      return next;
    });

  useEffect(() => {
    void (async () => {
      await Promise.all([refreshSettings(), loadPrefs(), refreshLicense()]);
      applyTheme(getState().settings.theme);
      setState({ workspace: await api().workspace.current() });
      void api()
        .watch.status()
        .then((watch) => setState({ watch }));
      void api()
        .whatsapp.status()
        .then(async (whatsapp) => {
          setState({ whatsapp });
          // WhatsApp control left on: Zinarix connects by itself so the chats get answers.
          if (whatsapp.control && whatsapp.chats.length && !whatsapp.linked) {
            const phone = await api().phone.start();
            setState({ phone });
          }
        })
        .catch(() => undefined);
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
      if (ev.type === 'browser:show' || ev.type === 'browser:focus') openBrowserTab();
      if (ev.type === 'whatsapp:status') setState({ whatsapp: ev.status });
      if (ev.type === 'watch:status') setState({ watch: ev.status });
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
        {design && (
          <div className="design-host">
            <DesignPanel />
          </div>
        )}
        {sidebar && !design && (!max || max === 'side') && (
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
              ) : sidebar === 'gcloud' ? (
                <GCloudPanel />
              ) : sidebar === 'mail' ? (
                <MailPanel />
              ) : sidebar === 'watch' ? (
                <WatchPanel />
              ) : (
                <SearchView />
              )}
            </aside>
            {!max && (
              <Sash
                dir="x"
                label={t('resizeSidebar')}
                onStart={() => setSideW(sideShown)}
                onDrag={dragSide}
              />
            )}
          </>
        )}
        {/* With no file open the chat takes the whole center, like a chat app. */}
        <div
          className={max === 'panel' ? 'center center-max-panel' : 'center'}
          style={chatWide || max === 'side' || design ? { display: 'none' } : undefined}
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
                  label={t('resizePanel')}
                  onStart={() => setPanelH(panelShownH)}
                  onDrag={dragPanel}
                />
              )}
              <div
                style={max === 'panel' ? { flex: 1, minHeight: 0 } : { height: panelShownH }}
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
            label={t('resizeChat')}
            onStart={() => setChatW(chatShownW)}
            onDrag={dragChat}
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
      <VideoStudioHost />
      <ConfirmDialog />
      <div className="app-banners">
        <NoticeBanner />
        <UpdateBanner />
      </div>
      <Toast />
      <DropOverlay />
      <GitBadgeWatcher />
    </div>
  );
}
