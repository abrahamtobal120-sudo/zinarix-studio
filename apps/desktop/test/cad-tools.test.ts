/**
 * Fase 7: the agent's CAD / 3D printing / Blender tools: approval cards, paths and results.
 * OpenSCAD is the built-in WebAssembly one (in this process); Blender is a fake.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { CadService } from '../src/main/cad.js';
import { runScadWasm } from '../src/main/cadWorker.js';
import { cadPreview, projectFile, runCadTool } from '../src/main/cadTools.js';
import type { BlenderModelJob, BlenderModelService } from '../src/main/blenderModel.js';
import { analyzeMesh, parseStl, writeStl } from '../src/shared/mesh3d.js';

const root = mkdtempSync(join(tmpdir(), 'zs-cadtools-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const cad = new CadService(join(root, '.picked.json'), (req) => runScadWasm(req));
const signal = new AbortController().signal;

const jobs: BlenderModelJob[] = [];
const fakeBlender = {
  run: async (job: BlenderModelJob) => {
    jobs.push(job);
    for (const op of job.ops)
      if (op.op === 'export' && String(op.path).endsWith('.stl'))
        writeFileSync(String(op.path), writeStl(new Float32Array(9)));
    return {
      report: {
        blender: '5.3.0',
        objects: [
          {
            name: 'Cube',
            type: 'MESH',
            location: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
            dimensions: [2, 2, 2],
            vertices: 8,
            faces: 6,
            triangles: 12,
            modifiers: [],
            materials: [],
            uv: ['UVMap'],
          },
        ],
        materials: [],
        units: { system: 'METRIC', scale: 1 },
        exported: job.ops.filter((o) => o.op === 'export').map((o) => String(o.path)),
        ...(job.save ? { saved: job.save } : {}),
        warnings: [],
      },
      preview: Buffer.from([137, 80, 78, 71]),
      ms: 5,
    };
  },
} as unknown as BlenderModelService;

describe('approval cards', () => {
  it('reads freely, asks for writes, refuses paths outside', () => {
    for (const n of ['cad_info', 'cad_render', 'mesh_check', 'blender_inspect'])
      expect(cadPreview(n, { path: 'a.scad' }, root)).toBeNull();
    const exp = cadPreview('cad_export', { path: 'm/caja.scad', format: '3mf' }, root);
    expect(exp).toMatchObject({
      risk: 'medium',
      allowKey: 'cad_export',
      action: 'exportar m/caja.scad a m/caja.3mf',
    });
    expect(cadPreview('cad_export', { path: '../x.scad' }, root)).toEqual({
      error: '"../x.scad" is outside the open folder.',
    });
    expect(cadPreview('cad_new', { path: 'n.scad', template: 'nope' }, root)).toEqual({
      error: 'Unknown template.',
    });
    const bm = cadPreview(
      'blender_model',
      {
        path: 'arte/m.blend',
        ops: [
          { op: 'add', type: 'cube' },
          { op: 'export', path: 'arte/m.glb' },
        ],
      },
      root,
    );
    expect(bm).toMatchObject({ risk: 'medium', allowKey: 'blender_model:arte/m.blend' });
    expect((bm as { warning: string }).warning).toContain('Escribe arte/m.glb');
    expect(
      cadPreview(
        'blender_model',
        // An absolute path of this system ("C:/…" is a relative name on macOS and Linux).
        {
          path: 'm.blend',
          ops: [
            {
              op: 'export',
              path: process.platform === 'win32' ? 'C:/Windows/x.stl' : '/etc/x.stl',
            },
          ],
        },
        root,
      ),
    ).toHaveProperty('error');
    expect(
      cadPreview('blender_model', { path: 'm.blend', ops: [{ op: 'run_python' }] }, root),
    ).toHaveProperty('error');
    expect(() => projectFile(undefined, 'a.scad')).toThrow(/Open a folder/);
  });
});

describe('CAD tools', () => {
  it('creates from a template, sees it and exports a printable STL', async () => {
    const made = await runCadTool(
      cad,
      undefined,
      'cad_new',
      { template: 'caja', path: 'modelos/caja.scad' },
      root,
      signal,
    );
    expect(made.ok).toBe(true);
    expect(made.changed).toBe(join(root, 'modelos', 'caja.scad'));
    expect(
      (
        await runCadTool(
          cad,
          undefined,
          'cad_new',
          { template: 'caja', path: 'modelos/caja.scad' },
          root,
          signal,
        )
      ).ok,
    ).toBe(false);

    const info = await runCadTool(
      cad,
      undefined,
      'cad_info',
      { path: 'modelos/caja.scad' },
      root,
      signal,
    );
    expect(info.content).toContain('- modelos/caja.scad');
    expect(info.content).toMatch(
      /- ancho = 60 \[20\.\.200 step 1\] — Ancho por dentro \(Medidas \(mm\)\)/,
    );

    const seen = await runCadTool(
      cad,
      undefined,
      'cad_render',
      { path: 'modelos/caja.scad', params: { con_tapa: false } },
      root,
      signal,
    );
    expect(seen.ok).toBe(true);
    expect(seen.content).toContain('watertight');
    expect(seen.content).toContain('con_tapa=false');
    expect(seen.image?.mediaType).toBe('image/png');
    expect(Buffer.from(seen.image!.data, 'base64').subarray(1, 4).toString()).toBe('PNG');

    const exp = await runCadTool(
      cad,
      undefined,
      'cad_export',
      { path: 'modelos/caja.scad', params: { con_tapa: false } },
      root,
      signal,
    );
    expect(exp.ok).toBe(true);
    const stl = join(root, 'modelos', 'caja.stl');
    expect(exp.changed).toBe(stl);
    expect(analyzeMesh(parseStl(readFileSync(stl))).watertight).toBe(true);

    const chk = await runCadTool(
      cad,
      undefined,
      'mesh_check',
      { path: 'modelos/caja.stl' },
      root,
      signal,
    );
    expect(chk.ok).toBe(true);
    expect(chk.summary).toBe('imprimible');
    expect(chk.content).toMatch(/64\.0 × 44\.0 × 32\.0 mm|64 × 44 × 32/);
  }, 120_000);

  it('reports errors with lines and keeps code inside the project', async () => {
    const bad = await runCadTool(
      cad,
      undefined,
      'cad_render',
      { code: 'cube(5);\nsphere(;' },
      root,
      signal,
    );
    expect(bad.ok).toBe(false);
    expect(bad.content).toMatch(/ERROR line 2/);
    mkdirSync(join(root, 'lib'), { recursive: true });
    writeFileSync(join(root, 'lib', 'p.scad'), 'module p() { cube(3); }');
    const inc = await runCadTool(
      cad,
      undefined,
      'cad_render',
      { path: 'uso.scad', code: 'use <lib/p.scad>\np();' },
      root,
      signal,
    );
    expect(inc.ok).toBe(true);
    const out = await runCadTool(
      cad,
      undefined,
      'cad_render',
      { code: 'include <../../x.scad>' },
      root,
      signal,
    );
    expect(out.content).toMatch(/fuera del proyecto/);
  }, 120_000);
});

describe('Blender tools (fake Blender)', () => {
  it('inspects without saving and models with validated ops', async () => {
    writeFileSync(join(root, 'escena.blend'), 'BLENDER');
    const ins = await runCadTool(
      cad,
      fakeBlender,
      'blender_inspect',
      { path: 'escena.blend' },
      root,
      signal,
    );
    expect(ins.ok).toBe(true);
    expect(jobs.at(-1)).toMatchObject({
      input: join(root, 'escena.blend'),
      ops: [],
      preview: true,
    });
    expect(jobs.at(-1)!.save).toBeUndefined();
    expect(ins.content).toContain('"Cube" MESH');
    expect(ins.image).toBeDefined();

    const ed = await runCadTool(
      cad,
      fakeBlender,
      'blender_model',
      {
        path: 'nuevo/pieza.blend',
        ops: [
          { op: 'add', type: 'cube', name: 'Pieza' },
          { op: 'export', path: 'nuevo/pieza.stl', scale: 1000 },
        ],
      },
      root,
      signal,
    );
    expect(ed.ok).toBe(true);
    const job = jobs.at(-1)!;
    expect(job).toMatchObject({ fresh: true, save: join(root, 'nuevo', 'pieza.blend') });
    expect(job.ops[1]).toMatchObject({
      op: 'export',
      path: join(root, 'nuevo', 'pieza.stl'),
      format: 'stl',
      scale: 1000,
    });
    expect(existsSync(join(root, 'nuevo'))).toBe(true);
    expect(ed.content).toContain('Print check of nuevo/pieza.stl');
    expect(ed.changed).toBe(join(root, 'nuevo', 'pieza.stl'));

    const bad = await runCadTool(
      cad,
      fakeBlender,
      'blender_model',
      {
        path: 'x.blend',
        ops: [{ op: 'modifier', object: 'A', type: 'bevel', settings: { python: 'x' } }],
      },
      root,
      signal,
    );
    expect(bad.ok).toBe(false);
    expect(bad.content).toMatch(/no setting "python"/);
  });
});
