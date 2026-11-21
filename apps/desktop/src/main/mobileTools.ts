import type { ToolDefinition } from '@omni/shared';
import type { ComputerShot } from './computerTools.js';
import type { MobileService } from './mobile.js';
import type { SystemPreview } from './system.js';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  filterLog,
  inputArgs,
  LOG_LEVELS,
  MOBILE_KEYS,
  pngSize,
  projectCommand,
  validAddress,
  validAvd,
  validPackage,
  validPairCode,
  validSerial,
  type LogLevel,
  type MobileInput,
} from '../shared/mobile.js';

/**
 * Fase 5B (plan de funciones): phones and emulators for the agent. Looking (tools, devices,
 * emulators, projects, the log) is free; a screenshot of the phone and starting an emulator
 * are approved. Building and running go through run_command with the commands mobile_info
 * gives (Gradle, Flutter, Expo, React Native), so the user approves those as usual.
 */

export const MOBILE_TOOLS: ToolDefinition[] = [
  {
    name: 'mobile_info',
    description:
      'Phone app development: what="tools" tells which tools are installed (Android SDK, adb, emulator, Flutter, scrcpy, Xcode on macOS); "devices" lists the phones and running emulators adb sees (serial, model, state); "avds" the Android emulators that can be started; "projects" the Flutter / Expo / React Native / Android (Gradle) projects of the open folder with the terminal commands that run and build them (use run_command to run those).',
    parameters: {
      type: 'object',
      properties: { what: { type: 'string', enum: ['tools', 'devices', 'avds', 'projects'] } },
    },
  },
  {
    name: 'mobile_logcat',
    description:
      'Last lines of the Android log (adb logcat) of a device, filtered: level (lowest shown: V, D, I, W, E, F; default W), query (words in the tag or message, e.g. the app package or "FATAL"), package (only lines of that running app). Use it to find crashes after running an app.',
    parameters: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: 'Device serial; default: the only device connected' },
        lines: { type: 'integer', minimum: 10, maximum: 5000, description: 'Log lines read before filtering (default 1500)' },
        level: { type: 'string', enum: LOG_LEVELS },
        query: { type: 'string' },
        package: { type: 'string', description: 'e.g. com.example.app' },
      },
    },
  },
  {
    name: 'mobile_screenshot',
    description:
      'Take a screenshot of the phone or emulator screen and look at it (to check the UI of the app being built). Its pixels are the coordinates mobile_input uses. The user approves it.',
    parameters: {
      type: 'object',
      properties: { serial: { type: 'string', description: 'Device serial; default: the only device connected' } },
    },
  },
  {
    name: 'mobile_emulator',
    description: 'Start an Android emulator (an AVD from mobile_info what="avds"). It takes 20–60 s to boot; check mobile_info what="devices" afterwards. The user approves it.',
    parameters: {
      type: 'object',
      properties: { avd: { type: 'string' } },
      required: ['avd'],
    },
  },
  {
    name: 'mobile_input',
    description:
      'Use the phone like a finger: action "tap" (x, y), "long_press" (x, y), "swipe" (x, y → x2, y2; e.g. scroll up = swipe from the lower middle to the upper middle), "text" (types into the focused field; ASCII only) or "key" (back, home, recents, enter, delete, tab, escape, power, volume_up, volume_down, menu, wakeup, sleep, dpad_*). Coordinates are pixels of the mobile_screenshot image. Returns a new screenshot afterwards (screenshot=false to skip it). Use it to test the app being built. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        serial: { type: 'string', description: 'Device serial; default: the only device connected' },
        action: { type: 'string', enum: ['tap', 'long_press', 'swipe', 'text', 'key'] },
        x: { type: 'number' },
        y: { type: 'number' },
        x2: { type: 'number' },
        y2: { type: 'number' },
        duration_ms: { type: 'integer', minimum: 1, maximum: 10000 },
        text: { type: 'string' },
        key: { type: 'string', enum: Object.keys(MOBILE_KEYS) },
        screenshot: { type: 'boolean', description: 'Look at the screen after (default true)' },
        wait_ms: { type: 'integer', minimum: 0, maximum: 10000, description: 'Wait before that screenshot (default 700)' },
      },
      required: ['action'],
    },
  },
  {
    name: 'mobile_app',
    description:
      'Apps on the phone: action "list" lists the installed apps (system=true also the system ones; no approval); "launch" opens an app by package; "stop" force-stops it; "clear" erases its data and cache; "uninstall" removes it; "install" installs or updates an .apk file of the open folder (apk: path relative to it, e.g. app/build/outputs/apk/debug/app-debug.apk). Everything but list is approved by the user.',
    parameters: {
      type: 'object',
      properties: {
        serial: { type: 'string' },
        action: { type: 'string', enum: ['list', 'launch', 'stop', 'clear', 'uninstall', 'install'] },
        package: { type: 'string', description: 'e.g. com.example.app' },
        apk: { type: 'string' },
        system: { type: 'boolean' },
        query: { type: 'string', description: 'Only packages containing these letters (action "list")' },
      },
      required: ['action'],
    },
  },
  {
    name: 'mobile_connect',
    description:
      'Connect a phone over Wi-Fi (wireless debugging, same network): address "IP:port" from the phone (Developer options → Wireless debugging). On Android 11+ pair first: pass the pairing address and the 6-digit pair_code of "Pair device with pairing code", then call again with the connect address (it is a different port). action "disconnect" forgets it. The user approves it.',
    parameters: {
      type: 'object',
      properties: {
        address: { type: 'string', description: 'e.g. 192.168.1.20:37099' },
        pair_code: { type: 'string', description: '6 digits' },
        action: { type: 'string', enum: ['connect', 'disconnect'] },
      },
      required: ['address'],
    },
  },
];

export const MOBILE_TOOL_NAMES = new Set(MOBILE_TOOLS.map((t) => t.name));

export const MOBILE_PROMPT_PART =
  '- mobile_info, mobile_logcat, mobile_screenshot, mobile_input, mobile_app, mobile_connect and mobile_emulator: Android phones and emulators (adb) and Flutter / Expo / React Native / Gradle projects. Build and run with run_command using the commands mobile_info what="projects" gives (or mobile_app install with the built .apk); read crashes with mobile_logcat; look at the app with mobile_screenshot and try it with mobile_input (tap / swipe / type using the screenshot\'s pixels). iPhone builds need macOS with Xcode (on Windows / Linux: Expo EAS in the cloud).';

export function mobilePreview(name: string, a: Record<string, unknown>): SystemPreview | { error: string } | null {
  if (a.serial !== undefined && a.serial !== '' && !validSerial(a.serial)) return { error: 'Invalid device serial.' };
  if (name === 'mobile_info' || name === 'mobile_logcat') return null;
  if (name === 'mobile_screenshot')
    return {
      risk: 'medium',
      action: `Celular: captura de pantalla${typeof a.serial === 'string' && a.serial ? ` de ${a.serial}` : ''}`,
      warning: 'La IA ve lo que hay en la pantalla del teléfono en este momento.',
      allowKey: `mobile_screenshot:${typeof a.serial === 'string' ? a.serial : ''}`,
    };
  const on = typeof a.serial === 'string' && a.serial ? ` en ${a.serial}` : '';
  if (name === 'mobile_input') {
    const i = toInput(a);
    if ('error' in i) return i;
    try {
      inputArgs(i);
    } catch (e) {
      return { error: (e as Error).message };
    }
    return {
      risk: 'medium',
      action: `Celular: ${describeInput(i)}${on}`,
      warning: 'La IA usa el teléfono como si lo tocara: puede abrir apps, escribir y cambiar ajustes.',
      allowKey: `mobile_input:${typeof a.serial === 'string' ? a.serial : ''}`,
    };
  }
  if (name === 'mobile_app') {
    const act = typeof a.action === 'string' ? a.action : '';
    if (act === 'list') return null;
    if (act === 'install') {
      if (typeof a.apk !== 'string' || !/\.apk$/i.test(a.apk)) return { error: 'Pass apk: the path of an .apk file in the open folder.' };
      return {
        risk: 'medium',
        action: `Celular: instalar ${a.apk}${on}`,
        warning: 'Instala (o actualiza) esa app en el teléfono.',
        path: a.apk,
        allowKey: `mobile_install:${a.apk}`,
      };
    }
    if (!validPackage(a.package)) return { error: 'Invalid or missing package (e.g. com.example.app).' };
    if (act === 'launch' || act === 'stop')
      return {
        risk: 'medium',
        action: `Celular: ${act === 'launch' ? 'abrir' : 'cerrar'} ${a.package}${on}`,
        warning: act === 'launch' ? 'Abre la app en el teléfono.' : 'Cierra la app a la fuerza (pierde lo que no guardó).',
        allowKey: `mobile_app:${act}:${a.package}`,
      };
    if (act === 'clear')
      return { risk: 'high', action: `Celular: borrar los datos de ${a.package}${on}`, warning: 'Borra todo lo que la app guardó (sesión, ajustes, archivos). No se puede deshacer.' };
    if (act === 'uninstall')
      return { risk: 'high', action: `Celular: desinstalar ${a.package}${on}`, warning: 'Quita la app del teléfono con sus datos.' };
    return { error: 'Unknown action.' };
  }
  if (name === 'mobile_connect') {
    if (!validAddress(a.address)) return { error: 'Invalid address: use IP:port.' };
    if (a.pair_code !== undefined && !validPairCode(a.pair_code)) return { error: 'pair_code is the 6 digits shown on the phone.' };
    const pair = a.pair_code !== undefined;
    return {
      risk: 'medium',
      action: a.action === 'disconnect' ? `Celular: desconectar ${a.address}` : pair ? `Celular: vincular ${a.address} por Wi-Fi` : `Celular: conectar ${a.address} por Wi-Fi`,
      warning: pair ? 'Vincula ese teléfono con esta PC para depurar por Wi-Fi.' : 'Conecta adb con el teléfono por la red.',
      command: a.action === 'disconnect' ? `adb disconnect ${a.address}` : pair ? `adb pair ${a.address} ******` : `adb connect ${a.address}`,
      ...(pair ? {} : { allowKey: `mobile_connect:${a.address}` }),
    };
  }
  if (name === 'mobile_emulator') {
    if (!validAvd(a.avd)) return { error: 'Invalid emulator name.' };
    return {
      risk: 'medium',
      action: `Celular: encender el emulador ${a.avd}`,
      warning: 'Abre el emulador de Android (usa bastante memoria).',
      command: `emulator -avd ${a.avd}`,
      allowKey: `mobile_emulator:${a.avd}`,
    };
  }
  return null;
}

const cut = (t: string, n = 20_000) => (t.length > n ? `…${t.slice(t.length - n)}` : t);

const num = (v: unknown) => (typeof v === 'number' ? v : Number.NaN);

/** The tool arguments as an input (checked again by inputArgs). */
export function toInput(a: Record<string, unknown>): MobileInput | { error: string } {
  const act = a.action;
  if (act === 'tap') return { kind: 'tap', x: num(a.x), y: num(a.y) };
  if (act === 'long_press') return { kind: 'long_press', x: num(a.x), y: num(a.y), ms: typeof a.duration_ms === 'number' ? a.duration_ms : undefined };
  if (act === 'swipe')
    return { kind: 'swipe', x: num(a.x), y: num(a.y), x2: num(a.x2), y2: num(a.y2), ms: typeof a.duration_ms === 'number' ? a.duration_ms : undefined };
  if (act === 'text') return { kind: 'text', text: typeof a.text === 'string' ? a.text : '' };
  if (act === 'key') {
    if (typeof a.key !== 'string' || !(a.key in MOBILE_KEYS)) return { error: `Unknown key. Keys: ${Object.keys(MOBILE_KEYS).join(', ')}` };
    return { kind: 'key', key: a.key as keyof typeof MOBILE_KEYS };
  }
  return { error: 'Unknown action.' };
}

function describeInput(i: MobileInput): string {
  const r = Math.round;
  if (i.kind === 'tap') return `tocar (${r(i.x)}, ${r(i.y)})`;
  if (i.kind === 'long_press') return `mantener presionado (${r(i.x)}, ${r(i.y)})`;
  if (i.kind === 'swipe') return `deslizar de (${r(i.x)}, ${r(i.y)}) a (${r(i.x2)}, ${r(i.y2)})`;
  if (i.kind === 'text') return `escribir ${JSON.stringify(i.text.slice(0, 80))}`;
  return `tecla ${i.key}`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function shot(m: MobileService, serial: string): Promise<ComputerShot | undefined> {
  const png = await m.screenshot(serial).catch(() => null);
  if (!png) return undefined;
  const { width, height } = pngSize(png);
  return width ? { mediaType: 'image/png', data: png.toString('base64'), width, height } : undefined;
}

async function oneDevice(m: MobileService, serial: unknown): Promise<string> {
  if (typeof serial === 'string' && serial) return serial;
  const list = (await m.devices()).filter((d) => d.state === 'device');
  if (list.length === 1) return list[0]!.serial;
  throw new Error(
    list.length
      ? `Several devices: pass serial (${list.map((d) => `${d.serial} ${d.model}`).join(', ')}).`
      : 'No phone or emulator connected (adb devices is empty). Start an emulator (mobile_emulator) or ask the user to plug in the phone with USB debugging on.',
  );
}

export async function runMobileTool(
  m: MobileService | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): Promise<{ ok: boolean; content: string; summary: string; image?: ComputerShot }> {
  if (!m) return { ok: false, content: 'Phone tools are not available here.', summary: 'no disponible' };
  try {
    const t = await m.tools();
    if (name === 'mobile_info') {
      const what = typeof a.what === 'string' ? a.what : 'tools';
      if (what === 'projects') {
        if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
        const list = await m.projects(root);
        const cmds = (p: (typeof list)[number]) =>
          [
            `run: ${projectCommand(p, 'run', { platform: t.platform })}`,
            `build: ${projectCommand(p, 'build', { platform: t.platform })}`,
            ...(p.kind !== 'android' ? [`ios: ${projectCommand(p, 'ios', { platform: t.platform })}`] : []),
          ].join('\n    ');
        return {
          ok: true,
          content: list.map((p) => `${p.kind} "${p.name}" in "${p.dir || '.'}"\n    ${cmds(p)}`).join('\n') || 'No Flutter, Expo, React Native or Android (Gradle) project in the open folder.',
          summary: `${list.length} proyectos`,
        };
      }
      if (what === 'devices') {
        if (!t.adb) return { ok: false, content: 'adb is not installed (Android SDK Platform-Tools).', summary: 'sin adb' };
        const list = await m.devices();
        return {
          ok: true,
          content: list.map((d) => `${d.serial}  ${d.model}  [${d.state}]${d.emulator ? ' (emulator)' : ''}`).join('\n') || 'No devices.',
          summary: `${list.length} dispositivos`,
        };
      }
      if (what === 'avds') {
        const list = await m.avds();
        return { ok: true, content: list.join('\n') || (t.emulator ? 'No AVDs: create one in Android Studio (Device Manager).' : 'The Android emulator is not installed.'), summary: `${list.length} emuladores` };
      }
      const row = (label: string, v: string | null) => `${label}: ${v ?? 'not found'}`;
      return {
        ok: true,
        content: [
          row('Android SDK', t.sdk),
          row('adb', t.adb),
          row('emulator', t.emulator),
          row('flutter', t.flutter),
          row('scrcpy', t.scrcpy),
          ...(t.platform === 'darwin' ? [row('xcrun (Xcode)', t.xcrun)] : ['iPhone: building for iOS needs macOS with Xcode; here use Expo EAS (cloud).']),
        ].join('\n'),
        summary: 'herramientas',
      };
    }
    if (name === 'mobile_logcat') {
      const serial = await oneDevice(m, a.serial);
      const raw = await m.logcatDump(serial, typeof a.lines === 'number' ? a.lines : 1500);
      const pid = typeof a.package === 'string' && a.package ? await m.pidOf(serial, a.package) : null;
      if (typeof a.package === 'string' && a.package && pid == null)
        return { ok: false, content: `The app ${a.package} is not running on ${serial}.`, summary: 'app no abierta' };
      const level = (LOG_LEVELS as string[]).includes(String(a.level)) ? (a.level as LogLevel) : 'W';
      const lines = filterLog(raw.split(/\r?\n/), { level, query: typeof a.query === 'string' ? a.query : '', pid });
      return { ok: true, content: cut(lines.join('\n')) || '(no matching lines)', summary: `${lines.length} líneas` };
    }
    if (name === 'mobile_screenshot') {
      const serial = await oneDevice(m, a.serial);
      const png = await m.screenshot(serial);
      const { width, height } = pngSize(png);
      if (!width) return { ok: false, content: 'The device did not return an image (is the screen on and unlocked?).', summary: 'sin imagen' };
      return {
        ok: true,
        content: `Screenshot of ${serial}: ${width}×${height}.`,
        summary: `${width}×${height}`,
        image: { mediaType: 'image/png', data: png.toString('base64'), width, height },
      };
    }
    if (name === 'mobile_connect') {
      const addr = String(a.address);
      if (a.action === 'disconnect') {
        await m.disconnect(addr);
        return { ok: true, content: `Disconnected ${addr}.`, summary: 'desconectado' };
      }
      const out = await m.connect(addr, typeof a.pair_code === 'string' ? a.pair_code : undefined);
      return {
        ok: true,
        content: `${out.trim()}${typeof a.pair_code === 'string' ? '\nPaired. Now call mobile_connect with the connect address (IP:port under "Wireless debugging", not the pairing one).' : ''}`,
        summary: typeof a.pair_code === 'string' ? 'vinculado' : 'conectado',
      };
    }
    if (name === 'mobile_input') {
      const i = toInput(a);
      if ('error' in i) return { ok: false, content: i.error, summary: 'no válido' };
      const serial = await oneDevice(m, a.serial);
      await m.input(serial, i);
      if (a.screenshot === false) return { ok: true, content: `Done: ${describeInput(i)}.`, summary: 'hecho' };
      await sleep(Math.max(0, Math.min(10_000, typeof a.wait_ms === 'number' ? a.wait_ms : 700)));
      const image = await shot(m, serial);
      return {
        ok: true,
        content: `Done: ${describeInput(i)}.${image ? ` Screen now (${image.width}×${image.height}):` : ' (no screenshot)'}`,
        summary: 'hecho',
        ...(image ? { image } : {}),
      };
    }
    if (name === 'mobile_app') {
      const serial = await oneDevice(m, a.serial);
      const act = String(a.action);
      if (act === 'list') {
        const q = typeof a.query === 'string' ? a.query.toLowerCase() : '';
        const list = (await m.packages(serial, a.system !== true)).filter((p) => !q || p.toLowerCase().includes(q));
        return { ok: true, content: list.join('\n') || '(no apps)', summary: `${list.length} apps` };
      }
      if (act === 'install') {
        if (!root) return { ok: false, content: 'No folder is open.', summary: 'sin carpeta' };
        const apk = resolve(root, String(a.apk ?? ''));
        const rel = relative(root, apk);
        if (!rel || rel.startsWith('..') || isAbsolute(rel)) return { ok: false, content: 'The .apk must be inside the open folder.', summary: 'fuera del proyecto' };
        await m.install(serial, apk);
        return { ok: true, content: `Installed ${rel.replace(/\\/g, '/')} on ${serial}.`, summary: 'instalada' };
      }
      if (!validPackage(a.package)) return { ok: false, content: 'Invalid package.', summary: 'no válido' };
      if (act === 'launch' || act === 'stop' || act === 'clear' || act === 'uninstall') {
        await m.app(serial, a.package, act);
        const done = { launch: 'Opened', stop: 'Stopped', clear: 'Cleared the data of', uninstall: 'Uninstalled' }[act];
        return { ok: true, content: `${done} ${a.package} on ${serial}.`, summary: { launch: 'abierta', stop: 'cerrada', clear: 'datos borrados', uninstall: 'desinstalada' }[act] };
      }
      return { ok: false, content: 'Unknown action.', summary: 'no aplica' };
    }
    if (name === 'mobile_emulator') {
      await m.startEmulator(String(a.avd));
      return { ok: true, content: `Starting ${String(a.avd)}; it shows in mobile_info what="devices" when it has booted (20–60 s).`, summary: 'encendiendo' };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (e) {
    return { ok: false, content: (e as Error).message, summary: 'error' };
  }
}
