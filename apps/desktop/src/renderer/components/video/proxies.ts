/**
 * Fase 4C: proxies in Video Studio. The main process makes light 540p copies with FFmpeg; here
 * we keep their URLs per media id (VState.proxies) and the progress of the ones being made. The
 * player plays playUrl() (the proxy when there is one and they are on); the export never sees
 * them, it reads the media paths of the project.
 */
import type { MediaItem } from '../../../shared/video';
import { api, toast } from '../../store';
import { t4 } from './fase4Strings';
import { getV, setV } from './videoStore';

export const PROXY_HEIGHT = 540;
/** Short side above this gets a proxy automatically (1080p and below play fine). */
const AUTO_MIN = 1081;

export const needsProxy = (m: MediaItem) =>
  m.kind === 'video' && m.hasVideo && !m.missing && Math.min(m.width, m.height) > PROXY_HEIGHT;

/** Worth one on import: bigger than 1080p on its short side. */
export const heavy = (m: MediaItem) => needsProxy(m) && Math.min(m.width, m.height) >= AUTO_MIN;

let wired = false;
function wire(): void {
  if (wired) return;
  wired = true;
  api().on((ev) => {
    if (ev.type !== 'video:proxy') return;
    const ids = getV()
      .project.media.filter((m) => m.path === ev.path)
      .map((m) => m.id);
    if (!ids.length) return;
    setV((s) => {
      const proxyProg = { ...s.proxyProg };
      for (const id of ids) proxyProg[id] = ev.progress;
      return { proxyProg };
    });
  });
}

/** The proxies that already exist for the project's videos (on open). */
export async function findProxies(): Promise<void> {
  const media = getV().project.media.filter(needsProxy);
  const found: Record<string, string> = {};
  for (const m of media) {
    const url = await api()
      .video.proxyUrl(m.path, PROXY_HEIGHT)
      .catch(() => null);
    if (url) found[m.id] = url;
  }
  if (Object.keys(found).length) setV((s) => ({ proxies: { ...s.proxies, ...found } }));
  if (getV().autoProxy)
    for (const m of media) if (!found[m.id] && heavy(m)) void makeProxy(m, true);
}

/** On import: heavy videos get a proxy in the background when that option is on. */
export async function autoProxy(m: MediaItem): Promise<void> {
  if (!needsProxy(m)) return;
  const url = await api()
    .video.proxyUrl(m.path, PROXY_HEIGHT)
    .catch(() => null);
  if (url) {
    setV((s) => ({ proxies: { ...s.proxies, [m.id]: url } }));
    return;
  }
  if (getV().autoProxy && heavy(m)) await makeProxy(m, true);
}

/** Makes the proxy of one video (quiet: no toast when it is done, only on errors). */
export async function makeProxy(m: MediaItem, quiet = false): Promise<boolean> {
  if (!needsProxy(m)) return false;
  const s = getV();
  if (s.proxies[m.id]) return true;
  if (s.proxyProg[m.id] !== undefined) return false;
  wire();
  setV((st) => ({ proxyProg: { ...st.proxyProg, [m.id]: 0 } }));
  try {
    const url = await api().video.proxy(m.path, {
      duration: m.duration,
      width: m.width,
      height: m.height,
      hasAudio: m.hasAudio,
      target: PROXY_HEIGHT,
    });
    // Every media item of the same file shares it.
    setV((st) => {
      const proxies = { ...st.proxies };
      for (const x of st.project.media) if (x.path === m.path) proxies[x.id] = url;
      return { proxies };
    });
    if (!quiet) toast(`${t4('proxyReady')}: ${m.name}`);
    return true;
  } catch (e) {
    const err = (e as Error).message.replace(
      /^Error invoking remote method '[^']+': (Error: )?/,
      '',
    );
    if (!/cancel/i.test(err)) toast(t4('proxyFailed', { name: m.name, err }));
    return false;
  } finally {
    setV((st) => {
      const proxyProg = { ...st.proxyProg };
      for (const x of st.project.media) if (x.path === m.path) delete proxyProg[x.id];
      return { proxyProg };
    });
  }
}

/** Proxies for the given media (default: every video that is bigger than the proxy). */
export async function makeProxies(ids?: string[]): Promise<{ made: number; failed: number }> {
  const media = getV().project.media.filter((m) => needsProxy(m) && (!ids || ids.includes(m.id)));
  const results = await Promise.all(media.map((m) => makeProxy(m, true)));
  const made = results.filter(Boolean).length;
  return { made, failed: results.length - made };
}

export function cancelProxy(m: MediaItem): void {
  void api().video.proxyCancel(m.path);
}

/** "2 of 3 videos have a proxy" for the settings and the AI. */
export function proxyStatus(): {
  total: number;
  ready: string[];
  making: string[];
  candidates: MediaItem[];
} {
  const s = getV();
  const candidates = s.project.media.filter(needsProxy);
  return {
    total: candidates.length,
    candidates,
    ready: candidates.filter((m) => s.proxies[m.id]).map((m) => m.id),
    making: candidates.filter((m) => s.proxyProg[m.id] !== undefined).map((m) => m.id),
  };
}
