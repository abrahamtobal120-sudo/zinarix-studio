/**
 * Left-panel tab of phase 13 ("IA"): transcript with word times, text-based editing (delete
 * words, fillers), silence removal, scene split and captions. Every edit is one undoable change
 * of the pure model (shared/videoAi.ts); the analysis runs in main (FFmpeg, whisper, provider).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { SttEngineId, SttEngineView } from '../../../shared/api';
import type { Clip, MediaItem, VideoProject } from '../../../shared/video';
import { isText, mediaOf, speedOf, trackOf } from '../../../shared/video';
import type { Range } from '../../../shared/videoAi';
import {
  CAPTION_STYLES,
  SILENCE_DEFAULTS,
  TRANSCRIBE_LANGS,
  captionTrack,
  cuesOfTrack,
  cutMediaRanges,
  fillerIndexes,
  placeCaptions,
  projectCues,
  setTranscript,
  silenceCuts,
  splitClipAtSource,
  toSrt,
  toVtt,
  usedSourceRanges,
  wordCuts,
} from '../../../shared/videoAi';
import { confirmDialog } from '../../confirm';
import { lang as uiLang } from '../../i18n';
import { api, toast } from '../../store';
import { type AiKey, ta } from './aiStrings';
import { commit, getV, seek, setV, useV } from './videoStore';
import './video-fx.css';
import './easy.css';
import './ai.css';

/** Transcription languages, named in the UI language and sorted by that name. */
function langOptions(ui: string): { code: string; name: string }[] {
  let dn: Intl.DisplayNames | null = null;
  try {
    dn = new Intl.DisplayNames([ui], { type: 'language' });
  } catch {
    /* older runtime: fall back to the code */
  }
  return Object.keys(TRANSCRIBE_LANGS)
    .map((code) => {
      const n = dn?.of(code) ?? code;
      return { code, name: n.charAt(0).toLocaleUpperCase(ui) + n.slice(1) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, ui));
}

/** The clip the panel works on: the selected one with sound, else the first one on the timeline. */
function targetOf(p: VideoProject, selection: string[]): { clip: Clip; media: MediaItem } | null {
  const usable = (c: Clip | undefined) => {
    if (!c || isText(c)) return null;
    const m = mediaOf(p, c.mediaId);
    return m && m.hasAudio && !m.missing && m.kind !== 'image' ? { clip: c, media: m } : null;
  };
  for (const id of selection) {
    const r = usable(p.clips.find((c) => c.id === id));
    if (r) return r;
  }
  const first = [...p.clips].sort((a, b) => a.start - b.start).find((c) => usable(c));
  return first ? usable(first) : null;
}

const lockedFor = (p: VideoProject, mediaId: string) =>
  p.clips.some((c) => c.mediaId === mediaId && trackOf(p, c.trackId)?.locked);

function applyCut(p: VideoProject, mediaId: string, cuts: Range[], label: AiKey): void {
  if (!cuts.length) return void toast(ta('nothingCut'));
  if (lockedFor(p, mediaId)) return void toast(ta('locked'));
  const r = cutMediaRanges(p, mediaId, cuts);
  if (r.removed <= 0) return void toast(ta('nothingCut'));
  commit(r.project, ta(label));
  toast(ta('cut', { s: r.removed.toFixed(1) }));
}

export function AiPanel() {
  const project = useV((s) => s.project);
  const selection = useV((s) => s.selection);
  const target = targetOf(project, selection);
  return (
    <div className="vs-fx-panel">
      <div className="vs-panel-title">{ta('tab')}</div>
      {!target ? (
        <p className="vs-dim vs-note vs-ai-pad">{ta('noTarget')}</p>
      ) : (
        <>
          <p className="vs-dim vs-note vs-ai-pad">
            {ta('target')}: <strong title={target.media.path}>{target.media.name}</strong>
          </p>
          <TranscriptSection media={target.media} />
          <SilenceSection media={target.media} />
          <SceneSection clip={target.clip} media={target.media} />
        </>
      )}
      <CaptionSection />
    </div>
  );
}

function TranscriptSection({ media }: { media: MediaItem }) {
  const transcript = useV((s) => s.project.transcripts?.[media.id]);
  const project = useV((s) => s.project);
  const [engines, setEngines] = useState<SttEngineView[] | null>(null);
  const [engine, setEngine] = useState<SttEngineId | ''>('');
  const [lang, setLang] = useState<string>('');
  const langs = useMemo(() => langOptions(uiLang), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [sel, setSel] = useState<{ a: number; b: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    void api()
      .video.sttEngines()
      .then((list) => {
        if (!live) return;
        setEngines(list);
        setEngine((e) => e || list.find((x) => x.ready)?.id || '');
      })
      .catch(() => live && setEngines([]));
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => setSel(null), [media.id]);

  const words = transcript?.words ?? [];
  const used = useMemo(() => usedSourceRanges(project, media.id), [project, media.id]);
  const isUsed = (s: number, e: number) => {
    const mid = (s + e) / 2;
    return used.some((r) => mid >= r[0] && mid < r[1]);
  };
  const fillers = useMemo(
    () => fillerIndexes(words).filter((i) => isUsed(words[i]!.s, words[i]!.e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [words, used],
  );
  const current = engines?.find((e) => e.id === engine);

  const run = async () => {
    if (!current?.ready) return toast(ta('noEngine'));
    if (
      current.cloud &&
      !(await confirmDialog(ta('cloudAsk', { name: media.name, engine: current.label })))
    )
      return;
    const id = `stt-${Date.now()}`;
    setBusy(id);
    try {
      const t = await api().video.transcribe(
        id,
        media.path,
        current.id,
        media.duration,
        lang || undefined,
      );
      commit(setTranscript(getV().project, media.id, t), ta('editStt'));
      setSel(null);
      toast(ta('done', { n: t.words.length }));
    } catch (e) {
      toast(ta('failed', { err: e instanceof Error ? e.message : String(e) }));
    } finally {
      setBusy(null);
    }
  };

  /** Timeline time of a source time, through the clip that still plays it (if any). */
  const timelineOf = (src: number): number | null => {
    const p = getV().project;
    const c = p.clips.find(
      (x) => x.mediaId === media.id && !isText(x) && src >= x.in && src < x.out,
    );
    return c ? c.start + (src - c.in) / speedOf(c) : null;
  };

  const click = (i: number, shift: boolean) => {
    if (shift && sel) setSel({ a: Math.min(sel.a, i), b: Math.max(sel.b, i) });
    else setSel({ a: i, b: i });
    const t = timelineOf(words[i]!.s);
    if (t !== null && !shift) seek(t);
  };

  const deleteSel = () => {
    if (!sel) return;
    const idx: number[] = [];
    for (let i = sel.a; i <= sel.b; i++) idx.push(i);
    applyCut(getV().project, media.id, wordCuts(words, idx), 'editCut');
    setSel(null);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
      e.preventDefault();
      e.stopPropagation();
      deleteSel();
    } else if (e.key === 'Escape' && sel) {
      e.stopPropagation();
      setSel(null);
    }
  };

  // The playhead's word, highlighted while it plays.
  const playhead = useV((s) => s.playhead);
  const atSrc = (() => {
    const c = project.clips.find(
      (x) =>
        x.mediaId === media.id &&
        !isText(x) &&
        playhead >= x.start &&
        playhead < x.start + (x.out - x.in) / speedOf(x),
    );
    return c ? c.in + (playhead - c.start) * speedOf(c) : null;
  })();
  useEffect(() => {
    if (atSrc === null) return;
    listRef.current?.querySelector('.vs-ai-word.now')?.scrollIntoView({ block: 'nearest' });
  }, [atSrc]);

  return (
    <section className="vs-easy-sec" aria-label={ta('sttTitle')}>
      <h4>{ta('sttTitle')}</h4>
      <p className="vs-dim vs-note">{ta('sttHint')}</p>
      <div className="vs-ai-grid">
        <label className="vs-easy-field">
          <span>{ta('engine')}</span>
          <select
            className="vs-select"
            value={engine}
            disabled={!!busy || !engines}
            onChange={(e) => setEngine(e.target.value as SttEngineId)}
          >
            {(engines ?? []).map((e) => (
              <option key={e.id} value={e.id} disabled={!e.ready}>
                {e.label}
              </option>
            ))}
          </select>
        </label>
        <label className="vs-easy-field">
          <span>{ta('language')}</span>
          <select
            className="vs-select"
            value={lang}
            disabled={!!busy}
            onChange={(e) => setLang(e.target.value)}
          >
            <option value="">{ta('langAuto')}</option>
            {langs.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {current && <p className="vs-dim vs-note">{current.note}</p>}
      {engines && !engines.some((e) => e.ready) && (
        <p className="vs-dim vs-note">{ta('noEngine')}</p>
      )}
      <div className="vs-easy-row">
        {busy ? (
          <>
            <span className="vs-dim">{ta('transcribing')}</span>
            <button onClick={() => void api().video.sttAbort(busy)}>{ta('cancel')}</button>
          </>
        ) : (
          <button
            className={transcript ? '' : 'primary'}
            disabled={!current?.ready}
            onClick={() => void run()}
          >
            {transcript ? ta('retranscribe') : ta('transcribe')}
          </button>
        )}
      </div>
      {transcript && (
        <>
          <p className="vs-dim vs-note">{ta('wordsHint')}</p>
          <div
            ref={listRef}
            className="vs-ai-words"
            role="listbox"
            aria-multiselectable="true"
            aria-label={ta('sttTitle')}
            tabIndex={0}
            onKeyDown={onKey}
          >
            {words.map((w, i) => {
              const gone = !isUsed(w.s, w.e);
              const picked = !!sel && i >= sel.a && i <= sel.b;
              const now = atSrc !== null && atSrc >= w.s && atSrc < w.e;
              return (
                <span
                  key={i}
                  role="option"
                  aria-selected={picked}
                  className={`vs-ai-word${gone ? ' gone' : ''}${picked ? ' on' : ''}${now ? ' now' : ''}`}
                  title={`${w.s.toFixed(2)} s`}
                  onClick={(e) => click(i, e.shiftKey)}
                >
                  {w.w}{' '}
                </span>
              );
            })}
          </div>
          <div className="vs-easy-row">
            <button disabled={!sel} onClick={deleteSel}>
              {ta('deleteSel', { n: sel ? sel.b - sel.a + 1 : 0 })}
            </button>
            <button
              disabled={!fillers.length}
              onClick={() =>
                applyCut(getV().project, media.id, wordCuts(words, fillers), 'editFillers')
              }
            >
              {fillers.length ? ta('fillers', { n: fillers.length }) : ta('noFillers')}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function SilenceSection({ media }: { media: MediaItem }) {
  const [db, setDb] = useState<number>(SILENCE_DEFAULTS.noiseDb);
  const [min, setMin] = useState<number>(SILENCE_DEFAULTS.minDur);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const s = await api().video.silences(media.path, media.duration, db, min);
      applyCut(getV().project, media.id, silenceCuts(s, min), 'editSilences');
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vs-easy-sec" aria-label={ta('silTitle')}>
      <h4>{ta('silTitle')}</h4>
      <p className="vs-dim vs-note">{ta('silHint')}</p>
      <div className="vs-ai-grid">
        <label className="vs-easy-field">
          <span>
            {ta('silLevel')}: {db}
          </span>
          <input
            type="range"
            min={-60}
            max={-20}
            step={1}
            value={db}
            onChange={(e) => setDb(Number(e.target.value))}
          />
        </label>
        <label className="vs-easy-field">
          <span>
            {ta('silMin')}: {min.toFixed(1)}
          </span>
          <input
            type="range"
            min={0.3}
            max={3}
            step={0.1}
            value={min}
            onChange={(e) => setMin(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="vs-easy-row">
        <button disabled={busy} onClick={() => void run()}>
          {busy ? ta('analyzing') : ta('silRun')}
        </button>
      </div>
    </section>
  );
}

function SceneSection({ clip, media }: { clip: Clip; media: MediaItem }) {
  const [sens, setSens] = useState(0.6);
  const [busy, setBusy] = useState(false);
  if (!media.hasVideo || media.kind !== 'video') return null;
  const run = async () => {
    setBusy(true);
    try {
      // More sensitive = a lower scene score threshold.
      const times = await api().video.scenes(media.path, media.duration, 0.9 - sens * 0.7);
      const p = getV().project;
      if (trackOf(p, clip.trackId)?.locked) return void toast(ta('locked'));
      const r = splitClipAtSource(p, clip.id, times);
      if (!r.cuts) return void toast(ta('noScenes'));
      commit(r.project, ta('editScenes'));
      toast(ta('scenesDone', { n: r.cuts }));
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="vs-easy-sec" aria-label={ta('sceneTitle')}>
      <h4>{ta('sceneTitle')}</h4>
      <p className="vs-dim vs-note">{ta('sceneHint')}</p>
      <label className="vs-easy-field">
        <span>
          {ta('sceneSens')}: {Math.round(sens * 100)}%
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={sens}
          onChange={(e) => setSens(Number(e.target.value))}
        />
      </label>
      <div className="vs-easy-row">
        <button disabled={busy} onClick={() => void run()}>
          {busy ? ta('analyzing') : ta('sceneRun')}
        </button>
      </div>
    </section>
  );
}

function CaptionSection() {
  const project = useV((s) => s.project);
  const [style, setStyle] = useState<string>(CAPTION_STYLES[0]!.id);
  const has = !!captionTrack(project);
  const any = !!project.transcripts && Object.keys(project.transcripts).length > 0;
  const create = () => {
    const p = getV().project;
    const cues = projectCues(p, style);
    if (!cues.length) return toast(ta('capNone'));
    const r = placeCaptions(p, cues, style);
    if (!r.count) return toast(ta('locked'));
    commit(r.project, ta('editCaptions'));
    setV({ selection: [] });
    toast(ta('capDone', { n: r.count }));
  };
  const save = async (ext: 'srt' | 'vtt') => {
    const p = getV().project;
    const cues = has ? cuesOfTrack(p) : projectCues(p, style);
    if (!cues.length) return toast(ta('capNone'));
    const out = await api().video.saveCaptions(
      p.name,
      ext === 'srt' ? toSrt(cues) : toVtt(cues),
      ext,
    );
    if (out) toast(ta('saved', { path: out }));
  };
  return (
    <section className="vs-easy-sec" aria-label={ta('capTitle')}>
      <h4>{ta('capTitle')}</h4>
      <p className="vs-dim vs-note">{ta('capHint')}</p>
      <label className="vs-easy-field">
        <span>{ta('capStyle')}</span>
        <select className="vs-select" value={style} onChange={(e) => setStyle(e.target.value)}>
          {CAPTION_STYLES.map((s) => (
            <option key={s.id} value={s.id}>
              {ta(`st_${s.id}` as AiKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="vs-easy-row">
        <button className="primary" disabled={!any} onClick={create}>
          {has ? ta('capRedo') : ta('capRun')}
        </button>
        <button disabled={!any && !has} onClick={() => void save('srt')}>
          {ta('saveSrt')}
        </button>
        <button disabled={!any && !has} onClick={() => void save('vtt')}>
          {ta('saveVtt')}
        </button>
      </div>
    </section>
  );
}
