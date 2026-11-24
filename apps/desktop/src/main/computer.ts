import { homedir } from 'node:os';
import { desktopCapturer, screen, shell } from 'electron';
import {
  MAX_SHOT_SIDE,
  shotSize,
  toImage,
  toScreen,
  type ComputerService,
  type ComputerShot,
  type KeyCombo,
  type MouseButton,
  type OpenTarget,
  type WindowInfo,
} from './computerTools.js';
import { platformDriver, type Driver } from './computerDrivers.js';

/**
 * Computer use service: screenshots of the main monitor with Electron, and the real mouse
 * and keyboard through the platform driver (computerDrivers.ts). Maps the model's
 * screenshot coordinates to screen pixels.
 */

interface Dims {
  width: number;
  height: number;
}

/** Size of the main monitor in the units the platform's input API uses. */
function screenDims(): Dims {
  const d = screen.getPrimaryDisplay();
  // macOS CoreGraphics works in points; Windows (DPI-aware helper) and X11 in pixels.
  const k = process.platform === 'darwin' ? 1 : d.scaleFactor;
  return { width: Math.round(d.size.width * k), height: Math.round(d.size.height * k) };
}

// ---------- Service ----------

export class Computer implements ComputerService {
  private readonly driver: Driver & { dispose?: () => void } = platformDriver();
  /** Image size of the last screenshot (what the model's coordinates refer to). */
  private image?: Dims;

  unavailable() {
    return this.driver.unavailable();
  }

  private imageDims(): Dims {
    return this.image ?? shotSize(screenDims().width, screenDims().height);
  }

  private at(x: number, y: number) {
    return toScreen(x, y, this.imageDims(), screenDims());
  }

  async screenshot(): Promise<ComputerShot> {
    const d = screen.getPrimaryDisplay();
    const px = {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
    };
    const want = shotSize(px.width, px.height);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: want });
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty())
      throw new Error(
        process.platform === 'darwin'
          ? 'Could not capture the screen. Ask the user to allow Zinarix Studio in System Settings → Privacy & Security → Screen Recording.'
          : 'Could not capture the screen.',
      );
    let img = src.thumbnail;
    const size = img.getSize();
    if (size.width > want.width || size.height > want.height) img = img.resize(want);
    const final = img.getSize();
    this.image = { width: final.width, height: final.height };
    return {
      mediaType: 'image/jpeg',
      data: img.toJPEG(72).toString('base64'),
      width: final.width,
      height: final.height,
    };
  }

  async cursor() {
    const p = await this.driver.pos();
    return toImage(p.x, p.y, this.imageDims(), screenDims());
  }
  async move(x: number, y: number) {
    const p = this.at(x, y);
    await this.driver.move(p.x, p.y);
  }
  async click(x: number, y: number, button: MouseButton, count: number) {
    const p = this.at(x, y);
    await this.driver.click(p.x, p.y, button, count);
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    const a = this.at(x1, y1);
    const b = this.at(x2, y2);
    await this.driver.drag(a.x, a.y, b.x, b.y);
  }
  async scroll(x: number, y: number, dx: number, dy: number) {
    const p = this.at(x, y);
    await this.driver.scroll(p.x, p.y, dx, dy);
  }
  type(text: string) {
    return this.driver.type(text);
  }
  keys(combo: KeyCombo) {
    return this.driver.keys(combo);
  }

  /** Starts the mouse / keyboard helper ahead of time (on Windows it compiles a small
   * helper, a second or two), so the AI's first click does not wait for it. */
  warm(): void {
    void this.driver.pos().catch(() => undefined);
  }

  /** The cursor in screen units (the "Controlar la compu" bar notices the user moving it). */
  async rawCursor() {
    return this.driver.pos();
  }

  async zoom(x: number, y: number, width: number, height: number): Promise<ComputerShot> {
    const d = screen.getPrimaryDisplay();
    const px = {
      width: Math.round(d.size.width * d.scaleFactor),
      height: Math.round(d.size.height * d.scaleFactor),
    };
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: px });
    const src = sources.find((s) => s.display_id === String(d.id)) ?? sources[0];
    if (!src || src.thumbnail.isEmpty()) throw new Error('Could not capture the screen.');
    const full = src.thumbnail;
    const fs = full.getSize();
    const img = this.imageDims();
    const a = toScreen(x, y, img, fs);
    const b = toScreen(x + width, y + height, img, fs);
    const rect = {
      x: Math.min(a.x, fs.width - 1),
      y: Math.min(a.y, fs.height - 1),
      width: Math.max(1, Math.min(b.x, fs.width) - Math.min(a.x, fs.width - 1)),
      height: Math.max(1, Math.min(b.y, fs.height) - Math.min(a.y, fs.height - 1)),
    };
    let crop = full.crop(rect);
    // Native pixels, enlarged up to 2× for tiny regions, never over the screenshot limit.
    const k = Math.min(2, MAX_SHOT_SIDE / Math.max(rect.width, rect.height));
    if (k !== 1)
      crop = crop.resize({
        width: Math.max(1, Math.round(rect.width * k)),
        height: Math.max(1, Math.round(rect.height * k)),
        quality: 'best',
      });
    const z = crop.getSize();
    return {
      mediaType: 'image/png',
      data: crop.toPNG().toString('base64'),
      width: z.width,
      height: z.height,
    };
  }

  async open(target: OpenTarget) {
    if (target.kind === 'url') await shell.openExternal(target.url);
    else if (target.kind === 'file') {
      const p = target.path.replace(/^~(?=[\\/])/, homedir());
      const err = await shell.openPath(p);
      if (err) throw new Error(err);
    } else await this.driver.openApp(target.name);
  }

  async windows(): Promise<WindowInfo[]> {
    // Zinarix's own windows (the chat, the bar) are not the AI's to switch to.
    const list = await this.driver.windows();
    return list
      .filter((w) => w.pid !== process.pid)
      .map(({ id, app, title }) => ({ id, app, title }));
  }

  focus(id: string) {
    return this.driver.focus(id);
  }

  dispose() {
    this.driver.dispose?.();
  }
}
