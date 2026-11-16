import { describe, expect, it } from 'vitest';
import { VIDEO_TOOL_NAMES, videoPreview, type VideoUi } from '../src/main/videoTools.js';
import type { MediaItem, VideoProject } from '../src/shared/video.js';
import {
  defaultExport,
  insertMedia,
  newProject,
  validProject,
  visualAt,
} from '../src/shared/video.js';
import { addTransition, describeChange, describeTransitions } from '../src/shared/videoAgent.js';
import { validTransition } from '../src/shared/videoFx.js';
import { buildRender } from '../src/shared/videoRender.js';
import {
  COMMUNITY_DIR,
  COMMUNITY_REPO,
  customLook,
  customLookExpr,
  freeId,
  normalizeTransitionDef,
  parseTransitionFile,
  shareUrl,
  slugify,
  transitionFile,
  validTransitionDef,
  type TransitionDef,
} from '../src/shared/videoTransitions.js';

const ok = <T>(e: T | { error: string }): T => {
  if (e && typeof e === 'object' && 'error' in e) throw new Error((e as { error: string }).error);
  return e as T;
};

const spin = (): TransitionDef =>
  ok(
    normalizeTransitionDef({
      name: 'Zoom desde la derecha',
      channels: {
        alpha: [
          { t: 0, v: 0 },
          { t: 0.4, v: 1 },
        ],
        dx: [[0, 0.3]],
        scale: [
          { t: 0, v: 1.6 },
          { t: 0.7, v: 0.95 },
        ],
      },
    }),
  );

/** Evaluates one of our FFmpeg expressions (numbers, k, clip, if, lt) in JS. */
function evalExpr(expr: string, k: number): number {
  const js = expr.replace(/\bif\(/g, 'iff(');
  const f = new Function('k', 'clip', 'iff', 'lt', `return ${js.replace(/\bK\b/g, 'k')};`) as (
    k: number,
    clip: (x: number, a: number, b: number) => number,
    iff: (c: number, a: number, b: number) => number,
    lt: (a: number, b: number) => number,
  ) => number;
  return f(
    k,
    (x, a, b) => Math.min(b, Math.max(a, x)),
    (c, a, b) => (c ? a : b),
    (a, b) => (a < b ? 1 : 0),
  );
}

describe('custom transitions: the data format', () => {
  it('normalizes: sorted keys, clamped values, start added, end forced in place', () => {
    const d = ok(
      normalizeTransitionDef({
        name: '  Giro <b>loco</b>  ',
        extra: 'dropped',
        channels: {
          scale: [
            { t: 0.8, v: 9 },
            { t: 0.2, v: 0.5 },
          ],
          alpha: [{ t: 0, v: 1 }],
        },
      }),
    );
    expect(d.name).toBe('Giro bloco/b');
    expect(d.id).toBe('giro-bloco-b');
    expect(d.ease).toBe('smooth');
    expect('extra' in d).toBe(false);
    // alpha never leaves 1: does nothing, dropped.
    expect(d.channels.alpha).toBeUndefined();
    expect(d.channels.scale).toEqual([
      { t: 0, v: 0.5 },
      { t: 0.2, v: 0.5 },
      { t: 0.8, v: 3 },
      { t: 1, v: 1 },
    ]);
    expect(validTransitionDef(d)).toBe(true);
    expect(validTransitionDef({ ...d, channels: { scale: [{ t: 0, v: 2 }] } })).toBe(false);
  });

  it('refuses what is not a transition', () => {
    expect(normalizeTransitionDef(null)).toHaveProperty('error');
    expect(normalizeTransitionDef({ name: 'x' })).toHaveProperty('error');
    expect(normalizeTransitionDef({ name: 'x', channels: { rotate: [] } })).toHaveProperty('error');
    expect(
      normalizeTransitionDef({ name: 'x', channels: { alpha: [{ t: 0, v: 'a' }] } }),
    ).toHaveProperty('error');
    expect(
      normalizeTransitionDef({ name: 'x', channels: { alpha: [{ t: 0, v: 1 }] } }),
    ).toHaveProperty('error');
    const many = Array.from({ length: 20 }, (_, i) => ({ t: i / 20, v: 0.5 }));
    expect(normalizeTransitionDef({ name: 'x', channels: { alpha: many } })).toHaveProperty(
      'error',
    );
    expect(parseTransitionFile('{nope')).toHaveProperty('error');
    expect(parseTransitionFile('{"name":"x","channels":{"alpha":[[0,0]]}}')).toHaveProperty(
      'error',
    );
    expect(parseTransitionFile('x'.repeat(20_000))).toHaveProperty('error');
  });

  it('round-trips through the file', () => {
    const d = spin();
    expect(parseTransitionFile(transitionFile(d))).toEqual(d);
    expect(transitionFile(d).endsWith('}\n')).toBe(true);
  });

  it('slugs and free ids', () => {
    expect(slugify('Transición Ñandú ¡Ya!')).toBe('transicion-nandu-ya');
    expect(slugify('***')).toBe('transicion');
    expect(freeId('a', new Set(['a', 'a-2']))).toBe('a-3');
  });
});

describe('custom transitions: preview and export agree', () => {
  it('starts where the keys say and ends with the clip in place', () => {
    const d = spin();
    expect(customLook(d, 0)).toEqual({ alpha: 0, dx: 0.3, dy: 0, scale: 1.6, reveal: 1 });
    expect(customLook(d, 1)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1, reveal: 1 });
  });

  it('the FFmpeg expressions give the same numbers as the preview', () => {
    for (const d of [spin(), { ...spin(), ease: 'linear' as const }]) {
      const ex = customLookExpr(d, 'K');
      for (let i = 0; i <= 40; i++) {
        const k = i / 40;
        const l = customLook(d, k);
        expect(evalExpr(ex.alpha!, k)).toBeCloseTo(l.alpha, 5);
        expect(evalExpr(ex.dx!, k)).toBeCloseTo(l.dx, 5);
        expect(evalExpr(ex.scale!, k)).toBeCloseTo(l.scale, 5);
      }
      expect(ex.dy).toBeUndefined();
      // Only numbers and our operators reach FFmpeg.
      expect(Object.values(ex).join('')).toMatch(/^[-0-9.K+*/(),a-z]*$/);
    }
  });
});

const media = (id: string): MediaItem => ({
  id,
  path: `/x/${id}.mp4`,
  name: `${id}.mp4`,
  kind: 'video',
  duration: 5,
  width: 1920,
  height: 1080,
  fps: 30,
  hasVideo: true,
  hasAudio: false,
  size: 1,
});

/** Two shots back to back on V1. */
function twoShots(): VideoProject {
  const a = media('a');
  const b = media('b');
  let p: VideoProject = { ...newProject({ name: 'T' }), media: [a, b] };
  p = insertMedia(p, a, { start: 0 }).project;
  p = insertMedia(p, b, { start: 5 }).project;
  return p;
}

describe('custom transitions on the timeline', () => {
  it('the agent invents one, puts it on the cut, and the project stays valid', () => {
    const p = twoShots();
    const e = ok(
      addTransition(
        p,
        {
          custom: {
            name: 'Zoom desde la derecha',
            channels: { alpha: [{ t: 0, v: 0 }], scale: [{ t: 0, v: 1.6 }] },
          },
          duration: 1,
        },
        [],
      ),
    );
    expect(e.isNew).toBe(true);
    expect(e.def!.id).toBe('zoom-desde-la-derecha');
    const second = e.project.clips.find((c) => c.start === 5)!;
    expect(second.transition).toEqual({ kind: 'custom', d: 1, def: e.def });
    expect(e.project.clips.find((c) => c.start === 0)!.transition).toBeUndefined();
    expect(validProject(e.project)).toBe(true);
    expect(describeChange(p, e.project)).toContain('1 transición(es)');
    // Halfway through, the incoming clip is coming in.
    const mid = visualAt(e.project, second, 5)!;
    expect(mid.alpha).toBeGreaterThan(0);
    expect(mid.alpha).toBeLessThan(1);
    expect(mid.scale).toBeGreaterThan(1);
    // The export uses the same curves and scales up to the largest size first.
    const f = buildRender(e.project, defaultExport(e.project), '/out.mp4').filter;
    expect(f).toContain('1.6');
  });

  it('reuses a saved one by id, renames a different one with a taken id, removes', () => {
    const p = twoShots();
    const lib = [spin()];
    const used = ok(addTransition(p, { transition_id: lib[0]!.id }, lib));
    expect(used.isNew).toBeUndefined();
    expect(used.project.clips.some((c) => c.transition?.def?.id === lib[0]!.id)).toBe(true);
    const clash = ok(
      addTransition(
        p,
        { custom: { name: 'Zoom desde la derecha', channels: { dy: [{ t: 0, v: 1 }] } } },
        lib,
      ),
    );
    expect(clash.def!.id).toBe('zoom-desde-la-derecha-2');
    const off = ok(addTransition(used.project, { remove: true }, lib));
    expect(off.project.clips.every((c) => !c.transition)).toBe(true);
  });

  it('explains what is wrong to the model', () => {
    const p = twoShots();
    expect(addTransition(p, { kind: 'explode' }, [])).toHaveProperty('error');
    expect(addTransition(p, { transition_id: 'nope' }, [])).toHaveProperty('error');
    expect(addTransition(p, { clips: ['zzz'] }, [])).toHaveProperty('error');
    expect(addTransition(p, { custom: { name: 'x', channels: {} } }, [])).toHaveProperty('error');
    expect(describeTransitions([spin()])).toContain('zoom-desde-la-derecha');
  });

  it('a project with a broken custom transition does not load', () => {
    expect(validTransition({ kind: 'custom', d: 1 })).toBe(false);
    expect(validTransition({ kind: 'custom', d: 1, def: { ...spin(), name: '' } })).toBe(false);
    expect(validTransition({ kind: 'dissolve', d: 1, def: spin() })).toBe(false);
    expect(validTransition({ kind: 'custom', d: 1, def: spin() })).toBe(true);
  });
});

describe('sharing on GitHub', () => {
  it('opens the new-file page of the repository with the file filled in', () => {
    const d = spin();
    const u = new URL(shareUrl(d));
    expect(u.origin).toBe('https://github.com');
    expect(u.pathname).toBe(`/${COMMUNITY_REPO}/new/main/${COMMUNITY_DIR}`);
    expect(u.searchParams.get('filename')).toBe(`${d.id}.json`);
    expect(parseTransitionFile(u.searchParams.get('value')!)).toEqual(d);
  });

  it('the tools exist and sharing is approved every time', async () => {
    for (const n of ['video_transitions', 'video_add_transition', 'video_share_transition'])
      expect(VIDEO_TOOL_NAMES.has(n)).toBe(true);
    const ui: VideoUi = {
      call: async () => ({ ok: true, content: 'proponer', summary: 'Se abre GitHub' }),
    };
    expect(await videoPreview(ui, 'video_transitions', {})).toBeNull();
    const share = await videoPreview(ui, 'video_share_transition', { transition_id: 'x' });
    expect(share && 'allowKey' in share && share.allowKey).toBeFalsy();
    const add = await videoPreview(ui, 'video_add_transition', {});
    expect(add && 'allowKey' in add && add.allowKey).toBe('video:edit');
  });
});
