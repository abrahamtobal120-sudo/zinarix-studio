import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebContentsView, session, shell } from 'electron';
import type { BrowserWindow, Rectangle, Session } from 'electron';
import type { WhatsAppStatus } from '../shared/api.js';

const URL_HOME = 'https://web.whatsapp.com/';
const PARTITION = 'persist:zinarix-whatsapp';
const POLL_MS = 1500;
/** Marks the messages Zinarix writes, so they are never read back as orders. */
const MARK = '[Zinarix]';
/** Longest message WhatsApp Web takes comfortably in one go. */
export const WHATSAPP_LIMIT = 3000;

/**
 * WhatsApp Web refuses browsers it does not know: the view presents itself as the Chrome
 * Electron is built on, for the system it runs on.
 */
function chromeAgent(): string {
  const os =
    process.platform === 'darwin'
      ? 'Macintosh; Intel Mac OS X 10_15_7'
      : process.platform === 'win32'
        ? 'Windows NT 10.0; Win64; x64'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
}

/**
 * Runs in the page (isolated world): the chat open now (its id, read from the messages'
 * data-id, and its name) and the last messages the user sent in it. Emojis are images with
 * their character in "alt": they are put back as text.
 */
const READ_JS = `(() => {
  const main = document.querySelector('#main');
  if (!main) return { chat: '', title: '', mine: [] };
  const textOf = (node) => {
    if (!node) return '';
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) s += n.nodeValue;
      else if (n.nodeName === 'IMG') s += n.getAttribute('alt') || '';
      else if (n.nodeName === 'BR') s += '\\n';
      else s += textOf(n);
    }
    return s;
  };
  let chat = '';
  const seen = new Set();
  const mine = [];
  for (const el of [...main.querySelectorAll('[data-id]')].slice(-60)) {
    const m = /^(true|false)_([^_]+@[\\w.]+)_([^_]+)/.exec(el.getAttribute('data-id') || '');
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    chat = m[2];
    if (m[1] !== 'true') continue;
    const body = el.querySelector('[data-pre-plain-text] span.selectable-text') || el.querySelector('span.selectable-text');
    const text = textOf(body).trim();
    if (text) mine.push({ id: m[3], text });
  }
  const title = ((main.querySelector('header span[dir="auto"]') || {}).textContent || '').trim();
  return { chat, title, mine };
})()`;

/** Puts the cursor in the message box of the open chat. */
const FOCUS_JS = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
})()`;

interface Saved {
  control?: boolean;
  chat?: { id: string; title: string };
}

export interface WhatsAppDeps {
  /** Folder for the chosen chat and the on/off switch. */
  dir(): string;
  /** A message the user wrote in the chosen chat; false when nobody is listening (remote off). */
  incoming(chat: string, text: string): boolean;
  /** Whether the remote (and the bots riding on it) is running. */
  linked(): boolean;
  onStatus(s: WhatsAppStatus): void;
}

/**
 * WhatsApp Web inside Zinarix: the official web client in its own sandboxed view and session
 * (the login is kept, nothing else of the app reaches it). Used by hand like on the browser,
 * so the account runs no more risk than WhatsApp Web in Chrome.
 *
 * Optional control: in one chat the user picks (meant to be "Message yourself"), what the
 * user writes, from the phone or here, goes to Zinarix like a Telegram message, and the
 * answers are typed back into that chat. It only reads the user's own messages there, and
 * only while that chat is the one open in this view (WhatsApp Web shows one chat at a time).
 */
export class WhatsApp {
  private view: WebContentsView | null = null;
  private win: BrowserWindow | null = null;
  private bounds: Rectangle | null = null;
  private visible = false;
  private configured = new WeakSet<Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: { id: string; title: string } | undefined;
  private unread = 0;
  /** Messages of the chosen chat already handled (ids), and whether the first read was done. */
  private seen = new Set<string>();
  private primed = false;
  /** Answers waiting for the chosen chat to be open. */
  private outbox: string[] = [];
  private sending = false;
  private stored: Saved | null = null;

  constructor(private deps: WhatsAppDeps) {}

  /** Read on first use (the app's folder is known only once the app is ready). */
  private get saved(): Saved {
    return (this.stored ??= this.load());
  }

  private set saved(v: Saved) {
    this.stored = v;
  }

  private file(): string {
    return join(this.deps.dir(), 'whatsapp.json');
  }

  private load(): Saved {
    try {
      return JSON.parse(readFileSync(this.file(), 'utf8')) as Saved;
    } catch {
      return {};
    }
  }

  private save(): void {
    writeFileSync(this.file(), JSON.stringify(this.saved), { mode: 0o600 });
  }

  status(): WhatsAppStatus {
    return {
      open: Boolean(this.view && !this.view.webContents.isDestroyed()),
      control: Boolean(this.saved.control),
      chat: this.saved.chat,
      current: this.current,
      linked: this.deps.linked(),
      pending: this.outbox.length,
      unread: this.unread,
    };
  }

  private changed(): void {
    this.deps.onStatus(this.status());
  }

  private ensure(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const ses = session.fromPartition(PARTITION);
    if (!this.configured.has(ses)) {
      this.configured.add(ses);
      ses.setUserAgent(chromeAgent());
      // Notifications, voice notes, calls' camera and copy/paste, for WhatsApp only.
      const ok = new Set(['notifications', 'media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);
      const fromWa = (url: string) => url.startsWith(URL_HOME);
      ses.setPermissionRequestHandler((wc, perm, cb) => cb(ok.has(perm) && fromWa(wc.getURL())));
      ses.setPermissionCheckHandler((_wc, perm, origin) => ok.has(perm) && fromWa(`${origin}/`));
    }
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#111b21');
    view.setBorderRadius(10);
    const wc = view.webContents;
    wc.setUserAgent(chromeAgent());
    // Links people send open in the real browser; the view never leaves WhatsApp.
    wc.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (url.startsWith(URL_HOME)) return;
      e.preventDefault();
      if (/^https:\/\//i.test(url)) void shell.openExternal(url);
    });
    wc.on('page-title-updated', (_e, title) => {
      const n = Number(/^\((\d+)\)/.exec(title)?.[1] ?? 0);
      if (n !== this.unread) {
        this.unread = n;
        this.changed();
      }
    });
    // A reload shows the chat list again: the chosen chat is read afresh.
    wc.on('did-start-navigation', (_e, _url, _inPage, isMain) => {
      if (isMain) this.primed = false;
    });
    view.setBounds({ x: 0, y: 0, width: 1100, height: 760 });
    view.setVisible(false);
    if (this.win && !this.win.isDestroyed()) this.win.contentView.addChildView(view);
    void wc.loadURL(URL_HOME).catch(() => undefined);
    this.view = view;
    this.schedule();
    return view;
  }

  /** The window that shows the WhatsApp tab: the view moves there (one login, one page). */
  private adopt(win: BrowserWindow): void {
    if (this.win === win) return;
    const view = this.view;
    if (view && this.win && !this.win.isDestroyed()) {
      try {
        this.win.contentView.removeChildView(view);
      } catch {
        // window going away
      }
    }
    this.win = win;
    if (view && !view.webContents.isDestroyed()) win.contentView.addChildView(view);
  }

  /** A window closed: the page keeps running out of sight (control goes on). */
  release(win: BrowserWindow): void {
    if (this.win !== win) return;
    this.win = null;
    this.visible = false;
  }

  /** Called by the renderer with the area reserved for the page; null hides it. */
  setBounds(win: BrowserWindow, rect: Rectangle | null): void {
    this.visible = Boolean(rect && rect.width > 0 && rect.height > 0);
    if (this.visible) {
      this.adopt(win);
      this.bounds = rect;
      this.ensure();
    } else if (this.win !== win) return;
    const view = this.view;
    if (!view || view.webContents.isDestroyed()) return;
    if (this.visible && this.bounds) view.setBounds(this.bounds);
    view.setVisible(this.visible);
    if (this.visible) this.changed();
  }

  reload(): void {
    this.ensure().webContents.reload();
  }

  setControl(on: boolean): WhatsAppStatus {
    this.saved.control = on;
    this.save();
    this.primed = false;
    if (!on) this.outbox = [];
    this.schedule();
    return this.status();
  }

  /** The chat open right now becomes the one Zinarix listens to. */
  async useCurrent(): Promise<WhatsAppStatus> {
    await this.read();
    if (!this.current?.id)
      throw new Error(
        'Abre el chat que quieres usar (de preferencia "Mensaje para ti") y escribe algo en él primero.',
      );
    this.saved.chat = { ...this.current };
    this.saved.control = true;
    this.save();
    this.primed = false;
    this.schedule();
    await this.read();
    return this.status();
  }

  forget(): WhatsAppStatus {
    this.saved = {};
    this.save();
    this.outbox = [];
    this.schedule();
    return this.status();
  }

  /** The control is on and has a chat: the page is opened (out of sight) and watched. */
  private schedule(): void {
    const want = Boolean(this.saved.control && this.saved.chat);
    if (want && !this.timer) {
      this.timer = setInterval(() => void this.read().catch(() => undefined), POLL_MS);
      if (!this.view) this.ensure();
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Starts the control at app start when it was left on (the page opens out of sight). */
  resume(): void {
    this.schedule();
  }

  private reading = false;

  private async read(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading() || this.reading) return;
    this.reading = true;
    try {
      const r = (await wc.executeJavaScriptInIsolatedWorld(998, [{ code: READ_JS }])) as {
        chat: string;
        title: string;
        mine: { id: string; text: string }[];
      } | null;
      if (!r) return;
      const cur = r.chat ? { id: r.chat, title: r.title } : undefined;
      if (cur?.id !== this.current?.id || cur?.title !== this.current?.title) {
        this.current = cur;
        this.changed();
      }
      const chosen = this.saved.chat;
      if (!this.saved.control || !chosen || r.chat !== chosen.id) return;
      // The first look at the chat only learns what was already there.
      if (!this.primed) {
        for (const m of r.mine) this.seen.add(m.id);
        this.primed = true;
      } else {
        for (const m of r.mine) {
          if (this.seen.has(m.id)) continue;
          this.seen.add(m.id);
          if (m.text.startsWith(MARK)) continue;
          if (!this.deps.incoming(chosen.id, m.text))
            this.queue(
              'El control remoto está apagado. Enciéndelo en Zinarix: Configuración → Celular.',
            );
        }
        if (this.seen.size > 2000) this.seen = new Set([...this.seen].slice(-500));
      }
      void this.flush();
    } finally {
      this.reading = false;
    }
  }

  /** An answer for the chosen chat (written when that chat is open). */
  send(chat: string, text: string): Promise<void> {
    if (chat === this.saved.chat?.id) this.queue(text);
    return Promise.resolve();
  }

  private queue(text: string): void {
    this.outbox.push(`${MARK} ${text}`);
    if (this.outbox.length > 20) this.outbox.splice(0, this.outbox.length - 20);
    this.changed();
    void this.flush();
  }

  private async flush(): Promise<void> {
    const wc = this.view?.webContents;
    if (this.sending || !this.outbox.length || !wc || wc.isDestroyed()) return;
    if (!this.saved.chat || this.current?.id !== this.saved.chat.id) return;
    this.sending = true;
    try {
      while (this.outbox.length && this.current?.id === this.saved.chat?.id) {
        if (!(await wc.executeJavaScriptInIsolatedWorld(998, [{ code: FOCUS_JS }]))) break;
        const lines = this.outbox[0]!.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (i) {
            // Shift+Enter: a new line inside the same message.
            wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] });
            wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] });
          }
          if (lines[i]) await wc.insertText(lines[i]!);
        }
        await new Promise((r) => setTimeout(r, 150));
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
        wc.sendInputEvent({ type: 'char', keyCode: '\r' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
        this.outbox.shift();
        this.changed();
        await new Promise((r) => setTimeout(r, 900));
      }
    } finally {
      this.sending = false;
    }
  }

  destroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }
}
