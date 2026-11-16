/**
 * Fase 13B: the agent's video_* calls, run on the project open in Video Studio. A dry run
 * (for the approval card) computes the change without committing; a real one commits it as one
 * undo step, with the same pure functions as the buttons (shared/videoAgent.ts, videoAi.ts).
 */
import type { SttEngineView } from '../../../shared/api';
import type { ExportOptions, VideoProject } from '../../../shared/video';
import {
  EXPORT_PRESETS,
  defaultExport,
  insertMedia,
  isText,
  projectDuration,
  trackKindFor,
} from '../../../shared/video';
import {
  SILENCE_DEFAULTS,
  setTranscript,
  silenceCuts,
  splitClipAtSource,
  type Range,
} from '../../../shared/videoAi';
import {
  applyCuts,
  describeChange,
  describeState,
  fmtTime,
  pickMedia,
  pureEdit,
  transcriptPage,
  type VideoAgentResult,
  type VideoEdit,
} from '../../../shared/videoAgent';
import { api, toast } from '../../store';
import { textPngs } from './textDraw';
import { commit, getV, importPaths, openStudio } from './videoStore';

type Args = Record<string, unknown>;
const str = (a: Args, k: string) => (typeof a[k] === 'string' ? (a[k] as string).trim() : '');
const num = (a: Args, k: string) =>
  typeof a[k] === 'number' && Number.isFinite(a[k]) ? (a[k] as number) : undefined;
const fail = (content: string, summary = 'no se pudo'): VideoAgentResult => ({
  ok: false,
  content,
  summary,
});
const base = (p: string) => p.split(/[\\/]/).pop() ?? p;

/** What each edit does, for the approval card. */
const ACTION: Record<string, (a: Args, p: VideoProject) => string> = {
  video_keep_ranges: (a) =>
    `dejar solo ${Array.isArray(a.ranges) ? a.ranges.length : 0} fragmento(s) de lo que se dice`,
  video_cut_words: (a) =>
    `cortar ${Array.isArray(a.ranges) ? a.ranges.length : 0} tramo(s) de palabras`,
  video_remove_fillers: () => 'quitar las muletillas',
  video_remove_silences: () => 'quitar los silencios',
  video_split_scenes: () => 'dividir en escenas',
  video_split: (a) => `dividir el clip ${str(a, 'clip')}`,
  video_trim: (a) => `recortar el clip ${str(a, 'clip')}`,
  video_move: (a) => `mover el clip ${str(a, 'clip')}`,
  video_delete: (a) => `borrar ${Array.isArray(a.clips) ? a.clips.length : 1} clip(s)`,
  video_add_title: (a) => `agregar el título "${str(a, 'text').slice(0, 80)}"`,
  video_captions: (a) => `poner subtítulos (estilo ${str(a, 'style') || 'classic'})`,
  video_set_format: (a) => `cambiar el formato a ${str(a, 'aspect')}`,
};

/** Analyses (silences, scenes) measured for the approval card, reused by the real run. */
const analysis = new Map<string, Promise<unknown>>();
function cached<T>(key: string, run: () => Promise<T>): Promise<T> {
  let p = analysis.get(key) as Promise<T> | undefined;
  if (!p) {
    p = run();
    analysis.set(key, p);
    p.catch(() => analysis.delete(key));
    if (analysis.size > 20) analysis.delete(analysis.keys().next().value!);
  }
  return p;
}

/** Shows (dry) or commits an edit. */
function finishEdit(
  name: string,
  a: Args,
  before: VideoProject,
  e: VideoEdit,
  dry: boolean,
): VideoAgentResult {
  if ('error' in e) return fail(e.error);
  const change = describeChange(before, e.project);
  if (dry) return { ok: true, content: (ACTION[name] ?? (() => name))(a, before), summary: change };
  // The project may have changed while the card waited: the run recomputed from the current one.
  commit(e.project, e.label);
  return { ok: true, content: e.content, summary: change };
}

async function run(
  name: string,
  a: Args,
  dry: boolean,
  id: string,
  signal: AbortSignal,
): Promise<VideoAgentResult> {
  const v = getV();
  if (!v.open && name !== 'video_add_media')
    return fail(
      'Video Studio is not open. Ask the user to open it (Ctrl+Shift+V or the Video button), or start with video_add_media, which opens it.',
      'Video Studio cerrado',
    );
  const p = v.project;
  switch (name) {
    case 'video_state':
      return {
        ok: true,
        content: describeState(p, v.playhead),
        summary: `${p.clips.length} clips · ${fmtTime(projectDuration(p))}`,
      };
    case 'video_transcript': {
      const page = num(a, 'page') ?? 1;
      return {
        ok: true,
        content: transcriptPage(p, str(a, 'media'), page),
        summary: `página ${page}`,
      };
    }
    case 'video_add_media':
      return addMedia(a, dry);
    case 'video_remove_silences': {
      const m = pickMedia(p, str(a, 'media'), 'audio');
      if ('error' in m) return fail(m.error);
      const db = Math.min(-10, Math.max(-80, num(a, 'noise_db') ?? SILENCE_DEFAULTS.noiseDb));
      const min = Math.min(10, Math.max(0.2, num(a, 'min_seconds') ?? SILENCE_DEFAULTS.minDur));
      const s = await cached(`sil|${m.path}|${db}|${min}`, () =>
        api().video.silences(m.path, m.duration, db, min),
      );
      const cuts = silenceCuts(s as Range[], min);
      const now = getV().project;
      return finishEdit(name, a, now, applyCuts(now, m, cuts, 'IA: quitar silencios'), dry);
    }
    case 'video_split_scenes': {
      const id0 = str(a, 'clip');
      const c =
        p.clips.find((x) => x.id === id0) ??
        (!id0
          ? [...p.clips]
              .sort((x, y) => x.start - y.start)
              .find((x) => !isText(x) && p.media.find((m) => m.id === x.mediaId)?.kind === 'video')
          : undefined);
      if (!c) return fail(id0 ? `No clip "${id0}".` : 'There is no video clip on the timeline.');
      const m = p.media.find((x) => x.id === c.mediaId);
      if (!m || m.kind !== 'video') return fail('That clip is not a video.');
      const sens = Math.min(1, Math.max(0, num(a, 'sensitivity') ?? 0.5));
      const times = (await cached(`sc|${m.path}|${sens}`, () =>
        api().video.scenes(m.path, m.duration, 0.9 - sens * 0.7),
      )) as number[];
      const now = getV().project;
      const r = splitClipAtSource(now, c.id, times);
      if (!r.cuts) return fail('No scene changes were found in that clip.');
      return finishEdit(
        name,
        a,
        now,
        {
          project: r.project,
          label: 'IA: escenas',
          content: `Split ${c.id} at ${r.cuts} scene change(s).`,
        },
        dry,
      );
    }
    case 'video_transcribe':
      return transcribe(a, dry, id, signal);
    case 'video_export':
      return exportVideo(a, dry, signal);
    default: {
      const e = pureEdit(p, name, a, v.playhead);
      if (!e) return fail(`Unknown video tool ${name}.`);
      return finishEdit(name, a, p, e, dry);
    }
  }
}

async function addMedia(a: Args, dry: boolean): Promise<VideoAgentResult> {
  const path = str(a, 'path');
  if (!path) return fail('Give the absolute "path" of the file.');
  if (dry)
    return { ok: true, content: `agregar "${base(path)}" a la línea de tiempo`, summary: path };
  if (!getV().open) await openStudio();
  const [m] = await importPaths([path]);
  if (!m) return fail(`Could not import ${path} (missing file or format not supported).`);
  const p = getV().project;
  const t = str(a, 'track');
  const track = p.tracks.find((x) => (x.id === t || x.name === t) && x.kind === trackKindFor(m));
  const r = insertMedia(p, m, { trackId: track?.id, start: num(a, 'start') });
  if (!r.clip) return fail(`"${m.name}" could not be placed.`);
  commit(r.project, 'IA: agregar medio');
  return {
    ok: true,
    content: `Added ${m.id} "${m.name}" (${m.kind}, ${m.duration.toFixed(2)} s) as clip ${r.clip.id} at ${r.clip.start.toFixed(2)} s on ${r.project.tracks.find((x) => x.id === r.clip!.trackId)?.name}.`,
    summary: `${m.name} en la línea de tiempo`,
  };
}

async function transcribe(
  a: Args,
  dry: boolean,
  id: string,
  signal: AbortSignal,
): Promise<VideoAgentResult> {
  const p = getV().project;
  const m = pickMedia(p, str(a, 'media'), 'audio');
  if ('error' in m) return fail(m.error);
  const engines: SttEngineView[] = await api().video.sttEngines();
  const asked = str(a, 'engine');
  const eng = asked
    ? engines.find((e) => e.id === asked || e.label.toLowerCase().includes(asked.toLowerCase()))
    : (engines.find((e) => e.ready && !e.cloud) ?? engines.find((e) => e.ready));
  if (!eng || !eng.ready)
    return fail(
      `No speech-to-text engine is ready${eng ? ` (${eng.label}: ${eng.note})` : ''}. Available: ${engines.map((e) => `${e.id} (${e.ready ? 'ready' : e.note})`).join(', ') || 'none'}.`,
    );
  const lang = str(a, 'lang') || undefined;
  if (dry)
    return {
      ok: true,
      content: `transcribir "${m.name}" con ${eng.label}`,
      summary: eng.cloud
        ? `Se sube el audio (${Math.ceil(m.duration / 60)} min) a ${eng.label}; puede tener costo.`
        : 'Se transcribe en tu equipo; el audio no sale de él.',
    };
  const off = () => void api().video.sttAbort(id);
  signal.addEventListener('abort', off, { once: true });
  try {
    const t = await api().video.transcribe(id, m.path, eng.id, m.duration, lang);
    commit(setTranscript(getV().project, m.id, t), 'IA: transcribir');
    return {
      ok: true,
      content: `Transcribed "${m.name}": ${t.words.length} words${t.lang ? ` (${t.lang})` : ''}. Read them with video_transcript.`,
      summary: `${t.words.length} palabras`,
    };
  } finally {
    signal.removeEventListener('abort', off);
  }
}

async function exportVideo(a: Args, dry: boolean, signal: AbortSignal): Promise<VideoAgentResult> {
  const p = getV().project;
  const total = projectDuration(p);
  if (!(total > 0)) return fail('The timeline is empty: nothing to export.');
  const preset = EXPORT_PRESETS.find((x) => x.id === str(a, 'preset')) ?? EXPORT_PRESETS[0]!;
  const loud = num(a, 'loudness');
  const o: ExportOptions = {
    ...defaultExport(p, preset),
    start: 0,
    end: total,
    ...(loud !== undefined ? { loudness: loud } : {}),
  };
  // main put the approved file name in __out (and only that one may be written).
  const out = str(a, '__out');
  if (!out) return fail('No output file.');
  if (dry)
    return {
      ok: true,
      content: `exportar el video (${preset.label}, ${o.width}x${o.height}, ${fmtTime(total)})`,
      summary: `Se guarda en ${out}`,
    };
  const job = await api().video.export(p, o, out, textPngs(p.clips, o.width, o.height));
  toast(`Exportando ${base(out)}…`);
  const end = await new Promise<{ state: string; error?: string }>((resolve) => {
    const off = api().on((ev) => {
      if (ev.type !== 'video:job' || ev.job.id !== job.id) return;
      if (ev.job.state === 'done' || ev.job.state === 'error' || ev.job.state === 'canceled') {
        off();
        resolve(ev.job);
      }
    });
    signal.addEventListener('abort', () => void api().video.cancel(job.id), { once: true });
  });
  if (end.state !== 'done')
    return fail(`Export ${end.state}${end.error ? `: ${end.error}` : ''}.`, 'export fallido');
  return {
    ok: true,
    content: `Exported ${fmtTime(total)} at ${o.width}x${o.height} to ${out}.`,
    summary: base(out),
  };
}

let wired = false;
/** Answers the agent's 'video:agent' requests for as long as the app runs. */
export function wireVideoAgent(): void {
  if (wired) return;
  wired = true;
  const live = new Map<string, AbortController>();
  api().on((ev) => {
    if (ev.type === 'video:agentAbort') return void live.get(ev.requestId)?.abort();
    if (ev.type !== 'video:agent') return;
    const ctl = new AbortController();
    live.set(ev.requestId, ctl);
    run(ev.name, ev.args, ev.dry, ev.requestId, ctl.signal)
      .catch((e: unknown): VideoAgentResult =>
        fail(
          (e instanceof Error ? e.message : String(e)).replace(
            /^Error invoking remote method '[^']+': (Error: )?/,
            '',
          ),
          'falló',
        ),
      )
      .then((r) => api().video.agentDone(ev.requestId, r))
      .finally(() => live.delete(ev.requestId));
  });
}
