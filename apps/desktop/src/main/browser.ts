import { WebContentsView, session } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';

export interface BrowserState {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface PageElement {
  ref: number;
  tag: string;
  role: string;
  label: string;
  href?: string;
  type?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  text: string;
  elements: PageElement[];
  truncated: boolean;
}

const PARTITION = 'persist:zinarix-browser';
const NAV_TIMEOUT = 25_000;

/**
 * Runs inside the page (isolated world): tags visible interactive elements with
 * data-zx-ref and returns the page text plus a compact element list for the model.
 */
const SNAPSHOT_JS = `(() => {
  const MAX_TEXT = 24000, MAX_EL = 250;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  };
  const label = (el) => (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder ||
    el.title || el.alt || el.name || '').replace(/\\s+/g, ' ').trim().slice(0, 120);
  document.querySelectorAll('[data-zx-ref]').forEach((e) => e.removeAttribute('data-zx-ref'));
  const sel = 'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[contenteditable=true],summary';
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll(sel)) {
    if (out.length >= MAX_EL) break;
    if (!visible(el)) continue;
    const ref = ++n;
    el.setAttribute('data-zx-ref', String(ref));
    out.push({
      ref,
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      label: label(el),
      href: el.tagName === 'A' ? el.href : undefined,
      type: el.type || undefined,
    });
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').trim();
  return { url: location.href, title: document.title, text: text.slice(0, MAX_TEXT), truncated: text.length > MAX_TEXT, elements: out };
})()`;

/** Briefly outlines the element the AI is acting on, so the user can follow along. */
const HIGHLIGHT_JS = (ref: number) => `(() => {
  const el = document.querySelector('[data-zx-ref="${ref}"]');
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });
  const prev = el.style.outline;
  el.style.outline = '3px solid #8b3dff';
  el.style.outlineOffset = '2px';
  setTimeout(() => { el.style.outline = prev; }, 1200);
  const r = el.getBoundingClientRect();
  const sensitive = el.type === 'password' || /cc-|card|cvc|cvv/i.test((el.autocomplete || '') + ' ' + (el.name || '') + ' ' + (el.id || ''));
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), tag: el.tagName.toLowerCase(), sensitive };
})()`;

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (!s) throw new Error('URL vacía');
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(s)
    ? s
    : /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(s) || s.startsWith('localhost')
      ? `https://${s}`
      : `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
  const url = new URL(withScheme);
  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new Error(`Solo se permiten páginas http(s), no ${url.protocol}`);
  return url.toString();
}

/**
 * The embedded browser: a sandboxed WebContentsView in its own session partition (no
 * Node, no preload, no downloads, no device permissions). The renderer reserves the area
 * where it is drawn; the agent drives it through the methods below.
 */
export class BrowserController {
  private view: WebContentsView | null = null;
  private visible = false;

  constructor(
    private readonly win: () => BrowserWindow | undefined,
    private readonly onState: (s: BrowserState) => void,
    private readonly onShow: () => void = () => {},
  ) {}

  /** Asks the UI to show the browser tab (the agent is about to use it). */
  reveal(): void {
    this.onShow();
  }

  private ensure(): WebContentsView {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view;
    const ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    ses.setPermissionCheckHandler(() => false);
    ses.on('will-download', (e) => e.preventDefault());
    const view = new WebContentsView({
      webPreferences: {
        partition: PARTITION,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#ffffff');
    view.setBorderRadius(10);
    const wc = view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      // Popups open in the same view.
      if (/^https?:/i.test(url)) void wc.loadURL(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (e, url) => {
      if (!/^https?:/i.test(url)) e.preventDefault();
    });
    const emit = () => this.onState(this.state());
    for (const ev of [
      'did-start-loading',
      'did-stop-loading',
      'did-navigate',
      'did-navigate-in-page',
      'page-title-updated',
    ] as const) {
      wc.on(ev as 'did-start-loading', emit);
    }
    // A real size even while hidden, so pages lay out and the agent can work in the background.
    view.setBounds({ x: 0, y: 0, width: 1280, height: 800 });
    view.setVisible(false);
    this.win()?.contentView.addChildView(view);
    this.view = view;
    return view;
  }

  state(): BrowserState {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed())
      return { url: '', title: '', loading: false, canGoBack: false, canGoForward: false };
    const url = wc.getURL();
    return {
      url: url === 'about:blank' ? '' : url,
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    };
  }

  /** Called by the renderer with the on-screen area reserved for the page. */
  setBounds(rect: Rectangle | null): void {
    const view = this.ensure();
    this.visible = Boolean(rect && rect.width > 0 && rect.height > 0);
    if (rect && this.visible) view.setBounds(rect);
    view.setVisible(this.visible);
  }

  async navigate(input: string): Promise<BrowserState> {
    const url = normalizeUrl(input);
    const wc = this.ensure().webContents;
    await Promise.race([
      wc.loadURL(url).catch((e: unknown) => {
        // ERR_ABORTED happens on redirects/SPAs; the page usually still loads.
        if (!String(e).includes('ERR_ABORTED')) throw e;
      }),
      new Promise((resolve) => setTimeout(resolve, NAV_TIMEOUT)),
    ]);
    await this.settle();
    return this.state();
  }

  /** Back to the start page (shown by the UI when no page is open). */
  home(): void {
    void this.ensure().webContents.loadURL('about:blank');
  }

  back(): void {
    const wc = this.ensure().webContents;
    if (wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  }

  forward(): void {
    const wc = this.ensure().webContents;
    if (wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  }

  reload(): void {
    this.ensure().webContents.reload();
  }

  private async settle(ms = 600): Promise<void> {
    const wc = this.ensure().webContents;
    const start = Date.now();
    while (wc.isLoading() && Date.now() - start < NAV_TIMEOUT)
      await new Promise((r) => setTimeout(r, 150));
    await new Promise((r) => setTimeout(r, ms));
  }

  async snapshot(): Promise<PageSnapshot> {
    const wc = this.ensure().webContents;
    if (!wc.getURL() || wc.getURL() === 'about:blank')
      throw new Error('No hay ninguna página abierta. Usa browser_open primero.');
    await this.settle(200);
    return (await wc.executeJavaScriptInIsolatedWorld(999, [
      { code: SNAPSHOT_JS },
    ])) as PageSnapshot;
  }

  private async locate(
    ref: number,
  ): Promise<{ x: number; y: number; tag: string; sensitive: boolean }> {
    const wc = this.ensure().webContents;
    const hit = (await wc.executeJavaScriptInIsolatedWorld(999, [{ code: HIGHLIGHT_JS(ref) }])) as {
      x: number;
      y: number;
      tag: string;
      sensitive: boolean;
    } | null;
    if (!hit)
      throw new Error(
        `No existe el elemento [${ref}] en la página actual. Usa browser_read para ver la lista actualizada.`,
      );
    await new Promise((r) => setTimeout(r, 350));
    return hit;
  }

  /** Real mouse click at the element center (works with JS frameworks). */
  async click(ref: number): Promise<BrowserState> {
    const wc = this.ensure().webContents;
    const { x, y } = await this.locate(ref);
    wc.sendInputEvent({ type: 'mouseMove', x, y });
    wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await this.settle(900);
    return this.state();
  }

  /** Focuses a field and types like a user. Password and payment fields are refused. */
  async type(ref: number, text: string, submit: boolean): Promise<BrowserState> {
    const wc = this.ensure().webContents;
    const el = await this.locate(ref);
    if (el.sensitive)
      throw new Error(
        'Por seguridad, la IA no puede escribir en campos de contraseña o de pago. Pídele al usuario que lo haga.',
      );
    wc.sendInputEvent({ type: 'mouseDown', x: el.x, y: el.y, button: 'left', clickCount: 1 });
    wc.sendInputEvent({ type: 'mouseUp', x: el.x, y: el.y, button: 'left', clickCount: 1 });
    await wc.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `(() => { const el = document.querySelector('[data-zx-ref="${ref}"]'); if (el && 'select' in el) { el.focus(); el.select(); } })()`,
      },
    ]);
    await wc.insertText(text);
    if (submit) {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
      wc.sendInputEvent({ type: 'char', keyCode: '\r' });
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
    }
    await this.settle(submit ? 1200 : 300);
    return this.state();
  }

  async scroll(direction: 'up' | 'down'): Promise<void> {
    const wc = this.ensure().webContents;
    await wc.executeJavaScriptInIsolatedWorld(999, [
      {
        code: `window.scrollBy({ top: ${direction === 'down' ? 1 : -1} * window.innerHeight * 0.85, behavior: 'instant' })`,
      },
    ]);
    await new Promise((r) => setTimeout(r, 300));
  }

  isVisible(): boolean {
    return this.visible;
  }

  destroy(): void {
    if (this.view && !this.view.webContents.isDestroyed()) this.view.webContents.close();
    this.view = null;
  }
}
