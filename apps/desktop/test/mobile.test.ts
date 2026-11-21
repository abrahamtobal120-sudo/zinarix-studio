import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  filterLog,
  parseAdbDevices,
  parseAvds,
  parseLogLine,
  pngSize,
  projectCommand,
  projectKind,
  validAvd,
  validSerial,
} from '../src/shared/mobile.js';
import { MobileService } from '../src/main/mobile.js';
import { mobilePreview, runMobileTool } from '../src/main/mobileTools.js';

/** Fase 5B (plan de funciones): phones, emulators and phone app projects. */

describe('adb and emulator output', () => {
  it('reads adb devices -l', () => {
    const out = `* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
R58M123ABC             unauthorized usb:1-1 transport_id:2
192.168.1.20:5555      device product:a52q model:SM_A525M device:a52q transport_id:3

`;
    expect(parseAdbDevices(out)).toEqual([
      { serial: 'emulator-5554', state: 'device', model: 'sdk gphone64 x86 64', emulator: true },
      { serial: 'R58M123ABC', state: 'unauthorized', model: 'R58M123ABC', emulator: false },
      { serial: '192.168.1.20:5555', state: 'device', model: 'SM A525M', emulator: false },
    ]);
    expect(parseAdbDevices('List of devices attached\r\n\r\n')).toEqual([]);
  });

  it('reads emulator -list-avds without its INFO lines', () => {
    expect(parseAvds('INFO    | Storing crashdata in: C:\\x\nPixel_8_API_35\r\nMedium_Phone\n')).toEqual(['Pixel_8_API_35', 'Medium_Phone']);
  });
});

const LOG = [
  '--------- beginning of main',
  '11-20 21:30:01.123  1234  1250 D MyTag   : debug line',
  '11-20 21:30:01.200  1234  1250 I ActivityManager: Start proc com.example.app',
  '11-20 21:30:02.000  4321  4321 E AndroidRuntime: FATAL EXCEPTION: main',
  '\tat com.example.app.MainActivity.onCreate(MainActivity.kt:12)',
  '11-20 21:30:02.100  4321  4321 W System  : something odd',
];

describe('logcat', () => {
  it('splits threadtime lines', () => {
    expect(parseLogLine(LOG[3]!)).toEqual({
      time: '11-20 21:30:02.000',
      pid: 4321,
      level: 'E',
      tag: 'AndroidRuntime',
      message: 'FATAL EXCEPTION: main',
    });
    expect(parseLogLine('garbage')).toBeNull();
  });

  it('filters by level, text and app, keeping stack traces with their line', () => {
    expect(filterLog(LOG, { level: 'W' })).toEqual([LOG[3], LOG[4], LOG[5]]);
    expect(filterLog(LOG, { query: 'example' })).toEqual([LOG[2]]);
    expect(filterLog(LOG, { pid: 4321, level: 'E' })).toEqual([LOG[3], LOG[4]]);
    expect(filterLog(LOG, {})).toHaveLength(5);
  });
});

describe('projects', () => {
  it('tells the kind from the files', () => {
    expect(projectKind({ pubspec: 'name: app\ndependencies:\n  flutter:\n    sdk: flutter\n' })).toBe('flutter');
    expect(projectKind({ packageJson: '{"dependencies":{"expo":"~52.0.0","react-native":"0.76"}}' })).toBe('expo');
    expect(projectKind({ packageJson: '{"dependencies":{"react-native":"0.76"}}' })).toBe('react-native');
    expect(projectKind({ packageJson: '{"dependencies":{"react":"19"}}' })).toBeNull();
    expect(projectKind({ gradle: true })).toBe('android');
    expect(projectKind({ packageJson: '{bad' })).toBeNull();
  });

  it('gives the terminal command for each kind', () => {
    const win = { platform: 'win32' };
    expect(projectCommand({ kind: 'android', dir: '', name: 'a' }, 'run', { ...win, serial: 'emulator-5554' })).toBe(
      '$env:ANDROID_SERIAL="emulator-5554"; .\\gradlew.bat installDebug',
    );
    expect(projectCommand({ kind: 'android', dir: 'app', name: 'a' }, 'build', { platform: 'linux' })).toBe('cd "app" && ./gradlew assembleDebug');
    expect(projectCommand({ kind: 'expo', dir: 'tienda', name: 'e' }, 'run', win)).toBe('cd "tienda"; npx expo start');
    expect(projectCommand({ kind: 'flutter', dir: '', name: 'f' }, 'run', { ...win, serial: 'R58M' })).toBe('flutter run -d R58M');
    expect(projectCommand({ kind: 'expo', dir: '', name: 'e' }, 'ios', win)).toBe('npx eas build -p ios --profile development');
    expect(projectCommand({ kind: 'expo', dir: '', name: 'e' }, 'ios', { platform: 'darwin' })).toBe('npx expo run:ios');
    expect(projectCommand({ kind: 'react-native', dir: '', name: 'r' }, 'run', { ...win, serial: 'x; calc' })).toBe('npx react-native run-android');
  });

  it('checks serials, AVD names and PNG sizes', () => {
    for (const s of ['emulator-5554', 'R58M123ABC', '192.168.1.20:5555']) expect(validSerial(s)).toBe(true);
    for (const s of ['a b', 'x;rm', '', '$(x)', '-s']) expect(validSerial(s)).toBe(false);
    expect(validAvd('Pixel_8_API_35')).toBe(true);
    expect(validAvd('-wipe-data')).toBe(false); // never read as an emulator option
    expect(validAvd('a b')).toBe(false);
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 4, 56, 0, 0, 9, 96]);
    expect(pngSize(png)).toEqual({ width: 1080, height: 2400 });
    expect(pngSize(new Uint8Array(4))).toEqual({ width: 0, height: 0 });
  });
});

describe('agent cards', () => {
  it('asks for screenshots and emulators, not for reading', () => {
    expect(mobilePreview('mobile_info', {})).toBeNull();
    expect(mobilePreview('mobile_logcat', { level: 'E' })).toBeNull();
    expect(mobilePreview('mobile_screenshot', {})).toMatchObject({ risk: 'medium' });
    expect(mobilePreview('mobile_emulator', { avd: 'Pixel_8' })).toMatchObject({ command: 'emulator -avd Pixel_8' });
    expect(mobilePreview('mobile_emulator', { avd: 'a b' })).toHaveProperty('error');
    expect(mobilePreview('mobile_logcat', { serial: 'x;y' })).toHaveProperty('error');
  });
});

const tmp = mkdtempSync(join(tmpdir(), 'zs-mobile-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('this PC', () => {
  it('finds Flutter, Expo and Gradle projects, not the android/ folder inside them', async () => {
    mkdirSync(join(tmp, 'flutter_app', 'android'), { recursive: true });
    writeFileSync(join(tmp, 'flutter_app', 'pubspec.yaml'), 'name: mi_app\ndependencies:\n  flutter:\n    sdk: flutter\n');
    writeFileSync(join(tmp, 'flutter_app', 'android', 'settings.gradle'), '');
    writeFileSync(join(tmp, 'flutter_app', 'android', 'gradlew'), '');
    mkdirSync(join(tmp, 'apps', 'tienda'), { recursive: true });
    writeFileSync(join(tmp, 'apps', 'tienda', 'package.json'), '{"name":"tienda","dependencies":{"expo":"~52.0.0"}}');
    mkdirSync(join(tmp, 'nativo'), { recursive: true });
    writeFileSync(join(tmp, 'nativo', 'settings.gradle.kts'), '');
    writeFileSync(join(tmp, 'nativo', 'gradlew.bat'), '');
    const m = new MobileService();
    const list = await m.projects(tmp);
    expect(list.sort((a, b) => a.dir.localeCompare(b.dir))).toEqual([
      { kind: 'expo', dir: 'apps/tienda', name: 'tienda' },
      { kind: 'flutter', dir: 'flutter_app', name: 'mi_app' },
      { kind: 'android', dir: 'nativo', name: 'nativo' },
    ]);
    const r = await runMobileTool(m, 'mobile_info', { what: 'projects' }, tmp);
    expect(r.content).toMatch(/flutter "mi_app" in "flutter_app"\n\s+run: cd "flutter_app"(;| &&) flutter run/);
  });

  it('uses ANDROID_HOME and says what is missing', async () => {
    const sdk = join(tmp, 'sdk');
    mkdirSync(join(sdk, 'platform-tools'), { recursive: true });
    const m = new MobileService({ ...process.env, ANDROID_HOME: sdk });
    const t = await m.tools();
    expect(t.sdk).toBe(sdk);
    expect(t.emulator).toBeNull();
    const info = await runMobileTool(m, 'mobile_info', { what: 'tools' }, tmp);
    expect(info.content).toContain(`Android SDK: ${sdk}`);
    expect(info.content).toMatch(/emulator: not found/);
    const avds = await runMobileTool(m, 'mobile_info', { what: 'avds' }, tmp);
    expect(avds.content).toMatch(/not installed/);
  });
});
