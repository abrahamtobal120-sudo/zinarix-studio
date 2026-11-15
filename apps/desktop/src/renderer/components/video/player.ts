/**
 * Real-time preview: a master clock drives one media element per clip near the playhead
 * (seeked and played in sync), and every frame the visible video tracks are composited on a
 * canvas, bottom track first. Elements live off-DOM and are recycled when far from the playhead.
 */
import type { Clip, VideoProject } from '../../../shared/video';
import { clipEnd, compositeOrder, mediaOf, projectDuration, trackOf } from '../../../shared/video';
import { getV, setV } from './videoStore';

type El = HTMLVideoElement | HTMLAudioElement;

/** Seconds of drift tolerated while playing before re-seeking an element. */
const DRIFT = 0.2;
/** Clips this close ahead get their element ready (seeked) before the playhead reaches them. */
const PRELOAD = 2;
const MAX_ELEMENTS = 24;

export class Player {
  private els = new Map<string, { el: El; mediaId: string; used: number }>();
  private images = new Map<string, HTMLImageElement>();
  private raf = 0;
  private clockStart = 0;
  private clockFrom = 0;
  private canvas: HTMLCanvasElement | null = null;
  private lastDrawKey = '';
  private stopped = false;

  attach(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.lastDrawKey = '';
  }

  start(): void {
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    for (const { el } of this.els.values()) {
      el.pause();
      el.removeAttribute('src');
      el.load();
    }
    this.els.clear();
  }

  /** Restarts the clock from the current playhead (after play, seek or a rate change). */
  resync(): void {
    this.clockStart = performance.now();
    this.clockFrom = getV().playhead;
  }

  private element(c: Clip, url: string, kind: 'video' | 'audio'): El {
    let e = this.els.get(c.id);
    if (e && e.mediaId !== c.mediaId) {
      e.el.pause();
      this.els.delete(c.id);
      e = undefined;
    }
    if (!e) {
      const el = document.createElement(kind);
      el.crossOrigin = 'anonymous';
      el.preload = 'auto';
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.src = url;
      e = { el, mediaId: c.mediaId, used: performance.now() };
      this.els.set(c.id, e);
    }
    e.used = performance.now();
    return e.el;
  }

  private image(mediaId: string, url: string): HTMLImageElement {
    let img = this.images.get(mediaId);
    if (!img) {
      img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      img.onload = () => (this.lastDrawKey = '');
      this.images.set(mediaId, img);
    }
    return img;
  }

  private tick(): void {
    const s = getV();
    const p = s.project;
    let t = s.playhead;
    const end = projectDuration(p);
    if (s.playing) {
      t = this.clockFrom + ((performance.now() - this.clockStart) / 1000) * s.rate;
      if (t >= end || t <= 0) {
        t = Math.min(Math.max(0, t), end);
        setV({ playing: false, playhead: t, rate: 1 });
      } else setV({ playhead: t });
    }
    this.syncElements(p, t, s.playing && s.rate > 0 ? s.rate : 0);
    this.draw(p, t);
  }

  private syncElements(p: VideoProject, t: number, rate: number): void {
    const s = getV();
    const live = new Set<string>();
    for (const c of p.clips) {
      const m = mediaOf(p, c.mediaId);
      const url = s.urls[c.mediaId];
      if (!m || !url || m.missing || m.kind === 'image') continue;
      const ahead = c.start - t;
      const active = t >= c.start && t < clipEnd(c);
      if (!active && !(ahead > 0 && ahead < PRELOAD)) continue;
      const track = trackOf(p, c.trackId);
      const el = this.element(c, url, m.kind === 'audio' ? 'audio' : 'video');
      live.add(c.id);
      const target = active ? c.in + (t - c.start) : c.in;
      el.muted = !track || track.muted || !m.hasAudio || c.volume <= 0;
      el.volume = Math.min(1, Math.max(0, c.volume));
      if (active && rate > 0) {
        // HTML media plays forward only, up to 16×.
        const r = Math.min(16, rate);
        if (el.playbackRate !== r) el.playbackRate = r;
        if (Math.abs(el.currentTime - target) > DRIFT * Math.max(1, r)) el.currentTime = target;
        if (el.paused) void el.play().catch(() => undefined);
      } else {
        if (!el.paused) el.pause();
        if (Math.abs(el.currentTime - target) > 0.5 / p.fps) el.currentTime = target;
      }
    }
    for (const [id, e] of this.els) {
      if (live.has(id)) continue;
      if (!e.el.paused) e.el.pause();
    }
    // Recycle the oldest idle elements.
    if (this.els.size > MAX_ELEMENTS) {
      const idle = [...this.els.entries()].filter(([id]) => !live.has(id)).sort((a, b) => a[1].used - b[1].used);
      for (const [id, e] of idle.slice(0, this.els.size - MAX_ELEMENTS)) {
        e.el.removeAttribute('src');
        e.el.load();
        this.els.delete(id);
      }
    }
  }

  private draw(p: VideoProject, t: number): void {
    const cv = this.canvas;
    if (!cv) return;
    const s = getV();
    const W = Math.max(2, Math.round(p.width * s.quality));
    const H = Math.max(2, Math.round(p.height * s.quality));
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
      this.lastDrawKey = '';
    }
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    // Paused on the same frame with every layer ready: nothing to repaint.
    const layers: { c: Clip; src: CanvasImageSource; w: number; h: number; ready: boolean }[] = [];
    for (const track of compositeOrder(p)) {
      if (track.hidden) continue;
      const c = p.clips.find((x) => x.trackId === track.id && t >= x.start && t < clipEnd(x));
      if (!c) continue;
      const m = mediaOf(p, c.mediaId);
      const url = s.urls[c.mediaId];
      if (!m || !url || !m.hasVideo && m.kind !== 'image') continue;
      if (m.kind === 'image') {
        const img = this.image(m.id, url);
        layers.push({ c, src: img, w: img.naturalWidth, h: img.naturalHeight, ready: img.complete && img.naturalWidth > 0 });
      } else {
        const e = this.els.get(c.id);
        if (!e || !(e.el instanceof HTMLVideoElement)) continue;
        const v = e.el;
        layers.push({ c, src: v, w: v.videoWidth, h: v.videoHeight, ready: v.readyState >= 2 && !v.seeking });
      }
    }
    const key = `${t.toFixed(4)}|${W}x${H}|${layers.map((l) => `${l.c.id}:${l.ready}`).join(',')}`;
    if (!s.playing && key === this.lastDrawKey) return;
    this.lastDrawKey = layers.every((l) => l.ready) ? key : '';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const l of layers) {
      if (!l.ready || !l.w || !l.h) continue;
      // Fit inside the frame, centred (same as the export's scale + overlay).
      const k = Math.min(W / l.w, H / l.h);
      const dw = l.w * k;
      const dh = l.h * k;
      ctx.drawImage(l.src, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }
  }
}
