/**
 * Play tests for Godot games (Fase 6 del plan de funciones): the AI "plays" the game. Zinarix
 * adds a temporary autoload (through the project's override.cfg, removed after the run) that
 * reads a plan of timed events: press / release input actions or keys, click or move the
 * mouse, read node properties ("probes") and take screenshots. Game time is fixed (60 fps), so
 * the same plan gives the same result. This file: the driver script, the plan from the AI's
 * steps, the override.cfg merge / clean-up and the parsing of what the driver prints.
 */

export const PLAYTEST_AUTOLOAD = 'ZinarixPlaytest';
const MARK = '; zinarix-playtest (temporary, Zinarix Studio removes it)';

/** The driver (GDScript 4). Prints ZS_PROBE / ZS_SHOT lines with JSON. */
export const PLAYTEST_GD = `extends Node
# Zinarix Studio play test (temporary autoload; Zinarix removes it after the run).

var events: Array = []
var fps := 60.0
var shot_dir := ""
var idx := 0
var start_frame := -1
var busy := false

func _ready() -> void:
	process_mode = Node.PROCESS_MODE_ALWAYS
	var plan_path := ""
	for a in OS.get_cmdline_user_args():
		if a.begins_with("--zs-plan="):
			plan_path = a.substr(10)
	if plan_path == "":
		return
	var data = JSON.parse_string(FileAccess.get_file_as_string(plan_path))
	if typeof(data) != TYPE_DICTIONARY:
		printerr("ZS_PLAN invalid")
		return
	events = data.get("events", [])
	fps = float(data.get("fps", 60))
	shot_dir = str(data.get("shots", ""))
	print("ZS_READY ", events.size())

func _process(_d: float) -> void:
	if events.is_empty() or busy:
		return
	if start_frame < 0:
		start_frame = Engine.get_process_frames()
	var t := float(Engine.get_process_frames() - start_frame) / fps
	while idx < events.size() and float(events[idx].get("t", 0)) <= t + 0.0001:
		var e: Dictionary = events[idx]
		idx += 1
		if e.get("type") == "shot":
			busy = true
			await RenderingServer.frame_post_draw
			_shot(e, t)
			busy = false
			return
		_run(e, t)

func _run(e: Dictionary, t: float) -> void:
	match str(e.get("type")):
		"action":
			var ev := InputEventAction.new()
			ev.action = StringName(str(e.get("name")))
			ev.pressed = bool(e.get("pressed"))
			ev.strength = 1.0 if ev.pressed else 0.0
			Input.parse_input_event(ev)
		"key":
			var k := InputEventKey.new()
			var code := OS.find_keycode_from_string(str(e.get("key")))
			if code == KEY_NONE:
				printerr("ZS_BAD_KEY ", e.get("key"))
				return
			k.keycode = code
			k.physical_keycode = code
			k.pressed = bool(e.get("pressed"))
			Input.parse_input_event(k)
		"mouse":
			var m := InputEventMouseButton.new()
			m.position = Vector2(float(e.get("x", 0)), float(e.get("y", 0)))
			m.global_position = m.position
			m.button_index = int(e.get("button", 1))
			m.pressed = bool(e.get("pressed"))
			Input.warp_mouse(m.position)
			Input.parse_input_event(m)
		"move":
			var mm := InputEventMouseMotion.new()
			mm.position = Vector2(float(e.get("x", 0)), float(e.get("y", 0)))
			mm.global_position = mm.position
			Input.warp_mouse(mm.position)
			Input.parse_input_event(mm)
		"probe":
			_probe(e, t)
		"quit":
			print("ZS_DONE")
			get_tree().quit()

func _probe(e: Dictionary, t: float) -> void:
	var path := str(e.get("node", "."))
	var root: Node = get_tree().current_scene
	var n: Node = null
	if path.begins_with("/root"):
		n = get_node_or_null(NodePath(path))
	elif root:
		n = root.get_node_or_null(NodePath(path))
	var out := {"t": snappedf(t, 0.01), "node": path, "prop": str(e.get("prop", ""))}
	if n == null:
		out["error"] = "node not found"
	elif out["prop"] == "":
		out["value"] = n.get_class()
	else:
		var v = n.get_indexed(NodePath(out["prop"]))
		out["value"] = var_to_str(v)
	print("ZS_PROBE ", JSON.stringify(out))

func _shot(e: Dictionary, t: float) -> void:
	var tex := get_viewport().get_texture()
	var img: Image = tex.get_image() if tex else null
	if img == null or img.is_empty():
		print("ZS_SHOT ", JSON.stringify({"t": snappedf(t, 0.01), "error": "no image"}))
		return
	var f := shot_dir.path_join("shot_%d.png" % idx)
	img.save_png(f)
	print("ZS_SHOT ", JSON.stringify({"t": snappedf(t, 0.01), "file": f}))
`;

export type PlayEvent =
  | { t: number; type: 'action'; name: string; pressed: boolean }
  | { t: number; type: 'key'; key: string; pressed: boolean }
  | { t: number; type: 'mouse'; x: number; y: number; button: number; pressed: boolean }
  | { t: number; type: 'move'; x: number; y: number }
  | { t: number; type: 'probe'; node: string; prop: string }
  | { t: number; type: 'shot' }
  | { t: number; type: 'quit' };

export interface PlayPlan {
  events: PlayEvent[];
  /** Game seconds until it quits. */
  seconds: number;
  shots: number;
}

const MAX_SECONDS = 120;
const MAX_SHOTS = 6;
const MAX_EVENTS = 2000;

const validAction = (s: unknown): s is string =>
  typeof s === 'string' && /^[\w.\-/]{1,80}$/.test(s);
/** Godot key names: A, Space, Enter, Escape, Left, Shift, F1, Kp 1… */
const validKey = (s: unknown): s is string =>
  typeof s === 'string' && /^[A-Za-z0-9 _+\-]{1,24}$/.test(s);
const validNodePath = (s: unknown): s is string =>
  typeof s === 'string' && s.length <= 200 && /^[\w./@ %\-]+$/.test(s);
const validProp = (s: unknown): s is string =>
  typeof s === 'string' &&
  (s === '' || /^[A-Za-z_]\w*(?:[:/][A-Za-z_]\w*)*$/.test(s)) &&
  s.length <= 120;
const nums = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;

/** "Player:position" / "Player.position" / {node, prop} → [node, prop]. */
function splitProbe(v: unknown): [string, string] | null {
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const n = typeof o.node === 'string' ? o.node : '.';
    const p = typeof o.prop === 'string' ? o.prop : '';
    return validNodePath(n) && validProp(p) ? [n, p] : null;
  }
  if (typeof v !== 'string') return null;
  const m = /^([^:]*):(.+)$/.exec(v) ?? /^(.*)\.([A-Za-z_]\w*)$/.exec(v);
  const n = m ? m[1] || '.' : '.';
  const p = m ? m[2]! : v;
  return validNodePath(n) && validProp(p) ? [n, p] : null;
}

/**
 * The plan from the AI's steps:
 *   { at: 0.5, press: "jump" }               action (or { key: "Space" }), released after hold (default 0.1 s)
 *   { at: 1, hold: "move_right", for: 2 }     hold an action 2 s
 *   { at: 1, click: [320, 200], button: "right" }   { at: 1, move: [10, 10] }
 *   { at: 2, shot: true }                     { at: 2, probe: "Player:position" }
 * plus watch (probes repeated every `every` seconds) and seconds (when it quits).
 */
export function buildPlaytestPlan(input: {
  steps?: unknown;
  watch?: unknown;
  every?: unknown;
  seconds?: unknown;
}): PlayPlan {
  const steps = Array.isArray(input.steps) ? input.steps : [];
  if (steps.length > 300) throw new Error('At most 300 steps.');
  const ev: PlayEvent[] = [];
  let lastT = 0;
  steps.forEach((raw, i) => {
    const s = (raw ?? {}) as Record<string, unknown>;
    const at = nums(s.at, 0, MAX_SECONDS);
    if (at === null) throw new Error(`steps[${i}]: "at" (game second) is required.`);
    const bad = (what: string) => new Error(`steps[${i}]: ${what}`);
    const pressKind = (
      v: unknown,
      keyField: unknown,
    ): { type: 'action' | 'key'; id: string } | null => {
      if (keyField !== undefined) {
        if (!validKey(keyField))
          throw bad(
            `bad key ${JSON.stringify(keyField)} (Godot names: A, Space, Enter, Escape, Left, Up…).`,
          );
        return { type: 'key', id: keyField };
      }
      if (v === undefined) return null;
      if (!validAction(v))
        throw bad(
          `bad action ${JSON.stringify(v)} (an input action of the project, see game_info).`,
        );
      return { type: 'action', id: v };
    };
    const down = (
      k: { type: 'action' | 'key'; id: string },
      t: number,
      pressed: boolean,
    ): PlayEvent =>
      k.type === 'action'
        ? { t, type: 'action', name: k.id, pressed }
        : { t, type: 'key', key: k.id, pressed };
    if (
      s.press !== undefined ||
      (s.key !== undefined && s.hold === undefined && s.release === undefined)
    ) {
      const k = pressKind(s.press, s.key)!;
      const dur = nums(s.for, 0.02, MAX_SECONDS) ?? 0.1;
      ev.push(down(k, at, true), down(k, at + dur, false));
      lastT = Math.max(lastT, at + dur);
    } else if (s.hold !== undefined) {
      const k = pressKind(typeof s.hold === 'string' ? s.hold : undefined, s.key)!;
      if (!k) throw bad('hold needs an action name (or key).');
      const dur = nums(s.for, 0.02, MAX_SECONDS);
      ev.push(down(k, at, true));
      if (dur !== null) ev.push(down(k, at + dur, false));
      lastT = Math.max(lastT, at + (dur ?? 0));
    } else if (s.release !== undefined) {
      const k = pressKind(typeof s.release === 'string' ? s.release : undefined, s.key)!;
      if (!k) throw bad('release needs an action name (or key).');
      ev.push(down(k, at, false));
    } else if (s.click !== undefined || s.move !== undefined) {
      const xy = (s.click ?? s.move) as unknown;
      if (
        !Array.isArray(xy) ||
        xy.length !== 2 ||
        xy.some((n) => typeof n !== 'number' || !Number.isFinite(n))
      )
        throw bad('click / move: [x, y] in window pixels.');
      const [x, y] = [Math.round(xy[0] as number), Math.round(xy[1] as number)];
      if (s.move !== undefined) ev.push({ t: at, type: 'move', x, y });
      else {
        const button = s.button === 'right' ? 2 : s.button === 'middle' ? 3 : 1;
        ev.push(
          { t: at, type: 'move', x, y },
          { t: at, type: 'mouse', x, y, button, pressed: true },
          { t: at + 0.05, type: 'mouse', x, y, button, pressed: false },
        );
      }
    } else if (s.shot) {
      ev.push({ t: at, type: 'shot' });
    } else if (s.probe !== undefined) {
      const list = Array.isArray(s.probe) ? s.probe : [s.probe];
      for (const p of list) {
        const np = splitProbe(p);
        if (!np)
          throw bad(
            `bad probe ${JSON.stringify(p)} ("Node/Path:property", e.g. "Player:position" or "/root/Global:score").`,
          );
        ev.push({ t: at, type: 'probe', node: np[0], prop: np[1] });
      }
    } else throw bad('one of press, hold, release, key, click, move, shot or probe.');
    lastT = Math.max(lastT, at);
  });
  const watch = (
    Array.isArray(input.watch) ? input.watch : input.watch !== undefined ? [input.watch] : []
  ).slice(0, 10);
  const every = nums(input.every, 0.1, 10) ?? 0.5;
  const seconds =
    nums(input.seconds, 0.5, MAX_SECONDS) ?? Math.min(MAX_SECONDS, Math.max(2, lastT + 0.5));
  for (const w of watch) {
    const np = splitProbe(w);
    if (!np) throw new Error(`bad watch ${JSON.stringify(w)} ("Node:property").`);
    for (let t = 0; t <= seconds + 1e-9; t += every)
      ev.push({ t: Math.round(t * 100) / 100, type: 'probe', node: np[0], prop: np[1] });
  }
  const shots = ev.filter((e) => e.type === 'shot').length;
  if (shots > MAX_SHOTS) throw new Error(`At most ${MAX_SHOTS} screenshots per play test.`);
  const kept = ev.filter((e) => e.t <= seconds);
  kept.push({ t: seconds, type: 'quit' });
  if (kept.length > MAX_EVENTS)
    throw new Error('Too many events (shorten watch or make "every" bigger).');
  // Stable sort by time: a press and the probe at the same second keep the given order.
  const ordered = kept
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i)
    .map((x) => ({ ...x.e, t: Math.round(x.e.t * 1000) / 1000 }));
  return { events: ordered, seconds, shots };
}

/** override.cfg with our autoload added (keeps whatever the project had). */
export function overrideWithPlaytest(existing: string | null, driverPath: string): string {
  const clean = existing ? stripPlaytest(existing) : '';
  const entry = `${PLAYTEST_AUTOLOAD}="*${driverPath.replace(/\\/g, '/').replace(/"/g, '\\"')}"`;
  const eol = clean.includes('\r\n') ? '\r\n' : '\n';
  const lines = clean ? clean.split(/\r?\n/) : [];
  const sec = lines.findIndex((l) => l.trim() === '[autoload]');
  if (sec >= 0) {
    lines.splice(sec + 1, 0, MARK, entry);
    return lines.join(eol);
  }
  const head = [MARK, '[autoload]', MARK, entry, MARK, ''];
  return [...head, ...lines].join(eol);
}

/** Removes what overrideWithPlaytest added ('' when nothing else is left). */
export function stripPlaytest(text: string): string {
  const lines = text.split(/\r?\n/);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === MARK) {
      i++; // the marked line after it
      continue;
    }
    if (lines[i]!.startsWith(`${PLAYTEST_AUTOLOAD}=`)) continue;
    out.push(lines[i]!);
  }
  const rest = out.join(eol);
  return rest.trim() ? rest : '';
}

export const hasPlaytest = (text: string) => text.includes(MARK);

export interface PlayProbe {
  t: number;
  node: string;
  prop: string;
  value?: string;
  error?: string;
}

export interface PlayOutput {
  ready: boolean;
  done: boolean;
  probes: PlayProbe[];
  shots: { t: number; file?: string; error?: string }[];
  badKeys: string[];
  /** The output without our lines. */
  output: string;
}

export function parsePlaytestOutput(text: string): PlayOutput {
  const r: PlayOutput = {
    ready: false,
    done: false,
    probes: [],
    shots: [],
    badKeys: [],
    output: '',
  };
  const keep: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^ZS_(READY|DONE|PROBE|SHOT|BAD_KEY|PLAN)\b ?(.*)$/.exec(line.trim());
    if (!m) {
      keep.push(line);
      continue;
    }
    try {
      if (m[1] === 'READY') r.ready = true;
      else if (m[1] === 'DONE') r.done = true;
      else if (m[1] === 'PROBE') r.probes.push(JSON.parse(m[2]!) as PlayProbe);
      else if (m[1] === 'SHOT') r.shots.push(JSON.parse(m[2]!) as PlayOutput['shots'][number]);
      else if (m[1] === 'BAD_KEY') r.badKeys.push(m[2]!.trim());
      else keep.push(line);
    } catch {
      keep.push(line);
    }
  }
  r.output = keep.join('\n');
  return r;
}

/** Probes as a compact timeline for the AI: one line per time, "Player:position=Vector2(…)". */
export function describeProbes(probes: PlayProbe[], max = 120): string {
  if (!probes.length) return '';
  const byT = new Map<number, PlayProbe[]>();
  for (const p of probes) (byT.get(p.t) ?? byT.set(p.t, []).get(p.t)!).push(p);
  const rows = [...byT.entries()].sort((a, b) => a[0] - b[0]);
  const lines = rows
    .slice(0, max)
    .map(
      ([t, ps]) =>
        `t=${t.toFixed(2)}s  ${ps.map((p) => `${p.node}${p.prop ? `:${p.prop}` : ''}=${p.error ? `(${p.error})` : (p.value ?? '').slice(0, 120)}`).join('  ')}`,
    );
  if (rows.length > max) lines.push(`… (+${rows.length - max} more times)`);
  return lines.join('\n');
}
