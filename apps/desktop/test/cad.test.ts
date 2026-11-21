/**
 * Fase 7: CAD with OpenSCAD and the mesh tools. The built-in WebAssembly engine always runs
 * (in this process); the installed one only when found (ZINARIX_OPENSCAD names a portable one).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { CadService, type BuiltinRunner } from '../src/main/cad.js';
import { runScadWasm } from '../src/main/cadWorker.js';
import {
  CAD_TEMPLATES,
  coerceParam,
  parseScadLog,
  parseScadParams,
  scadDefines,
  scadDependencies,
  setScadParam,
} from '../src/shared/cad.js';
import { analyzeMesh, checkPrint, parseObj, parseOff, parseStl, writeStl } from '../src/shared/mesh3d.js';
import { encodePng, rasterViews, rasterize } from '../src/shared/meshRaster.js';

const dir = mkdtempSync(join(tmpdir(), 'zs-cad-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const builtin: BuiltinRunner = (req) => runScadWasm(req);

/** A closed unit cube made of 12 triangles (outward normals). */
function cube(s = 10): Float32Array {
  const v = [
    [0, 0, 0], [s, 0, 0], [s, s, 0], [0, s, 0],
    [0, 0, s], [s, 0, s], [s, s, s], [0, s, s],
  ];
  const f = [
    [0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5], [2, 3, 7], [2, 7, 6], [3, 0, 4], [3, 4, 7],
  ];
  return Float32Array.from(f.flatMap((t) => t.flatMap((i) => v[i]!)));
}

describe('mesh analysis', () => {
  it('a closed cube is watertight with the right volume', () => {
    const r = analyzeMesh(cube());
    expect(r).toMatchObject({ triangles: 12, vertices: 8, openEdges: 0, nonManifoldEdges: 0, flippedEdges: 0, shells: 1, watertight: true });
    expect(r.volume).toBeCloseTo(1000);
    expect(r.area).toBeCloseTo(600);
    const c = checkPrint(r);
    expect(c.ok).toBe(true);
    expect(c.notes.join(' ')).toContain('1.0 cm³');
  });

  it('finds holes, flipped faces, size and metre units', () => {
    const open = cube().slice(9);
    expect(analyzeMesh(open).openEdges).toBe(3);
    expect(checkPrint(analyzeMesh(open)).errors[0]).toMatch(/bordes abiertos/);
    const flipped = cube();
    // Swap two corners of the first triangle.
    for (let k = 0; k < 3; k++) [flipped[3 + k], flipped[6 + k]] = [flipped[6 + k]!, flipped[3 + k]!];
    expect(analyzeMesh(flipped).flippedEdges).toBe(3);
    expect(checkPrint(analyzeMesh(cube(300))).errors[0]).toMatch(/más grande que la cama/);
    expect(checkPrint(analyzeMesh(cube(0.05))).warnings.join(' ')).toMatch(/metros/);
    expect(checkPrint(analyzeMesh(cube(0.05)), { units: 'm' }).ok).toBe(true);
    // 230 x 10 x 10 does not fit along X but fits on the diagonal? no: rotated onto Z (250) it does.
    const long = cube(10).map((v, i) => (i % 3 === 0 ? v * 23 : v));
    expect(checkPrint(analyzeMesh(long)).warnings.join(' ')).toMatch(/girándolo/);
  });

  it('round-trips binary STL, reads ASCII STL, OBJ and OFF', () => {
    const t = cube();
    expect(Array.from(parseStl(writeStl(t)))).toEqual(Array.from(t));
    const ascii = `solid x\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid x\n`;
    expect(parseStl(new TextEncoder().encode(ascii)).length).toBe(9);
    expect(parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3 4\n').length).toBe(18);
    expect(parseOff('OFF\n4 1 0\n0 0 0\n1 0 0\n1 1 0\n0 1 0\n4 0 1 2 3\n').length).toBe(18);
  });

  it('draws the views and writes a valid PNG', () => {
    const px = rasterize(cube(), { width: 64, height: 64, view: 'iso' });
    // The centre is the model's colour, a corner the background.
    const at = (x: number, y: number) => Array.from(px.slice((y * 64 + x) * 4, (y * 64 + x) * 4 + 3));
    expect(at(32, 32)).not.toEqual([32, 35, 42]);
    expect(at(0, 0)).toEqual([32, 35, 42]);
    const v = rasterViews(cube(), 90);
    expect([v.width, v.height]).toEqual([135, 90]);
    const png = encodePng(v.rgba, v.width, v.height, (b) => deflateSync(b));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const idatLen = new DataView(png.buffer).getUint32(33);
    expect(inflateSync(png.subarray(41, 41 + idatLen)).length).toBe(90 * (135 * 4 + 1));
  });
});

describe('OpenSCAD helpers', () => {
  const code = `/* [Medidas] */
// Ancho de la caja
ancho = 60; // [20:1:200]
alto = 3; // [10]
forma = "redonda"; // [redonda, cuadrada]
nivel = 2; // [1:Bajo, 2:Medio, 3:Alto]
texto = "Hola"; // 8
tapa = true;
v = [1, 2, 3];
doble = ancho * 2;
/* [Hidden] */
secreto = 5;
module m() { x = 1; }
despues = 1;
`;

  it('reads the Customizer parameters', () => {
    const p = parseScadParams(code);
    expect(p.map((x) => x.name)).toEqual(['ancho', 'alto', 'forma', 'nivel', 'texto', 'tapa', 'v']);
    expect(p[0]).toMatchObject({ value: 60, min: 20, step: 1, max: 200, description: 'Ancho de la caja', group: 'Medidas', line: 3 });
    expect(p[1]).toMatchObject({ min: 0, max: 10 });
    expect(p[2]!.options!.map((o) => o.value)).toEqual(['redonda', 'cuadrada']);
    expect(p[3]!.options).toEqual([
      { value: 1, label: 'Bajo' },
      { value: 2, label: 'Medio' },
      { value: 3, label: 'Alto' },
    ]);
    expect(p[4]!.maxLength).toBe(8);
    expect(p[6]!.type).toBe('vector');
  });

  it('builds -D overrides that cannot inject code', () => {
    const p = parseScadParams(code);
    expect(scadDefines(p, { ancho: 500, texto: 'a"); cube(1); //', tapa: 'false', nope: 1, v: [4, 5] })).toEqual([
      '-D', 'ancho=200',
      '-D', 'texto="a\\"); cub"',
      '-D', 'tapa=false',
      '-D', 'v=[4, 5]',
    ]);
    expect(coerceParam(p[0]!, 'abc')).toBeNull();
    expect(setScadParam(code, p[0]!, 80).split('\n')[2]).toBe('ancho = 80; // [20:1:200]');
  });

  it('parses the log and the dependencies', () => {
    const log = parseScadLog(
      [
        'ERROR: Parser error in file "C:\\p\\a.scad", line 3: syntax error',
        "WARNING: Ignoring unknown variable 'x' in file a.scad, line 7",
        'ECHO: "hola"',
        'Top level object is a 3D object (manifold):',
        'Total rendering time: 0:00:01.500',
      ].join('\n'),
    );
    expect(log.messages[0]).toEqual({ severity: 'error', message: 'Parser error syntax error', file: 'C:\\p\\a.scad', line: 3 });
    expect(log.messages[1]).toMatchObject({ severity: 'warning', line: 7 });
    expect(log.messages[2]).toEqual({ severity: 'echo', message: '"hola"' });
    expect(log).toMatchObject({ dimension: '3d', manifold: true, seconds: 1.5 });
    expect(scadDependencies('include <lib/a.scad>\nuse <b.scad> // use <no.scad>\nimport("m.stl");\nsurface(file = "h.png");')).toEqual([
      'lib/a.scad',
      'b.scad',
      'm.stl',
      'h.png',
    ]);
  });
});

const engines: ['builtin' | 'native', CadService][] = [['builtin', new CadService(join(dir, 'picked.json'), builtin)]];
const nativeSvc = new CadService(join(dir, 'picked2.json'), null);
if ((await nativeSvc.engines()).native) engines.push(['native', nativeSvc]);

describe.each(engines)('OpenSCAD engine: %s', (engine, svc) => {
  it.each(CAD_TEMPLATES.map((t) => [t.id, t.code] as const))('template %s renders a printable model', async (_id, code) => {
    const r = await svc.render({ code, engine });
    const mesh = analyzeMesh(parseStl(r.data));
    expect(r.log.messages.filter((m) => m.severity === 'error')).toEqual([]);
    expect(mesh.triangles).toBeGreaterThan(10);
    expect(mesh.watertight).toBe(true);
    expect(checkPrint(mesh).errors).toEqual([]);
  }, 120_000);

  it('applies parameter values', async () => {
    const box = CAD_TEMPLATES.find((t) => t.id === 'caja')!.code;
    const a = analyzeMesh(parseStl((await svc.render({ code: box, engine, values: { con_tapa: false } })).data));
    const b = analyzeMesh(parseStl((await svc.render({ code: box, engine, values: { con_tapa: false, ancho: 100 } })).data));
    expect(a.bounds.size[0]).toBeCloseTo(64, 1);
    expect(b.bounds.size[0]).toBeCloseTo(104, 1);
    expect(a.shells).toBe(1);
  }, 120_000);

  it('reports errors with their line, and 2D / empty models', async () => {
    const e = await svc.render({ code: 'cube(5);\ncube(10)\nsphere(;', engine }).catch((x: Error & { log?: { messages: { line?: number }[] } }) => x);
    expect(e).toBeInstanceOf(Error);
    expect((e as Error).message).toMatch(/línea 3/);
    await expect(svc.render({ code: 'square(10);', engine })).rejects.toThrow(/2D|linear_extrude|top level/i);
    await expect(svc.render({ code: 'x = 1;', engine })).rejects.toThrow(/vacío|empty/i);
  }, 120_000);

  it('reads included files inside the project and refuses the rest', async () => {
    const proj = join(dir, `proj-${engine}`);
    mkdirSync(join(proj, 'lib'), { recursive: true });
    writeFileSync(join(proj, 'lib', 'pieza.scad'), 'module pieza(s) { cube(s); }\n');
    writeFileSync(join(proj, 'modelo.scad'), 'use <lib/pieza.scad>\npieza(7);\necho("listo");\n');
    const r = await svc.render({ file: join(proj, 'modelo.scad'), root: proj, engine });
    expect(analyzeMesh(parseStl(r.data)).bounds.size[0]).toBeCloseTo(7);
    expect(r.log.messages).toContainEqual({ severity: 'echo', message: '"listo"' });
    await expect(svc.render({ code: 'include <../../secreto.scad>', root: proj, engine })).rejects.toThrow(/fuera del proyecto/);
    await expect(svc.render({ code: 'import("C:/Windows/x.stl");', root: proj, engine })).rejects.toThrow(/rutas relativas/);
  }, 120_000);

  it('writes text with the fonts of this PC', async () => {
    const r = await svc.render({ code: 'linear_extrude(2) text("Hola", size = 10);', engine });
    const m = analyzeMesh(parseStl(r.data));
    expect(m.bounds.size[0]).toBeGreaterThan(20);
    expect(m.shells).toBeGreaterThanOrEqual(4);
  }, 120_000);

  it('exports 3MF and OFF', async () => {
    const off = await svc.render({ code: 'cube(4);', engine, format: 'off' });
    expect(analyzeMesh(parseOff(off.data.toString('utf8'))).watertight).toBe(true);
    const tmf = await svc.render({ code: 'cube(4);', engine, format: '3mf' }).catch((e: Error) => e);
    // 3MF is a zip ("PK"); the built-in engine may lack lib3mf, then it says so.
    if (tmf instanceof Error) expect(engine).toBe('builtin');
    else expect(tmf.data.subarray(0, 2).toString()).toBe('PK');
  }, 120_000);
});
