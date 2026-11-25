import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import { CLOUD_PROMPT_PART, CLOUD_TOOLS } from './cloudTools.js';
import { MEDIA_PROMPT_PART, MEDIA_TOOLS } from './mediaTools.js';
import { IMAGE_PROMPT_PART, IMAGE_TOOLS } from './imageTools.js';
import { NOTEBOOK_PROMPT_PART, NOTEBOOK_TOOLS } from './notebookTools.js';
import { GRAPHICS_PROMPT_PART, GRAPHICS_TOOLS } from './graphicsTools.js';
import { DOCKER_PROMPT_PART, DOCKER_TOOLS } from './dockerTools.js';
import { PIO_PROMPT_PART, PIO_TOOLS } from './platformioTools.js';
import { MOBILE_PROMPT_PART, MOBILE_TOOLS } from './mobileTools.js';
import { GAME_PROMPT_PART, GAME_TOOLS } from './gameTools.js';
import { CAD_PROMPT_PART, CAD_TOOLS } from './cadTools.js';
import { SKETCHUP_PROMPT_PART, SKETCHUP_TOOLS } from './sketchupTools.js';
import { VIDEO_PROMPT_PART, VIDEO_TOOLS } from './videoTools.js';
import { SCENE3D_PROMPT_PART, SCENE3D_TOOLS } from './scene3dTools.js';
import { COMPUTER_PROMPT_PART, COMPUTER_TOOLS } from './computerTools.js';
import { MAIL_PROMPT_PART, MAIL_TOOLS } from './mailTools.js';
import { SYSTEM_PROMPT_PART, SYSTEM_TOOLS } from './system.js';
import { SECURITY_PROMPT_PART, SECURITY_TOOLS } from './security.js';

/**
 * Tool groups (estudio, punto A2): the agent starts every conversation with the core coding
 * tools only. Everything else Zinarix can do (browser, mail, video, CAD…) lives in groups
 * that are loaded when the task needs them: by the model with use_tools, or by Zinarix when
 * the user's message or the open folder makes the need obvious. A Python project no longer
 * pays, in every step, for the definitions of ~150 tools it will never call.
 */

export const BROWSER_PROMPT_PART =
  '- browser_open, browser_read, browser_click, browser_type, browser_scroll, browser_back: a real web browser the user can watch (this conversation has its own browser tab). Use it to read documentation, check a local dev server (e.g. http://localhost:3000) or follow web steps the user asks for. browser_read returns the page text and numbered interactive elements; use those numbers as "ref". Opening a site, clicking and typing need the user\'s approval per site. Never enter passwords, payment data or personal data; ask the user to do that.';

export const BROWSER_TOOLS: ToolDefinition[] = [
  {
    name: 'browser_open',
    description:
      'Open a web page in the built-in browser (the user sees it in the "Navegador" tab). Accepts a URL or search words. Returns the page text and its interactive elements.',
    parameters: {
      type: 'object',
      properties: { url: { type: 'string' } },
      required: ['url'],
    },
  },
  {
    name: 'browser_read',
    description:
      'Read the page currently open in the browser: URL, title, visible text and numbered interactive elements [ref] (links, buttons, inputs).',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'browser_click',
    description: 'Click an element of the current page by its ref number from browser_read.',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'integer' } },
      required: ['ref'],
    },
  },
  {
    name: 'browser_type',
    description:
      'Type text into an input of the current page (by ref from browser_read), replacing its content. Set submit=true to press Enter afterwards. Password and payment fields are refused.',
    parameters: {
      type: 'object',
      properties: {
        ref: { type: 'integer' },
        text: { type: 'string' },
        submit: { type: 'boolean' },
      },
      required: ['ref', 'text'],
    },
  },
  {
    name: 'browser_scroll',
    description:
      'Scroll the current page up or down by one screen, then return the visible content.',
    parameters: {
      type: 'object',
      properties: { direction: { type: 'string', enum: ['up', 'down'] } },
      required: ['direction'],
    },
  },
  {
    name: 'browser_back',
    description: 'Go back to the previous page in the browser.',
    parameters: { type: 'object', properties: {} },
  },
];

export interface ToolGroup {
  id: string;
  /** One line for the model: what the group is for. */
  summary: string;
  tools: ToolDefinition[];
  /** How to use the group's tools (given to the model when the group is loaded). */
  prompt: string;
  /** Words in the user's message that load the group without asking the model. */
  hint?: RegExp;
  /** Files or folders at the root of the open project that load the group. */
  files?: string[];
}

export const TOOL_GROUPS: ToolGroup[] = [
  {
    id: 'browser',
    summary: 'a real web browser: open pages, read docs, check a local dev server, click, type',
    tools: BROWSER_TOOLS,
    prompt: BROWSER_PROMPT_PART,
    hint: /https?:\/\/|\b(navegador|browser|localhost|p[aá]gina web|web ?page|sitio web|website|en internet|en la web|on the web|google)\b/i,
  },
  {
    id: 'mail',
    summary: "the user's mailboxes: list, read, organise, draft and send email",
    tools: MAIL_TOOLS,
    prompt: MAIL_PROMPT_PART,
    hint: /\b(correos?|e-?mails?|mail|bandeja de entrada|inbox)\b/i,
  },
  {
    id: 'cloud',
    summary: 'Supabase, Vercel and Google Cloud accounts: projects, databases, deployments, logs',
    tools: CLOUD_TOOLS,
    prompt: CLOUD_PROMPT_PART,
    hint: /\b(supabase|vercel|gcloud|google cloud|bigquery|cloud run|cloud sql)\b/i,
  },
  {
    id: 'media',
    summary: 'generate images, short videos and speech with AI models (costs money)',
    tools: MEDIA_TOOLS,
    prompt: MEDIA_PROMPT_PART,
    hint: /\b(genera\w* (una? |unas? |el |la )?(imagen|im[aá]genes|foto|video|v[ií]deo|voz|audio)|generate (an? |some )?(image|picture|video|speech|voice)|voz en off|voice-?over)\b/i,
  },
  {
    id: 'image',
    summary:
      'edit pictures of the project: crop, resize, colour, remove the background (on this PC)',
    tools: IMAGE_TOOLS,
    prompt: IMAGE_PROMPT_PART,
    hint: /\.(png|jpe?g|webp|bmp)\b|\b(foto|fotos|picture|photo|quita\w* el fondo|sin fondo|remove the background|recorta\w*)\b/i,
  },
  {
    id: 'notebook',
    summary: 'Jupyter notebooks (.ipynb): read, edit and run cells, inspect variables',
    tools: NOTEBOOK_TOOLS,
    prompt: NOTEBOOK_PROMPT_PART,
    hint: /\.ipynb\b|\b(jupyter|notebooks?|cuaderno)\b/i,
  },
  {
    id: 'design',
    summary: 'graphic design in SVG: templates (post, logo, poster…), render and export',
    tools: GRAPHICS_TOOLS,
    prompt: GRAPHICS_PROMPT_PART,
    hint: /\.svg\b|\b(logo|logotipo|p[oó]ster|flyer|banner|post de instagram|instagram post|miniatura de youtube|tarjeta de presentaci[oó]n)\b/i,
  },
  {
    id: 'docker',
    summary: 'Docker: containers, images, logs, compose, build, run, prune',
    tools: DOCKER_TOOLS,
    prompt: DOCKER_PROMPT_PART,
    hint: /\b(docker|dockerfile|contenedor(es)?|containers?)\b/i,
    files: [
      'Dockerfile',
      'docker-compose.yml',
      'docker-compose.yaml',
      'compose.yml',
      'compose.yaml',
    ],
  },
  {
    id: 'hardware',
    summary: 'microcontrollers with PlatformIO (Arduino, ESP32…): build, upload, serial monitor',
    tools: PIO_TOOLS,
    prompt: PIO_PROMPT_PART,
    hint: /\b(arduino|esp32|esp8266|platformio|stm32|raspberry pi pico|puerto serial|monitor serial|serial monitor|microcontrolador)\b/i,
    files: ['platformio.ini'],
  },
  {
    id: 'mobile',
    summary: 'phone apps: Android devices and emulators, logcat, screenshots, taps, install',
    tools: MOBILE_TOOLS,
    prompt: MOBILE_PROMPT_PART,
    hint: /\b(android|apk|emulador|emulator|adb|logcat|flutter|react native|expo)\b/i,
    files: ['pubspec.yaml', 'android', 'app.json'],
  },
  {
    id: 'game',
    summary:
      'video games: Godot 4 scenes, run, playtest, export; web games (canvas, Phaser, three)',
    tools: GAME_TOOLS,
    prompt: GAME_PROMPT_PART,
    hint: /\b(godot|gdscript|videojuegos?|juegos?|video ?games?|phaser)\b/i,
    files: ['project.godot'],
  },
  {
    id: 'cad',
    summary: 'CAD and 3D printing: OpenSCAD, Blender modelling, mesh check, slicing, printers',
    tools: CAD_TOOLS,
    prompt: CAD_PROMPT_PART,
    hint: /\.(scad|stl|3mf|gcode|blend)\b|\b(openscad|cad|blender|impresi[oó]n 3d|imprimir en 3d|impresora 3d|3d print\w*|slicer|g-?code)\b/i,
  },
  {
    id: 'sketchup',
    summary: "model in the user's SketchUp (.skp) without writing Ruby",
    tools: SKETCHUP_TOOLS,
    prompt: SKETCHUP_PROMPT_PART,
    hint: /\.skp\b|\bsketchup\b/i,
  },
  {
    id: 'scene3d',
    summary: '3D scenes: edit the 3D studio scene, render with Blender, generate 3D models',
    tools: SCENE3D_TOOLS,
    prompt: SCENE3D_PROMPT_PART,
    hint: /\.(glb|gltf|fbx)\b|\b(escena 3d|3d scene|modelo 3d|modelos 3d|3d models?|render 3d|3d render)\b/i,
  },
  {
    id: 'video',
    summary: 'Video Studio: cut by transcript, titles, captions, colour, transitions, export',
    tools: VIDEO_TOOLS,
    prompt: VIDEO_PROMPT_PART,
    hint: /\.(mp4|mov|mkv|webm)\b|\b(v[ií]deos?|video studio|subt[ií]tulos|captions|l[ií]nea de tiempo|timeline|reels?|tiktok)\b/i,
  },
  {
    id: 'computer',
    summary: "see the user's screen and use the real mouse and keyboard in any program",
    tools: COMPUTER_TOOLS,
    prompt: COMPUTER_PROMPT_PART,
    hint: /\b(pantalla|screenshot|captura de pantalla|mouse|rat[oó]n|excel|powerpoint|bloc de notas|notepad|ajustes de windows|windows settings|controla\w* (la|mi) (compu|computadora|pc))\b/i,
  },
  {
    id: 'system',
    summary:
      'beyond the project: network status, HTTP requests, SQL databases, system files, env vars',
    tools: SYSTEM_TOOLS,
    prompt: SYSTEM_PROMPT_PART,
    hint: /\b(variables? de entorno|env vars?|environment variables?|sqlite|postgres(ql)?|mysql|base de datos|bases de datos|database|petici[oó]n http|http request|api externa|archivo del sistema|system file)\b/i,
  },
  {
    id: 'security',
    summary: 'defensive security: project audit, vulnerable dependencies, ports, site checks',
    tools: SECURITY_TOOLS,
    prompt: SECURITY_PROMPT_PART,
    hint: /\b(seguridad|security|vulnerab\w+|auditor[ií]a|audita\w*|audit|escaneo de puertos|port scan|puertos abiertos|firewall|certificado|secretos filtrados|leaked secrets)\b/i,
  },
];

export const GROUP_IDS = TOOL_GROUPS.map((g) => g.id);

const BY_ID = new Map(TOOL_GROUPS.map((g) => [g.id, g]));
const BY_TOOL = new Map<string, ToolGroup>();
for (const g of TOOL_GROUPS) for (const t of g.tools) BY_TOOL.set(t.name, g);

/** The group a tool belongs to (undefined for the core tools, MCP tools and unknown names). */
export function groupOf(tool: string): ToolGroup | undefined {
  return BY_TOOL.get(tool);
}

/** The tool is offered now: a core tool, or one of a loaded group. */
export function toolLoaded(tool: string, loaded: ReadonlySet<string>): boolean {
  const g = BY_TOOL.get(tool);
  return !g || loaded.has(g.id);
}

export const USE_TOOLS = 'use_tools';

export const USE_TOOLS_TOOL: ToolDefinition = {
  name: USE_TOOLS,
  description: `Load extra tool groups for this conversation. You start with the core tools only (project files, search, commands, knowledge); everything else Zinarix can do is in the groups below. Call this when the task needs one: its tools are available from your next step on, and the result tells you how to use them. Free, no approval. Groups:\n${TOOL_GROUPS.map(
    (g) => `- ${g.id}: ${g.summary}`,
  ).join('\n')}`,
  parameters: {
    type: 'object',
    properties: {
      groups: {
        type: 'array',
        items: { type: 'string', enum: GROUP_IDS },
        description: 'Ids of the groups to load',
      },
    },
    required: ['groups'],
  },
};

/** The line of the system prompt that tells the model the groups exist. */
export const GROUPS_PROMPT_PART = `- ${USE_TOOLS}: Zinarix can do much more than code (${GROUP_IDS.join(', ')}), with tools kept in groups that are not loaded until needed. When a task needs one, call ${USE_TOOLS} with its id first (its description says what each group does); never tell the user something cannot be done before checking the groups.`;

/** ZINARIX_AGENT_TOOLS=all: every group loaded from the first step (how it was before). */
export function allGroupsForced(): boolean {
  return process.env.ZINARIX_AGENT_TOOLS === 'all';
}

/**
 * Groups worth loading before the model even answers: the ones the user's message names
 * and the ones the open folder is clearly about (a Godot project, a PlatformIO project…).
 */
export function suggestGroups(text: string, root?: string): string[] {
  if (allGroupsForced()) return GROUP_IDS.slice();
  const out: string[] = [];
  for (const g of TOOL_GROUPS) {
    if (text && g.hint?.test(text)) out.push(g.id);
    else if (root && g.files?.some((f) => existsSync(join(root, f)))) out.push(g.id);
  }
  return out;
}

/** The groups that have at least one of these tools (a subagent limited to some tools). */
export function groupsWith(tools: ReadonlySet<string>): string[] {
  return TOOL_GROUPS.filter((g) => g.tools.some((t) => tools.has(t.name))).map((g) => g.id);
}

/** How to use the loaded groups, for the system prompt (stable order). */
export function loadedPrompt(loaded: ReadonlySet<string>): string {
  return TOOL_GROUPS.filter((g) => loaded.has(g.id))
    .map((g) => g.prompt)
    .join('\n');
}

/**
 * use_tools: loads the groups asked for. The answer lists the new tools and how to use them;
 * it is written by Zinarix (not by a web page or a file), so it is not marked as untrusted.
 */
export function loadGroups(
  loaded: Set<string>,
  asked: unknown,
): { ok: boolean; content: string; summary: string } {
  const ids = (Array.isArray(asked) ? asked : typeof asked === 'string' ? [asked] : [])
    .map((x) => String(x).trim().toLowerCase())
    .filter(Boolean);
  const known = ids.filter((id) => BY_ID.has(id));
  const unknown = ids.filter((id) => !BY_ID.has(id));
  if (!known.length)
    return {
      ok: false,
      content: `${unknown.length ? `Unknown group: ${unknown.join(', ')}. ` : 'Give "groups": a list of group ids. '}Groups: ${GROUP_IDS.join(', ')}.`,
      summary: 'grupo desconocido',
    };
  const parts: string[] = [];
  for (const id of known) {
    const g = BY_ID.get(id)!;
    const was = loaded.has(id);
    loaded.add(id);
    parts.push(
      `Group "${id}" ${was ? 'was already loaded' : 'is loaded'}. Tools: ${g.tools.map((t) => t.name).join(', ')}.${was ? '' : `\n${g.prompt}`}`,
    );
  }
  if (unknown.length)
    parts.push(`Unknown group ignored: ${unknown.join(', ')}. Groups: ${GROUP_IDS.join(', ')}.`);
  return { ok: true, content: parts.join('\n\n'), summary: `herramientas: ${known.join(', ')}` };
}
