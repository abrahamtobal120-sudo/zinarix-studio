/**
 * Fase 4A: screen recording for Video Studio (like OBS / Loom).
 *
 * The screen or window comes from getDisplayMedia(): the main process answers it with the
 * source picked in our own dialog (recSelect), with the computer's sound on Windows. The
 * microphone is mixed in with Web Audio. The camera is recorded as a second file, so it lands
 * on its own track above the screen (small, in a corner) and can still be moved or cut.
 * Chunks go to the main process every second: long recordings never sit in memory.
 */
import { useSyncExternalStore } from 'react';
import type { MediaItem, VideoProject } from '../../../shared/video';
import {
  addTrack,
  clipEnd,
  insertMedia,
  projectDuration,
  setTransform,
} from '../../../shared/video';
import { api, toast } from '../../store';
import { zoomClip } from './autoZoom';
import { t4 } from './fase4Strings';
import { commit, getV, importPaths, setV } from './videoStore';

export type RecQuality = 'high' | 'smooth' | 'light';
export interface RecOptions {
  sourceId: string;
  /** The computer's sound (Windows). */
  system: boolean;
  /** Microphone device id ('' = default), null = none. */
  mic: string | null;
  /** Camera device id ('' = default), null = none. */
  cam: string | null;
  countdown: boolean;
  minimize: boolean;
  addToTimeline: boolean;
  quality: RecQuality;
  /** Fase 4 (mejora): zoom towards the cursor when the recording lands on the timeline. */
  autoZoom?: boolean;
}

export interface RecState {
  phase: 'idle' | 'starting' | 'countdown' | 'recording' | 'paused' | 'saving';
  count: number;
  /** ms recorded so far, without the pauses (updated by elapsed()). */
  startedAt: number;
  pausedMs: number;
  pausedAt: number;
  shortcut: string | null;
  /** Microphone level 0–1 (for the meter in the bar). */
  level: number;
}

const IDLE: RecState = {
  phase: 'idle',
  count: 0,
  startedAt: 0,
  pausedMs: 0,
  pausedAt: 0,
  shortcut: null,
  level: 0,
};
let rs: RecState = IDLE;
const listeners = new Set<() => void>();
function set(patch: Partial<RecState>): void {
  rs = { ...rs, ...patch };
  for (const l of listeners) l();
}
export const getRec = (): RecState => rs;
export function useRec<T>(select: (s: RecState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => select(rs),
  );
}

/** Recorded milliseconds (pauses left out). */
export function elapsed(s: RecState = rs, now = Date.now()): number {
  if (!s.startedAt) return 0;
  const pausedNow = s.phase === 'paused' ? now - s.pausedAt : 0;
  return Math.max(0, now - s.startedAt - s.pausedMs - pausedNow);
}

interface Track {
  rec: MediaRecorder;
  fileId: string;
  path: string;
  /** Writes in order; the last one. */
  writes: Promise<void>;
  /** Bytes the recorder has handed over so far. */
  bytes: number;
  failed?: Error;
}

/** Everything that must be closed when the recording ends. */
interface Session {
  streams: MediaStream[];
  audio?: AudioContext;
  screen?: Track;
  cam?: Track;
  opts: RecOptions;
  meter?: number;
  /** Where the playhead was when it started (the clip goes there). */
  at: number;
  canceled?: boolean;
}
let sess: Session | null = null;

const QUALITY: Record<RecQuality, { fps: number; bps: number }> = {
  high: { fps: 30, bps: 8_000_000 },
  smooth: { fps: 60, bps: 12_000_000 },
  light: { fps: 24, bps: 2_500_000 },
};

/** The best WebM the recorder supports (VP9 is smaller; VP8 everywhere). */
export function pickMime(audio: boolean, isOk: (m: string) => boolean): string {
  const list = audio
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return list.find(isOk) ?? 'video/webm';
}

const errText = (e: unknown) =>
  ((e as Error)?.message ?? String(e)).replace(
    /^Error invoking remote method '[^']+': (Error: )?/,
    '',
  );

let stopWired = false;
function wireStop(): void {
  if (stopWired) return;
  stopWired = true;
  api().on((ev) => {
    if (ev.type === 'video:recStop' && (rs.phase === 'recording' || rs.phase === 'paused'))
      void stopRecording();
  });
}

function startTrack(stream: MediaStream, fileId: string, path: string, bps: number): Track {
  const audio = stream.getAudioTracks().length > 0;
  const mimeType = pickMime(audio, (m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: bps,
    ...(audio ? { audioBitsPerSecond: 160_000 } : {}),
  });
  const t: Track = { rec, fileId, path, writes: Promise.resolve(), bytes: 0 };
  rec.ondataavailable = (e) => {
    if (!e.data.size) return;
    const blob = e.data;
    t.bytes += blob.size;
    t.writes = t.writes.then(async () => {
      if (t.failed) return;
      try {
        await api().video.recChunk(fileId, new Uint8Array(await blob.arrayBuffer()));
      } catch (err) {
        t.failed = err as Error;
      }
    });
  };
  rec.start(1000);
  return t;
}

async function stopTrack(t: Track | undefined): Promise<void> {
  if (!t) return;
  // The encoder hands its first data a couple of seconds after it starts (it waits for the
  // first frame): stopping before that would leave an empty file, so wait for it a little.
  for (let i = 0; i < 50 && t.bytes === 0 && t.rec.state !== 'inactive'; i++) {
    t.rec.requestData();
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise<void>((resolve) => {
    if (t.rec.state === 'inactive') return resolve();
    t.rec.addEventListener('stop', () => resolve(), { once: true });
    t.rec.stop();
  });
  await t.writes;
}

function cleanup(): void {
  const s = sess;
  sess = null;
  if (!s) return;
  if (s.meter) cancelAnimationFrame(s.meter);
  for (const st of s.streams) for (const tr of st.getTracks()) tr.stop();
  void s.audio?.close().catch(() => undefined);
}

/** Opens the devices, counts down and starts writing. */
export async function startRecording(opts: RecOptions): Promise<void> {
  if (rs.phase !== 'idle') {
    toast(t4('recBusy'));
    return;
  }
  wireStop();
  set({ ...IDLE, phase: 'starting' });
  const s: Session = { streams: [], opts, at: getV().playhead };
  sess = s;
  const q = QUALITY[opts.quality] ?? QUALITY.high;
  try {
    await api().video.recSelect(opts.sourceId, opts.system);
    let display: MediaStream;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: q.fps, max: q.fps } },
        audio: opts.system,
      });
    } catch (e) {
      throw new Error((e as Error).name === 'NotAllowedError' ? t4('recDenied') : errText(e));
    }
    s.streams.push(display);
    let mic: MediaStream | null = null;
    if (opts.mic !== null) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({
          audio: {
            ...(opts.mic ? { deviceId: { exact: opts.mic } } : {}),
            echoCancellation: true,
            noiseSuppression: true,
          },
        });
        s.streams.push(mic);
      } catch (e) {
        toast(t4('recMicFailed', { err: errText(e) }));
      }
    }
    let cam: MediaStream | null = null;
    if (opts.cam !== null) {
      try {
        cam = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(opts.cam ? { deviceId: { exact: opts.cam } } : {}),
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
          },
        });
        s.streams.push(cam);
      } catch (e) {
        toast(t4('recCamFailed', { err: errText(e) }));
      }
    }
    // One sound track: the computer's sound and the microphone mixed.
    const sources = [display, mic].filter((x): x is MediaStream => !!x?.getAudioTracks().length);
    const tracks = [...display.getVideoTracks()];
    if (sources.length) {
      const ctx = new AudioContext();
      s.audio = ctx;
      const dest = ctx.createMediaStreamDestination();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      for (const src of sources) {
        const node = ctx.createMediaStreamSource(src);
        node.connect(dest);
        if (src === mic) node.connect(analyser);
      }
      tracks.push(...dest.stream.getAudioTracks());
      if (mic) {
        const buf = new Uint8Array(analyser.fftSize);
        const tick = () => {
          analyser.getByteTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
          if (Math.abs(peak - rs.level) > 0.02) set({ level: peak });
          if (sess === s) s.meter = requestAnimationFrame(tick);
        };
        s.meter = requestAnimationFrame(tick);
      }
    }
    const screenStream = new MediaStream(tracks);
    // Closing the shared window or "Stop sharing" ends it like the Stop button.
    display.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (sess === s && (rs.phase === 'recording' || rs.phase === 'paused')) void stopRecording();
    });
    if (opts.countdown) {
      for (let n = 3; n > 0; n--) {
        set({ phase: 'countdown', count: n });
        await new Promise((r) => setTimeout(r, 1000));
        if (s.canceled) return;
      }
    }
    const mode = await api().video.recMode(true, opts.minimize);
    const screenFile = await api().video.recStart('screen');
    s.screen = startTrack(screenStream, screenFile.id, screenFile.path, q.bps);
    if (cam) {
      const camFile = await api().video.recStart('camera');
      s.cam = startTrack(cam, camFile.id, camFile.path, 4_000_000);
    }
    set({ phase: 'recording', count: 0, startedAt: Date.now(), shortcut: mode.shortcut });
  } catch (e) {
    toast(t4('recFailed', { err: errText(e) }));
    await abortFiles(s);
    cleanup();
    void api()
      .video.recMode(false, false)
      .catch(() => undefined);
    set(IDLE);
  }
}

async function abortFiles(s: Session): Promise<void> {
  for (const t of [s.screen, s.cam]) {
    if (!t) continue;
    if (t.rec.state !== 'inactive') t.rec.stop();
    await t.writes;
    await api()
      .video.recAbort(t.fileId)
      .catch(() => undefined);
  }
}

export function pauseRecording(): void {
  const s = sess;
  if (!s || rs.phase !== 'recording') return;
  for (const t of [s.screen, s.cam]) if (t?.rec.state === 'recording') t.rec.pause();
  if (s.screen)
    void api()
      .video.recPause(s.screen.fileId, true)
      .catch(() => undefined);
  set({ phase: 'paused', pausedAt: Date.now() });
}

export function resumeRecording(): void {
  const s = sess;
  if (!s || rs.phase !== 'paused') return;
  for (const t of [s.screen, s.cam]) if (t?.rec.state === 'paused') t.rec.resume();
  if (s.screen)
    void api()
      .video.recPause(s.screen.fileId, false)
      .catch(() => undefined);
  set({ phase: 'recording', pausedMs: rs.pausedMs + (Date.now() - rs.pausedAt), pausedAt: 0 });
}

/** Throws the recording away (nothing is saved). */
export async function discardRecording(): Promise<void> {
  const s = sess;
  if (!s) return;
  s.canceled = true;
  set({ phase: 'saving' });
  await abortFiles(s);
  cleanup();
  await api()
    .video.recMode(false, false)
    .catch(() => undefined);
  set(IDLE);
}

/** Stops, saves the files and (when asked) puts them on the timeline. */
export async function stopRecording(): Promise<string | null> {
  const s = sess;
  if (!s || (rs.phase !== 'recording' && rs.phase !== 'paused')) {
    if (s && (rs.phase === 'countdown' || rs.phase === 'starting')) await discardRecording();
    return null;
  }
  set({ phase: 'saving' });
  try {
    await Promise.all([stopTrack(s.screen), stopTrack(s.cam)]);
    cleanup();
    await api()
      .video.recMode(false, false)
      .catch(() => undefined);
    const failed = s.screen?.failed ?? s.cam?.failed;
    if (failed) throw failed;
    const screenPath = await api().video.recFinish(s.screen!.fileId);
    const camPath = s.cam
      ? await api()
          .video.recFinish(s.cam.fileId)
          .catch(() => null)
      : null;
    toast(t4('recSaved', { name: screenPath.split(/[\\/]/).pop() ?? screenPath }));
    const added = await importPaths(camPath ? [screenPath, camPath] : [screenPath]);
    if (s.opts.addToTimeline) {
      const screen = added.find((m) => m.path === screenPath);
      const camera = camPath ? added.find((m) => m.path === camPath) : undefined;
      if (screen) {
        const p = placeRecording(
          getV().project,
          screen,
          camera,
          getV().project.clips.length ? undefined : 0,
        );
        let project = p.project;
        if (s.opts.autoZoom && p.ids[0]) {
          const z = await zoomClip(project, p.ids[0]);
          if ('project' in z) {
            project = z.project;
            toast(t4('zoomDone', { n: z.rests }));
          } else if (z.error === 'none') toast(t4('zoomNone'));
        }
        commit(project, t4('recUndo'));
        setV({ selection: p.ids });
      }
    }
    return screenPath;
  } catch (e) {
    toast(t4('recFailed', { err: errText(e) }));
    return null;
  } finally {
    cleanup();
    set(IDLE);
  }
}

/**
 * Puts a recording on the timeline: the screen at the end of the first video track (or at
 * `start`), the camera on a new track above it, small in the bottom-right corner. Pure.
 */
export function placeRecording(
  p: VideoProject,
  screen: MediaItem,
  camera?: MediaItem,
  start?: number,
): { project: VideoProject; ids: string[] } {
  const firstVideo = p.tracks.find((t) => t.kind === 'video' && !t.locked);
  const at =
    start ??
    (firstVideo
      ? p.clips
          .filter((c) => c.trackId === firstVideo.id)
          .reduce((mx, c) => Math.max(mx, clipEnd(c)), 0)
      : projectDuration(p));
  const a = insertMedia(p, screen, { trackId: firstVideo?.id, start: at });
  if (!a.clip) return { project: p, ids: [] };
  let project = a.project;
  const ids = [a.clip.id];
  if (camera) {
    project = addTrack(project, 'video');
    const top = project.tracks[0]!;
    const b = insertMedia(project, camera, { trackId: top.id, start: a.clip.start });
    if (b.clip) {
      project = {
        ...b.project,
        tracks: b.project.tracks.map((t) =>
          t.id === top.id ? { ...t, name: t4('recCamLayer') } : t,
        ),
      };
      project = setTransform(project, b.clip.id, { x: 0.36, y: 0.33, scale: 0.26 });
      ids.push(b.clip.id);
    }
  }
  return { project, ids };
}
