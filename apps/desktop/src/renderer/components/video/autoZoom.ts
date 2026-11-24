/**
 * Fase 4 (mejora): auto zoom of screen recordings, renderer side. Reads the cursor path main
 * saved next to the recording (cached) and turns it into zoom keys (shared/videoZoom.ts).
 */
import type { VideoProject } from '../../../shared/video';
import { mediaOf, updateClip } from '../../../shared/video';
import type { CursorTrack, ZoomOptions } from '../../../shared/videoZoom';
import {
  autoZoomKeys,
  parseCursorTrack,
  withAutoZoom,
  withoutZoom,
} from '../../../shared/videoZoom';
import { api } from '../../store';

const cache = new Map<string, Promise<CursorTrack | null>>();

/** The cursor path of a media file, or null when it has none. */
export function cursorTrackOf(path: string): Promise<CursorTrack | null> {
  let hit = cache.get(path);
  if (!hit) {
    hit = api()
      .video.cursorTrack(path)
      .then((t) => (t ? parseCursorTrack(t) : null))
      .catch(() => null);
    cache.set(path, hit);
    // A failed or missing file may show up later (a recording just finished).
    void hit.then((t) => {
      if (!t) cache.delete(path);
    });
  }
  return hit;
}

export type ZoomResult =
  { project: VideoProject; rests: number } | { error: 'noClip' | 'noTrack' | 'none' };

/** The project with the auto zoom on a clip (its scale / x / y keys replaced). */
export async function zoomClip(
  p: VideoProject,
  clipId: string,
  opts: ZoomOptions = {},
): Promise<ZoomResult> {
  const c = p.clips.find((x) => x.id === clipId);
  const m = c ? mediaOf(p, c.mediaId) : undefined;
  if (!c || !m || m.kind !== 'video') return { error: 'noClip' };
  const track = await cursorTrackOf(m.path);
  if (!track) return { error: 'noTrack' };
  const keys = autoZoomKeys(p, c, track, opts);
  if (!keys) return { error: 'none' };
  return {
    project: updateClip(p, c.id, { keyframes: withAutoZoom(c, keys).keyframes }),
    rests: keys.rests,
  };
}

/** The project without the zoom keys of a clip. */
export function unzoomClip(p: VideoProject, clipId: string): VideoProject {
  const c = p.clips.find((x) => x.id === clipId);
  return c ? updateClip(p, c.id, { keyframes: withoutZoom(c).keyframes }) : p;
}
