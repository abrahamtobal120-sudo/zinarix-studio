import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  applySceneOpsFull,
  applyScriptRenames,
  relativeNodePath,
  renameInScript,
  renameNode,
  renamedRef,
  resolveNodePath,
  sceneScripts,
  scriptRenames,
} from '../src/shared/tscnEdit.js';
import { runGameTool } from '../src/main/gameTools.js';
import type { GodotService } from '../src/main/godot.js';

const SCENE = `[gd_scene load_steps=3 format=3 uid="uid://abc"]

[ext_resource type="Script" path="res://player.gd" id="1_p"]
[ext_resource type="Script" path="res://main.gd" id="2_m"]

[node name="Main" type="Node2D"]
script = ExtResource("2_m")

[node name="Player" type="CharacterBody2D" parent="."]
script = ExtResource("1_p")

[node name="Sprite" type="Sprite2D" parent="Player"]

[node name="Camera" type="Camera2D" parent="Player"]
target = NodePath("../Sprite")
other = NodePath("../../Enemy")

[node name="Enemy" type="Node2D" parent="."]
unique_name_in_owner = true
chase = NodePath("../Player/Sprite:modulate")

[node name="Hud" type="CanvasLayer" parent="."]
follow = [NodePath("../Player"), NodePath("../Enemy")]

[connection signal="hit" from="Player" to="." method="_on_player_hit"]
`;

const MAIN_GD = `extends Node2D
# $Player is the hero (this comment stays)
@onready var player = $Player
@onready var sprite: Sprite2D = get_node("Player/Sprite")
var quoted = $"Player"
var path := ^"Player/Camera"
var rest = 10 % 3

func _ready() -> void:
\tplayer.jump()
\t%Enemy.hit()
\tprint("$Player in a string")
`;

const PLAYER_GD = `extends CharacterBody2D
@onready var sprite = $Sprite
@onready var enemy = get_node("../Enemy")
@onready var me = get_node_or_null("../Player")
`;

describe('node paths', () => {
  it('resolve and write relative paths like Godot', () => {
    expect(resolveNodePath('.', 'Player/Sprite')).toBe('Player/Sprite');
    expect(resolveNodePath('Player/Camera', '../Sprite')).toBe('Player/Sprite');
    expect(resolveNodePath('Player', '..')).toBe('.');
    expect(resolveNodePath('.', '../Outside')).toBeNull();
    expect(resolveNodePath('.', '/root/Main')).toBeNull();
    expect(resolveNodePath('.', '%Enemy')).toBeNull();
    expect(relativeNodePath('Hero/Camera', 'Hero/Sprite')).toBe('../Sprite');
    expect(relativeNodePath('.', 'Hero')).toBe('Hero');
    expect(relativeNodePath('Hero', 'Hero')).toBe('.');
    const r = { old: 'Player', now: 'Hero' };
    expect(renamedRef('../Player/Sprite:modulate', 'Enemy', r)).toBe('../Hero/Sprite:modulate');
    // Relative paths that do not go through the renamed node stay as written.
    expect(renamedRef('../Sprite', 'Player/Camera', r)).toBeNull();
    expect(renamedRef('Enemy', '.', r)).toBeNull();
  });
});

describe('renaming a node follows the references', () => {
  it('updates NodePath values of the scene, not the ones that still work', () => {
    const r = renameNode(SCENE, 'Player', 'Hero');
    expect(r.path).toBe('Hero');
    expect(r.text).toContain('chase = NodePath("../Hero/Sprite:modulate")');
    expect(r.text).toContain('follow = [NodePath("../Hero"), NodePath("../Enemy")]');
    expect(r.text).toContain('target = NodePath("../Sprite")');
    expect(r.text).toContain('other = NodePath("../../Enemy")');
    expect(r.text).toContain('[node name="Sprite" type="Sprite2D" parent="Hero"]');
    expect(r.text).toContain('from="Hero"');
    expect(r.refs).toBe(2);
    // Untouched lines stay byte for byte.
    expect(r.text.split('\n').length).toBe(SCENE.split('\n').length);
  });

  it('finds the scripts attached to the nodes', () => {
    expect(sceneScripts(SCENE)).toEqual([
      { res: 'res://main.gd', holder: '.' },
      { res: 'res://player.gd', holder: 'Player' },
    ]);
  });

  it('updates $Paths, get_node and ^"…" in the scripts, not comments or strings', () => {
    const rn = renameNode(SCENE, 'Player', 'Hero').rename!;
    const main = renameInScript(MAIN_GD, '.', rn);
    expect(main.code).toContain('@onready var player = $Hero');
    expect(main.code).toContain('get_node("Hero/Sprite")');
    expect(main.code).toContain('var quoted = $"Hero"');
    expect(main.code).toContain('var path := ^"Hero/Camera"');
    expect(main.code).toContain('# $Player is the hero');
    expect(main.code).toContain('print("$Player in a string")');
    expect(main.code).toContain('var rest = 10 % 3');
    expect(main.count).toBe(4);
    const player = renameInScript(PLAYER_GD, 'Player', rn);
    expect(player.code).toContain('$Sprite');
    expect(player.code).toContain('get_node("../Enemy")');
    expect(player.code).toContain('get_node_or_null("../Hero")');
    expect(player.count).toBe(1);
  });

  it('follows %Unique names of unique nodes', () => {
    const r = renameNode(SCENE, 'Enemy', 'Boss');
    expect(r.rename?.unique).toEqual({ old: 'Enemy', now: 'Boss' });
    const main = renameInScript(MAIN_GD, '.', r.rename!);
    expect(main.code).toContain('%Boss.hit()');
    expect(main.code).toContain('var rest = 10 % 3');
    expect(r.text).toContain('other = NodePath("../../Boss")');
  });

  it('chains several renames for each script', () => {
    const { text, renames } = applySceneOpsFull(SCENE, [
      { op: 'rename', node: 'Player', name: 'Hero' },
      { op: 'rename', node: 'Hero/Sprite', name: 'Body' },
    ]);
    expect(text).toContain('chase = NodePath("../Hero/Body:modulate")');
    const per = scriptRenames(SCENE, renames);
    const main = applyScriptRenames(MAIN_GD, per.find((s) => s.res === 'res://main.gd')!);
    expect(main.code).toContain('get_node("Hero/Body")');
    const player = applyScriptRenames(PLAYER_GD, per.find((s) => s.res === 'res://player.gd')!);
    expect(player.code).toContain('@onready var sprite = $Body');
  });
});

describe('godot_scene_edit renames also fix the scripts', () => {
  const root = mkdtempSync(join(tmpdir(), 'zinarix-rename-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('writes the scene and the scripts that pointed at the node', async () => {
    mkdirSync(join(root, 'juego'));
    writeFileSync(join(root, 'juego/project.godot'), 'config_version=5\n');
    writeFileSync(join(root, 'juego/main.tscn'), SCENE);
    writeFileSync(join(root, 'juego/main.gd'), MAIN_GD);
    writeFileSync(join(root, 'juego/player.gd'), PLAYER_GD);
    const r = await runGameTool(
      {} as GodotService,
      undefined,
      'godot_scene_edit',
      { path: 'juego/main.tscn', ops: [{ op: 'rename', node: 'Player', name: 'Hero' }] },
      root,
    );
    expect(r.ok, r.content).toBe(true);
    expect(r.content).toContain('juego/main.gd (4)');
    expect(readFileSync(join(root, 'juego/main.gd'), 'utf8')).toContain('$Hero');
    expect(readFileSync(join(root, 'juego/player.gd'), 'utf8')).toContain('get_node_or_null("../Hero")');
    expect(readFileSync(join(root, 'juego/main.tscn'), 'utf8')).toContain('[node name="Hero"');
  });
});
