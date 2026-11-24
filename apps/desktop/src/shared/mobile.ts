/**
 * Phone apps (Fase 5B del plan de funciones): shared types and the pure parts (adb output,
 * emulators, logcat lines, project kinds and the commands that run them). No Node or DOM
 * imports: tested in Node.
 */

export interface MobileTools {
  /** Android SDK folder (ANDROID_HOME, ANDROID_SDK_ROOT or the usual place). */
  sdk: string | null;
  adb: string | null;
  emulator: string | null;
  flutter: string | null;
  scrcpy: string | null;
  /** Xcode command line tools (macOS only). */
  xcrun: string | null;
  platform: 'win32' | 'darwin' | 'linux' | string;
}

export interface MobileDevice {
  serial: string;
  /** device, offline, unauthorized, … */
  state: string;
  model: string;
  emulator: boolean;
}

export type MobileKind = 'android' | 'flutter' | 'expo' | 'react-native';

export interface MobileProject {
  kind: MobileKind;
  /** Folder relative to the open folder ("" = the folder itself). */
  dir: string;
  name: string;
}

export type LogLevel = 'V' | 'D' | 'I' | 'W' | 'E' | 'F';
export const LOG_LEVELS: LogLevel[] = ['V', 'D', 'I', 'W', 'E', 'F'];

export interface LogLine {
  time: string;
  pid: number;
  level: LogLevel;
  tag: string;
  message: string;
}

export type MobileEvent =
  { kind: 'logcat'; key: string; chunk: string } | { kind: 'logcat-end'; key: string };

/** `adb devices -l` → devices (skips the header and daemon messages). */
export function parseAdbDevices(text: string): MobileDevice[] {
  const out: MobileDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || /^List of devices|^\*/.test(line)) continue;
    const m =
      /^(\S+)\s+(device|offline|unauthorized|recovery|sideload|bootloader|no permissions|authorizing|connecting)\b(.*)$/.exec(
        line,
      );
    if (!m) continue;
    const props = Object.fromEntries(
      [...m[3]!.matchAll(/(\w+):(\S+)/g)].map((x) => [x[1]!, x[2]!]),
    );
    out.push({
      serial: m[1]!,
      state: m[2]!,
      model: (props.model ?? props.product ?? m[1]!).replace(/_/g, ' '),
      emulator: m[1]!.startsWith('emulator-'),
    });
  }
  return out;
}

/** `emulator -list-avds` → AVD names (it also prints INFO / warning lines). */
export function parseAvds(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => validAvd(l) && !/^(INFO|WARNING|ERROR)\b/i.test(l));
}

/** "11-20 21:30:01.123  1234  1250 E Tag   : message" (logcat -v threadtime). */
export function parseLogLine(line: string): LogLine | null {
  const m =
    /^(\d\d-\d\d\s+\d\d:\d\d:\d\d\.\d{3})\s+(\d+)\s+\d+\s+([VDIWEF])\s+(.*?)\s*:\s(.*)$/.exec(line);
  if (!m) return null;
  return {
    time: m[1]!,
    pid: Number(m[2]),
    level: m[3] as LogLevel,
    tag: m[4]!.trim(),
    message: m[5]!,
  };
}

export interface LogFilter {
  /** Lowest level shown. */
  level?: LogLevel;
  /** Words to look for in the tag or the message (case-insensitive). */
  query?: string;
  /** Only this process id (an app's pid). */
  pid?: number | null;
}

/** Keeps the lines that pass the filter; lines logcat could not split stay with the last one. */
export function filterLog(lines: string[], f: LogFilter): string[] {
  const min = LOG_LEVELS.indexOf(f.level ?? 'V');
  const q = (f.query ?? '').trim().toLowerCase();
  const out: string[] = [];
  let keep = false;
  for (const line of lines) {
    const p = parseLogLine(line);
    if (!p) {
      if (keep && line.trim() && !/^-{5,} beginning of/.test(line)) out.push(line);
      continue;
    }
    keep =
      LOG_LEVELS.indexOf(p.level) >= min &&
      (!q || p.tag.toLowerCase().includes(q) || p.message.toLowerCase().includes(q)) &&
      (f.pid == null || p.pid === f.pid);
    if (keep) out.push(line);
  }
  return out;
}

/** What kind of phone project a folder is, from its files. */
export function projectKind(files: {
  pubspec?: string | null;
  packageJson?: string | null;
  gradle?: boolean;
}): MobileKind | null {
  if (files.pubspec && /^\s*flutter\s*:/m.test(files.pubspec)) return 'flutter';
  if (files.packageJson) {
    try {
      const p = JSON.parse(files.packageJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...p.dependencies, ...p.devDependencies };
      if ('expo' in deps) return 'expo';
      if ('react-native' in deps) return 'react-native';
    } catch {
      /* not JSON */
    }
  }
  return files.gradle ? 'android' : null;
}

export type MobileAction = 'run' | 'build' | 'ios';

/**
 * The command that runs / builds a project in the terminal (Gradle, Flutter and Expo are
 * interactive or long: the user watches them there). serial: the chosen device, when any.
 */
export function projectCommand(
  p: MobileProject,
  action: MobileAction,
  opts: { platform: string; serial?: string | null },
): string {
  const win = opts.platform === 'win32';
  // Windows' terminal is PowerShell, and Windows PowerShell 5 has no "&&".
  const cd = p.dir ? `cd "${p.dir}"${win ? ';' : ' &&'} ` : '';
  const serial = opts.serial && validSerial(opts.serial) ? opts.serial : null;
  if (p.kind === 'android') {
    const gradlew = win ? '.\\gradlew.bat' : './gradlew';
    const env = serial
      ? win
        ? `$env:ANDROID_SERIAL="${serial}"; `
        : `ANDROID_SERIAL=${serial} `
      : '';
    if (action === 'build') return `${cd}${gradlew} assembleDebug`;
    return `${cd}${env}${gradlew} installDebug`;
  }
  if (p.kind === 'flutter') {
    if (action === 'build') return `${cd}flutter build apk --debug`;
    if (action === 'ios') return `${cd}flutter run -d ios`;
    return `${cd}flutter run${serial ? ` -d ${serial}` : ''}`;
  }
  if (p.kind === 'expo') {
    if (action === 'ios')
      return opts.platform === 'darwin'
        ? `${cd}npx expo run:ios`
        : `${cd}npx eas build -p ios --profile development`;
    if (action === 'build') return `${cd}npx expo run:android`;
    return `${cd}npx expo start${serial ? ' --android' : ''}`;
  }
  if (action === 'ios') return `${cd}npx react-native run-ios`;
  if (action === 'build') return `${cd}npx react-native build-android --mode=debug`;
  return `${cd}npx react-native run-android${serial ? ` --deviceId ${serial}` : ''}`;
}

/** adb serials: emulator-5554, R58M123ABC, 192.168.1.20:5555 (wireless). */
export function validSerial(s: unknown): s is string {
  return typeof s === 'string' && /^\w[\w.:-]{0,63}$/.test(s);
}

/** AVD names; never starting with "-" (it would read as an emulator option). */
export function validAvd(s: unknown): s is string {
  return typeof s === 'string' && /^\w[\w.-]{0,99}$/.test(s);
}

/** Width and height of a PNG from its header (0 when it is not one). */
export function pngSize(b: Uint8Array): { width: number; height: number } {
  if (b.length < 24 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47)
    return { width: 0, height: 0 };
  const at = (i: number) =>
    ((b[i]! << 24) | (b[i + 1]! << 16) | (b[i + 2]! << 8) | b[i + 3]!) >>> 0;
  return { width: at(16), height: at(20) };
}

// ---------------- touch, keys and apps (adb shell input / pm / am) ----------------

/** Android key codes the panel and the AI can press. */
export const MOBILE_KEYS = {
  back: 4,
  home: 3,
  recents: 187,
  enter: 66,
  delete: 67,
  tab: 61,
  escape: 111,
  power: 26,
  volume_up: 24,
  volume_down: 25,
  menu: 82,
  wakeup: 224,
  sleep: 223,
  dpad_up: 19,
  dpad_down: 20,
  dpad_left: 21,
  dpad_right: 22,
} as const;
export type MobileKey = keyof typeof MOBILE_KEYS;

export type MobileInput =
  | { kind: 'tap'; x: number; y: number }
  | { kind: 'long_press'; x: number; y: number; ms?: number }
  | { kind: 'swipe'; x: number; y: number; x2: number; y2: number; ms?: number }
  | { kind: 'text'; text: string }
  | { kind: 'key'; key: MobileKey };

const coord = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20_000;

/**
 * Checks an input and gives what goes after `adb -s SERIAL shell`. adb joins those words
 * into ONE command line for the phone's sh, so the text is single-quoted for sh here, and
 * every number is an integer: nothing the caller sends can add a second command.
 */
export function inputArgs(i: MobileInput): string[] {
  const n = (v: number) => String(Math.round(v));
  const dur = (ms: unknown, def: number) =>
    String(
      Math.round(
        Math.max(1, Math.min(10_000, typeof ms === 'number' && Number.isFinite(ms) ? ms : def)),
      ),
    );
  if (i.kind === 'tap') {
    if (!coord(i.x) || !coord(i.y)) throw new Error('Coordenadas no válidas.');
    return ['input', 'tap', n(i.x), n(i.y)];
  }
  if (i.kind === 'long_press') {
    if (!coord(i.x) || !coord(i.y)) throw new Error('Coordenadas no válidas.');
    return ['input', 'swipe', n(i.x), n(i.y), n(i.x), n(i.y), dur(i.ms, 700)];
  }
  if (i.kind === 'swipe') {
    if (![i.x, i.y, i.x2, i.y2].every(coord)) throw new Error('Coordenadas no válidas.');
    return ['input', 'swipe', n(i.x), n(i.y), n(i.x2), n(i.y2), dur(i.ms, 300)];
  }
  if (i.kind === 'key') {
    const code = MOBILE_KEYS[i.key as MobileKey];
    if (code === undefined) throw new Error('Tecla no válida.');
    return ['input', 'keyevent', String(code)];
  }
  if (i.kind === 'text') {
    const t = String(i.text ?? '');
    if (!t || t.length > 1000) throw new Error('Texto vacío o muy largo.');
    // `input text` only types ASCII; a space must be written %s.
    if (/[^\x20-\x7e]/.test(t))
      throw new Error('El teclado de adb solo escribe letras sin acentos (ASCII).');
    return ['input', 'text', `'${t.replace(/ /g, '%s').replace(/'/g, `'\\''`)}'`];
  }
  throw new Error('Acción no válida.');
}

/** Android package names (com.example.app). */
export function validPackage(p: unknown): p is string {
  return typeof p === 'string' && p.length <= 200 && /^[A-Za-z][\w]*(\.[A-Za-z_][\w]*)+$/.test(p);
}

/** `pm list packages` → names, sorted. */
export function parsePackages(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/\r?\n/)
        .map((l) => /^package:(\S+)/.exec(l.trim())?.[1] ?? '')
        .filter(validPackage),
    ),
  ].sort();
}

/** host:port of a phone on Wi-Fi (adb connect / adb pair). */
export function validAddress(a: unknown): a is string {
  if (typeof a !== 'string') return false;
  const m = /^([A-Za-z0-9][A-Za-z0-9.-]{0,252}|\[[0-9a-fA-F:]+\]):(\d{1,5})$/.exec(a.trim());
  return !!m && Number(m[2]) > 0 && Number(m[2]) < 65536;
}

/** Wireless debugging pairing code (6 digits on the phone). */
export function validPairCode(c: unknown): c is string {
  return typeof c === 'string' && /^\d{6}$/.test(c.trim());
}

/** `wm size` → the physical size ("Physical size: 1080x2400", an override wins). */
export function parseWmSize(text: string): { width: number; height: number } | null {
  const m = /Override size:\s*(\d+)x(\d+)/.exec(text) ?? /Physical size:\s*(\d+)x(\d+)/.exec(text);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : null;
}

/**
 * A point on the screen picture shown at (shownW × shownH) → the phone's pixels
 * (the picture is the screen at its real size, so the same ratio holds both ways).
 */
export function toDevicePoint(
  px: number,
  py: number,
  shown: { width: number; height: number },
  device: { width: number; height: number },
): { x: number; y: number } {
  const x = Math.round((px / Math.max(1, shown.width)) * device.width);
  const y = Math.round((py / Math.max(1, shown.height)) * device.height);
  return {
    x: Math.max(0, Math.min(device.width - 1, x)),
    y: Math.max(0, Math.min(device.height - 1, y)),
  };
}
