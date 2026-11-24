import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  describeSketchupOps,
  describeSketchupReport,
  isSkpHeader,
  parseSkp,
  pngAt,
  sketchupWrites,
  sketchupYear,
  validateSketchupOps,
  type SketchupJob,
} from '../src/shared/sketchup.js';
import { SketchupService, findSketchups, pluginsDir } from '../src/main/sketchup.js';
import {
  SKETCHUP_LOADER_RB,
  SKETCHUP_MAIN_RB,
  SKETCHUP_EXT_VERSION,
} from '../src/main/sketchupRuby.js';
import { SKETCHUP_TOOLS, runSketchupTool, sketchupPreview } from '../src/main/sketchupTools.js';

const utf16 = (s: string) => Buffer.from(s, 'utf16le');

/** A tiny but complete PNG (IHDR, IDAT, IEND); the CRCs are not checked by the parser. */
function png(w: number, h: number, idat = 10): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', Buffer.alloc(idat, 7)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Bytes laid out like a .skp: the header strings, some data, the thumbnail, more data. */
function skp(version: string | null, thumbs: Buffer[] = []): Buffer {
  const head = Buffer.concat([
    Buffer.from([0xff, 0xfe, 0xff, 0x0e]),
    utf16('SketchUp Model'),
    ...(version
      ? [Buffer.from([0xff, 0xfe, 0xff, version.length + 2]), utf16(`{${version}}`)]
      : []),
  ]);
  return Buffer.concat([
    head,
    Buffer.alloc(300, 1),
    ...thumbs.flatMap((t) => [t, Buffer.alloc(50, 2)]),
    Buffer.alloc(200, 3),
  ]);
}

describe('.skp parser', () => {
  it('reads the version and the embedded thumbnail', () => {
    const thumb = png(256, 160, 400);
    const info = parseSkp(skp('23.0.367', [thumb]));
    expect(info.version).toBe('23.0.367');
    expect(info.major).toBe(23);
    expect(info.year).toBe(2023);
    expect(info.label).toBe('SketchUp 2023');
    expect(info.thumbnail?.width).toBe(256);
    expect(info.thumbnail?.height).toBe(160);
    expect(Buffer.from(info.thumbnail!.png).equals(thumb)).toBe(true);
  });

  it('labels old versions and files without a thumbnail', () => {
    const info = parseSkp(skp('8.0.15158'));
    expect(info.year).toBeNull();
    expect(info.label).toBe('SketchUp 8');
    expect(info.thumbnail).toBeNull();
    expect(parseSkp(skp(null)).version).toBeNull();
  });

  it('keeps the largest whole PNG and skips cut ones', () => {
    const small = png(32, 32, 10);
    const big = png(512, 320, 2000);
    const cut = png(1024, 1024, 5000).subarray(0, 300);
    const info = parseSkp(skp('24.0.484', [small, big, cut]));
    expect(info.thumbnail?.width).toBe(512);
    expect(pngAt(cut, 0)).toBeNull();
  });

  it('refuses what is not SketchUp', () => {
    expect(isSkpHeader(Buffer.from('hello world'))).toBe(false);
    expect(isSkpHeader(skp('23.0.1'))).toBe(true);
    expect(() => parseSkp(Buffer.from('PK\u0003\u0004 zip'))).toThrow(/not a SketchUp/);
  });

  it('gets the year of an install folder', () => {
    expect(sketchupYear('C:\\Program Files\\SketchUp\\SketchUp 2024\\SketchUp\\SketchUp.exe')).toBe(
      2024,
    );
    expect(sketchupYear('/Applications/SketchUp 2023/SketchUp.app')).toBe(2023);
    expect(sketchupYear('/opt/other')).toBeNull();
  });
});

describe('SketchUp ops', () => {
  const root = '/proj';
  const resolve = (p: string) => {
    if (p.startsWith('..') || p.startsWith('/')) throw new Error('outside the open folder');
    return `${root}/${p}`;
  };

  it('validates and normalises ops', () => {
    const ops = validateSketchupOps(
      [
        { op: 'add_box', name: 'Mesa', w: 1200, d: 800, h: 750 },
        { op: 'set_layer', target: 'Mesa', layer: 'Muebles' },
        { op: 'material', target: 'Mesa', color: '#AA5500', alpha: 0.9 },
        { op: 'move', target: 'Mesa', by: [10, 0, 0], units: 'cm' },
        { op: 'view', preset: 'top' },
        { op: 'export', path: 'out/mesa.stl' },
        { op: 'save', path: 'mesa.skp' },
      ],
      resolve,
    );
    expect(ops[0]).toMatchObject({ op: 'add_box', name: 'Mesa', x: 0, y: 0, z: 0, w: 1200 });
    expect(ops[1]).toMatchObject({ op: 'tag', tag: 'Muebles', target: 'Mesa' });
    expect(ops[2]!.color).toBe('#aa5500');
    expect(ops[3]!.units).toBe('cm');
    expect(ops[4]).toMatchObject({ preset: 'top', zoom_extents: true });
    expect(sketchupWrites(ops)).toEqual(['/proj/out/mesa.stl', '/proj/mesa.skp']);
    expect(describeSketchupOps(ops)).toContain('caja');
  });

  it.each([
    [{ op: 'eval', code: 'system("x")' }, /unknown op/],
    [{ op: 'add_box', w: 1, d: 1 }, /"h" must be a number/],
    [{ op: 'add_box', w: -1, d: 1, h: 1 }, /"w" must be between/],
    [{ op: 'add_box', w: 1, d: 1, h: Infinity }, /"h" must be a number/],
    [{ op: 'move', target: 'A' }, /"to".*"by"/],
    [{ op: 'material', target: 'A', color: 'red' }, /#rrggbb/],
    [{ op: 'export', path: 'x.exe' }, /wrong file type/],
    [{ op: 'export', path: '../x.stl' }, /outside the open folder/],
    [{ op: 'add_face', points: [[0, 0, 0]] }, /3 to 500/],
    [{ op: 'view', preset: 'sideways' }, /preset/],
    [{ op: 'pushpull', target: 'A', distance: 0 }, /cannot be 0/],
    [{ op: 'add_box', name: 'a\u0000b', w: 1, d: 1, h: 1 }, /control characters/],
    [{ op: 'add_box', w: 1, d: 1, h: 1, units: 'parsec' }, /units/],
  ])('refuses %j', (op, why) => {
    expect(() => validateSketchupOps([op], resolve)).toThrow(why);
  });

  it('limits the number of ops', () => {
    expect(() => validateSketchupOps(new Array(101).fill({ op: 'view' }), resolve)).toThrow(
      /At most 100/,
    );
    expect(validateSketchupOps([], resolve)).toEqual([]);
  });

  it('describes a report', () => {
    const text = describeSketchupReport({
      sketchup: '24.0.484',
      model: 'casa.skp',
      title: 'casa',
      units: 'mm',
      faces: 6,
      edges: 12,
      entities: [
        { name: 'Mesa', type: 'group', size: [1200, 800, 750], min: [0, 0, 0], tag: 'Muebles' },
      ],
      materials: ['Madera'],
      tags: ['Untagged', 'Muebles'],
      exported: ['out/mesa.stl'],
    });
    expect(text).toContain('"Mesa" group: size 1200 × 800 × 750');
    expect(text).toContain('Exported: out/mesa.stl');
  });
});

describe('the Ruby extension', () => {
  it('only knows the validated ops and never evaluates code', () => {
    for (const op of ['add_box', 'pushpull', 'add_cylinder', 'export', 'view', 'add_component'])
      expect(SKETCHUP_MAIN_RB).toContain(`when '${op}'`);
    expect(SKETCHUP_MAIN_RB).not.toMatch(/\beval\b|instance_eval|send\(|system\(|`/);
    expect(SKETCHUP_LOADER_RB).toContain(`ZINARIX_EXT_VERSION = '${SKETCHUP_EXT_VERSION}'`);
    expect(SKETCHUP_MAIN_RB).toContain('write_image');
  });
});

describe('SketchUp service', () => {
  let dir: string;
  const saved = { ...process.env };
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'zs-sketchup-'));
    process.env.ZINARIX_SKETCHUP_HOME = join(dir, 'bridge');
    process.env.APPDATA = join(dir, 'appdata');
  });
  afterEach(() => {
    process.env = { ...saved };
    rmSync(dir, { recursive: true, force: true });
  });

  it('finds SketchUp under Program Files', () => {
    const exe = join(dir, 'pf', 'SketchUp', 'SketchUp 2024', 'SketchUp', 'SketchUp.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    const old = join(dir, 'pf', 'SketchUp', 'SketchUp 2021', 'SketchUp.exe');
    mkdirSync(join(old, '..'), { recursive: true });
    writeFileSync(old, '');
    const found = findSketchups({ ProgramFiles: join(dir, 'pf') } as NodeJS.ProcessEnv, 'win32');
    expect(found.map((f) => f.year)).toEqual([2024, 2021]);
    expect(pluginsDir(2024, { APPDATA: 'C:\\A' } as NodeJS.ProcessEnv, 'win32')).toMatch(
      /SketchUp 2024[\\/]SketchUp[\\/]Plugins$/,
    );
  });

  it('installs the extension and answers jobs through the bridge folder', async () => {
    const exe = join(dir, 'SketchUp 2024', 'SketchUp.exe');
    mkdirSync(join(exe, '..'), { recursive: true });
    writeFileSync(exe, '');
    process.env.ZINARIX_SKETCHUP = exe;
    const svc = new SketchupService(join(dir, 'sketchup.json'));
    expect(svc.status().extension.installed).toBe(false);
    const loader = await svc.installExtension();
    expect(readFileSync(loader, 'utf8')).toContain('SketchupExtension');
    expect(existsSync(join(loader, '..', 'zinarix_sketchup', 'main.rb'))).toBe(true);
    expect(svc.status().extension).toMatchObject({ installed: true, outdated: false });

    // A stand-in for the Ruby side: heartbeat + one answered job.
    const home = process.env.ZINARIX_SKETCHUP_HOME!;
    const beat = () =>
      writeFileSync(
        join(home, 'alive.json'),
        JSON.stringify({ time: Date.now(), version: '24.0.484', model: '', title: 'Untitled' }),
      );
    beat();
    expect(svc.status().connected).toBe(true);
    let seen: SketchupJob | null = null;
    const fake = setInterval(() => {
      beat();
      for (const f of readdirSync(join(home, 'jobs')).filter((n) => n.endsWith('.json'))) {
        const job = JSON.parse(readFileSync(join(home, 'jobs', f), 'utf8')) as SketchupJob;
        rmSync(join(home, 'jobs', f));
        seen = job;
        if (job.shot) writeFileSync(job.shot.path, png(64, 40));
        writeFileSync(
          join(home, 'results', `${job.id}.json`),
          JSON.stringify({
            id: job.id,
            ok: true,
            report: {
              sketchup: '24.0.484',
              model: '',
              title: 'Untitled',
              units: job.units,
              faces: 6,
              edges: 12,
              entities: [],
              materials: [],
              tags: [],
              exported: [],
              shot: job.shot?.path,
            },
          }),
        );
      }
    }, 50);
    try {
      const r = await runSketchupTool(
        svc,
        'sketchup_screenshot',
        { view: 'iso' },
        dir,
        new AbortController().signal,
      );
      expect(r.ok).toBe(true);
      expect(r.image?.width).toBe(64);
      expect(seen!.ops).toEqual([{ op: 'view', preset: 'iso', zoom_extents: true }]);
      expect(seen!.save).toBe(false);
    } finally {
      clearInterval(fake);
    }
  });

  it('fails clearly when SketchUp is closed and asks before writing', async () => {
    const svc = new SketchupService(join(dir, 'sketchup.json'));
    const r = await runSketchupTool(
      svc,
      'sketchup_screenshot',
      {},
      dir,
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/not open/);
    const card = sketchupPreview(
      svc,
      'sketchup_model',
      { path: 'casa.skp', ops: [{ op: 'add_box', w: 1, d: 1, h: 1 }] },
      dir,
    );
    expect(card && 'risk' in card && card.action).toContain('crear casa.skp');
    expect(
      sketchupPreview(svc, 'sketchup_model', { path: '../x.skp', ops: [] }, dir),
    ).toMatchObject({ error: expect.stringMatching(/outside/) });
    expect(sketchupPreview(svc, 'sketchup_inspect', { path: 'a.skp' }, dir)).toBeNull();
  });

  it('inspects a .skp of the project without SketchUp', async () => {
    writeFileSync(join(dir, 'casa.skp'), skp('23.0.367', [png(128, 80, 100)]));
    const r = await runSketchupTool(
      undefined,
      'sketchup_inspect',
      { path: 'casa.skp' },
      dir,
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    expect(r.content).toContain('SketchUp 2023');
    expect(r.image).toMatchObject({ mediaType: 'image/png', width: 128, height: 80 });
  });

  it('declares every tool with a schema', () => {
    expect(SKETCHUP_TOOLS.map((t) => t.name)).toEqual([
      'sketchup_status',
      'sketchup_inspect',
      'sketchup_model',
      'sketchup_screenshot',
      'sketchup_install_extension',
    ]);
  });
});
