import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { alphaOf, findFfmpeg, parseProbe, VideoService } from '../src/main/video.js';
import {
  blenderCandidates,
  parseBlenderVersion,
  Scene3DService,
  versionOk,
} from '../src/main/scene3d.js';
import {
  cameraAt,
  describeScene,
  duplicateNode,
  encodeArgs,
  formatFor,
  frameCount,
  fromTemplate,
  keyAllAt,
  keyTimes,
  makeMesh,
  newScene,
  poseAt,
  sanitizeScene,
  setCameraProp,
  setNodeProp,
  straightTopDown,
  withKey,
  withoutKey,
} from '../src/shared/scene3d.js';
import { BPY_PROGRAM, blenderProgress, toBpy } from '../src/shared/scene3dBpy.js';
import { decide } from '../src/shared/approvalPolicy.js';
import { sceneOf, scene3dPreview } from '../src/main/scene3dTools.js';
import {
  addTrack,
  defaultExport,
  insertMedia,
  newProject,
  type VideoProject,
} from '../src/shared/video.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const tools = findFfmpeg(appRoot);
const dir = mkdtempSync(join(tmpdir(), 'z3d-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('Fase 14: scene model', () => {
  it('the logo template turns once, linearly, over its duration', () => {
    const s = fromTemplate('logo', { text: 'Hola', duration: 4 });
    const logo = s.nodes.find((n) => n.shape === 'text')!;
    expect(logo.text).toBe('Hola');
    expect(s.transparent).toBe(true);
    expect(poseAt(logo, 0).rotation[1]).toBe(0);
    expect(poseAt(logo, 2).rotation[1]).toBeCloseTo(180);
    expect(poseAt(logo, 4).rotation[1]).toBeCloseTo(360);
    expect(frameCount(s)).toBe(120);
    expect(formatFor(s)).toBe('webm');
    expect(formatFor({ ...s, transparent: false }, 'mp4')).toBe('mp4');
  });

  it('the orbit template circles the camera around the subject', () => {
    const s = fromTemplate('orbit', { duration: 8, shape: 'torus' });
    const quarter = cameraAt(s.camera, 2);
    expect(quarter.position[0]).toBeCloseTo(6, 3);
    expect(quarter.position[2]).toBeCloseTo(0, 3);
    expect(cameraAt(s.camera, 8).position[2]).toBeCloseTo(6, 3);
    expect(s.nodes.some((n) => n.shape === 'torus')).toBe(true);
  });

  it('keys replace within half a frame, sort, and disappear when emptied', () => {
    let k = withKey(undefined, 'px', 1, 2, 30);
    k = withKey(k, 'px', 0, 0, 30);
    k = withKey(k, 'px', 1.01, 5, 30, 'ease');
    expect(k.px).toEqual([
      { t: 0, v: 0 },
      { t: 1.01, v: 5, ease: 'ease' },
    ]);
    expect(withoutKey(withoutKey(k, 'px', 0, 30), 'px', 1, 30)).toBeUndefined();
  });

  it('keying the transform records the pose at that time', () => {
    const n = {
      ...makeMesh('box'),
      keys: {
        px: [
          { t: 0, v: 0 },
          { t: 2, v: 4 },
        ],
      },
    };
    const k = keyAllAt(n, ['px', 'py'], 1, 30);
    expect(k.keys?.px?.map((x) => x.v)).toEqual([0, 2, 4]);
    expect(k.keys?.py).toEqual([{ t: 1, v: 0 }]);
    expect(keyTimes({ ...newScene(), nodes: [k] })).toEqual([0, 1, 2]);
  });

  it('editing an animated property keys it at the playhead; a still one just changes', () => {
    const still = setNodeProp(makeMesh('box'), 'px', 3, 1, 30);
    expect(still.position[0]).toBe(3);
    expect(still.keys).toBeUndefined();
    const anim = setNodeProp(
      { ...makeMesh('box'), keys: { px: [{ t: 0, v: 0 }] } },
      'px',
      3,
      1,
      30,
    );
    expect(anim.position[0]).toBe(0);
    expect(anim.keys?.px).toEqual([
      { t: 0, v: 0 },
      { t: 1, v: 3 },
    ]);
    const cam = setCameraProp(newScene().camera, 'ty', 2, 0, 30);
    expect(cam.target).toEqual([0, 2, 0]);
  });

  it('duplicates a node with a fresh id, next to the original', () => {
    const s = newScene();
    const box = s.nodes.find((n) => n.shape === 'box')!;
    const r = duplicateNode(s, box.id);
    expect(r.scene.nodes).toHaveLength(s.nodes.length + 1);
    expect(r.id).not.toBe(box.id);
    expect(r.scene.nodes.find((n) => n.id === r.id)!.position[0]).toBe(0.5);
  });

  it('sanitize clamps numbers, keeps sizes even within 4K and drops what it cannot trust', () => {
    const s = sanitizeScene({
      width: 99999,
      height: 3001,
      fps: 500,
      duration: -3,
      transparent: false,
      background: 'red',
      camera: { position: [0, 'x', 1e9], fov: 1 },
      nodes: [
        {
          kind: 'mesh',
          shape: 'text',
          text: 'a\u0000b'.repeat(40),
          id: 'dup',
          material: { color: '#FF0000', metalness: 7 },
        },
        { kind: 'mesh', shape: 'blob', id: 'dup' },
        { kind: 'model', model: 'relative/file.glb' },
        { kind: 'model', model: 'C:\\m\\robot.exe' },
        { kind: 'model', model: 'C:\\m\\robot.GLB' },
        { kind: 'light', light: { type: 'laser', intensity: -5 } },
        { kind: 'script', code: 'import os' },
        {
          kind: 'mesh',
          keys: {
            px: [
              { t: 99, v: 1 },
              { t: 'x', v: 2 },
              { t: 0, v: Infinity },
            ],
            evil: [{ t: 0, v: 1 }],
          },
        },
      ],
    });
    expect(s.width * s.height).toBeLessThanOrEqual(3840 * 2160);
    expect(s.width % 2).toBe(0);
    expect(s.height % 2).toBe(0);
    expect(s.fps).toBe(60);
    expect(s.duration).toBe(0.5);
    expect(s.background).toBe('#101318');
    expect(s.camera.position).toEqual([0, 1.2, 1000]);
    expect(s.camera.fov).toBe(10);
    expect(s.nodes.map((n) => n.kind)).toEqual(['mesh', 'mesh', 'model', 'light', 'mesh']);
    const [text, blob, model, light, keyed] = s.nodes;
    expect([...text!.text!].length).toBe(60);
    expect(text!.text).not.toContain('\u0000');
    expect(text!.material!.color).toBe('#ff0000');
    expect(text!.material!.metalness).toBe(1);
    expect(blob!.shape).toBe('box');
    expect(blob!.id).not.toBe(text!.id);
    expect(model!.model).toBe('C:\\m\\robot.GLB');
    expect(light!.light).toEqual({ type: 'point', color: '#ffffff', intensity: 0 });
    expect(keyed!.keys).toEqual({ px: [{ t: 0.5, v: 1 }] });
    expect(() => sanitizeScene('scene')).toThrow();
    expect(() => sanitizeScene([])).toThrow();
    // A valid scene survives unchanged.
    const ok = fromTemplate('logo');
    expect(sanitizeScene(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
  });

  it('describes a scene in words for the approval card', () => {
    const d = describeScene(fromTemplate('logo', { text: 'ACME' }));
    expect(d).toContain('fondo transparente');
    expect(d).toContain('texto "ACME"');
    expect(d).toContain('1 con animación');
  });

  it('flips WebGL pixels to top-down and un-premultiplies the alpha', () => {
    // 1×2: bottom row (first in memory) half-covered red, top row clear.
    const src = new Uint8Array([128, 0, 0, 128, 0, 0, 0, 0]);
    const out = straightTopDown(src, 1, 2, new Uint8Array(8));
    expect([...out]).toEqual([0, 0, 0, 0, 255, 0, 0, 128]);
  });

  it('encodes transparent renders as VP9 with alpha, opaque ones as H.264', () => {
    const webm = encodeArgs({ width: 64, height: 32, fps: 30, format: 'webm', out: 'o.webm' });
    expect(webm.join(' ')).toContain('-pix_fmt rgba -s 64x32');
    expect(webm.join(' ')).toContain('libvpx-vp9 -pix_fmt yuva420p');
    const mp4 = encodeArgs({
      width: 64,
      height: 32,
      fps: 30,
      format: 'mp4',
      out: 'o.mp4',
      pngInput: 'f_%04d.png',
    });
    expect(mp4).toContain('libx264');
    expect(mp4).not.toContain('rawvideo');
  });
});

describe('Fase 14: Blender bridge', () => {
  it('puts the scene in as base64 data, never as code', () => {
    const s = fromTemplate('logo', { text: `"""); import os; os.system('x') #` });
    const py = toBpy(s, { framesDir: 'C:\\tmp\\frames', engine: 'eevee' });
    expect(py.startsWith(BPY_PROGRAM)).toBe(true);
    const tail = py.slice(BPY_PROGRAM.length);
    expect(tail).not.toContain('os.system');
    const b64 = /b64decode\("([A-Za-z0-9+/=]+)"\)/.exec(tail)![1]!;
    const back = JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
    expect(back.scene).toEqual(s);
    expect(back.engine).toBe('eevee');
  });

  it('the fixed program does not run other programs or evaluate strings', () => {
    for (const bad of [
      'subprocess',
      'os.system',
      'eval(',
      'exec(',
      'urllib',
      'socket',
      '__import__',
    ])
      expect(BPY_PROGRAM, bad).not.toContain(bad);
    expect(BPY_PROGRAM).toContain('film_transparent');
    expect(BPY_PROGRAM).toContain('keyframe_new_interpolation_type');
  });

  it('reads the version and the frame progress from Blender', () => {
    expect(parseBlenderVersion('Blender 4.2.3 LTS\n\tbuild date: …')).toBe('4.2.3');
    expect(parseBlenderVersion('blender')).toBeNull();
    expect(versionOk('3.6.5')).toBe(true);
    expect(versionOk('3.5')).toBe(false);
    expect(versionOk('5.0')).toBe(true);
    expect(blenderProgress('Fra:61 Mem:120M | Rendering', 120)).toBeCloseTo(0.5);
    expect(blenderProgress('Saved: f_0001.png', 120)).toBeNull();
  });

  it('looks for Blender in the usual places, the variable first', () => {
    const c = blenderCandidates(
      { ZINARIX_BLENDER: 'D:\\b\\blender.exe', PATH: 'C:\\bin' },
      'win32',
    );
    expect(c[0]).toBe('D:\\b\\blender.exe');
    expect(c).toContain(join('C:\\bin', 'blender.exe'));
    // Our own Zinarix 3D build wins over any other Blender on the PC.
    const own = blenderCandidates({ LOCALAPPDATA: 'C:\\L', PATH: 'C:\\bin' }, 'win32');
    expect(own[0]).toBe(join('C:\\L', 'Programs', 'Zinarix Studio 3D', 'blender.exe'));
    expect(blenderCandidates({}, 'darwin')).toContain(
      '/Applications/Blender.app/Contents/MacOS/Blender',
    );
  });
});

describe('Fase 14: agent tools', () => {
  it('a Blender script asks every time, even in auto mode', () => {
    expect(decide('auto', 'blender_script', { script: 'print(1)' })).toBe('ask');
    expect(scene3dPreview('blender_script', { script: 'import bpy' })).toMatchObject({
      risk: 'high',
      command: 'import bpy',
    });
  });

  it('render_3d builds the template scene, clamped like any scene', () => {
    const s = sceneOf({ template: 'logo', text: 'ACME', width: 5000, height: 999, duration: 4 });
    expect(s.nodes.find((n) => n.shape === 'text')?.text).toBe('ACME');
    expect(s.width).toBe(3840);
    expect(s.height % 2).toBe(0);
    expect(sceneOf({ scene: { nodes: [{ kind: 'mesh', shape: 'torus' }] } }).nodes[0]!.shape).toBe(
      'torus',
    );
    expect(scene3dPreview('render_3d', { template: 'logo' }).action).toContain('Zinarix (rápido)');
  });
});

describe('Fase 14: alpha in the video model', () => {
  it('knows which streams carry transparency', () => {
    expect(alphaOf({ codec_type: 'video', codec_name: 'vp9', tags: { ALPHA_MODE: '1' } })).toBe(
      'vp9',
    );
    expect(alphaOf({ codec_type: 'video', codec_name: 'vp9', pix_fmt: 'yuv420p' })).toBeUndefined();
    expect(alphaOf({ codec_type: 'video', codec_name: 'prores', pix_fmt: 'yuva444p10le' })).toBe(
      'native',
    );
    expect(
      alphaOf({ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p' }),
    ).toBeUndefined();
    const m = parseProbe(
      'C:\\a\\logo.webm',
      {
        streams: [
          {
            codec_type: 'video',
            codec_name: 'vp9',
            width: 64,
            height: 64,
            tags: { alpha_mode: '1' },
          },
        ],
      },
      10,
    );
    expect(m.alpha).toBe('vp9');
  });
});

const sh = (args: string[]) => {
  const r = spawnSync(tools.ffmpeg!, ['-hide_banner', '-v', 'error', ...args], {
    maxBuffer: 64 << 20,
  });
  expect(r.status, r.stderr?.toString()).toBe(0);
  return r.stdout as Buffer;
};

/** W×H RGBA: left half opaque orange, right half fully transparent. */
function halfFrame(W: number, H: number): Uint8Array {
  const f = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W / 2; x++) f.set([255, 128, 0, 255], (y * W + x) * 4);
  return f;
}

describe.skipIf(!tools.ffmpeg || !tools.ffprobe)('Fase 14 with FFmpeg', () => {
  const W = 64;
  const H = 48;

  it('viewer frames become a WebM with a real alpha channel', async () => {
    const svc = new Scene3DService(dir, () => tools.ffmpeg);
    const { id, path } = svc.begin(
      { width: W, height: H, fps: 10, format: 'webm', name: 'Logo ñandú' },
      dir,
    );
    expect(path).toMatch(/media[\\/]3d[\\/]Logo-nandu-.+\.webm$/);
    const f = halfFrame(W, H);
    for (let i = 0; i < 10; i++) await svc.frame(id, f);
    await expect(svc.frame(id, new Uint8Array(10))).rejects.toThrow();
    const r = await svc.end(id);
    expect(r.frames).toBe(10);
    const video = new VideoService(appRoot, dir, () => undefined);
    const m = await video.probe(r.path);
    expect(m.alpha).toBe('vp9');
    expect(m.duration).toBeCloseTo(1, 1);
    // Decoded with libvpx the alpha is there: left solid, right clear.
    const px = sh([
      '-c:v',
      'libvpx-vp9',
      '-i',
      r.path,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgba',
      '-',
    ]);
    const a = (x: number, y: number) => px[(y * W + x) * 4 + 3]!;
    expect(a(4, 20)).toBeGreaterThan(240);
    expect(a(W - 4, 20)).toBeLessThan(15);
  }, 60_000);

  it('a canceled render leaves no file behind', async () => {
    const svc = new Scene3DService(dir, () => tools.ffmpeg);
    const { id, path } = svc.begin({ width: W, height: H, fps: 10, format: 'mp4', name: 'x' }, dir);
    await svc.frame(id, halfFrame(W, H));
    await svc.cancel(id);
    const { existsSync } = await import('node:fs');
    expect(existsSync(path)).toBe(false);
  }, 30_000);

  it('acceptance: the transparent render enters the timeline and the background shows through', async () => {
    const svc = new Scene3DService(dir, () => tools.ffmpeg);
    const { id } = svc.begin({ width: W, height: H, fps: 30, format: 'webm', name: 'alpha' }, dir);
    const f = halfFrame(W, H);
    for (let i = 0; i < 60; i++) await svc.frame(id, f);
    const r = await svc.end(id);
    const bg = join(dir, 'blue.mp4');
    sh([
      '-y',
      '-f',
      'lavfi',
      '-i',
      `color=c=0x0000ff:s=${W}x${H}:r=30`,
      '-t',
      '2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv444p',
      '-qp',
      '0',
      bg,
    ]);
    const video = new VideoService(appRoot, dir, () => undefined);
    const { url: _a, ...mBg } = await video.probe(bg);
    const { url: _b, ...mLogo } = await video.probe(r.path);
    let p: VideoProject = {
      ...newProject({ width: W, height: H, fps: 30, name: 'acc3d' }),
      media: [mBg, mLogo],
    };
    p = addTrack(p, 'video');
    const track = (name: string) => p.tracks.find((t) => t.name === name)!.id;
    p = insertMedia(p, mBg, { trackId: track('V1'), start: 0 }).project;
    p = insertMedia(p, mLogo, { trackId: track('V2'), start: 0 }).project;
    const out = join(dir, 'acc3d.mp4');
    const job = video.enqueue(
      p,
      { ...defaultExport(p), width: W, height: H, crf: 0, preset: 'veryfast' },
      out,
    );
    await new Promise<void>((resolve) => {
      const tick = setInterval(() => {
        const j = video.list().find((x) => x.id === job.id)!;
        if (j.state !== 'queued' && j.state !== 'running') {
          clearInterval(tick);
          resolve();
        }
      }, 100);
    });
    const done = video.list().find((x) => x.id === job.id)!;
    expect(done.state, done.error).toBe('done');
    const px = sh([
      '-ss',
      '1',
      '-i',
      out,
      '-frames:v',
      '1',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ]);
    const at = (x: number, y: number) => [...px.subarray((y * W + x) * 3, (y * W + x) * 3 + 3)];
    const [lr, , lb] = at(8, 24);
    const [rr, , rb] = at(W - 8, 24);
    // Left: the orange logo covers the blue. Right: the blue background shows through.
    expect(lr).toBeGreaterThan(200);
    expect(lb).toBeLessThan(60);
    expect(rr).toBeLessThan(40);
    expect(rb).toBeGreaterThan(200);
  }, 120_000);
});
