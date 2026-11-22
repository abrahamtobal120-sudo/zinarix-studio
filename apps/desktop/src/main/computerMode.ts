import { BrowserWindow, globalShortcut, screen } from 'electron';
import type { ComputerRunHooks } from './computerTools.js';
import { LOGO_SVG } from './zinarixLogo.js';

/**
 * "Controlar la compu" (full computer control) for one chat run: the first time the AI acts
 * on the screen, the Zinarix window gets out of the way (minimized, so the AI sees the
 * desktop and the user's programs) and a small always-on-top bar shows what the AI is doing
 * with Pause, Show chat and Stop. The window comes back when the AI needs the user (an
 * approval, a question) and when the run ends.
 *
 * The user stays in charge: moving the mouse while the AI works pauses it (until Continue),
 * Ctrl+Alt+Esc stops it from anywhere, and so does the mouse in the top-left corner.
 *
 * The bar never takes the focus (the AI types into the program below it) and is kept out of
 * screenshots where the OS allows it. While the AI acts, a thin glowing border around the
 * screen (click-through, also kept out of screenshots) says "the AI is driving" at a glance;
 * it goes away when the AI pauses or stops.
 */

const BAR_W = 560;
const BAR_H = 46;
/** Time the minimize animation gets before the AI's next screenshot. */
const HIDE_MS = 450;
/** The cursor this far (screen px) from where the AI left it = the user took the mouse. */
const TAKEOVER_PX = 12;
/** Global shortcut that stops the AI from any program. */
export const STOP_ACCELERATOR = 'Control+Alt+Escape';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function barHtml(labels: ComputerBarLabels): string {
  const esc = (s: string) =>
    s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;font:12px/1.2 "Segoe UI",system-ui,sans-serif;user-select:none}
.bar{box-sizing:border-box;height:100%;display:flex;align-items:center;gap:6px;padding:0 6px 0 12px;
 background:#1d1f24;color:#e8e9ec;border:1px solid #2f6bff;border-radius:10px;-webkit-app-region:drag;
 box-shadow:inset 0 0 0 1px rgba(56,225,255,.22),inset 0 0 14px rgba(47,107,255,.35)}
.paused .bar{border-color:#b98a2c;box-shadow:none}
.logo{position:relative;width:28px;height:28px;flex:none;margin-right:2px}
.logo svg{width:28px;height:28px;display:block}
.dot{position:absolute;right:-1px;bottom:-1px;width:8px;height:8px;border-radius:50%;background:#e5534b;border:2px solid #1d1f24;animation:p 1.4s ease-in-out infinite}
.paused .dot{background:#e0a33a;animation:none}
@keyframes p{50%{opacity:.35}}
.txt{flex:1;min-width:0;display:flex;flex-direction:column}
b{font-weight:700;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:linear-gradient(90deg,#7cecff,#8fb0ff 55%,#c9a8ff);-webkit-background-clip:text;background-clip:text;color:transparent}
.paused b{background:none;color:#f1c46b}
#st{color:#a3a7b0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
button{-webkit-app-region:no-drag;font:inherit;border-radius:6px;padding:5px 10px;cursor:pointer;border:1px solid #474b55;background:transparent;color:#e8e9ec;white-space:nowrap}
button:hover{background:#2b2e35}
.paused #pause{background:#e0a33a;border-color:#e0a33a;color:#1d1f24;font-weight:600}
#stop{background:#c93c37;border-color:#c93c37;color:#fff;font-weight:600}
#stop:hover{background:#b3322d}
</style></head><body><div class="bar">
<span class="logo">${LOGO_SVG}<span class="dot"></span></span>
<div class="txt"><b id="ti">${esc(labels.title)}</b><span id="st">${esc(labels.starting)}</span></div>
<button id="pause" title="${esc(labels.pauseHint)}">${esc(labels.pause)}</button>
<button id="show" title="${esc(labels.showHint)}">${esc(labels.show)}</button>
<button id="stop" title="${esc(labels.stopHint)}">${esc(labels.stop)}</button>
</div><script>
const say=(w)=>{document.title='zx:'+w+':'+Date.now()};
document.getElementById('stop').onclick=()=>say('stop');
document.getElementById('show').onclick=()=>say('show');
document.getElementById('pause').onclick=()=>say(document.body.classList.contains('paused')?'resume':'pause');
window.zxStatus=(t)=>{document.getElementById('st').textContent=t};
window.zxPaused=(on,title,status,btn,hint)=>{document.body.classList.toggle('paused',on);
 document.getElementById('ti').textContent=title;document.getElementById('st').textContent=status;
 const b=document.getElementById('pause');b.textContent=btn;b.title=hint};
</script></body></html>`;
}

export interface ComputerBarLabels {
  title: string;
  starting: string;
  /** "Paso {n}: {what}" */
  step: string;
  stop: string;
  stopHint: string;
  show: string;
  showHint: string;
  pause: string;
  pauseHint: string;
  resume: string;
  resumeHint: string;
  pausedTitle: string;
  /** Paused with the button (or "Ver chat"). */
  pausedByUser: string;
  /** Paused because the user moved the mouse. */
  pausedTakeover: string;
}

export const BAR_LABELS: Record<'es' | 'en', ComputerBarLabels> = {
  es: {
    title: 'Zinarix Studio AI navegando…',
    starting: 'Empezando…',
    step: 'Paso {n}: {what}',
    stop: 'Detener',
    stopHint:
      'Detiene a la IA (también: Ctrl+Alt+Esc o mover el mouse a la esquina de arriba a la izquierda)',
    show: 'Ver chat',
    showHint: 'Pausa a la IA y muestra la ventana de Zinarix',
    pause: 'Pausar',
    pauseHint: 'Pausa a la IA para que uses tu compu (también: mover el mouse)',
    resume: 'Continuar',
    resumeHint: 'La IA sigue desde donde quedó la pantalla',
    pausedTitle: 'Zinarix Studio AI en pausa',
    pausedByUser: 'Pulsa Continuar cuando quieras que siga.',
    pausedTakeover: 'Moviste el mouse. Pulsa Continuar cuando quieras que siga.',
  },
  en: {
    title: 'Zinarix Studio AI navigating…',
    starting: 'Starting…',
    step: 'Step {n}: {what}',
    stop: 'Stop',
    stopHint: 'Stops the AI (or Ctrl+Alt+Esc, or move the mouse to the top-left corner)',
    show: 'Show chat',
    showHint: 'Pauses the AI and shows the Zinarix window',
    pause: 'Pause',
    pauseHint: 'Pauses the AI so you can use your computer (moving the mouse does too)',
    resume: 'Continue',
    resumeHint: 'The AI goes on from what is on screen now',
    pausedTitle: 'Zinarix Studio AI is paused',
    pausedByUser: 'Press Continue when you want it to go on.',
    pausedTakeover: 'You moved the mouse. Press Continue when you want it to go on.',
  },
};

/**
 * The name the bar shows for the AI: the app's own name (its edition), with "AI" when the
 * name does not already say it ("Zinarix Studio" → "Zinarix Studio AI").
 */
export function aiName(productName: string): string {
  const name = productName.trim() || 'Zinarix Studio';
  return /\bAI\b/.test(name) ? name : `${name} AI`;
}

/** The bar's labels with the edition's name: "Zinarix Studio AI navegando…". */
export function barLabelsFor(lang: 'es' | 'en', productName: string): ComputerBarLabels {
  const name = aiName(productName);
  const base = BAR_LABELS[lang];
  return lang === 'en'
    ? { ...base, title: `${name} navigating…`, pausedTitle: `${name} is paused` }
    : { ...base, title: `${name} navegando…`, pausedTitle: `${name} en pausa` };
}

/** Note for the AI after a pause (the action it asked for is not carried out). */
export const PAUSE_NOTE =
  'The user paused you (they used the computer meanwhile) and has now pressed Continue. The screen may have changed, so this action was NOT carried out: take a new screenshot and go on from what you see.';

/** Platform pieces, swappable in tests. */
export interface ComputerModeDeps {
  /** Cursor in screen units; null = unknown (no takeover check). */
  cursor?: () => Promise<{ x: number; y: number } | null>;
  makeBar?: (run: ComputerControlRun) => BarHandle;
  registerStop?: (cb: () => void) => (() => void) | null;
}

/** What the run needs from the floating bar. */
export interface BarHandle {
  status(text: string): void;
  paused(on: boolean, takeover: boolean): void;
  destroy(): void;
}

/** The window the run minimizes (a BrowserWindow in the app). */
export interface RunWindow {
  isDestroyed(): boolean;
  isMinimized(): boolean;
  minimize(): void;
  restore(): void;
  show(): void;
  focus(): void;
}

export class ComputerControlRun implements ComputerRunHooks {
  private bar?: BarHandle;
  /** The Zinarix window is minimized by this run (to bring it back afterwards). */
  private hidden = false;
  private ended = false;
  private steps = 0;
  private lastStatus?: string;
  /** Where the AI left the cursor after its last action (screen units). */
  private lastPos: { x: number; y: number } | null = null;
  private pauseWait?: { promise: Promise<void>; resolve: () => void };
  private unregister?: (() => void) | null;

  constructor(
    private readonly win: RunWindow,
    private readonly stop: () => void,
    private readonly labels: ComputerBarLabels = BAR_LABELS.es,
    private readonly deps: ComputerModeDeps = {},
  ) {}

  get isPaused(): boolean {
    return Boolean(this.pauseWait);
  }

  /** Before every computer_* action: waits out a pause, then the window out of the way. */
  async before(signal?: AbortSignal, looksOnly = false): Promise<string | undefined> {
    if (this.ended) return undefined;
    this.showBar();
    let note: string | undefined;
    // The user took the mouse since the AI's last action: pause until they say so.
    if (!this.pauseWait && this.lastPos && this.deps.cursor) {
      const now = await this.deps.cursor().catch(() => null);
      if (now && Math.hypot(now.x - this.lastPos.x, now.y - this.lastPos.y) > TAKEOVER_PX)
        this.pause(true);
    }
    if (this.pauseWait) {
      await Promise.race([
        this.pauseWait.promise,
        new Promise<void>((r) => {
          if (signal?.aborted) r();
          signal?.addEventListener('abort', () => r(), { once: true });
        }),
      ]);
      if (this.ended || signal?.aborted) return undefined;
      if (!looksOnly) note = PAUSE_NOTE;
    }
    if (!this.hidden && !this.win.isDestroyed() && !this.win.isMinimized()) {
      this.hidden = true;
      this.win.minimize();
      await sleep(HIDE_MS);
    }
    return note;
  }

  /** After an action with the mouse or keyboard: where the AI left the cursor. */
  async after(): Promise<void> {
    if (this.ended || !this.deps.cursor) return;
    this.lastPos = await this.deps.cursor().catch(() => null);
  }

  /** What the AI just did, on the bar. */
  status(text: string): void {
    this.steps++;
    this.lastStatus = this.labels.step.replace('{n}', String(this.steps)).replace('{what}', text);
    if (!this.pauseWait) this.bar?.status(this.lastStatus);
  }

  /** The AI waits for the user (an approval, a question): the window comes back. */
  needUser(): void {
    this.lastPos = null;
    this.reveal();
  }

  pause(takeover = false): void {
    if (this.ended || this.pauseWait) return;
    let resolve!: () => void;
    const promise = new Promise<void>((r) => (resolve = r));
    this.pauseWait = { promise, resolve };
    this.bar?.paused(true, takeover);
  }

  resume(): void {
    const w = this.pauseWait;
    if (!w) return;
    this.pauseWait = undefined;
    // From here the cursor is where the user left it: that is the new reference.
    this.lastPos = null;
    this.bar?.paused(false, false);
    w.resolve();
  }

  /** "Ver chat": the window comes back and the AI waits (it would minimize it again). */
  showChat(): void {
    this.pause(false);
    this.reveal();
  }

  /** Stop from the bar or the shortcut. */
  stopRun(): void {
    this.stop();
    this.end();
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.unregister?.();
    this.unregister = undefined;
    this.bar?.destroy();
    this.bar = undefined;
    this.pauseWait?.resolve();
    this.pauseWait = undefined;
    this.reveal();
  }

  private reveal(): void {
    if (!this.hidden) return;
    this.hidden = false;
    if (this.win.isDestroyed()) return;
    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  private showBar(): void {
    if (this.bar) return;
    this.bar = (this.deps.makeBar ?? electronBar)(this);
    this.unregister = (this.deps.registerStop ?? registerGlobalStop)(() => this.stopRun());
  }

  /** Labels the bar shows for a pause state. */
  pausedTexts(on: boolean, takeover: boolean) {
    const l = this.labels;
    return on
      ? [l.pausedTitle, takeover ? l.pausedTakeover : l.pausedByUser, l.resume, l.resumeHint]
      : [l.title, this.lastStatus ?? l.starting, l.pause, l.pauseHint];
  }

  get barLabels(): ComputerBarLabels {
    return this.labels;
  }
}

/** Ctrl+Alt+Esc stops the AI from any program (null = another run or app has it). */
function registerGlobalStop(cb: () => void): (() => void) | null {
  try {
    if (globalShortcut.isRegistered(STOP_ACCELERATOR)) return null;
    if (!globalShortcut.register(STOP_ACCELERATOR, cb)) return null;
    return () => globalShortcut.unregister(STOP_ACCELERATOR);
  } catch {
    return null;
  }
}

/**
 * The glowing border around the screen while the AI acts: a transparent window over the
 * whole main monitor that lets every click through and never takes the focus. It is kept
 * out of screenshots where the OS allows it (Windows 10 2004+, macOS); elsewhere it is only
 * a thin line, so the AI's view of the screen barely changes.
 */
function glowHtml(thin: boolean): string {
  const glow = thin
    ? ''
    : 'box-shadow:inset 0 0 18px 4px rgba(47,107,255,.55),inset 0 0 42px 6px rgba(139,61,255,.22);';
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
html,body{margin:0;height:100%;background:transparent;overflow:hidden;pointer-events:none}
.edge{position:fixed;inset:0;box-sizing:border-box;border:${thin ? 2 : 3}px solid transparent;
 border-image:linear-gradient(135deg,#38e1ff,#2f6bff 45%,#8b3dff) 1;${glow}
 animation:g 2.4s ease-in-out infinite}
@keyframes g{50%{opacity:.55}}
@media (prefers-reduced-motion:reduce){.edge{animation:none}}
</style></head><body><div class="edge"></div></body></html>`;
}

interface GlowHandle {
  show(): void;
  hide(): void;
  destroy(): void;
}

function electronGlow(): GlowHandle | null {
  try {
    const { bounds } = screen.getPrimaryDisplay();
    const glow = new BrowserWindow({
      ...bounds,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: false,
      show: false,
      hasShadow: false,
      enableLargerThanScreen: true,
      title: 'Zinarix',
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        javascript: false,
        spellcheck: false,
      },
    });
    glow.setAlwaysOnTop(true, 'screen-saver');
    // Clicks, the wheel and the AI's own input go to the programs below.
    glow.setIgnoreMouseEvents(true);
    glow.setContentProtection(true);
    if (process.platform === 'darwin') glow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    glow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    glow.webContents.on('will-navigate', (e) => e.preventDefault());
    let want = true;
    let ready = false;
    glow.once('ready-to-show', () => {
      ready = true;
      if (want && !glow.isDestroyed()) {
        glow.setBounds(bounds);
        glow.showInactive();
      }
    });
    const thin = process.platform !== 'win32' && process.platform !== 'darwin';
    void glow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(glowHtml(thin))}`);
    return {
      show: () => {
        want = true;
        if (ready && !glow.isDestroyed() && !glow.isVisible()) glow.showInactive();
      },
      hide: () => {
        want = false;
        if (!glow.isDestroyed()) glow.hide();
      },
      destroy: () => {
        if (!glow.isDestroyed()) glow.destroy();
      },
    };
  } catch {
    return null; // no border: the bar still says the AI is acting
  }
}

function electronBar(run: ComputerControlRun): BarHandle {
  // The border first, so the bar sits above it.
  const glow = electronGlow();
  const area = screen.getPrimaryDisplay().workArea;
  const w = Math.min(BAR_W, area.width - 20);
  const bar = new BrowserWindow({
    width: w,
    height: BAR_H,
    x: Math.round(area.x + (area.width - w) / 2),
    y: area.y + 10,
    frame: false,
    transparent: true,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    show: false,
    hasShadow: true,
    title: 'Zinarix',
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      javascript: true,
      spellcheck: false,
    },
  });
  bar.setAlwaysOnTop(true, 'screen-saver');
  // Out of the AI's screenshots (Windows 10 2004+ and macOS); elsewhere it shows as a box.
  bar.setContentProtection(true);
  bar.on('closed', () => glow?.destroy());
  bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  bar.webContents.on('will-navigate', (e) => e.preventDefault());
  bar.on('page-title-updated', (e, title) => {
    e.preventDefault();
    const m = /^zx:(stop|show|pause|resume):/.exec(title)?.[1];
    if (m === 'stop') run.stopRun();
    else if (m === 'show') run.showChat();
    else if (m === 'pause') run.pause(false);
    else if (m === 'resume') run.resume();
  });
  bar.once('ready-to-show', () => bar.showInactive());
  void bar.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(barHtml(run.barLabels))}`);
  const js = (code: string) => {
    if (bar.isDestroyed()) return;
    void bar.webContents.executeJavaScript(code).catch(() => undefined);
  };
  return {
    status: (text) => js(`window.zxStatus && window.zxStatus(${JSON.stringify(text)})`),
    paused: (on, takeover) => {
      // The border only while the AI is acting: off during a pause.
      if (on) glow?.hide();
      else glow?.show();
      js(
        `window.zxPaused && window.zxPaused(${JSON.stringify(on)}, ${run
          .pausedTexts(on, takeover)
          .map((s) => JSON.stringify(s))
          .join(', ')})`,
      );
    },
    destroy: () => {
      glow?.destroy();
      if (!bar.isDestroyed()) bar.destroy();
    },
  };
}
