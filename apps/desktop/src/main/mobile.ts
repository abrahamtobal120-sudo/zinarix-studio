import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { childEnv } from './env.js';
import {
  inputArgs,
  parseAdbDevices,
  parseAvds,
  parsePackages,
  parseWmSize,
  projectKind,
  validAddress,
  validAvd,
  validPackage,
  validPairCode,
  validSerial,
  type MobileDevice,
  type MobileInput,
  type MobileProject,
  type MobileTools,
} from '../shared/mobile.js';

/**
 * Fase 5B (plan de funciones): phones and emulators through the Android SDK tools (adb,
 * emulator), scrcpy for the live screen, and Flutter / Expo / React Native / Gradle projects
 * (run in the integrated terminal). Never a shell; serials and AVD names are checked first.
 */

const exe = (name: string) => (process.platform === 'win32' ? `${name}.exe` : name);

/** How adb and the other tools are run (tests give a fake one). */
export interface MobileRunner {
  text(bin: string, args: string[], timeout: number): Promise<string>;
  buffer(bin: string, args: string[], timeout: number): Promise<Buffer>;
}

export class MobileService {
  protected cached: MobileTools | null = null;
  private logcats = new Map<string, ChildProcess>();
  private sizes = new Map<string, { width: number; height: number }>();

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly runner: MobileRunner = { text: run, buffer: runBuffer },
  ) {}

  /** The tools found on this computer (cached; force looks again). */
  async tools(force = false): Promise<MobileTools> {
    if (this.cached && !force) return this.cached;
    const e = this.env;
    const home = homedir();
    const sdkCandidates = [
      e.ANDROID_HOME,
      e.ANDROID_SDK_ROOT,
      e.LOCALAPPDATA && join(e.LOCALAPPDATA, 'Android', 'Sdk'),
      join(home, 'Library', 'Android', 'sdk'),
      join(home, 'Android', 'Sdk'),
    ].filter((x): x is string => !!x);
    const sdk =
      sdkCandidates.find((p) => existsSync(join(p, 'platform-tools'))) ??
      sdkCandidates.find((p) => existsSync(p)) ??
      null;
    const inSdk = (...parts: string[]) => {
      if (!sdk) return null;
      const p = join(sdk, ...parts);
      return existsSync(p) ? p : null;
    };
    const [adbPath, flutter, scrcpy, xcrun] = await Promise.all([
      which('adb'),
      which('flutter'),
      which('scrcpy'),
      process.platform === 'darwin' ? which('xcrun') : Promise.resolve(null),
    ]);
    this.cached = {
      sdk,
      adb: inSdk('platform-tools', exe('adb')) ?? adbPath,
      emulator: inSdk('emulator', exe('emulator')),
      flutter,
      scrcpy,
      xcrun,
      platform: process.platform,
    };
    return this.cached;
  }

  private async adb(): Promise<string> {
    const t = await this.tools();
    if (!t.adb) throw new Error('No se encontró adb (Android SDK Platform-Tools).');
    return t.adb;
  }

  async devices(): Promise<MobileDevice[]> {
    return parseAdbDevices(await this.runner.text(await this.adb(), ['devices', '-l'], 20_000));
  }

  async avds(): Promise<string[]> {
    const t = await this.tools();
    if (!t.emulator) return [];
    return parseAvds(await this.runner.text(t.emulator, ['-list-avds'], 20_000));
  }

  /** Starts an emulator (it keeps running after Zinarix closes, like Android Studio's). */
  async startEmulator(avd: string): Promise<void> {
    if (!validAvd(avd)) throw new Error('Nombre de emulador no válido.');
    const t = await this.tools();
    if (!t.emulator) throw new Error('No se encontró el emulador del Android SDK.');
    if (!(await this.avds()).includes(avd)) throw new Error(`No existe el emulador ${avd}.`);
    spawn(t.emulator, ['-avd', avd], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      env: childEnv(process.env),
    }).unref();
  }

  /** The phone's screen in its own window (scrcpy), with mouse and keyboard. */
  async mirror(serial: string): Promise<void> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    const t = await this.tools();
    if (!t.scrcpy) throw new Error('scrcpy no está instalado.');
    const env = { ...childEnv(process.env), ...(t.adb ? { ADB: t.adb } : {}) };
    spawn(t.scrcpy, ['-s', serial, '--window-title', `Zinarix · ${serial}`], {
      detached: true,
      stdio: 'ignore',
      env,
    }).unref();
  }

  /** A PNG of the phone's screen. */
  async screenshot(serial: string): Promise<Buffer> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    return this.runner.buffer(
      await this.adb(),
      ['-s', serial, 'exec-out', 'screencap', '-p'],
      30_000,
    );
  }

  /** The screen size touches are measured in (wm size; cached per device). */
  async screenSize(serial: string): Promise<{ width: number; height: number } | null> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    const known = this.sizes.get(serial);
    if (known) return known;
    const out = await this.runner
      .text(await this.adb(), ['-s', serial, 'shell', 'wm', 'size'], 15_000)
      .catch(() => '');
    const size = parseWmSize(out);
    if (size) this.sizes.set(serial, size);
    return size;
  }

  /** A tap, long press, swipe, typed text or key on the phone (adb shell input). */
  async input(serial: string, i: MobileInput): Promise<void> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    await this.runner.text(await this.adb(), ['-s', serial, 'shell', ...inputArgs(i)], 20_000);
  }

  /** Installed apps: third = only the ones the user installed (not the system ones). */
  async packages(serial: string, third = true): Promise<string[]> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    return parsePackages(
      await this.runner.text(
        await this.adb(),
        ['-s', serial, 'shell', 'pm', 'list', 'packages', ...(third ? ['-3'] : [])],
        30_000,
      ),
    );
  }

  /** Opens, stops or clears (data and cache) an app; uninstall removes it. */
  async app(
    serial: string,
    pkg: string,
    action: 'launch' | 'stop' | 'clear' | 'uninstall',
  ): Promise<string> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    if (!validPackage(pkg)) throw new Error('Paquete no válido.');
    const adb = await this.adb();
    const sh = (...a: string[]) => this.runner.text(adb, ['-s', serial, 'shell', ...a], 60_000);
    if (action === 'launch') {
      const out = await sh('monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1');
      if (/No activities found|monkey aborted/i.test(out))
        throw new Error(`La app ${pkg} no tiene una pantalla de inicio (o no está instalada).`);
      return out;
    }
    if (action === 'stop') return sh('am', 'force-stop', pkg);
    if (action === 'clear') return sh('pm', 'clear', pkg);
    const out = await this.runner.text(adb, ['-s', serial, 'uninstall', pkg], 120_000);
    if (!/Success/i.test(out))
      throw new Error(out.trim().split('\n').pop() || 'No se pudo desinstalar.');
    return out;
  }

  /** Installs (or updates, -r) an APK file. */
  async install(serial: string, apk: string): Promise<string> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    if (!/\.apk$/i.test(apk) || !existsSync(apk)) throw new Error('No existe ese archivo .apk.');
    const out = await this.runner.text(
      await this.adb(),
      ['-s', serial, 'install', '-r', apk],
      10 * 60_000,
    );
    if (!/Success/i.test(out))
      throw new Error(out.trim().split('\n').pop() || 'No se pudo instalar.');
    return out;
  }

  /** .apk files of the folder (build outputs included), newest first, relative paths. */
  async apks(root: string): Promise<string[]> {
    const found: { rel: string; t: number }[] = [];
    const skip = new Set([
      'node_modules',
      '.git',
      '.gradle',
      '.dart_tool',
      'Pods',
      '.cxx',
      'intermediates',
      'tmp',
    ]);
    const look = async (dir: string, depth: number) => {
      if (found.length >= 50) return;
      let entries: import('node:fs').Dirent[];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const p = join(dir, e.name);
        if (e.isFile() && /\.apk$/i.test(e.name)) {
          const t = await stat(p)
            .then((x) => x.mtimeMs)
            .catch(() => 0);
          found.push({ rel: relative(root, p).replace(/\\/g, '/'), t });
        } else if (e.isDirectory() && depth > 0 && !skip.has(e.name) && !e.name.startsWith('.'))
          await look(p, depth - 1);
      }
    };
    await look(root, 8);
    return found.sort((a, b) => b.t - a.t).map((f) => f.rel);
  }

  /** Wi-Fi debugging: adb pair (Android 11+, with the 6-digit code) and adb connect. */
  async connect(address: string, pairCode?: string): Promise<string> {
    if (!validAddress(address)) throw new Error('Dirección no válida (IP:puerto).');
    const adb = await this.adb();
    if (pairCode !== undefined) {
      if (!validPairCode(pairCode)) throw new Error('El código de vinculación son 6 números.');
      const out = await this.runner.text(adb, ['pair', address.trim(), pairCode.trim()], 30_000);
      if (!/Successfully paired/i.test(out)) throw new Error(out.trim() || 'No se pudo vincular.');
      return out;
    }
    const out = await this.runner.text(adb, ['connect', address.trim()], 30_000);
    if (/failed|cannot|unable|refused/i.test(out)) throw new Error(out.trim());
    return out;
  }

  async disconnect(address: string): Promise<void> {
    if (!validAddress(address)) throw new Error('Dirección no válida (IP:puerto).');
    await this.runner.text(await this.adb(), ['disconnect', address.trim()], 15_000);
  }

  /** The last lines of the device log (logcat -d), threadtime format. */
  async logcatDump(serial: string, lines: number): Promise<string> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    const n = Math.max(1, Math.min(5000, Math.floor(lines)));
    return this.runner.text(
      await this.adb(),
      ['-s', serial, 'logcat', '-d', '-v', 'threadtime', '-t', String(n)],
      30_000,
    );
  }

  /** pid of a running app (adb shell pidof), to keep only its lines. */
  async pidOf(serial: string, pkg: string): Promise<number | null> {
    if (!validSerial(serial) || !/^[\w.]{1,200}$/.test(pkg)) throw new Error('Paquete no válido.');
    const out = await this.runner
      .text(await this.adb(), ['-s', serial, 'shell', 'pidof', pkg], 15_000)
      .catch(() => '');
    const n = Number.parseInt(out.trim().split(/\s+/)[0] ?? '', 10);
    return Number.isFinite(n) ? n : null;
  }

  /** Follows the device log: chunks to onData until stopLogcat (or the device goes away). */
  async followLogcat(
    key: string,
    serial: string,
    onData: (chunk: string) => void,
    onEnd: () => void,
  ): Promise<void> {
    if (!validSerial(serial)) throw new Error('Dispositivo no válido.');
    const adb = await this.adb();
    this.stopLogcat(key);
    const p = spawn(adb, ['-s', serial, 'logcat', '-v', 'threadtime', '-T', '500'], {
      windowsHide: true,
      env: childEnv(process.env),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.logcats.set(key, p);
    p.stdout.on('data', (b: Buffer) => onData(b.toString('utf8')));
    p.stderr.on('data', (b: Buffer) => onData(b.toString('utf8')));
    p.on('close', () => {
      if (this.logcats.get(key) === p) this.logcats.delete(key);
      onEnd();
    });
    p.on('error', () => undefined);
  }

  stopLogcat(key: string): void {
    const p = this.logcats.get(key);
    if (!p) return;
    this.logcats.delete(key);
    p.kill();
  }

  /** Flutter, Expo, React Native and Gradle projects of the folder (two levels down). */
  async projects(root: string): Promise<MobileProject[]> {
    const out: MobileProject[] = [];
    const look = async (dir: string, depth: number) => {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      const read = (n: string) =>
        names.includes(n)
          ? readFile(join(dir, n), 'utf8').catch(() => null)
          : Promise.resolve(null);
      const [pubspec, packageJson] = await Promise.all([
        read('pubspec.yaml'),
        read('package.json'),
      ]);
      const gradle =
        (names.includes('settings.gradle') || names.includes('settings.gradle.kts')) &&
        (names.includes('gradlew') || names.includes('gradlew.bat'));
      const kind = projectKind({ pubspec, packageJson, gradle });
      if (kind) {
        const rel = relative(root, dir).replace(/\\/g, '/');
        let name = rel.split('/').pop() || dir.split(/[\\/]/).pop() || 'app';
        if (packageJson) {
          try {
            name = (JSON.parse(packageJson) as { name?: string }).name || name;
          } catch {
            /* keep */
          }
        } else if (pubspec) name = /^name:\s*(\S+)/m.exec(pubspec)?.[1] ?? name;
        out.push({ kind, dir: rel, name });
        // A Flutter / RN project has an android/ folder with Gradle: not a second project.
        return;
      }
      if (depth > 0)
        for (const n of names)
          if (
            !n.startsWith('.') &&
            !['node_modules', 'build', 'dist', 'ios', 'android', 'Pods'].includes(n)
          )
            await look(join(dir, n), depth - 1);
    };
    await look(root, 2);
    return out;
  }

  dispose(): void {
    for (const k of [...this.logcats.keys()]) this.stopLogcat(k);
  }
}

function run(bin: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, env: childEnv(process.env) },
      (err, stdout, stderr) => {
        if (err)
          reject(
            new Error((String(stderr).trim() || err.message).split('\n').slice(-4).join('\n')),
          );
        else resolve(String(stdout));
      },
    );
  });
}

function runBuffer(bin: string, args: string[], timeout: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      args,
      {
        encoding: 'buffer',
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: childEnv(process.env),
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(String(stderr).trim() || err.message));
        else resolve(stdout);
      },
    );
  });
}

/** Full path of a program on PATH (where / which), or null. */
function which(name: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      process.platform === 'win32' ? 'where' : 'which',
      [name],
      { timeout: 8000, windowsHide: true, env: childEnv(process.env) },
      (err, stdout) => {
        if (err) return resolve(null);
        const lines = String(stdout)
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
        // Windows: prefer the .exe / .bat over an extension-less shell script.
        resolve(lines.find((l) => /\.(exe|bat|cmd)$/i.test(l)) ?? lines[0] ?? null);
      },
    );
  });
}
