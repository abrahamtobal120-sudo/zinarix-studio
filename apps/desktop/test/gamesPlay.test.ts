import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseTscn } from '../src/shared/games.js';
import {
  addExtResource,
  addNode,
  applySceneOps,
  attachScript,
  colorFromHex,
  connectSignal,
  disconnectSignal,
  hexFromColor,
  moveNode,
  parseSceneOps,
  removeNode,
  renameNode,
  setNodeProp,
  validGodotValue,
  validNodeName,
  valueKind,
  valueLike,
} from '../src/shared/tscnEdit.js';
import {
  buildPlaytestPlan,
  describeProbes,
  overrideWithPlaytest,
  parsePlaytestOutput,
  stripPlaytest,
} from '../src/shared/godotPlaytest.js';
import { GodotService } from '../src/main/godot.js';
import { gamePreview, runGameTool } from '../src/main/gameTools.js';

/** Mejoras de la Fase 6: editing .tscn scenes and play tests (the AI presses keys in the game). */

const tmps: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'zx-gplay-'));
  tmps.push(d);
  return d;
};
afterAll(() => {
  for (const d of tmps)
    rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const SCENE = [
  '[gd_scene load_steps=2 format=3 uid="uid://abc"]',
  '',
  '[ext_resource type="Script" path="res://main.gd" id="1_main"]',
  '',
  '[node name="Main" type="Node2D"]',
  'script = ExtResource("1_main")',
  '',
  '[node name="Player" type="CharacterBody2D" parent="."]',
  'position = Vector2(200, 440)',
  '',
  '[node name="Sprite" type="Sprite2D" parent="Player"]',
  '',
  '[node name="Coin" type="Area2D" parent="."]',
  'position = Vector2(620, 340)',
  'metadata/info = {',
  '"a": 1',
  '}',
  '',
  '[node name="Shape" type="CollisionShape2D" parent="Coin"]',
  '',
  '[connection signal="body_entered" from="Coin" to="." method="_on_coin"]',
  '',
].join('\r\n');

describe('editing .tscn scenes', () => {
  it('sets, replaces and removes properties, keeping CRLF and the rest of the file', () => {
    let t = setNodeProp(SCENE, 'Player', 'position', 'Vector2(10, 20)');
    expect(t).toContain('position = Vector2(10, 20)\r\n');
    expect(t.split('\r\n').length).toBe(SCENE.split('\r\n').length);
    t = setNodeProp(t, 'Player/Sprite', 'modulate', 'Color(1, 0, 0, 1)');
    expect(parseTscn(t).nodes.find((n) => n.path === 'Player/Sprite')!.props.modulate).toBe(
      'Color(1, 0, 0, 1)',
    );
    // A multi-line value is replaced whole.
    t = setNodeProp(t, 'Coin', 'metadata/info', '{"a": 2}');
    expect(t).not.toContain('"a": 1');
    t = setNodeProp(t, 'Coin', 'position', null);
    expect(parseTscn(t).nodes.find((n) => n.path === 'Coin')!.props).toEqual({
      'metadata/info': '{"a": 2}',
    });
    expect(t).not.toMatch(/(?<!\r)\n/); // still CRLF everywhere
    expect(() => setNodeProp(SCENE, 'Nope', 'x', '1')).toThrow(/No node/);
    expect(() => setNodeProp(SCENE, '.', 'x', '1\n[node name="Evil"]')).toThrow(/Bad value/);
    expect(() => setNodeProp(SCENE, '.', 'bad key', '1')).toThrow(/Bad property/);
  });

  it('adds, renames, moves and removes nodes with their children and connections', () => {
    const a = addNode(SCENE, 'Player', 'Hat', 'Sprite2D', { position: 'Vector2(0, -20)' });
    expect(a.path).toBe('Player/Hat');
    let s = parseTscn(a.text);
    expect(s.nodes.map((n) => n.path)).toEqual([
      '.',
      'Player',
      'Player/Sprite',
      'Player/Hat',
      'Coin',
      'Coin/Shape',
    ]);
    expect(s.nodes[3]!.props.position).toBe('Vector2(0, -20)');
    expect(() => addNode(SCENE, '.', 'Player', 'Node2D')).toThrow(/already has a child/);
    expect(() => addNode(SCENE, '.', 'a/b', 'Node2D')).toThrow(/Bad node name/);

    const r = renameNode(a.text, 'Coin', 'Gem');
    s = parseTscn(r.text);
    expect(r.path).toBe('Gem');
    expect(s.nodes.map((n) => n.path)).toContain('Gem/Shape');
    expect(s.connections[0]).toMatchObject({ from: 'Gem', to: '.' });
    expect(renameNode(SCENE, '.', 'Root').text).toContain('[node name="Root" type="Node2D"]');

    const m = moveNode(SCENE, 'Coin', -1);
    expect(parseTscn(m).nodes.map((n) => n.path)).toEqual([
      '.',
      'Coin',
      'Coin/Shape',
      'Player',
      'Player/Sprite',
    ]);
    expect(moveNode(m, 'Coin', 1)).toBe(SCENE);
    expect(moveNode(SCENE, 'Player', -1)).toBe(SCENE); // already first

    const d = removeNode(SCENE, 'Coin');
    s = parseTscn(d);
    expect(s.nodes.map((n) => n.path)).toEqual(['.', 'Player', 'Player/Sprite']);
    expect(s.connections).toEqual([]);
    expect(() => removeNode(SCENE, '.')).toThrow(/root/);
  });

  it('connects signals and attaches scripts with a new ext_resource', () => {
    let t = connectSignal(SCENE, 'body_exited', 'Coin', '.', '_on_coin_exit');
    expect(parseTscn(t).connections).toHaveLength(2);
    expect(connectSignal(t, 'body_exited', 'Coin', '.', '_on_coin_exit')).toBe(t);
    t = disconnectSignal(t, 'body_entered', 'Coin', '.');
    expect(parseTscn(t).connections.map((c) => c.signal)).toEqual(['body_exited']);

    t = attachScript(SCENE, 'Player', 'res://player.gd');
    const s = parseTscn(t);
    expect(s.nodes.find((n) => n.path === 'Player')!.script).toBe('res://player.gd');
    expect(s.ext.map((e) => e.path)).toEqual(['res://main.gd', 'res://player.gd']);
    expect(t).toContain('load_steps=3');
    // The same script again reuses its resource.
    expect(addExtResource(t, 'Script', 'res://player.gd').text).toBe(t);
    expect(
      parseTscn(attachScript(t, 'Player', null)).nodes.find((n) => n.path === 'Player')!.script,
    ).toBeUndefined();
    expect(() => attachScript(SCENE, 'Player', 'res://../x.gd')).toThrow(/Bad resource/);
  });

  it('applies AI ops all or nothing', () => {
    const ops = parseSceneOps([
      {
        op: 'add',
        parent: '.',
        name: 'Enemy',
        type: 'CharacterBody2D',
        props: { position: 'Vector2(800, 440)' },
      },
      { op: 'set', node: 'Enemy', prop: 'speed', value: 120 },
      { op: 'connect', signal: 'body_entered', from: 'Coin', to: 'Enemy', method: '_hit' },
      { op: 'rename', node: 'Enemy', name: 'Bat' },
    ]);
    const t = applySceneOps(SCENE, ops);
    const s = parseTscn(t);
    expect(s.nodes.find((n) => n.path === 'Bat')!.props).toEqual({
      position: 'Vector2(800, 440)',
      speed: '120',
    });
    expect(s.connections.map((c) => c.to)).toEqual(['.', 'Bat']);
    expect(() =>
      applySceneOps(
        SCENE,
        parseSceneOps([
          { op: 'remove', node: 'Coin' },
          { op: 'set', node: 'Coin', prop: 'x', value: '1' },
        ]),
      ),
    ).toThrow(/ops\[1\] \(set\): No node/);
    expect(() => parseSceneOps([{ op: 'explode' }])).toThrow(/unknown op/);
    const card = gamePreview('godot_scene_edit', {
      path: 'g/main.tscn',
      ops: [{ op: 'remove', node: 'Coin' }],
    });
    expect(card).toMatchObject({ risk: 'medium', action: expect.stringContaining('borrar Coin') });
  });

  it('reads and writes values like the Scene view does', () => {
    expect(
      [
        'true',
        '3',
        '1.5',
        '"hola"',
        'Color(1, 0, 0, 1)',
        'Vector2(1, 2)',
        'Vector3(1, 2, 3)',
        'ExtResource("1")',
      ].map(valueKind),
    ).toEqual(['bool', 'int', 'float', 'string', 'color', 'vector2', 'vector3', 'other']);
    expect(valueLike('1.0', '2')).toBe('2.0');
    expect(valueLike('"a"', 'di "hola"')).toBe('"di \\"hola\\""');
    expect(colorFromHex('#ff0000', 0.5)).toBe('Color(1, 0, 0, 0.5)');
    expect(hexFromColor('Color(1, 0.5, 0, 1)')).toEqual({ hex: '#ff8000', alpha: 1 });
    expect(validGodotValue('Vector2(1, 2))')).toBe(false);
    expect(validGodotValue('"a ] ["')).toBe(true);
    expect(validNodeName('Player 2')).toBe(true);
    expect(validNodeName('a.b')).toBe(false);
  });
});

describe('play test plans', () => {
  it('turns steps into timed events and checks them', () => {
    const p = buildPlaytestPlan({
      steps: [
        { at: 1, hold: 'move_right', for: 2 },
        { at: 0.5, press: 'jump' },
        { at: 1.5, key: 'Space' },
        { at: 2, click: [10.4, 20], button: 'right' },
        { at: 3, probe: 'Player:position' },
        { at: 3, shot: true },
      ],
      watch: ['/root/Game:score'],
      every: 1,
    });
    expect(p.seconds).toBe(3.5);
    expect(p.shots).toBe(1);
    const kinds = p.events.map((e) => `${e.t}:${e.type}`);
    expect(kinds.slice(0, 3)).toEqual(['0:probe', '0.5:action', '0.6:action']);
    expect(p.events.find((e) => e.type === 'mouse')).toMatchObject({
      x: 10,
      y: 20,
      button: 2,
      pressed: true,
    });
    expect(p.events.at(-1)).toEqual({ t: 3.5, type: 'quit' });
    expect(p.events.filter((e) => e.type === 'probe' && e.node === '/root/Game').length).toBe(4);
    expect(() => buildPlaytestPlan({ steps: [{ press: 'jump' }] })).toThrow(/"at"/);
    expect(() => buildPlaytestPlan({ steps: [{ at: 1, press: 'a"b' }] })).toThrow(/bad action/);
    expect(() => buildPlaytestPlan({ steps: [{ at: 1, probe: 'P:x;y' }] })).toThrow(/bad probe/);
    expect(() =>
      buildPlaytestPlan({ steps: Array.from({ length: 7 }, (_, i) => ({ at: i, shot: true })) }),
    ).toThrow(/screenshots/);
    expect(gamePreview('godot_playtest', { steps: [{ at: 1, press: 'jump' }] })).toMatchObject({
      allowKey: 'godot_run:',
    });
  });

  it('adds and removes its autoload from override.cfg without touching the rest', () => {
    const drv = 'C:\\tmp\\zs_playtest.gd';
    const fresh = overrideWithPlaytest(null, drv);
    expect(fresh).toContain('ZinarixPlaytest="*C:/tmp/zs_playtest.gd"');
    expect(stripPlaytest(fresh)).toBe('');
    const mine =
      '[display]\r\n\r\nwindow/size/viewport_width=640\r\n\r\n[autoload]\r\n\r\nX="*res://x.gd"\r\n';
    const both = overrideWithPlaytest(mine, drv);
    expect(both).toContain('[autoload]\r\n; zinarix-playtest');
    expect(stripPlaytest(both)).toBe(mine);
    expect(stripPlaytest(overrideWithPlaytest('a=1\n', drv))).toBe('a=1\n');
    // Twice in a row (a stale one): still one entry.
    expect(overrideWithPlaytest(both, drv).match(/ZinarixPlaytest=/g)).toHaveLength(1);
  });

  it('reads what the driver prints', () => {
    const out = parsePlaytestOutput(
      [
        'Godot Engine v4',
        'ZS_READY 3',
        'hola',
        'ZS_PROBE {"t":0.5,"node":"Player","prop":"position","value":"Vector2(1, 2)"}',
        'ZS_PROBE {"t":0.5,"node":"X","prop":"a","error":"node not found"}',
        'ZS_SHOT {"t":1,"file":"C:/s.png"}',
        'ZS_DONE',
      ].join('\n'),
    );
    expect(out).toMatchObject({
      ready: true,
      done: true,
      shots: [{ t: 1, file: 'C:/s.png' }],
      output: 'Godot Engine v4\nhola',
    });
    expect(describeProbes(out.probes)).toBe(
      't=0.50s  Player:position=Vector2(1, 2)  X:a=(node not found)',
    );
  });
});

// ───────────── with a real Godot 4 ─────────────

const live = new GodotService(tmp());
let haveGodot = false;
beforeAll(async () => {
  haveGodot = (await live.status()).state === 'ready';
}, 60_000);

const vec = (v: string | undefined) =>
  (v ?? '')
    .replace(/^[^(]*\(/, '')
    .match(/-?[\d.]+/g)!
    .map(Number);

describe('real Godot play test', () => {
  it('the AI moves and jumps the platformer player, and override.cfg is left as it was', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'p', 'godot-platformer', 'Saltos');
    writeFileSync(join(root, 'p/override.cfg'), '[debug]\n\nsettings/stdout/print_fps=false\n');
    const r = await runGameTool(
      live,
      undefined,
      'godot_playtest',
      {
        steps: [
          { at: 0.5, probe: 'Player:position' },
          { at: 0.5, hold: 'move_right', for: 1 },
          { at: 1.6, probe: 'Player:position' },
          { at: 2, key: 'Space' },
          { at: 2.25, probe: ['Player:position', 'Player:velocity:y', 'Nope:x'] },
          { at: 2.3, hold: true, key: 'A', for: 0.5 },
          { at: 2.9, probe: 'Player:position:x' },
        ],
        seconds: 3,
      },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(r.content).toContain('PLAYED 3 game seconds');
    const out = r.content;
    const at = (t: string, what: string) =>
      new RegExp(
        `t=${t}s .*?${what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}=(\\w+\\([^)]*\\)|\\S+)`,
      ).exec(out)?.[1];
    const x0 = vec(at('0.50', 'Player:position'))[0]!;
    const p1 = vec(at('1.60', 'Player:position'));
    // 1 s at 260 px/s to the right.
    expect(p1[0]! - x0).toBeGreaterThan(230);
    expect(p1[0]! - x0).toBeLessThan(290);
    // Space (the jump action's key) lifts the player.
    const p2 = vec(at('2.25', 'Player:position'));
    expect(p2[1]!).toBeLessThan(p1[1]! - 40);
    expect(out).toContain('Nope:x=(node not found)');
    // "A" moves it back left.
    expect(Number(at('2.90', 'Player:position:x'))).toBeLessThan(p2[0]! - 60);
    expect(readFileSync(join(root, 'p/override.cfg'), 'utf8')).toBe(
      '[debug]\n\nsettings/stdout/print_fps=false\n',
    );
  }, 180_000);

  it('takes screenshots while playing and cleans a stale override.cfg', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'p', 'godot-platformer', 'Fotos');
    const r = await runGameTool(
      live,
      undefined,
      'godot_playtest',
      {
        steps: [
          { at: 0.5, shot: true },
          { at: 1, hold: 'move_right', for: 0.5 },
          { at: 1.6, shot: true },
        ],
      },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(r.content).toMatch(/screenshots: t=0\.5s 960×540, t=1\.6s 960×540/);
    expect(r.image).toMatchObject({ mediaType: 'image/png', width: 960, height: 540 });
    expect(existsSync(join(root, 'p/override.cfg'))).toBe(false);
    // As if Zinarix had closed in the middle of a play test: the next run removes our autoload.
    writeFileSync(join(root, 'p/override.cfg'), overrideWithPlaytest(null, join(root, 'gone.gd')));
    const run = await live.runFor(root, 'p', { seconds: 0.5 });
    expect(
      run.problems.filter((x) => x.severity === 'error'),
      run.output,
    ).toEqual([]);
    expect(existsSync(join(root, 'p/override.cfg'))).toBe(false);
  }, 180_000);

  it('a scene edited with godot_scene_edit still runs', async (ctx) => {
    if (!haveGodot) ctx.skip();
    const root = tmp();
    await live.create(root, 'p', 'godot-platformer', 'Editada');
    const r = await runGameTool(
      live,
      undefined,
      'godot_scene_edit',
      {
        path: 'p/main.tscn',
        ops: [
          {
            op: 'add',
            parent: '.',
            name: 'Coin2',
            type: 'Area2D',
            props: { position: 'Vector2(300, 470)' },
          },
          {
            op: 'add',
            parent: 'Coin2',
            name: 'Look',
            type: 'ColorRect',
            props: { offset_right: '16.0', offset_bottom: '16.0', color: 'Color(1, 0.8, 0, 1)' },
          },
          { op: 'set', node: 'Player', prop: 'position', value: 'Vector2(120, 440)' },
        ],
      },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(r.changed).toBe('p/main.tscn');
    expect(r.content).toMatch(/Coin2 \(Area2D\)/);
    const play = await runGameTool(
      live,
      undefined,
      'godot_playtest',
      { steps: [{ at: 0.2, probe: ['Coin2:position', 'Player:position', 'Coin2/Look:color'] }] },
      root,
    );
    expect(play.content, play.content).toMatch(/Coin2:position=Vector2\(300, 470\)/);
    expect(play.content).toMatch(/Coin2\/Look:color=Color\(1, 0\.8, 0, 1\)/);
    expect(play.content).toMatch(/RAN WITHOUT ERRORS/);
  }, 180_000);
});
