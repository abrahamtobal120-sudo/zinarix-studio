import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  describeScene,
  gameTemplateFiles,
  parseExportPresets,
  parseGodotOutput,
  parseGodotVersion,
  parseProjectGodot,
  parseTscn,
  parseUnityVersion,
  parseUproject,
  pngSize,
  relToRes,
  resToRel,
  sceneTree,
  validNewFolder,
  validProjectDir,
  validScene,
} from '../src/shared/games.js';
import { GodotService, LSP_TCP_BRIDGE } from '../src/main/godot.js';
import { gamePreview, runGameTool } from '../src/main/gameTools.js';
import { WebGameServers } from '../src/main/webGame.js';
import { DebugManager, setGodotLocator } from '../src/main/debug/manager.js';
import type { DebugEvent } from '../src/shared/devtools.js';

/** Fase 6 (plan de funciones): video games (Godot, web, Unity / Unreal). */

const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zx-games-'));
  tmps.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmps)
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const write = (root: string, files: Record<string, string>) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
};

describe('project.godot and scenes', () => {
  it('reads project.godot', () => {
    const files = gameTemplateFiles('godot-platformer', 'Mi "juego"');
    const info = parseProjectGodot(files['project.godot']!);
    expect(info.name).toBe('Mi "juego"');
    expect(info.mainScene).toBe('res://main.tscn');
    expect(info.version).toBe('4.3');
    expect(info.renderer).toBe('GL Compatibility');
    expect(info.actions).toEqual(['move_left', 'move_right', 'jump']);
    expect(info.width).toBe(960);
    expect(info.configVersion).toBe(5);
    const auto = parseProjectGodot(
      'config_version=5\n[application]\nconfig/name="X"\n[autoload]\nGame="*res://game.gd"\n',
    );
    expect(auto.autoloads).toEqual([{ name: 'Game', path: 'res://game.gd' }]);
  });

  it('reads a .tscn as a tree with scripts, instances and signals', () => {
    const files = gameTemplateFiles('godot-platformer', 'X');
    const scene = parseTscn(files['main.tscn']!);
    expect(scene.kind).toBe('gd_scene');
    expect(scene.format).toBe(3);
    expect(scene.ext.map((e) => e.path)).toEqual(['res://player.tscn', 'res://main.gd']);
    expect(scene.sub).toHaveLength(3);
    const main = scene.nodes[0]!;
    expect(main).toMatchObject({
      name: 'Main',
      type: 'Node2D',
      parent: null,
      path: '.',
      script: 'res://main.gd',
    });
    const player = scene.nodes.find((n) => n.name === 'Player')!;
    expect(player.instance).toBe('res://player.tscn');
    expect(player.props.position).toBe('Vector2(200, 440)');
    const floorShape = scene.nodes.find((n) => n.path === 'Floor/Shape')!;
    expect(floorShape.props.shape).toBe('SubResource("RectangleShape2D_floor")');
    expect(scene.connections).toEqual([
      { signal: 'body_entered', from: 'Coin', to: '.', method: '_on_coin_body_entered' },
    ]);
    const tree = sceneTree(scene.nodes);
    expect(tree.map((t) => `${t.depth}:${t.node.path}`).slice(0, 4)).toEqual([
      '0:.',
      '1:Sky',
      '1:Floor',
      '2:Floor/Shape',
    ]);
    const text = describeScene(scene);
    expect(text).toContain('Player (instance of res://player.tscn)');
    expect(text).toContain('Coin.body_entered → Main._on_coin_body_entered()');
    // Multi-line values and groups.
    const s2 = parseTscn(
      '[gd_scene format=3]\n\n[node name="A" type="Node" groups=["enemy", "boss"]]\nmeta = {\n"k": 1\n}\n',
    );
    expect(s2.nodes[0]!.groups).toEqual(['enemy', 'boss']);
    expect(s2.nodes[0]!.props.meta).toBe('{\n"k": 1\n}');
  });

  it('turns res:// paths into project paths and back', () => {
    expect(resToRel('res://player.gd', '')).toBe('player.gd');
    expect(resToRel('res://a/b.gd', 'games/plat')).toBe('games/plat/a/b.gd');
    expect(resToRel('res://../x.gd', '')).toBeNull();
    expect(resToRel('user://x', '')).toBeNull();
    expect(relToRes('games/plat/a.gd', 'games/plat')).toBe('res://a.gd');
    expect(relToRes('other/a.gd', 'games/plat')).toBeNull();
  });

  it('validates what the AI passes', () => {
    expect(validProjectDir('')).toBe(true);
    expect(validProjectDir('games/plat')).toBe(true);
    expect(validProjectDir('../x')).toBe(false);
    expect(validProjectDir('C:\\x')).toBe(false);
    expect(validScene('res://levels/one.tscn')).toBe(true);
    expect(validScene('levels/one.tscn')).toBe(true);
    expect(validScene('res://../one.tscn')).toBe(false);
    expect(validScene('main.gd')).toBe(false);
    expect(validNewFolder('mi-juego')).toBe(true);
    expect(validNewFolder('../x')).toBe(false);
    expect(validNewFolder('a/b')).toBe(false);
    expect(validNewFolder('.hidden')).toBe(false);
  });
});

describe('Godot output', () => {
  it('finds script errors with file and line, merging repeats', () => {
    const out = `Godot Engine v4.7.2.stable.official.ed1daf0bf - https://godotengine.org

listo
WARNING: aviso de prueba
   at: push_warning (core/variant/variant_utility.cpp:1033)
   GDScript backtrace (most recent call first):
       [0] _ready (res://main.gd:7)
SCRIPT ERROR: Invalid call. Nonexistent function 'foo' in base 'Nil'.
   at: _process (res://main.gd:14)
   GDScript backtrace (most recent call first):
       [0] _process (res://main.gd:14)
SCRIPT ERROR: Invalid call. Nonexistent function 'foo' in base 'Nil'.
   at: _process (res://main.gd:14)
SCRIPT ERROR: Parse Error: Expected expression for variable initial value after "=".
   at: GDScript::reload (res://bad.gd:3)
ERROR: Failed to load script "res://bad.gd" with error "Parse error".
   at: load (modules/gdscript/gdscript_resource_format.cpp:46)
`;
    const p = parseGodotOutput(out);
    expect(p).toEqual([
      {
        severity: 'warning',
        message: 'aviso de prueba',
        file: 'res://main.gd',
        line: 7,
        func: '_ready',
        count: 1,
      },
      {
        severity: 'error',
        message: "Invalid call. Nonexistent function 'foo' in base 'Nil'.",
        file: 'res://main.gd',
        line: 14,
        func: '_process',
        count: 2,
      },
      {
        severity: 'error',
        message: 'Parse error: Expected expression for variable initial value after "=".',
        file: 'res://bad.gd',
        line: 3,
        func: 'GDScript::reload',
        count: 1,
      },
      {
        severity: 'error',
        message: 'Failed to load script "res://bad.gd" with error "Parse error".',
        file: 'res://bad.gd',
        line: 0,
        func: undefined,
        count: 1,
      },
    ]);
  });

  it('reads versions, presets, PNG sizes and other engines', () => {
    expect(parseGodotVersion('4.7.2.stable.official.ed1daf0bf')).toEqual({
      major: 4,
      minor: 7,
      text: '4.7.2',
      mono: false,
    });
    expect(parseGodotVersion('4.3.stable.mono.official.77dcf97d8')?.mono).toBe(true);
    expect(parseGodotVersion('nope')).toBeNull();
    const presets = parseExportPresets(
      '[preset.0]\n\nname="Windows Desktop"\nplatform="Windows Desktop"\nexport_path="build/juego.exe"\n\n[preset.0.options]\n\ncustom_template/debug=""\n\n[preset.1]\nname="Web"\nplatform="Web"\nexport_path=""\n',
    );
    expect(presets).toEqual([
      { name: 'Windows Desktop', platform: 'Windows Desktop', exportPath: 'build/juego.exe' },
      { name: 'Web', platform: 'Web', exportPath: '' },
    ]);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000280000001680806000000', 'hex');
    expect(pngSize(png)).toEqual({ width: 640, height: 360 });
    expect(pngSize(Buffer.from('nope'))).toBeNull();
    expect(parseUnityVersion('m_EditorVersion: 2022.3.10f1\nm_EditorVersionWithRevision: x')).toBe(
      '2022.3.10f1',
    );
    expect(parseUproject('{"EngineAssociation":"5.4","Modules":[{"Name":"Shooter"}]}')).toEqual({
      engine: '5.4',
      modules: ['Shooter'],
    });
  });
});

describe('AI tool approvals', () => {
  it('looking is free; running Godot asks', () => {
    expect(gamePreview('game_info', {})).toBeNull();
    expect(gamePreview('godot_scene', { path: 'main.tscn' })).toBeNull();
    expect(gamePreview('web_game_url', { path: 'web' })).toBeNull();
    expect(gamePreview('godot_run', { project: 'plat', seconds: 3 })).toMatchObject({
      risk: 'medium',
      allowKey: 'godot_run:plat',
    });
    expect(gamePreview('godot_screenshot', {})).toMatchObject({ risk: 'medium' });
    expect(gamePreview('godot_check', {})).toMatchObject({ allowKey: 'godot_check:' });
    expect(gamePreview('godot_export', { preset: 'Web' })).toMatchObject({
      allowKey: 'godot_export::Web',
    });
    expect(gamePreview('godot_export', { preset: 'x"; rm' })).toHaveProperty('error');
    expect(gamePreview('godot_run', { project: '../x' })).toHaveProperty('error');
    expect(gamePreview('godot_run', { scene: 'C:/x.tscn' })).toHaveProperty('error');
    expect(gamePreview('game_new', { template: 'nope', folder: 'a' })).toHaveProperty('error');
    expect(gamePreview('game_new', { template: 'web-canvas', folder: '../a' })).toHaveProperty(
      'error',
    );
    expect(gamePreview('game_new', { template: 'web-canvas', folder: 'a' })).toMatchObject({
      risk: 'medium',
    });
  });
});

describe('projects and web preview (no Godot needed)', () => {
  it('finds Godot, Unity, Unreal and web game projects', async () => {
    const root = tmp();
    write(root, {
      'plat/project.godot': gameTemplateFiles('godot-platformer', 'Plat')['project.godot']!,
      'plat/main.tscn': '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n',
      'plat/levels/two.tscn': '[gd_scene format=3]\n[node name="L" type="Node2D"]\n',
      'plat/player.gd': 'extends Node\n',
      'plat/.godot/x.tscn': 'ignored',
      'plat/export_presets.cfg':
        '[preset.0]\nname="Web"\nplatform="Web"\nexport_path="build/index.html"\n',
      'unity/ProjectSettings/ProjectVersion.txt': 'm_EditorVersion: 2022.3.10f1\n',
      'unity/Assets/a.cs': '',
      'unreal/Shooter.uproject': '{"EngineAssociation":"5.4"}',
      'web/index.html': '<canvas></canvas><script type="module" src="game.js"></script>',
      'web/game.js': "import * as THREE from 'three';",
      'site/index.html': '<h1>Not a game</h1>',
    });
    const g = new GodotService(tmp());
    const scan = await g.scan(root);
    expect(scan.godot).toHaveLength(1);
    expect(scan.godot[0]).toMatchObject({
      dir: 'plat',
      scenes: ['plat/main.tscn', 'plat/levels/two.tscn'],
      scripts: 1,
    });
    expect(scan.godot[0]!.info.name).toBe('Plat');
    expect(scan.godot[0]!.presets[0]!.name).toBe('Web');
    expect(scan.others).toEqual([
      { kind: 'unity', dir: 'unity', name: 'unity', version: '2022.3.10f1' },
      { kind: 'unreal', dir: 'unreal', name: 'Shooter', version: '5.4', file: 'Shooter.uproject' },
    ]);
    expect(scan.web).toEqual([{ dir: 'web', entry: 'web/index.html', lib: 'three' }]);
    const info = await runGameTool(g, undefined, 'game_info', {}, root);
    expect(info.content).toContain('Godot project "Plat" in "plat"');
    expect(info.content).toContain('Unity project "unity"');
    expect(info.content).toContain('Web game (three) at web/index.html');
    const sc = await runGameTool(
      g,
      undefined,
      'godot_scene',
      { path: 'res://levels/two.tscn' },
      root,
    );
    expect(sc.content).toContain('L (Node2D)');
  });

  it('creates web templates (three.js copied for offline use) and serves them only with the token', async () => {
    const root = tmp();
    const g = new GodotService(tmp());
    const files = await g.create(root, 'cubos', 'web-three', 'Cubos');
    expect(files).toContain('cubos/lib/three.module.min.js');
    expect(readFileSync(join(root, 'cubos/index.html'), 'utf8')).toContain(
      './lib/three.module.min.js',
    );
    await expect(g.create(root, 'cubos', 'web-canvas', 'x')).rejects.toThrow(/ya existe/);
    writeFileSync(join(root, '.env'), 'SECRET=1');
    const web = new WebGameServers();
    try {
      const url = await web.url(root, 'cubos/');
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/[0-9a-f]{32}\/cubos\/$/);
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(page.headers.get('content-type')).toContain('text/html');
      expect(page.headers.get('cross-origin-embedder-policy')).toBeNull();
      const js = await fetch(`${url}lib/three.module.min.js`);
      expect(js.headers.get('content-type')).toContain('javascript');
      const base = url.replace(/cubos\/$/, '');
      expect((await fetch(`${base}.env`)).status).toBe(403);
      expect((await fetch(`${base}..%2F..%2Fsecret`)).status).toBe(403);
      expect((await fetch(url.replace(/\/[0-9a-f]{32}\//, '/0000/'))).status).toBe(404);
      await expect(web.url(root, '../x')).rejects.toThrow();
      // A Godot web export (a .wasm next to the page) is cross-origin isolated.
      write(root, { 'exp/index.html': '<html></html>', 'exp/game.wasm': '' });
      expect(
        (await fetch(`${base}exp/index.html`)).headers.get('cross-origin-embedder-policy'),
      ).toBe('require-corp');
    } finally {
      web.stop();
    }
  });
});

// ───────────── with a real Godot 4 (ZINARIX_GODOT, PATH or the usual places) ─────────────

const live = new GodotService(tmp());
let haveGodot = false;
beforeAll(async () => {
  haveGodot = (await live.status()).state === 'ready';
}, 60_000);

describe('real Godot', () => {
  it('runs every Godot template without errors', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    for (const t of ['godot-platformer', 'godot-topdown', 'godot-3d', 'godot-empty'] as const) {
      await live.create(root, t, t, `Prueba ${t}`);
      const r = await live.runFor(root, t, { seconds: 2 });
      expect(
        r.problems.filter((p) => p.severity === 'error'),
        `${t}: ${r.output}`,
      ).toEqual([]);
      expect(r.exitCode, t).toBe(0);
    }
    const chk = await live.check(root, 'godot-platformer');
    expect(chk).toEqual({ checked: 2, problems: [] });
  }, 300_000);

  it('reports parse and runtime errors with file:line through the AI tools', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'g', 'godot-empty', 'Errores');
    write(root, {
      'g/bad.gd': 'extends Node\nfunc _ready():\n\tvar x = \n',
      'g/main.gd':
        'extends Node2D\n\nfunc _ready() -> void:\n\tprint("hola desde el juego")\n\tvar a = null\n\ta.foo()\n',
    });
    const chk = await runGameTool(live, undefined, 'godot_check', { files: ['g/bad.gd'] }, root);
    expect(chk.content).toMatch(/error: g\/bad\.gd:3.*Parse error/);
    const run = await runGameTool(live, undefined, 'godot_run', { seconds: 1 }, root);
    expect(run.content).toContain('hola desde el juego');
    expect(run.content).toMatch(
      /error: g\/main\.gd:6 in _ready\(\): Invalid call\. Nonexistent function 'foo' in base 'Nil'/,
    );
    expect(run.summary).toBe('1 errores');
  }, 180_000);

  it('shows the AI a frame of the game', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'p', 'godot-platformer', 'Captura');
    const r = await runGameTool(live, undefined, 'godot_screenshot', { at: 1 }, root);
    expect(r.ok, r.content).toBe(true);
    expect(r.image).toMatchObject({ mediaType: 'image/png', width: 960, height: 540 });
    expect(Buffer.from(r.image!.data, 'base64').subarray(1, 4).toString()).toBe('PNG');
  }, 180_000);

  it('serves GDScript completion through the headless editor and the TCP bridge', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'lsp', 'godot-platformer', 'LSP');
    const abs = join(root, 'lsp');
    const port = await live.lspPort(abs);
    const bridge = spawn(process.execPath, ['-e', LSP_TCP_BRIDGE, String(port)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    try {
      let buf = Buffer.alloc(0);
      const msgs: Record<string, unknown>[] = [];
      bridge.stdout.on('data', (d: Buffer) => {
        buf = Buffer.concat([buf, d]);
        for (;;) {
          const i = buf.indexOf('\r\n\r\n');
          if (i < 0) break;
          const n = Number(/Content-Length: (\d+)/i.exec(buf.subarray(0, i).toString())![1]);
          if (buf.length < i + 4 + n) break;
          msgs.push(
            JSON.parse(buf.subarray(i + 4, i + 4 + n).toString()) as Record<string, unknown>,
          );
          buf = buf.subarray(i + 4 + n);
        }
      });
      const send = (m: unknown) => {
        const b = Buffer.from(JSON.stringify(m));
        bridge.stdin.write(`Content-Length: ${b.length}\r\n\r\n`);
        bridge.stdin.write(b);
      };
      const wait = async (pred: (m: Record<string, unknown>) => boolean) => {
        for (let t = 0; t < 150; t++) {
          const m = msgs.find(pred);
          if (m) return m;
          await new Promise((r) => setTimeout(r, 100));
        }
        throw new Error(`no answer; got ${msgs.map((m) => m.method ?? m.id).join(',')}`);
      };
      const uri = (p: string) => `file:///${join(abs, p).replace(/\\/g, '/').replace(/^\//, '')}`;
      send({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { processId: null, rootUri: uri(''), capabilities: {} },
      });
      const init = await wait((m) => m.id === 1);
      expect(JSON.stringify(init)).toContain('completionProvider');
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });
      const text = 'extends CharacterBody2D\n\nfunc _ready() -> void:\n\tmove_and\n';
      send({
        jsonrpc: '2.0',
        method: 'textDocument/didOpen',
        params: {
          textDocument: { uri: uri('player.gd'), languageId: 'gdscript', version: 1, text },
        },
      });
      send({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/completion',
        params: { textDocument: { uri: uri('player.gd') }, position: { line: 3, character: 9 } },
      });
      const comp = await wait((m) => m.id === 2);
      expect(JSON.stringify(comp)).toContain('move_and_slide');
    } finally {
      bridge.kill();
      live.dispose();
    }
  }, 180_000);

  it("stops at a breakpoint through Godot's debug adapter", async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'd', 'godot-empty', 'Debug');
    setGodotLocator(async () => (await live.status()).exe ?? null);
    const events: DebugEvent[] = [];
    const dbg = new DebugManager((e) => events.push(e));
    try {
      await dbg.start(root, null, 'd/main.gd', { 'd/main.gd': [{ line: 5 }] });
      for (let t = 0; t < 300 && !events.some((e) => e.kind === 'stopped'); t++)
        await new Promise((r) => setTimeout(r, 100));
      const stopped = events.find((e) => e.kind === 'stopped') as
        Extract<DebugEvent, { kind: 'stopped' }> | undefined;
      expect(stopped, JSON.stringify(events).slice(0, 2000)).toBeDefined();
      expect(stopped!.frames[0]).toMatchObject({ name: '_ready', line: 5, path: 'd/main.gd' });
    } finally {
      await dbg.stop();
    }
  }, 180_000);
});
