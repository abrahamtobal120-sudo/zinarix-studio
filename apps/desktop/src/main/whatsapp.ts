import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { WebContentsView, session, shell } from 'electron';
import type { BrowserWindow, Rectangle, Session } from 'electron';
import type { WhatsAppChat, WhatsAppEvent, WhatsAppStatus, WhatsAppWho } from '../shared/api.js';

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

/** Finds a chat of the list by its name ("Ana (Tú)" also matches "Ana"). Page code. */
const FIND_ROW = `
  const norm = (s) => (s || '').replace(/\\s*\\((t[uú]|you)\\)\\s*$/i, '').trim().toLowerCase();
  const findRow = (want) => {
    const w = norm(want);
    if (!w) return null;
    for (const sp of document.querySelectorAll('#pane-side span[title]')) {
      if (norm(sp.getAttribute('title')) !== w) continue;
      return sp.closest('[role="listitem"],[role="row"],[role="gridcell"]') || sp;
    }
    return null;
  };`;

/**
 * Runs in the page (isolated world): whether the account is logged in, how long ago the user
 * touched the page, the rows of the allowed chats in the list, by name (a row's text changes
 * with each new message), the chat open now (id from the messages' data-id, and its name)
 * and its last messages, in order. Emojis are images with their character in "alt": put
 * back as text.
 */
function readJs(titles: string[]): string {
  return `(() => {
  ${FIND_ROW}
  const W = window;
  if (!W.__zx) {
    W.__zx = { last: 0 };
    for (const ev of ['keydown', 'pointerdown', 'wheel'])
      document.addEventListener(ev, (e) => { if (e.isTrusted) W.__zx.last = Date.now(); }, true);
  }
  const idle = W.__zx.last ? Date.now() - W.__zx.last : 1e9;
  const logged = Boolean(document.querySelector('#pane-side'));
  const sigs = {};
  for (const t of ${JSON.stringify(titles)}) {
    const row = findRow(t);
    if (row) sigs[t] = (row.textContent || '').slice(0, 400);
  }
  const main = document.querySelector('#main');
  if (!main) return { logged, idle, sigs, chat: '', title: '', msgs: [] };
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
  const msgs = [];
  for (const el of [...main.querySelectorAll('[data-id]')].slice(-60)) {
    const m = /^(true|false)_([^_]+@[\\w.]+)_([^_]+)/.exec(el.getAttribute('data-id') || '');
    if (!m || seen.has(m[3])) continue;
    seen.add(m[3]);
    chat = m[2];
    const body = el.querySelector('[data-pre-plain-text] span.selectable-text') || el.querySelector('span.selectable-text');
    msgs.push({ id: m[3], mine: m[1] === 'true', text: textOf(body).trim() });
  }
  const title = ((main.querySelector('header span[dir="auto"]') || {}).textContent || '').trim();
  return { logged, idle, sigs, chat, title, msgs };
})()`;
}

/** Clicks the chosen chat in the list; its center, for a real click when that fails. */
function openJs(chosen: string): string {
  return `(() => {
  ${FIND_ROW}
  const row = findRow(${JSON.stringify(chosen)});
  if (!row) return null;
  row.scrollIntoView({ block: 'center' });
  for (const t of ['mousedown', 'mouseup', 'click'])
    row.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window, button: 0 }));
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
})()`;
}

/** Puts the cursor in the search box of the chat list, emptied (clear=true: just empties it). */
const SEARCH_JS = `(() => {
  const el = document.querySelector('#side [contenteditable="true"], #side input[type="text"]');
  if (!el) return false;
  el.focus();
  if (el.select) el.select(); else document.execCommand('selectAll');
  document.execCommand('delete');
  return document.activeElement === el;
})()`;

/** Puts the cursor in the message box of the open chat. */
const FOCUS_JS = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return false;
  el.focus();
  return document.activeElement === el;
})()`;

/**
 * Writes a message in the open chat and sends it from inside the page, so it works with the
 * window hidden or in the background (real key presses only reach a window in front):
 * the text goes in as typing (Shift+Enter between lines) and the send button is pressed.
 * "sent", "stuck" (written but still in the box) or "empty" (could not write).
 */
function sendJs(text: string): string {
  return `(async () => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return 'empty';
  el.focus();
  const key = (shiftKey) =>
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, shiftKey, bubbles: true, cancelable: true });
  ${JSON.stringify(text)}.split('\\n').forEach((line, i) => {
    if (i) {
      const ev = key(true);
      el.dispatchEvent(ev);
      if (!ev.defaultPrevented) document.execCommand('insertLineBreak');
    }
    if (line) document.execCommand('insertText', false, line);
  });
  const left = () => (el.innerText || el.textContent || '').trim();
  if (!left()) return 'empty';
  await new Promise((r) => setTimeout(r, 200));
  const icon = document.querySelector('#main footer [data-icon="send"], #main footer [data-icon*="send"]');
  const btn =
    (icon && icon.closest('button, [role="button"]')) ||
    document.querySelector('#main footer button[aria-label="Enviar"], #main footer button[aria-label="Send"]');
  if (btn) btn.click();
  else el.dispatchEvent(key(false));
  await new Promise((r) => setTimeout(r, 400));
  return left() ? 'stuck' : 'sent';
})()`;
}

/** Empties the message box of the open chat (a message that could not be sent). */
const CLEAR_JS = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  if (!el) return false;
  el.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  return true;
})()`;

/** What is left in the message box of the open chat. */
const readBoxJs = `(() => {
  const el = document.querySelector('#main footer [contenteditable="true"]');
  return el ? (el.innerText || el.textContent || '').trim() : '';
})()`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));


/** "Ana (Tú)": the chat with yourself ("Message yourself"). */
const SELF = /\s*\((t[uú]|you)\)\s*$/i;

interface Saved {
  control?: boolean;
  chats?: WhatsAppChat[];
  /** Before several chats: the one chosen, and whether its other person gave orders too. */
  chat?: { id: string; title: string };
  others?: boolean;
}

interface Read {
  logged: boolean;
  idle: number;
  sigs: Record<string, string>;
  chat: string;
  title: string;
  msgs: { id: string; mine: boolean; text: string }[];
}

export interface WhatsAppDeps {
  /** Folder for the allowed chats and the on/off switch. */
  dir(): string;
  /** An order from an allowed chat; false when nobody is listening (remote off). */
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
 * Optional control: the user allows some chats ("Message yourself", or people they trust).
 * What is written there (by the user, by the other person, or both: chosen per chat) goes to
 * Zinarix like a Telegram message, and the answers are typed back into the same chat.
 * WhatsApp Web shows one chat at a time: a change in an allowed chat's row of the list means
 * a new message, and the page opens that chat by itself (right away when nobody is looking
 * at the tab, after a few idle seconds when the user is using it), and the chat an answer is
 * for when it is ready.
 */
export class WhatsApp {
  private view: WebContentsView | null = null;
  private win: BrowserWindow | null = null;
  private bounds: Rectangle | null = null;
  private visible = false;
  private configured = new WeakSet<Session>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private current: { id: string; title: string } | undefined;
  private logged: boolean | undefined;
  private unread = 0;
  /** Messages already handled ("chat|id"), and the chats read once since the page loaded. */
  private seen = new Set<string>();
  private primed = new Set<string>();
  /** Allowed chats' rows as last seen in the list, and those with something new since. */
  private sigs = new Map<string, string>();
  private wake = new Set<string>();
  private opening = false;
  private lastOpen = 0;
  /** Answers waiting for their chat to be open. */
  private outbox: { chat: string; text: string }[] = [];
  private sending = false;
  /** A message failed to go out: next try not before this time. */
  private retryAt = 0;
  private log: WhatsAppEvent[] = [];
  private stored: Saved | null = null;

  constructor(private deps: WhatsAppDeps) {}

  /** Read on first use (the app's folder is known only once the app is ready). */
  private get saved(): Saved {
    return (this.stored ??= this.load());
  }

  private set saved(v: Saved) {
    this.stored = v;
  }

  private get chats(): WhatsAppChat[] {
    return this.saved.chats ?? [];
  }

  private file(): string {
    return join(this.deps.dir(), 'whatsapp.json');
  }

  private load(): Saved {
    try {
      const s = JSON.parse(readFileSync(this.file(), 'utf8')) as Saved;
      if (s.chat && !s.chats) {
        s.chats = [{ ...s.chat, who: s.others ? 'all' : 'me' }];
      }
      delete s.chat;
      delete s.others;
      return s;
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
      logged: this.logged,
      control: Boolean(this.saved.control),
      chats: this.chats.map((c) => ({
        ...c,
        pending: this.outbox.filter((o) => o.chat === c.id).length,
      })),
      current: this.current,
      linked: this.deps.linked(),
      pending: this.outbox.length,
      unread: this.unread,
      log: [...this.log],
    };
  }

  private changed(): void {
    this.deps.onStatus(this.status());
  }

  private note(dir: WhatsAppEvent['dir'], text: string, chat?: string): void {
    const title = chat ? this.chats.find((c) => c.id === chat)?.title : undefined;
    this.log.push({ at: Date.now(), dir, text: text.slice(0, 300), chat: title });
    if (this.log.length > 40) this.log.splice(0, this.log.length - 40);
    this.changed();
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
    view.setBackgroundColor('#ffffff');
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
    // A reload shows the chat list again: the chats are read afresh.
    wc.on('did-start-navigation', (_e, _url, _inPage, isMain) => {
      if (isMain) {
        this.primed.clear();
        this.sigs.clear();
      }
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
    if (on && !this.chats.length) throw new Error('Agrega primero un chat permitido.');
    this.saved.control = on;
    this.save();
    this.primed.clear();
    if (!on) this.outbox = [];
    this.schedule();
    this.note('info', on ? 'Control encendido' : 'Control apagado');
    return this.status();
  }

  /** The chat open right now is allowed to control Zinarix (and the control turns on). */
  async useCurrent(): Promise<WhatsAppStatus> {
    // Read here (not through read(), which skips while another read runs).
    const now = await this.run<Read>(readJs([]));
    if (now?.chat) this.current = { id: now.chat, title: now.title };
    const cur = now?.chat ? this.current : undefined;
    if (!cur?.id)
      throw new Error('Abre a la izquierda el chat que quieres permitir y escribe algo en él primero.');
    if (!this.chats.some((c) => c.id === cur.id)) {
      // With yourself every message is yours; with someone else, their messages are the orders.
      const who: WhatsAppWho = SELF.test(cur.title) ? 'me' : 'them';
      this.saved.chats = [...this.chats, { id: cur.id, title: cur.title, who }];
    }
    this.saved.control = true;
    this.save();
    // What is in the chat now is old: only later messages are orders.
    for (const m of now!.msgs) this.seen.add(`${cur.id}|${m.id}`);
    this.primed.add(cur.id);
    this.schedule();
    this.note('info', `Chat permitido: "${cur.title || cur.id}"`);
    return this.status();
  }

  /** Whose messages of an allowed chat are orders: the user's, the other person's, or both. */
  setWho(id: string, who: WhatsAppWho): WhatsAppStatus {
    const c = this.chats.find((x) => x.id === id);
    if (c) {
      c.who = who;
      this.save();
    }
    return this.status();
  }

  remove(id: string): WhatsAppStatus {
    this.saved.chats = this.chats.filter((c) => c.id !== id);
    if (!this.saved.chats.length) this.saved.control = false;
    this.save();
    this.outbox = this.outbox.filter((o) => o.chat !== id);
    this.sigs.delete(id);
    this.wake.delete(id);
    this.schedule();
    return this.status();
  }

  /** Writes a test message in an allowed chat (opened when needed). */
  test(id?: string): WhatsAppStatus {
    const c = this.chats.find((x) => x.id === id) ?? this.chats[0];
    if (!c) throw new Error('Agrega primero un chat permitido.');
    this.queue(
      c.id,
      'Conectado. Escríbeme aquí lo que quieras pedirle a la IA, o /ayuda para ver los comandos.',
    );
    return this.status();
  }

  forget(): WhatsAppStatus {
    this.saved = {};
    this.save();
    this.outbox = [];
    this.sigs.clear();
    this.wake.clear();
    this.schedule();
    return this.status();
  }

  /** The control is on and has chats: the page is opened (out of sight) and watched. */
  private schedule(): void {
    const want = Boolean(this.saved.control && this.chats.length);
    if (want && !this.timer) {
      this.timer = setInterval(() => void this.read().catch(() => undefined), POLL_MS);
      if (!this.view) this.ensure();
    } else if (!want && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.changed();
  }

  /** Starts the control at app start when it was left on (the page opens out of sight). */
  resume(): void {
    this.schedule();
  }

  /** Whether the control should run but needs the remote: the renderer starts it. */
  get wantsRemote(): boolean {
    return Boolean(this.saved.control && this.chats.length);
  }

  private run<T>(code: string): Promise<T | null> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return Promise.resolve(null);
    return wc.executeJavaScriptInIsolatedWorld(998, [{ code }]).catch(() => null) as Promise<T | null>;
  }

  /**
   * Opens a chat in the page: clicks it in the chat list, or searches for it by name when it
   * is not on screen. Not more than once every few seconds.
   */
  private async open(chat: WhatsAppChat): Promise<boolean> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed() || !chat.title || this.opening || this.sending) return false;
    if (Date.now() - this.lastOpen < 5000) return false;
    this.opening = true;
    this.lastOpen = Date.now();
    try {
      let at = await this.run<{ x: number; y: number }>(openJs(chat.title));
      let searched = false;
      if (!at) {
        if (!(await this.run<boolean>(SEARCH_JS))) return false;
        searched = true;
        await wc.insertText(chat.title.replace(SELF, ''));
        await sleep(1500);
        at = await this.run<{ x: number; y: number }>(openJs(chat.title));
      }
      let ok = false;
      if (at) {
        await sleep(700);
        let r = await this.run<Read>(readJs([]));
        if (r && r.chat !== chat.id) {
          // The page ignored the synthetic click: a real one where the row is.
          wc.sendInputEvent({ type: 'mouseDown', x: at.x, y: at.y, button: 'left', clickCount: 1 });
          wc.sendInputEvent({ type: 'mouseUp', x: at.x, y: at.y, button: 'left', clickCount: 1 });
          await sleep(700);
          r = await this.run<Read>(readJs([]));
        }
        ok = r?.chat === chat.id;
      }
      if (searched) await this.run<boolean>(SEARCH_JS);
      return ok;
    } finally {
      this.opening = false;
    }
  }

  private reading = false;

  private async read(): Promise<void> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading() || this.reading || this.opening) return;
    this.reading = true;
    try {
      const chats = this.chats;
      const r = await this.run<Read>(readJs(chats.map((c) => c.title)));
      if (!r) return;
      const cur = r.chat ? { id: r.chat, title: r.title } : undefined;
      if (cur?.id !== this.current?.id || cur?.title !== this.current?.title || r.logged !== this.logged) {
        this.current = cur;
        this.logged = r.logged;
        this.changed();
      }
      if (!this.saved.control || !chats.length || !r.logged) return;

      // A changed row in the list: something new in that chat.
      for (const c of chats) {
        const sig = r.sigs[c.title];
        if (!sig) continue;
        const was = this.sigs.get(c.id);
        if (was !== undefined && was !== sig && c.id !== r.chat) this.wake.add(c.id);
        this.sigs.set(c.id, sig);
      }

      const here = chats.find((c) => c.id === r.chat);
      if (here) {
        const woke = this.wake.delete(here.id);
        this.take(here, r.msgs, woke);
        if (this.outbox.some((o) => o.chat === here.id)) {
          void this.flush();
          return;
        }
      }

      // Somewhere else a message or an answer waits: go there. Out of sight right away;
      // while the user uses the tab, only after a few idle seconds.
      const nextId = [...this.wake][0] ?? this.outbox[0]?.chat;
      const next = chats.find((c) => c.id === nextId);
      const free = !this.visible || r.idle > 4000;
      if (next && free) {
        void this.open(next);
        return;
      }
      // Nothing waiting and away from the allowed chats for long: back to the first one, so
      // its messages are read even when its row is not on screen.
      if (!here && !next && (!this.visible || r.idle > 90_000)) void this.open(chats[0]!);
    } finally {
      this.reading = false;
    }
  }

  /**
   * The new messages of an allowed chat open in the page go to Zinarix (woke: the chat was
   * opened because its row changed).
   */
  private take(chat: WhatsAppChat, msgs: Read['msgs'], woke: boolean): void {
    // Only what comes after the last message already handled is new (the page may load
    // older ones when scrolled). The first look at the chat only learns what was there,
    // except the last message when a new one is what brought the page here.
    const key = (id: string) => `${chat.id}|${id}`;
    let last = -1;
    msgs.forEach((m, i) => {
      if (this.seen.has(key(m.id))) last = i;
    });
    if (!this.primed.has(chat.id) || last < 0) {
      for (const m of msgs) this.seen.add(key(m.id));
      this.primed.add(chat.id);
      if (!woke) return;
      const i = msgs.findLastIndex((m) => this.from(chat, m));
      if (i < 0 || i < msgs.length - 3) return;
      last = i - 1;
      this.seen.delete(key(msgs[i]!.id));
    }
    for (const m of msgs.slice(last + 1)) {
      this.seen.add(key(m.id));
      if (!this.from(chat, m)) continue;
      this.note('in', m.text, chat.id);
      if (!this.deps.incoming(chat.id, m.text))
        this.queue(
          chat.id,
          'Zinarix no está conectado en la computadora en este momento. Inténtalo en un rato.',
        );
    }
    if (this.seen.size > 3000) this.seen = new Set([...this.seen].slice(-1000));
  }

  /** Whether a message of an allowed chat is an order (by whom it was written). */
  private from(chat: WhatsAppChat, m: Read['msgs'][number]): boolean {
    if (!m.text || m.text.startsWith(MARK)) return false;
    return chat.who === 'all' || (chat.who === 'me' ? m.mine : !m.mine);
  }

  /** An answer for an allowed chat (written when that chat is open). */
  send(chat: string, text: string): Promise<void> {
    if (this.chats.some((c) => c.id === chat)) this.queue(chat, text);
    return Promise.resolve();
  }

  private queue(chat: string, text: string): void {
    this.outbox.push({ chat, text: `${MARK} ${text}` });
    if (this.outbox.length > 30) this.outbox.splice(0, this.outbox.length - 30);
    this.changed();
    void this.flush();
  }

  private async flush(): Promise<void> {
    const wc = this.view?.webContents;
    const here = this.current?.id;
    if (this.sending || this.opening || !here || !wc || wc.isDestroyed()) return;
    if (Date.now() < this.retryAt || !this.outbox.some((o) => o.chat === here)) return;
    this.sending = true;
    try {
      let item: { chat: string; text: string } | undefined;
      while ((item = this.outbox.find((o) => o.chat === here)) && this.current?.id === here) {
        const text = item.text;
        let how = await this.run<string>(sendJs(text));
        if (how === 'stuck') {
          // Written but the page did not take the button: Enter, as a person would.
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
          wc.sendInputEvent({ type: 'char', keyCode: '\r' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
          await sleep(500);
          how = (await this.run<string>(readBoxJs)) ? 'stuck' : 'sent';
        } else if (how === 'empty') {
          // The page did not take the text from inside: typed in like before (needs the
          // window in front).
          if (!(await this.run<boolean>(FOCUS_JS))) break;
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (i) {
              // Shift+Enter: a new line inside the same message.
              wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return', modifiers: ['shift'] });
              wc.sendInputEvent({ type: 'char', keyCode: '\r', modifiers: ['shift'] });
              wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return', modifiers: ['shift'] });
            }
            if (lines[i]) await wc.insertText(lines[i]!);
          }
          await sleep(150);
          wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
          wc.sendInputEvent({ type: 'char', keyCode: '\r' });
          wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
          await sleep(500);
          how = (await this.run<string>(readBoxJs)) ? 'stuck' : 'sent';
        }
        if (how !== 'sent') {
          // Left in the box would be sent with the next one: emptied, tried again later.
          await this.run<boolean>(CLEAR_JS);
          this.retryAt = Date.now() + 10_000;
          break;
        }
        this.outbox.splice(this.outbox.indexOf(item), 1);
        this.note('out', text.slice(MARK.length + 1), here);
        await sleep(900);
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
