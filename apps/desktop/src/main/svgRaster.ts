import { BrowserWindow, app, session } from 'electron';

/**
 * Fase 3B (plan de funciones): turns an SVG into a PNG / JPEG in the main process, for the
 * design tools of the agent (svg_render shows the model its logo, svg_export writes a file).
 *
 * The picture is drawn as an <img> in a hidden window of its own: an SVG loaded as an image
 * never runs scripts nor loads anything, and that window's session refuses every request
 * that is not a data: URL. The window closes itself after a short idle time.
 */

export interface RasterOpts {
  width: number;
  height: number;
  mime: 'image/png' | 'image/jpeg';
  /** Fill behind the picture (JPEG has no transparency: white by default). */
  background?: string | null;
  /** 0…1, JPEG only. */
  quality?: number;
}

export type Raster = (svg: string, o: RasterOpts) => Promise<Buffer>;

const PARTITION = 'zs-svg-raster';
const IDLE_MS = 20_000;
const MAX_PIXELS = 8192 * 8192;

let win: BrowserWindow | null = null;
let ready: Promise<BrowserWindow> | null = null;
let idle: ReturnType<typeof setTimeout> | undefined;
let chain: Promise<unknown> = Promise.resolve();

function close(): void {
  clearTimeout(idle);
  const w = win;
  win = null;
  ready = null;
  if (w && !w.isDestroyed()) w.destroy();
}

function windowFor(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed() && ready) return ready;
  const ses = session.fromPartition(PARTITION, { cache: false });
  ses.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(data|about|blob):/i.test(d.url) }));
  ses.setPermissionRequestHandler((_w, _p, cb) => cb(false));
  const w = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    skipTaskbar: true,
    webPreferences: {
      partition: PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  w.on('closed', () => {
    if (win === w) {
      win = null;
      ready = null;
    }
  });
  win = w;
  ready = w.loadURL('about:blank').then(() => w);
  return ready;
}

app.on('before-quit', close);

/** Draws the SVG at width × height. Throws with the XML error when the file is broken. */
export const rasterSvg: Raster = (svg, o) => {
  const run = async (): Promise<Buffer> => {
    const w = Math.max(1, Math.round(o.width));
    const h = Math.max(1, Math.round(o.height));
    if (w * h > MAX_PIXELS) throw new Error('The picture would be too large (max 8192 × 8192 px).');
    clearTimeout(idle);
    const page = await windowFor();
    const script = `(async () => {
      const text = ${JSON.stringify(svg)};
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const err = doc.querySelector('parsererror');
      if (err) return { error: 'XML error: ' + (err.textContent || '').replace(/\\s+/g, ' ').slice(0, 400) };
      if (!doc.documentElement || doc.documentElement.localName !== 'svg') return { error: 'The root element is not <svg>.' };
      const blob = new Blob([text], { type: 'image/svg+xml' });
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        try { await img.decode(); } catch { return { error: 'The SVG could not be drawn.' }; }
        const c = document.createElement('canvas');
        c.width = ${w}; c.height = ${h};
        const g = c.getContext('2d');
        const bg = ${JSON.stringify(o.background ?? (o.mime === 'image/jpeg' ? '#ffffff' : null))};
        if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(img, 0, 0, c.width, c.height);
        return { data: c.toDataURL(${JSON.stringify(o.mime)}, ${o.quality ?? 0.92}) };
      } finally { URL.revokeObjectURL(url); }
    })()`;
    try {
      const r = (await page.webContents.executeJavaScript(script, true)) as { error?: string; data?: string };
      if (r.error || !r.data) throw new Error(r.error ?? 'The SVG could not be drawn.');
      return Buffer.from(r.data.slice(r.data.indexOf(',') + 1), 'base64');
    } finally {
      idle = setTimeout(close, IDLE_MS);
    }
  };
  const next = chain.then(run, run);
  chain = next.catch(() => undefined);
  return next;
};
