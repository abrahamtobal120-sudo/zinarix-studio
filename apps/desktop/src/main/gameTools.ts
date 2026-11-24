import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import type { ComputerShot } from './computerTools.js';
import type { GodotProject, GodotRunResult, GodotService } from './godot.js';
import type { SystemPreview } from './system.js';
import type { WebGameServers } from './webGame.js';
import {
  describeScene,
  isGameTemplate,
  parseTscn,
  resToRel,
  validNewFolder,
  validPresetName,
  validProjectDir,
  validScene,
  type GodotProblem,
} from '../shared/games.js';
import { buildPlaytestPlan, describeProbes } from '../shared/godotPlaytest.js';
import {
  applySceneOpsFull,
  applyScriptRenames,
  describeSceneOp,
  parseSceneOps,
  scriptRenames,
} from '../shared/tscnEdit.js';

/**
 * Fase 6 (plan de funciones): video games for the agent. Looking (projects, scenes) is free;
 * anything that starts Godot on the project asks, because Godot loads the project's code
 * (scripts, autoloads and native GDExtensions) as soon as it opens it.
 */

export const GAME_TOOLS: ToolDefinition[] = [
  {
    name: 'game_info',
    description:
      'Video game projects of the open folder: Godot 4 (project.godot: name, main scene, version, autoloads, input actions, scenes, export presets), Unity and Unreal projects, and web games (index.html with three.js, Phaser, Pixi or a canvas). Also tells whether Godot is installed and which version.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'godot_scene',
    description:
      'Read a Godot scene (.tscn) as a node tree: name, class or instanced scene, script, groups, main properties and the line of each node, plus its signal connections. Use it before editing a .tscn by hand (keep the text format: [ext_resource], [sub_resource], [node name= type= parent=], [connection]).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'The .tscn, relative to the open folder (or res://… with project)',
        },
        project: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'godot_run',
    description:
      'Run a Godot project (or one scene) for some seconds and return what it printed plus the errors and warnings with file:line (script errors, null calls, missing nodes…). headless (default true) runs the game logic without a window at a fixed 60 fps, faster than real time; headless=false opens the game window. Use it after editing scripts to see if the game works. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: {
          type: 'string',
          description:
            'Folder with project.godot relative to the open folder ("" = the folder). Optional when there is one.',
        },
        scene: {
          type: 'string',
          description: 'A .tscn to run instead of the main scene (relative or res://)',
        },
        seconds: {
          type: 'number',
          minimum: 0.5,
          maximum: 120,
          description: 'Game seconds to run (default 5)',
        },
        headless: { type: 'boolean' },
      },
    },
  },
  {
    name: 'godot_screenshot',
    description:
      "See the game: render it with Godot's movie writer and return the frame at the given second of play (default 2) as an image, plus the errors it printed. It opens the game window for a moment and needs a GPU. Use it to check how a scene looks after changing it. The user approves it.",
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        scene: { type: 'string' },
        at: {
          type: 'number',
          minimum: 0,
          maximum: 30,
          description: 'Second of play to capture (default 2)',
        },
      },
    },
  },
  {
    name: 'godot_playtest',
    description:
      'PLAY the game to test it: Godot runs it (or one scene) at a fixed 60 fps while Zinarix presses input actions or keys, clicks, reads node properties and takes screenshots at the game seconds you give. Use it to check that the controls and the gameplay really work (the player moves and jumps, a coin adds score, a menu button opens the level…). steps (sorted by "at", game seconds): {"at":0.5,"press":"jump"} (tap an input action, "for" = hold seconds, default 0.1), {"at":1,"hold":"move_right","for":2}, {"at":1,"key":"Space"} (a key by Godot name: A, Space, Enter, Escape, Left, Up, Shift…), {"at":2,"click":[320,180],"button":"left"} (window pixels), {"at":2,"move":[10,10]}, {"at":3,"probe":"Player:position"} (node path from the scene root, or /root/Autoload:prop; "." is the root; sub-properties like "Player:position:x"), {"at":3,"shot":true} (screenshot, up to 6; opens the game window). watch: probes repeated every "every" seconds (default 0.5). Returns the probe values over time, the screenshots (the last one as an image) and the errors with file:line. Input action names: see game_info. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        scene: { type: 'string', description: 'A .tscn to play instead of the main scene' },
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Timed steps, see the description',
        },
        watch: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Properties to sample over time, like "Player:position" or "/root/Game:score"',
        },
        every: { type: 'number', minimum: 0.1, maximum: 10 },
        seconds: {
          type: 'number',
          minimum: 0.5,
          maximum: 120,
          description: 'Game seconds to play (default: last step + 0.5)',
        },
      },
      required: ['steps'],
    },
  },
  {
    name: 'godot_scene_edit',
    description:
      'Edit a Godot scene (.tscn) safely, without rewriting it by hand: ops applied in order (all or nothing), keeping the rest of the file as it is. {"op":"set","node":"Player","prop":"position","value":"Vector2(100, 200)"} (value: a raw Godot value: 1.0, true, "text", Vector2(…), Color(r, g, b, a), ExtResource("id"); null removes the property so it goes back to its default), {"op":"add","parent":".","name":"Coin2","type":"Area2D","props":{"position":"Vector2(300, 0)"}}, {"op":"remove","node":"Enemy"} (with its children and their signal connections), {"op":"rename","node":"Player","name":"Hero"} (updates child paths and connections; NodePath values and scripts that use the old name are not changed), {"op":"move","node":"HUD","dir":"up"}, {"op":"connect","signal":"body_entered","from":"Coin","to":".","method":"_on_coin_body_entered"}, {"op":"disconnect",…}, {"op":"script","node":"Player","path":"res://player.gd"} (null detaches). Node paths are from the scene root ("." is the root, "Player/Sprite"). Read the scene with godot_scene first. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The .tscn, relative to the open folder' },
        ops: { type: 'array', items: { type: 'object' } },
      },
      required: ['path', 'ops'],
    },
  },
  {
    name: 'godot_check',
    description:
      'Check GDScript files for parse and type errors without running the game (godot --check-only). files: .gd files relative to the open folder or res://; default every script of the project. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        files: { type: 'array', items: { type: 'string' } },
      },
    },
  },
  {
    name: 'godot_export',
    description:
      'Export (build) a Godot game with an export preset from export_presets.cfg ("Windows Desktop", "Web", "Linux"…, see game_info). Needs Godot\'s export templates installed. debug=true makes a debug build. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        preset: { type: 'string' },
        debug: { type: 'boolean' },
      },
      required: ['preset'],
    },
  },
  {
    name: 'game_new',
    description:
      'Create a new game project in a new folder of the open folder from a template: "godot-platformer" (2D platformer with a player, jump, a coin and a score), "godot-topdown" (2D top-down movement), "godot-3d" (3D character with a camera, sky and light), "godot-empty", "web-canvas" (2D canvas game, no libraries), "web-phaser" (2D platformer with Phaser 4 and arcade physics, works offline) or "web-three" (3D with three.js, works offline). Then edit it to the user\'s idea. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        template: {
          type: 'string',
          enum: [
            'godot-platformer',
            'godot-topdown',
            'godot-3d',
            'godot-empty',
            'web-canvas',
            'web-phaser',
            'web-three',
          ],
        },
        folder: { type: 'string', description: 'New folder name (letters, numbers, - _ .)' },
        name: { type: 'string', description: 'Game title' },
      },
      required: ['template', 'folder'],
    },
  },
  {
    name: 'web_game_url',
    description:
      'Local address to play a web game of the open folder (an index.html with its scripts and assets) in the built-in browser: returns an http://127.0.0.1 URL; then call browser_open with it and browser_read to check it runs. ES modules, import maps and assets work there (they do not from file://).',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'index.html (or its folder) relative to the open folder',
        },
      },
      required: ['path'],
    },
  },
];

export const GAME_TOOL_NAMES = new Set(GAME_TOOLS.map((t) => t.name));

export const GAME_PROMPT_PART =
  '- game_info, godot_scene, godot_scene_edit, godot_run, godot_playtest, godot_screenshot, godot_check, godot_export, game_new and web_game_url: video games. For Godot 4 projects edit the .gd scripts as text and the .tscn scenes with godot_scene_edit (or as text), then godot_check (parse errors) and godot_run (runtime errors, file:line) until they are clean; godot_playtest plays it (presses the input actions, reads properties like Player:position, screenshots) to prove the gameplay works; godot_screenshot to see how it looks. GDScript 4 syntax (@export, @onready, func f() -> void, signal.connect(callable)). Web games: web_game_url then browser_open. The Games panel (Más → Juegos) shows the same projects and output.';

const s = (v: unknown) => (typeof v === 'string' ? v : '');

export function gamePreview(
  name: string,
  a: Record<string, unknown>,
): SystemPreview | { error: string } | null {
  if (a.project !== undefined && !validProjectDir(a.project))
    return { error: 'Invalid project folder (relative to the open folder).' };
  if (a.scene !== undefined && a.scene !== '' && !validScene(a.scene))
    return { error: 'Invalid scene (a .tscn of the project).' };
  const where = s(a.project) || '.';
  const scene = s(a.scene) ? ` (${s(a.scene)})` : '';
  switch (name) {
    case 'game_info':
    case 'godot_scene':
    case 'web_game_url':
      return null;
    case 'godot_run':
      return {
        risk: 'medium',
        action: `Godot: ejecutar el juego ${where}${scene} ${typeof a.seconds === 'number' ? `${a.seconds} s` : '5 s'}${a.headless === false ? ' con ventana' : ' sin ventana'}`,
        warning: 'Godot ejecuta el código del proyecto (scripts, autoloads y extensiones).',
        allowKey: `godot_run:${s(a.project)}`,
      };
    case 'godot_screenshot':
      return {
        risk: 'medium',
        action: `Godot: capturar el juego ${where}${scene}`,
        warning: 'Abre la ventana del juego un momento y ejecuta el código del proyecto.',
        allowKey: `godot_run:${s(a.project)}`,
      };
    case 'godot_playtest': {
      let plan;
      try {
        plan = buildPlaytestPlan(a);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const inputs = plan.events.filter(
        (e) => e.type === 'action' || e.type === 'key' || e.type === 'mouse',
      ).length;
      return {
        risk: 'medium',
        action: `Godot: jugar ${where}${scene} ${plan.seconds} s (${inputs} entradas${plan.shots ? `, ${plan.shots} capturas con ventana` : ', sin ventana'})`,
        warning:
          'Godot ejecuta el código del proyecto. Zinarix añade un override.cfg temporal y lo deja como estaba al terminar.',
        allowKey: `godot_run:${s(a.project)}`,
      };
    }
    case 'godot_scene_edit': {
      let ops;
      try {
        ops = parseSceneOps(a.ops);
      } catch (e) {
        return { error: (e as Error).message };
      }
      const list = ops.slice(0, 12).map(describeSceneOp);
      if (ops.length > 12) list.push(`… y ${ops.length - 12} más`);
      return {
        risk: 'medium',
        action: `Editar la escena ${s(a.path)}: ${list.join('; ')}`,
        warning: 'Escribe el archivo .tscn (si está abierto, se recarga).',
        allowKey: `godot_scene_edit:${s(a.path)}`,
      };
    }
    case 'godot_check':
      return {
        risk: 'medium',
        action: `Godot: revisar los scripts de ${where}`,
        warning: 'Godot abre el proyecto sin ejecutar el juego (carga sus extensiones).',
        allowKey: `godot_check:${s(a.project)}`,
      };
    case 'godot_export':
      if (!validPresetName(a.preset)) return { error: 'Invalid preset name (see game_info).' };
      return {
        risk: 'medium',
        action: `Godot: exportar ${where} con "${a.preset}"${a.debug === true ? ' (debug)' : ''}`,
        warning: 'Compila el juego y escribe el ejecutable en la ruta del preset.',
        allowKey: `godot_export:${s(a.project)}:${a.preset}`,
      };
    case 'game_new':
      if (!isGameTemplate(a.template)) return { error: 'Unknown template.' };
      if (!validNewFolder(a.folder))
        return { error: 'Invalid folder name (letters, numbers, - _ .).' };
      return {
        risk: 'medium',
        action: `Crear el juego "${s(a.name) || a.folder}" (${a.template}) en la carpeta ${a.folder}/`,
        warning: 'Crea una carpeta nueva con los archivos de la plantilla.',
      };
  }
  return null;
}

const cut = (t: string, n = 12_000) => (t.length > n ? `… (start cut)\n${t.slice(-n)}` : t);

function problemLines(list: (GodotProblem & { count: number })[], dir: string): string[] {
  return list.slice(0, 60).map((p) => {
    const where = p.file
      ? `${resToRel(p.file, dir) ?? p.file}${p.line ? `:${p.line}` : ''}${p.func ? ` in ${p.func}()` : ''}: `
      : '';
    return `${p.severity}: ${where}${p.message}${p.count > 1 ? ` (×${p.count})` : ''}`;
  });
}

export function describeRun(r: GodotRunResult, dir: string): string {
  const head = r.problems.some((p) => p.severity === 'error')
    ? `ERRORS (${r.problems.filter((p) => p.severity === 'error').length})`
    : r.exitCode === 0 || r.timedOut
      ? 'RAN WITHOUT ERRORS'
      : `EXITED WITH CODE ${r.exitCode ?? '?'}`;
  return [
    `${head} in ${r.seconds}s`,
    ...problemLines(r.problems, dir),
    '',
    '--- output ---',
    cut(r.output.trim()) || '(nothing printed)',
  ].join('\n');
}

async function pick(
  g: GodotService,
  root: string,
  a: Record<string, unknown>,
): Promise<GodotProject> {
  const list = (await g.scan(root)).godot;
  if (!list.length)
    throw new Error(
      'No Godot project (project.godot) in the open folder. Create one with game_new.',
    );
  if (typeof a.project === 'string') {
    const want = a.project.replace(/\\/g, '/').replace(/\/+$/, '');
    const p = list.find((x) => x.dir === want);
    if (!p)
      throw new Error(
        `No project.godot in "${a.project}". Projects: ${list.map((x) => x.dir || '.').join(', ')}`,
      );
    return p;
  }
  if (list.length > 1)
    throw new Error(
      `Several Godot projects; pass project: ${list.map((x) => JSON.stringify(x.dir)).join(', ')}`,
    );
  return list[0]!;
}

export async function runGameTool(
  g: GodotService | undefined,
  web: WebGameServers | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal?: AbortSignal,
): Promise<{
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  changed?: string;
}> {
  if (!g)
    return { ok: false, content: 'Game tools are not available here.', summary: 'no disponible' };
  if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
  try {
    if (name === 'game_info') {
      const [st, scan] = await Promise.all([g.status(), g.scan(root)]);
      const lines = [
        st.state === 'ready'
          ? `Godot ${st.version}${st.mono ? ' (.NET)' : ''} installed: ${st.exe}`
          : 'Godot 4 is NOT installed (or not found). The user can download it from godotengine.org and pick it in Más → Juegos.',
      ];
      for (const p of scan.godot) {
        const i = p.info;
        lines.push(
          `\nGodot project "${i.name}" in "${p.dir || '.'}" (Godot ${i.version || '?'}, ${i.renderer || '?'}${i.width ? `, ${i.width}×${i.height}` : ''})`,
          `  main scene: ${i.mainScene || '(none)'}`,
          ...(i.autoloads.length
            ? [`  autoloads: ${i.autoloads.map((x) => `${x.name}=${x.path}`).join(', ')}`]
            : []),
          ...(i.actions.length ? [`  input actions: ${i.actions.join(', ')}`] : []),
          `  ${p.scripts} scripts; scenes: ${p.scenes.slice(0, 40).join(', ')}${p.scenes.length > 40 ? ` … (+${p.scenes.length - 40})` : ''}`,
          `  export presets: ${p.presets.length ? p.presets.map((x) => `"${x.name}" (${x.platform})`).join(', ') : '(none; create them in Godot: Project → Export)'}`,
        );
      }
      for (const o of scan.others)
        lines.push(
          `\n${o.kind === 'unity' ? 'Unity' : 'Unreal'} project "${o.name}" in "${o.dir || '.'}" (${o.version || 'version ?'}). Zinarix can open it in its editor; edit its C# / C++ as text.`,
        );
      for (const w of scan.web)
        lines.push(`\nWeb game (${w.lib}) at ${w.entry}: play it with web_game_url.`);
      if (!scan.godot.length && !scan.others.length && !scan.web.length)
        lines.push('\nNo game projects in the open folder. Create one with game_new.');
      return {
        ok: true,
        content: lines.join('\n'),
        summary: `${scan.godot.length + scan.others.length + scan.web.length} proyectos`,
      };
    }
    if (name === 'web_game_url') {
      if (!web) return { ok: false, content: 'Not available here.', summary: 'no disponible' };
      const rel = s(a.path)
        .replace(/\\/g, '/')
        .replace(/\/index\.html?$/i, '');
      const url = await web.url(root, rel ? `${rel}/` : '');
      return {
        ok: true,
        content: `${url}\nOpen it with browser_open.`,
        summary: 'dirección lista',
      };
    }
    if (name === 'godot_scene' || name === 'godot_scene_edit') {
      let rel = s(a.path).replace(/\\/g, '/');
      if (rel.startsWith('res://')) {
        const p = await pick(g, root, a);
        rel = resToRel(rel, p.dir) ?? '';
      }
      if (
        !rel ||
        !/\.(tscn|tres)$/i.test(rel) ||
        rel.split('/').includes('..') ||
        /^([a-z]:)?\//i.test(rel)
      )
        return {
          ok: false,
          content: 'Pass a .tscn relative to the open folder.',
          summary: 'no válida',
        };
      const text = await readFile(join(root, rel), 'utf8');
      if (name === 'godot_scene_edit') {
        const ops = parseSceneOps(a.ops);
        const { text: next, renames } = applySceneOpsFull(text, ops);
        if (next === text)
          return {
            ok: true,
            content: 'Nothing changed (the scene already was like that).',
            summary: 'sin cambios',
          };
        // Renamed nodes: the $Paths / get_node("…") of the scene's scripts follow (read all first,
        // so a failure writes nothing).
        const dir = godotDirOf(root, rel);
        const scripts: { file: string; code: string; count: number }[] = [];
        for (const sr of scriptRenames(text, renames)) {
          const file = resToRel(sr.res, dir);
          if (!file) continue;
          const code = await readFile(join(root, file), 'utf8').catch(() => null);
          if (code === null) continue;
          const r = applyScriptRenames(code, sr);
          if (r.count) scripts.push({ file, code: r.code, count: r.count });
        }
        await writeFile(join(root, rel), next, 'utf8');
        for (const sc of scripts) await writeFile(join(root, sc.file), sc.code, 'utf8');
        const fixed = scripts.length
          ? `\nAlso updated the node paths of the renamed nodes in: ${scripts.map((sc) => `${sc.file} (${sc.count})`).join(', ')}. Paths built at run time (strings joined in code) are not followed: check them.`
          : '';
        return {
          ok: true,
          content: `Applied ${ops.length} ops to ${rel}.${fixed} The scene now:\n${describeScene(parseTscn(next))}`,
          summary: `${ops.length} cambios`,
          changed: rel,
        };
      }
      const scene = parseTscn(text);
      return {
        ok: true,
        content: `${rel} (${scene.nodes.length} nodes, ${scene.ext.length} external resources, ${scene.sub.length} sub-resources)\n${describeScene(scene)}`,
        summary: `${scene.nodes.length} nodos`,
      };
    }
    if (name === 'game_new') {
      if (!isGameTemplate(a.template) || !validNewFolder(a.folder))
        return { ok: false, content: 'Invalid template or folder.', summary: 'no válido' };
      const files = await g.create(root, a.folder, a.template, s(a.name) || a.folder);
      return {
        ok: true,
        content: `Created ${files.length} files:\n${files.join('\n')}${a.template.startsWith('godot') ? '\nRun it with godot_run.' : '\nPlay it with web_game_url.'}`,
        summary: 'juego creado',
        changed: files.find((f) => /\.(gd|js)$/.test(f)) ?? files[0],
      };
    }
    const st = await g.status();
    if (st.state !== 'ready')
      return {
        ok: false,
        content:
          'Godot 4 is not installed (or not found). Tell the user to download it from https://godotengine.org/download and pick the executable in Más → Juegos.',
        summary: 'sin Godot',
      };
    const p = await pick(g, root, a);
    const scene = s(a.scene) || null;
    if (name === 'godot_run') {
      const r = await g.runFor(
        root,
        p.dir,
        {
          scene,
          seconds: typeof a.seconds === 'number' ? a.seconds : 5,
          headless: a.headless !== false,
        },
        signal,
      );
      const errors = r.problems.filter((x) => x.severity === 'error').length;
      return {
        ok: true,
        content: describeRun(r, p.dir),
        summary: errors ? `${errors} errores` : 'sin errores',
      };
    }
    if (name === 'godot_screenshot') {
      const at = typeof a.at === 'number' ? a.at : 2;
      const { frames, run } = await g.frames(root, p.dir, { scene, at: [at] }, signal);
      const f = frames[0];
      if (!f)
        return {
          ok: false,
          content: `No frame was rendered.\n${describeRun(run, p.dir)}`,
          summary: 'sin imagen',
        };
      return {
        ok: true,
        content: `Frame at ${f.at}s (${f.width}×${f.height}).\n${describeRun(run, p.dir)}`,
        summary: `captura ${f.width}×${f.height}`,
        image: {
          mediaType: 'image/png',
          data: f.png.toString('base64'),
          width: f.width,
          height: f.height,
        },
      };
    }
    if (name === 'godot_playtest') {
      const plan = buildPlaytestPlan(a);
      const { run, play, frames } = await g.playtest(root, p.dir, { scene, plan }, signal);
      const inputs = plan.events.filter(
        (e) => e.type === 'action' || e.type === 'key' || e.type === 'mouse',
      ).length;
      const parts = [
        play.ready
          ? `PLAYED ${plan.seconds} game seconds (${inputs} inputs).`
          : 'The play test driver did NOT start (the game crashed first, or the scene failed to load).',
        ...(play.badKeys.length ? [`Unknown key names: ${play.badKeys.join(', ')}`] : []),
        ...(play.probes.length ? ['--- probes ---', describeProbes(play.probes)] : []),
        ...(frames.length
          ? [
              `--- screenshots: ${frames.map((f) => `t=${f.at}s ${f.width}×${f.height}`).join(', ')} (the last one is attached) ---`,
            ]
          : []),
        ...play.shots.filter((x) => x.error).map((x) => `screenshot at ${x.t}s failed: ${x.error}`),
        describeRun(run, p.dir),
      ];
      const last = frames[frames.length - 1];
      const errors = run.problems.filter((x) => x.severity === 'error').length;
      return {
        ok: play.ready,
        content: parts.join('\n'),
        summary: `${play.probes.length} lecturas${frames.length ? `, ${frames.length} capturas` : ''}${errors ? `, ${errors} errores` : ''}`,
        ...(last
          ? {
              image: {
                mediaType: 'image/png' as const,
                data: last.png.toString('base64'),
                width: last.width,
                height: last.height,
              },
            }
          : {}),
      };
    }
    if (name === 'godot_check') {
      const files = Array.isArray(a.files)
        ? a.files.filter((x): x is string => typeof x === 'string').slice(0, 200)
        : undefined;
      const r = await g.check(root, p.dir, files, signal);
      return {
        ok: true,
        content: r.problems.length
          ? `${r.checked} scripts checked:\n${problemLines(r.problems, p.dir).join('\n')}`
          : `${r.checked} scripts checked: no errors.`,
        summary: r.problems.length ? `${r.problems.length} problemas` : 'sin errores',
      };
    }
    if (name === 'godot_export') {
      if (!validPresetName(a.preset))
        return { ok: false, content: 'Invalid preset.', summary: 'no válido' };
      const r = await g.exportGame(root, p.dir, a.preset, a.debug === true, signal);
      return {
        ok: r.ok,
        content: `${r.ok ? `Exported to ${r.path}` : 'Export FAILED'}\n${describeRun(r, p.dir)}`,
        summary: r.ok ? 'exportado' : 'falló',
      };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'error' };
  }
}

/** Folder (relative to the open folder, '' = itself) of the Godot project that holds a file. */
function godotDirOf(root: string, rel: string): string {
  const parts = rel.split('/').slice(0, -1);
  for (let i = parts.length; i >= 0; i--) {
    const dir = parts.slice(0, i).join('/');
    if (existsSync(join(root, dir, 'project.godot'))) return dir;
  }
  return '';
}
