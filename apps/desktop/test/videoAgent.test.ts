import { describe, expect, it } from 'vitest';
import {
  VIDEO_TOOLS,
  VIDEO_TOOL_NAMES,
  videoPreview,
  type VideoUi,
} from '../src/main/videoTools.js';
import type { MediaItem, TranscriptWord, VideoProject } from '../src/shared/video.js';
import {
  clipEnd,
  insertMedia,
  isText,
  newProject,
  projectDuration,
  validProject,
} from '../src/shared/video.js';
import { captionTrack, setTranscript } from '../src/shared/videoAi.js';
import {
  VIDEO_TOOL_LIST,
  describeChange,
  describeState,
  keepRanges,
  pureEdit,
  transcriptPage,
  wordRanges,
} from '../src/shared/videoAgent.js';

const media = (over: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  path: '/x/entrevista.mp4',
  name: 'entrevista.mp4',
  kind: 'video',
  duration: 600,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: true,
  size: 1,
  ...over,
});

/** A 10-minute interview: one word every second ("w0" … "w599"), 0.6 s long. */
function interview(): VideoProject {
  const m = media();
  let p: VideoProject = { ...newProject({ name: 'Entrevista' }), media: [m] };
  p = insertMedia(p, m, { start: 0 }).project;
  const words: TranscriptWord[] = Array.from({ length: 600 }, (_, i) => ({
    s: i,
    e: i + 0.6,
    w: i === 10 ? 'eh' : `w${i}`,
  }));
  return setTranscript(p, m.id, { engine: 'test', lang: 'es', words, at: 0 });
}

const ok = <T>(e: T | { error: string }): T => {
  if (e && typeof e === 'object' && 'error' in e) throw new Error((e as { error: string }).error);
  return e as T;
};

describe('Fase 13B: reading the project', () => {
  it('describes media, transcripts, tracks and clip ids', () => {
    const p = interview();
    const s = describeState(p);
    expect(s).toContain('entrevista.mp4');
    expect(s).toContain('transcript: 600 words');
    expect(s).toContain(p.clips[0]!.id);
  });

  it('pages the transcript with word numbers and marks what was cut', () => {
    const p = interview();
    const page1 = transcriptPage(p, '', 1);
    expect(page1).toContain('[0] w0 0.00');
    expect(page1).toContain('page 1 of 1');
    const cut = ok(pureEdit(p, 'video_cut_words', { ranges: [[5, 6]] }, 0));
    expect(transcriptPage(cut.project, 'm1')).toContain('[5] w5 5.00 (cut)');
  });

  it('checks word ranges against the transcript', () => {
    expect(wordRanges([[3, 5], 7], 10)).toEqual([
      [3, 5],
      [7, 7],
    ]);
    expect(wordRanges([[5, 3]], 10)).toHaveProperty('error');
    expect(wordRanges([[0, 10]], 10)).toHaveProperty('error');
    expect(wordRanges([], 10)).toHaveProperty('error');
  });
});

describe('Fase 13B: the short (video_keep_ranges)', () => {
  it('keeps only the stretches, in the given order, back to back', () => {
    const p = interview();
    const r = ok(
      keepRanges(p, '', [
        [300, 319],
        [100, 124],
      ]),
    );
    const clips = r.project.clips.filter((c) => !isText(c)).sort((a, b) => a.start - b.start);
    expect(clips).toHaveLength(2);
    // The later stretch first, as asked.
    expect(clips[0]!.in).toBeCloseTo(299.95, 3); // word 300 minus the 0.05 s pad
    expect(clips[1]!.start).toBeCloseTo(clipEnd(clips[0]!), 6);
    expect(clips[1]!.in).toBeLessThan(clips[0]!.in);
    // About 20 s + 25 s, never 10 minutes.
    expect(projectDuration(r.project)).toBeGreaterThan(44);
    expect(projectDuration(r.project)).toBeLessThan(46);
    expect(validProject(r.project)).toBe(true);
  });

  it('joins stretches that follow each other and moves later clips on the track', () => {
    const m2 = media({ id: 'm2', path: '/x/b.mp4', name: 'b.mp4', duration: 5 });
    let p = interview();
    p = { ...p, media: [...p.media, m2] };
    p = insertMedia(p, m2, { trackId: p.clips[0]!.trackId }).project; // at 600 s
    const r = ok(
      keepRanges(p, 'm1', [
        [0, 4],
        [5, 9],
      ]),
    );
    const mine = r.project.clips.filter((c) => c.mediaId === 'm1');
    expect(mine).toHaveLength(1);
    const after = r.project.clips.find((c) => c.mediaId === 'm2')!;
    expect(after.start).toBeCloseTo(clipEnd(mine[0]!), 3);
  });

  it('refuses without a transcript or with bad numbers', () => {
    const m = media();
    const bare = insertMedia({ ...newProject({ name: 'x' }), media: [m] }, m, { start: 0 }).project;
    expect(keepRanges(bare, '', [[0, 1]])).toHaveProperty('error');
    expect(keepRanges(interview(), '', [[0, 9999]])).toHaveProperty('error');
  });
});

describe('Fase 13B: the other edits', () => {
  it('removes fillers, adds titles, captions and changes the format', () => {
    let p = interview();
    const f = ok(pureEdit(p, 'video_remove_fillers', {}, 0));
    expect(projectDuration(f.project)).toBeLessThan(600);
    p = ok(keepRanges(f.project, '', [[20, 64]])).project;
    p = ok(pureEdit(p, 'video_set_format', { aspect: '9:16' }, 0)).project;
    expect(p.width).toBeLessThan(p.height);
    // A 16:9 shot fills the vertical frame (centre crop): 1920/1080 squared.
    const shot = p.clips.find((c) => !isText(c))!;
    expect(shot.transform?.scale).toBeCloseTo((1920 / 1080) ** 2, 1);
    const withTitle = ok(
      pureEdit(p, 'video_add_title', { text: 'Hola', start: 1, style: 'title' }, 0),
    );
    expect(withTitle.project.clips.some((c) => c.text?.content === 'Hola')).toBe(true);
    const cap = ok(pureEdit(withTitle.project, 'video_captions', { style: 'yellow' }, 0));
    const track = captionTrack(cap.project)!;
    expect(cap.project.clips.filter((c) => c.trackId === track.id).length).toBeGreaterThan(3);
    const change = describeChange(withTitle.project, cap.project);
    expect(change).toMatch(/pista Subtítulos con \d+ frases/);
    expect(describeChange(interview(), p)).toMatch(/duración 10:00.0 → 0:4\d/);
  });

  it('splits, trims, moves and deletes clips by id', () => {
    let p = interview();
    const id = p.clips[0]!.id;
    p = ok(pureEdit(p, 'video_split', { clip: id, at: 100 }, 0)).project;
    expect(p.clips).toHaveLength(2);
    p = ok(pureEdit(p, 'video_trim', { clip: id, end: 50 }, 0)).project;
    expect(clipEnd(p.clips.find((c) => c.id === id)!)).toBeCloseTo(50);
    const right = p.clips.find((c) => c.id !== id)!;
    expect(pureEdit(p, 'video_move', { clip: right.id, start: 10 }, 0)).toHaveProperty('error');
    p = ok(pureEdit(p, 'video_move', { clip: right.id, start: 60 }, 0)).project;
    p = ok(pureEdit(p, 'video_delete', { clips: [id] }, 0)).project;
    expect(p.clips).toHaveLength(1);
    expect(p.clips[0]!.start).toBeCloseTo(10); // ripple closed the 50 s gap
    expect(pureEdit(p, 'video_split', { clip: 'nope', at: 1 }, 0)).toHaveProperty('error');
  });
});

describe('Fase 13B: tools for the agent', () => {
  it('defines every tool once', () => {
    expect(VIDEO_TOOLS.map((t) => t.name).sort()).toEqual([...VIDEO_TOOL_LIST].sort());
    expect(VIDEO_TOOL_NAMES.size).toBe(VIDEO_TOOL_LIST.length);
  });

  it('reads need no approval; edits can be allowed for the chat; exports ask every time', async () => {
    const calls: string[] = [];
    const ui: VideoUi = {
      call: async (name, _a, dry) => {
        calls.push(`${name}:${dry}`);
        return name === 'video_split'
          ? { ok: false, content: 'No clip "x".', summary: '' }
          : { ok: true, content: 'hacer algo', summary: 'duración 1:00.0 → 0:45.0' };
      },
    };
    expect(await videoPreview(ui, 'video_state', {})).toBeNull();
    const edit = await videoPreview(ui, 'video_keep_ranges', { ranges: [[0, 1]] });
    expect(edit).toMatchObject({ allowKey: 'video:edit', action: 'hacer algo' });
    expect(edit && 'warning' in edit && edit.warning).toContain('Ctrl+Z');
    const exp = await videoPreview(ui, 'video_export', {});
    expect(exp).not.toHaveProperty('allowKey');
    expect(await videoPreview(ui, 'video_split', { clip: 'x' })).toEqual({ error: 'No clip "x".' });
    expect(await videoPreview(undefined, 'video_trim', {})).toHaveProperty('error');
    expect(calls).toEqual(['video_keep_ranges:true', 'video_export:true', 'video_split:true']);
  });
});
