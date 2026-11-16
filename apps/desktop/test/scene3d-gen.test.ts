import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  EASES_3D,
  bakeKeys,
  bakeScene,
  easeAt,
  easeK,
  fromTemplate,
  interpKeys,
  sanitizeScene,
  withEaseAt,
  withKey,
  type Keyframe,
} from '../src/shared/scene3d.js';
import { toBpy } from '../src/shared/scene3dBpy.js';
import {
  gen3dFileName,
  gen3dIssue,
  genInput,
  logPercent,
  missingInputs,
  modelUrlOf,
} from '../src/shared/gen3d.js';
import { Gen3DService } from '../src/main/gen3d.js';
import { gen3dRequestOf, scene3dPreview, SCENE3D_TOOLS } from '../src/main/scene3dTools.js';
import { alwaysAsks, decide } from '../src/shared/approvalPolicy.js';

const tmp = mkdtempSync(join(tmpdir(), 'z3dgen-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('Fase 14: animation curves', () => {
  it('every curve starts at 0 and ends at 1', () => {
    for (const e of EASES_3D) {
      if (e === 'hold') continue;
      expect(easeK(e, 0)).toBeCloseTo(0, 6);
      expect(easeK(e, 1)).toBeCloseTo(1, 6);
    }
  });

  it('shapes: in is slow first, out fast first, back overshoots, bounce never passes 1', () => {
    expect(easeK('in', 0.5)).toBeCloseTo(0.125, 6);
    expect(easeK('out', 0.5)).toBeCloseTo(0.875, 6);
    const back = Array.from({ length: 101 }, (_, i) => easeK('back', i / 100));
    expect(Math.max(...back)).toBeGreaterThan(1.05);
    const bounce = Array.from({ length: 101 }, (_, i) => easeK('bounce', i / 100));
    expect(Math.max(...bounce)).toBeLessThanOrEqual(1 + 1e-9);
    const elastic = Array.from({ length: 101 }, (_, i) => easeK('elastic', i / 100));
    expect(Math.max(...elastic)).toBeGreaterThan(1);
  });

  it('interpolates with the curve of the first key of the segment', () => {
    const keys: Keyframe[] = [
      { t: 0, v: 0, ease: 'in' },
      { t: 2, v: 100 },
    ];
    expect(interpKeys(keys, 1)).toBeCloseTo(12.5, 6);
    expect(
      interpKeys(
        [
          { t: 0, v: 5, ease: 'hold' },
          { t: 1, v: 9 },
        ],
        0.99,
      ),
    ).toBe(5);
  });

  it('bakes curves into per-frame linear keys that land exactly on every frame', () => {
    const keys: Keyframe[] = [
      { t: 0, v: 0, ease: 'bounce' },
      { t: 1, v: 10 },
      { t: 2, v: 20, ease: 'hold' },
      { t: 3, v: 0 },
    ];
    const fps = 24;
    const baked = bakeKeys(keys, fps);
    expect(baked.every((k) => !k.ease || k.ease === 'hold')).toBe(true);
    // Linear evaluation of the baked keys equals the curve on each frame.
    for (let f = 0; f <= 3 * fps; f++) {
      const t = f / fps;
      expect(interpKeys(baked, t)).toBeCloseTo(interpKeys(keys, t), 3);
    }
    // The linear and hold segments are not sampled.
    expect(baked.filter((k) => k.t > 1 && k.t < 3)).toEqual([{ t: 2, v: 20, ease: 'hold' }]);
  });

  it('Blender receives baked keys only (no curve it would draw differently)', () => {
    const s = fromTemplate('logo', { duration: 2 });
    const logo = s.nodes.find((n) => n.shape === 'text')!;
    logo.keys = {
      ry: [
        { t: 0, v: 0, ease: 'back' },
        { t: 2, v: 360 },
      ],
    };
    const py = toBpy(s, { framesDir: 'C:\\f', engine: 'eevee' });
    const b64 = /b64decode\("([A-Za-z0-9+/=]+)"\)/.exec(py)![1]!;
    const sent = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')).scene;
    const ry = sent.nodes.find((n: { shape?: string }) => n.shape === 'text').keys.ry;
    expect(ry.length).toBe(2 * s.fps + 1);
    expect(ry.some((k: Keyframe) => k.ease)).toBe(false);
    expect(Math.max(...ry.map((k: Keyframe) => k.v))).toBeGreaterThan(360);
    expect(bakeScene(s).nodes.length).toBe(s.nodes.length);
  });

  it('sanitize keeps known curves and drops unknown ones', () => {
    const s = sanitizeScene({
      nodes: [
        {
          kind: 'mesh',
          shape: 'box',
          keys: {
            px: [
              { t: 0, v: 0, ease: 'bounce' },
              { t: 1, v: 1, ease: 'wobble' },
            ],
          },
        },
      ],
    });
    expect(s.nodes[0]!.keys!.px).toEqual([
      { t: 0, v: 0, ease: 'bounce' },
      { t: 1, v: 1 },
    ]);
  });

  it('re-keying keeps the curve; the curve picker sets every key at the playhead', () => {
    let k = withKey<'px' | 'py'>(undefined, 'px', 0, 0, 30, 'out');
    k = withKey(k, 'px', 0, 5, 30);
    expect(k.px).toEqual([{ t: 0, v: 5, ease: 'out' }]);
    k = withKey(k, 'py', 0, 1, 30);
    expect(easeAt(k, 0, 30)).toBe('mixed');
    const all = withEaseAt(k, 0, 30, 'elastic')!;
    expect(easeAt(all, 0, 30)).toBe('elastic');
    expect(easeAt(withEaseAt(all, 0, 30, 'linear'), 0, 30)).toBe('linear');
    expect(easeAt(all, 1, 30)).toBeNull();
  });
});

describe('Fase 14: 3D generation (pure)', () => {
  it('checks the request', () => {
    expect(gen3dIssue({ model: 'x/y', prompt: 'a' })).toMatch(/no es un modelo/);
    expect(gen3dIssue({ model: 'firtoz/trellis', prompt: 'taza' })).toMatch(/necesita una imagen/);
    expect(gen3dIssue({ model: 'tencent/hunyuan-3d-3.1' })).toMatch(/descripción o elige/);
    expect(gen3dIssue({ model: 'tencent/hunyuan-3d-3.1', prompt: 'taza' })).toBeNull();
    expect(gen3dIssue({ model: 'tencent/hunyuan-3d-3.1', image: 'C:\\a\\b.gif' })).toMatch(/PNG/);
    expect(gen3dIssue({ model: 'firtoz/trellis', image: 'C:\\a\\b.png' })).toBeNull();
  });

  it('builds the input from the model schema', () => {
    const trellis = {
      images: { type: 'array', items: { type: 'string' } },
      seed: { type: 'integer' },
      generate_model: { type: 'boolean', default: false },
      generate_color: { type: 'boolean', default: true },
      save_gaussian_ply: { type: 'boolean' },
    };
    expect(genInput(trellis, { prompt: 'taza', imageDataUrl: 'data:x', seed: 7.2 })).toEqual({
      images: ['data:x'],
      seed: 7,
      generate_model: true,
      generate_color: false,
      save_gaussian_ply: false,
    });
    expect(missingInputs(trellis, { prompt: 'taza', imageDataUrl: 'data:x' })).toEqual([
      'descripción',
    ]);
    const rodin = {
      prompt: { type: 'string' },
      images: { type: 'array' },
      geometry_file_format: { enum: ['GLB', 'USDZ', 'FBX', 'OBJ', 'STL'] },
    };
    expect(genInput(rodin, { prompt: ' una taza ' })).toEqual({
      prompt: 'una taza',
      geometry_file_format: 'GLB',
    });
    // A format field without GLB is left to the model's default.
    expect(genInput({ prompt: {}, format: { enum: ['obj'] } }, { prompt: 'a' })).toEqual({
      prompt: 'a',
    });
    // No schema: the two common fields.
    expect(genInput(undefined, { prompt: 'a', imageDataUrl: 'data:y' })).toEqual({
      prompt: 'a',
      image: 'data:y',
    });
  });

  it('finds the model file in any output shape, GLB first', () => {
    expect(
      modelUrlOf({
        color_video: 'https://replicate.delivery/a/out.mp4',
        model_file: 'https://replicate.delivery/a/model.glb',
        gaussian_ply: 'https://replicate.delivery/a/p.ply',
      }),
    ).toEqual({ url: 'https://replicate.delivery/a/model.glb', ext: 'glb' });
    expect(modelUrlOf(['https://x.io/m.obj', 'https://x.io/m.glb?sig=1'])).toEqual({
      url: 'https://x.io/m.glb?sig=1',
      ext: 'glb',
    });
    expect(modelUrlOf('https://x.io/m.FBX')).toEqual({ url: 'https://x.io/m.FBX', ext: 'fbx' });
    expect(modelUrlOf('http://x.io/m.glb')).toBeNull();
    expect(modelUrlOf({ a: 'https://x.io/v.mp4' })).toBeNull();
    expect(modelUrlOf(null)).toBeNull();
  });

  it('file names, progress from logs', () => {
    const at = new Date(2026, 10, 15, 18, 30, 5);
    expect(gen3dFileName('Taza roja con asa!', 'glb', at)).toBe(
      'taza-roja-con-asa-20261115-183005.glb',
    );
    expect(gen3dFileName(undefined, 'obj', at)).toBe('modelo-3d-20261115-183005.obj');
    expect(logPercent('a\n 12%|██  | 3/25\n 48%|████ | 12/25')).toBe(48);
    expect(logPercent('nothing')).toBeUndefined();
  });
});

describe('Fase 14: 3D generation against a fake Replicate', () => {
  const GLB = Buffer.from('glTF\u0002\u0000\u0000\u0000fake-model');

  async function fakeReplicate(o: { fail?: boolean } = {}) {
    const seen: { method: string; url: string; body: unknown; auth?: string }[] = [];
    let polls = 0;
    const server: Server = createServer(async (req: IncomingMessage, res) => {
      let raw = '';
      for await (const c of req) raw += c;
      const url = req.url ?? '';
      seen.push({
        method: req.method ?? '',
        url,
        body: raw ? JSON.parse(raw) : undefined,
        auth: req.headers.authorization,
      });
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const send = (code: number, v: unknown) => {
        res.writeHead(code, { 'content-type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (url === '/models/firtoz/trellis')
        return send(200, {
          latest_version: {
            id: 'v123',
            openapi_schema: {
              components: {
                schemas: {
                  Input: {
                    properties: {
                      images: { type: 'array' },
                      generate_model: { type: 'boolean' },
                    },
                  },
                },
              },
            },
          },
        });
      if (url === '/predictions' && req.method === 'POST')
        return send(201, {
          id: 'p1',
          status: 'starting',
          urls: { get: `${base}/predictions/p1`, cancel: `${base}/predictions/p1/cancel` },
        });
      if (url === '/predictions/p1') {
        polls++;
        if (polls < 2) return send(200, { status: 'processing', logs: ' 40%|████' });
        if (o.fail) return send(200, { status: 'failed', error: 'CUDA out of memory' });
        return send(200, {
          status: 'succeeded',
          output: { model_file: `${base}/files/model.glb`.replace('http://', 'https://') },
        });
      }
      if (url === '/files/model.glb') {
        res.writeHead(200, { 'content-type': 'model/gltf-binary' });
        return res.end(GLB);
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return { server, seen, base };
  }

  function service(base: string) {
    const core = {
      connectedProviders: async () => [{ id: 'replicate', store: 'vault' }],
      providerConfig: async () => ({
        entry: { id: 'replicate', auth: { type: 'bearer', header: 'Authorization' } },
        baseUrl: base,
        maxRetries: 0,
        // https:// output URLs of the fake are served by the same plain-HTTP server.
        fetch: (u: string | URL, init?: RequestInit) =>
          fetch(String(u).replace('https://', 'http://'), init),
      }),
    };
    return new Gen3DService(core as never, tmp);
  }

  it('reads the schema, sends the picture, polls, and saves the GLB in media/3d', async () => {
    const { server, seen, base } = await fakeReplicate();
    const img = join(tmp, 'mug.png');
    writeFileSync(img, Buffer.from([137, 80, 78, 71]));
    const ws = join(tmp, 'proj');
    const events: string[] = [];
    try {
      const svc = service(base);
      // The download host equals the API host here, so it goes through the provider fetch.
      const r = await svc.generate('g1', { model: 'firtoz/trellis', image: img }, ws, (e) =>
        events.push(e.type === 'progress' ? `${e.stage}${e.percent ?? ''}` : e.type),
      );
      expect(r.path.startsWith(join(ws, 'media', '3d'))).toBe(true);
      expect(r.path.endsWith('.glb')).toBe(true);
      expect(readFileSync(r.path).equals(GLB)).toBe(true);
      const post = seen.find((s) => s.method === 'POST')!;
      expect(post.body).toEqual({
        version: 'v123',
        input: { images: ['data:image/png;base64,iVBORw=='], generate_model: true },
      });
      expect(events).toContain('waiting40');
      expect(events.at(-1)).toBe('done');
    } finally {
      server.close();
    }
  });

  it('reports a failed prediction in words', async () => {
    const { server, base } = await fakeReplicate({ fail: true });
    try {
      await expect(
        service(base).generate('g2', { model: 'firtoz/trellis', image: join(tmp, 'mug.png') }, tmp),
      ).rejects.toThrow('CUDA out of memory');
    } finally {
      server.close();
    }
  });

  it('refuses without Replicate connected, before sending anything', async () => {
    const svc = new Gen3DService({ connectedProviders: async () => [] } as never, tmp);
    await expect(
      svc.generate('g3', { model: 'tencent/hunyuan-3d-3.1', prompt: 'a' }, tmp),
    ).rejects.toThrow(/Replicate no está conectado/);
  });
});

describe('Fase 14: generate_3d_model tool', () => {
  it('is declared, always asks and says the cost is unknown', () => {
    expect(SCENE3D_TOOLS.some((t) => t.name === 'generate_3d_model')).toBe(true);
    expect(alwaysAsks('generate_3d_model', {})).toBe(true);
    expect(decide('full', 'generate_3d_model', { prompt: 'a' })).not.toBe('auto');
    const p = scene3dPreview('generate_3d_model', { prompt: 'taza roja' })!;
    expect(p.warning).toMatch(/no se estima/);
    expect(p.command).toBe('taza roja');
    expect(gen3dRequestOf({ model: 'nope', prompt: 'a', seed: 3.6 })).toEqual({
      model: 'tencent/hunyuan-3d-3.1',
      prompt: 'a',
      seed: 4,
    });
  });
});
