import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  niceTicks,
  parsePlotLine,
  PlotData,
  plotCsv,
  plotRange,
  seriesStats,
} from '../src/shared/serialPlot.js';
import {
  libName,
  parseLibSearch,
  parsePlatformioIni,
  validLibQuery,
  validLibSpec,
} from '../src/shared/platformio.js';
import {
  inputArgs,
  parsePackages,
  parseWmSize,
  toDevicePoint,
  validAddress,
  validPackage,
  validPairCode,
  type MobileTools,
} from '../src/shared/mobile.js';
import { PlatformioService } from '../src/main/platformio.js';
import { pioPreview, runPioTool } from '../src/main/platformioTools.js';
import { MobileService, type MobileRunner } from '../src/main/mobile.js';
import { mobilePreview, runMobileTool, toInput } from '../src/main/mobileTools.js';

/** Mejoras de la Fase 5 (plan de funciones): serial plotter, libraries, phone screen and apps. */

describe('serial plotter', () => {
  it('reads the Arduino plotter formats and skips text lines', () => {
    expect(parsePlotLine('12 34.5 -6')).toEqual([
      { name: 'v1', value: 12 },
      { name: 'v2', value: 34.5 },
      { name: 'v3', value: -6 },
    ]);
    expect(parsePlotLine('1,2\t3')?.map((v) => v.value)).toEqual([1, 2, 3]);
    expect(parsePlotLine('temp:23.5,hum:40')).toEqual([
      { name: 'temp', value: 23.5 },
      { name: 'hum', value: 40 },
    ]);
    expect(parsePlotLine('Temp: 23.5 C  hum = 41')).toEqual([
      { name: 'Temp', value: 23.5 },
      { name: 'hum', value: 41 },
    ]);
    expect(parsePlotLine('x=1e3 y=-.5')?.map((v) => v.value)).toEqual([1000, -0.5]);
    expect(parsePlotLine('Starting…')).toBeNull();
    expect(parsePlotLine('WiFi ok 3')).toBeNull();
    expect(parsePlotLine('')).toBeNull();
  });

  it('keeps aligned samples from chunks cut anywhere, with a cap', () => {
    const p = new PlotData(3);
    expect(p.push('a:1,b:')).toBe(0);
    expect(p.push('2\r\nhello\na:3\n')).toBe(2);
    expect(p.series).toEqual(['a', 'b']);
    expect(p.samples).toEqual([
      { n: 0, values: { a: 1, b: 2 } },
      { n: 1, values: { a: 3 } },
    ]);
    p.push('a:4\na:5\n');
    expect(p.samples.map((s) => s.n)).toEqual([1, 2, 3]);
    const st = seriesStats(p.samples, p.series);
    expect(st[0]).toMatchObject({ name: 'a', count: 3, last: 5, min: 3, max: 5, avg: 4 });
    expect(st[1]!.count).toBe(0);
    expect(Number.isNaN(st[1]!.last)).toBe(true);
    expect(plotCsv(p.samples, p.series)).toBe('n,a,b\n1,3,\n2,4,\n3,5,\n');
    p.clear();
    expect(p.samples).toEqual([]);
  });

  it('gives a y range and round ticks', () => {
    expect(plotRange([], ['a'])).toEqual({ min: 0, max: 1 });
    const flat = plotRange([{ n: 0, values: { a: 5 } }], ['a']);
    expect(flat.min).toBeLessThan(5);
    expect(flat.max).toBeGreaterThan(5);
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(-1.2, 1.3, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });
});

const SEARCH = `Found 205 packages (page 1 of 21)\r
\r
markruys/DHT\r
Library \u2022 1.0.0 \u2022 Published on Mon Oct 10 07:35:51 2016\r
An Arduino library for reading the DHT family of temperature and humidity sensors.\r
\r
adafruit/DHT sensor library\r
Library \u2022 1.4.7 \u2022 Published on Thu Feb 26 01:48:06 2026\r
Arduino library for DHT11, DHT22, etc Temp & Humidity Sensors\r
\r
platformio/ststm32\r
Platform \u2022 19.0.0 \u2022 Published on Mon Jan 1 2026\r
ST STM32\r
`;

describe('libraries', () => {
  it('reads pio pkg search (no JSON there) and keeps only libraries', () => {
    const r = parseLibSearch(SEARCH);
    expect(r.total).toBe(205);
    expect(r.pages).toBe(21);
    expect(r.libraries.map((l) => `${l.id}@${l.version}`)).toEqual([
      'markruys/DHT@1.0.0',
      'adafruit/DHT sensor library@1.4.7',
    ]);
    expect(r.libraries[1]).toMatchObject({
      owner: 'adafruit',
      name: 'DHT sensor library',
      published: 'Thu Feb 26 01:48:06 2026',
    });
    expect(r.libraries[1]!.description).toMatch(/DHT11, DHT22/);
  });

  it('reads lib_deps (several lines or commas, inherited from [env])', () => {
    const ini =
      '[env]\nlib_deps =\n  adafruit/DHT sensor library@^1.4.7\n  knolleary/PubSubClient\n[env:a]\nboard = uno\n[env:b]\nboard = uno\nlib_deps = Servo, bblanchon/ArduinoJson @ ^7\n';
    const { envs } = parsePlatformioIni(ini);
    expect(envs[0]!.libDeps).toEqual([
      'adafruit/DHT sensor library@^1.4.7',
      'knolleary/PubSubClient',
    ]);
    expect(envs[1]!.libDeps).toEqual(['Servo', 'bblanchon/ArduinoJson @ ^7']);
    expect(libName('bblanchon/ArduinoJson @ ^7')).toBe('bblanchon/ArduinoJson');
  });

  it('accepts registry specs only (no options, URLs or paths)', () => {
    for (const ok of [
      'Servo',
      'adafruit/DHT sensor library',
      'adafruit/DHT sensor library@^1.4.7',
      'bblanchon/ArduinoJson @ ~7.0.0',
      'lib@>=1.0,<2',
    ])
      expect(validLibSpec(ok), ok).toBe(true);
    for (const bad of [
      '-e',
      '--global',
      'https://github.com/x/y.git',
      'file://C:/x',
      '../x',
      'C:\\libs\\x',
      'a/b/c',
      '',
      'x'.repeat(200),
    ])
      expect(validLibSpec(bad), bad).toBe(false);
    expect(validLibQuery('DHT22')).toBe(true);
    expect(validLibQuery('-h')).toBe(false);
    expect(validLibQuery('a;rm')).toBe(false);
  });

  it('asks before installing or removing, not for list or search', () => {
    expect(pioPreview('pio_library', { action: 'list' })).toBeNull();
    expect(pioPreview('pio_library', { action: 'search', query: 'dht' })).toBeNull();
    expect(pioPreview('pio_library', { action: 'search', query: '--x' })).toHaveProperty('error');
    const card = pioPreview('pio_library', {
      action: 'install',
      spec: 'adafruit/DHT sensor library@^1.4.7',
    });
    expect(card).toMatchObject({
      risk: 'medium',
      command: 'pio pkg install -l "adafruit/DHT sensor library@^1.4.7"',
    });
    const rm = pioPreview('pio_library', {
      action: 'uninstall',
      spec: 'adafruit/DHT sensor library@^1.4.7',
    });
    expect(rm).toMatchObject({ command: 'pio pkg uninstall -l "adafruit/DHT sensor library"' });
    expect(
      pioPreview('pio_library', { action: 'install', spec: 'https://evil/x.git' }),
    ).toHaveProperty('error');
    expect(pioPreview('serial_monitor', { action: 'values' })).toBeNull();
  });
});

const pio = new PlatformioService();
const st = await pio.status();
const tmp = mkdtempSync(join(tmpdir(), 'zs-f5m-'));
afterAll(() => {
  pio.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(st.state !== 'ready')('PlatformIO on this PC', () => {
  it('serial_monitor "values" summarises the numbers on a loopback port', async () => {
    const open = await runPioTool(
      pio,
      'serial_monitor',
      { action: 'open', port: 'loop://', baud: 115200, seconds: 0 },
      tmp,
    );
    expect(open.ok, open.content).toBe(true);
    for (const [t, h] of [
      [20, 40],
      [22, 41],
      [24, 45],
    ])
      await pio.writeSerial('loop://', `temp:${t},hum:${h}\n`);
    await pio.writeSerial('loop://', 'ready\n');
    await new Promise((r) => setTimeout(r, 600));
    const v = await runPioTool(pio, 'serial_monitor', { action: 'values' }, tmp);
    expect(v.ok, v.content).toBe(true);
    expect(v.content).toContain('3 samples of temp, hum');
    expect(v.content).toContain('temp: last 24, min 20, max 24, avg 22 (3 samples)');
    expect(v.content).toContain('hum: last 45, min 40, max 45, avg 42');
    await runPioTool(pio, 'serial_monitor', { action: 'close' }, tmp);
  }, 30_000);

  const hasStm = existsSync(join(homedir(), '.platformio', 'platforms', 'ststm32'));
  it.skipIf(!hasStm)(
    'searches, installs, lists and removes a real library (needs internet)',
    async (ctx) => {
      const dir = join(tmp, 'clima');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'platformio.ini'),
        '[env:bluepill]\nplatform = ststm32\nboard = bluepill_f103c8\nframework = arduino\n',
      );
      writeFileSync(
        join(dir, 'src', 'main.cpp'),
        '#include <Arduino.h>\nvoid setup(){}\nvoid loop(){}\n',
      );
      const found = await runPioTool(
        pio,
        'pio_library',
        { action: 'search', query: 'DHT sensor' },
        tmp,
      );
      if (!found.ok && /internet|network|resolve|connect|timed out/i.test(found.content))
        return ctx.skip();
      expect(found.ok, found.content).toBe(true);
      expect(found.content).toMatch(/adafruit\/DHT sensor library@\^\d/);
      const inst = await runPioTool(
        pio,
        'pio_library',
        { action: 'install', project: 'clima', spec: 'adafruit/DHT sensor library@^1.4.7' },
        tmp,
      );
      expect(inst.ok, inst.content).toBe(true);
      expect(readFileSync(join(dir, 'platformio.ini'), 'utf8')).toMatch(
        /lib_deps = adafruit\/DHT sensor library@\^1\.4\.7/,
      );
      const list = await runPioTool(pio, 'pio_library', { action: 'list', project: 'clima' }, tmp);
      expect(list.content).toMatch(/lib_deps: adafruit\/DHT sensor library@\^1\.4\.7/);
      expect(list.content).toMatch(/downloaded: .*DHT sensor library 1\.4\.\d/);
      expect(list.content).toMatch(/Adafruit Unified Sensor/);
      const rm = await runPioTool(
        pio,
        'pio_library',
        { action: 'uninstall', project: 'clima', spec: 'adafruit/DHT sensor library' },
        tmp,
      );
      expect(rm.ok, rm.content).toBe(true);
      expect(readFileSync(join(dir, 'platformio.ini'), 'utf8')).not.toMatch(/DHT/);
    },
    300_000,
  );
});

describe('phone input', () => {
  it('builds adb shell input words, quoting text for the phone shell', () => {
    expect(inputArgs({ kind: 'tap', x: 10.6, y: 20 })).toEqual(['input', 'tap', '11', '20']);
    expect(inputArgs({ kind: 'long_press', x: 1, y: 2 })).toEqual([
      'input',
      'swipe',
      '1',
      '2',
      '1',
      '2',
      '700',
    ]);
    expect(inputArgs({ kind: 'swipe', x: 1, y: 2, x2: 3, y2: 4, ms: 99999 })).toEqual([
      'input',
      'swipe',
      '1',
      '2',
      '3',
      '4',
      '10000',
    ]);
    expect(inputArgs({ kind: 'key', key: 'home' })).toEqual(['input', 'keyevent', '3']);
    expect(inputArgs({ kind: 'text', text: "hola mundo; it's $HOME `x`" })).toEqual([
      'input',
      'text',
      "'hola%smundo;%sit'\\''s%s$HOME%s`x`'",
    ]);
  });

  it('refuses what could become a second command or is not typeable', () => {
    expect(() => inputArgs({ kind: 'tap', x: Number.NaN, y: 1 })).toThrow();
    expect(() => inputArgs({ kind: 'tap', x: -1, y: 1 })).toThrow();
    expect(() => inputArgs({ kind: 'tap', x: '1; reboot' as unknown as number, y: 1 })).toThrow();
    expect(() => inputArgs({ kind: 'key', key: 'reboot' as never })).toThrow();
    expect(() => inputArgs({ kind: 'text', text: 'canción' })).toThrow(/ASCII/);
    expect(() => inputArgs({ kind: 'text', text: '' })).toThrow();
    expect(() => inputArgs({ kind: 'text', text: 'a\nreboot' })).toThrow();
  });

  it('maps a click on the picture to phone pixels', () => {
    expect(
      toDevicePoint(50, 100, { width: 100, height: 200 }, { width: 1080, height: 2400 }),
    ).toEqual({ x: 540, y: 1200 });
    expect(
      toDevicePoint(500, -5, { width: 100, height: 200 }, { width: 1080, height: 2400 }),
    ).toEqual({ x: 1079, y: 0 });
  });

  it('reads packages, wm size and checks addresses and codes', () => {
    expect(
      parsePackages(
        'package:com.b.app\r\npackage:com.a.app\npackage:bad name\npackage:com.a.app\n',
      ),
    ).toEqual(['com.a.app', 'com.b.app']);
    expect(parseWmSize('Physical size: 1080x2400\n')).toEqual({ width: 1080, height: 2400 });
    expect(parseWmSize('Physical size: 1080x2400\nOverride size: 720x1600')).toEqual({
      width: 720,
      height: 1600,
    });
    expect(validPackage('com.example.my_app')).toBe(true);
    expect(validPackage('com.x; reboot')).toBe(false);
    expect(validPackage('-p')).toBe(false);
    expect(validAddress('192.168.1.20:37099')).toBe(true);
    expect(validAddress('pixel.local:5555')).toBe(true);
    expect(validAddress('192.168.1.20')).toBe(false);
    expect(validAddress('-a:1')).toBe(false);
    expect(validAddress('1.2.3.4:70000')).toBe(false);
    expect(validPairCode('123456')).toBe(true);
    expect(validPairCode('12345')).toBe(false);
  });
});

/** A PNG header is all pngSize reads. */
function fakePng(w: number, h: number): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
}

class FakePhone extends MobileService {
  calls: string[][] = [];
  constructor(answer: (args: string[]) => string = () => '') {
    const calls: string[][] = [];
    const runner: MobileRunner = {
      text: async (_bin, args) => {
        calls.push(args);
        return answer(args);
      },
      buffer: async (_bin, args) => {
        calls.push(args);
        return fakePng(1080, 2400);
      },
    };
    super(process.env, runner);
    this.calls = calls;
    const tools: MobileTools = {
      sdk: null,
      adb: 'adb',
      emulator: null,
      flutter: null,
      scrcpy: null,
      xcrun: null,
      platform: process.platform,
    };
    this.cached = tools;
  }
}

const phoneAnswer = (args: string[]) => {
  if (args[0] === 'devices')
    return 'List of devices attached\nemulator-5554  device product:sdk model:Pixel_8 device:emu\n';
  if (args.includes('pm') && args.includes('list'))
    return 'package:com.example.shop\npackage:org.demo.app\n';
  if (args.includes('monkey'))
    return args.includes('com.nope.app')
      ? '** No activities found to run, monkey aborted.'
      : 'Events injected: 1';
  if (args[0] === 'connect') return 'connected to 192.168.1.20:5555';
  if (args[0] === 'pair') return 'Successfully paired to 192.168.1.20:37000 [guid=adb-x]';
  if (args.includes('install')) return 'Performing Streamed Install\nSuccess';
  return '';
};

describe('phone service and AI tools (fake adb)', () => {
  it('taps, types and presses keys through adb, then looks at the screen', async () => {
    const m = new FakePhone(phoneAnswer);
    const r = await runMobileTool(
      m,
      'mobile_input',
      { action: 'tap', x: 540, y: 1200, wait_ms: 0 },
      tmp,
    );
    expect(r.ok, r.content).toBe(true);
    expect(m.calls).toContainEqual(['-s', 'emulator-5554', 'shell', 'input', 'tap', '540', '1200']);
    expect(r.image).toMatchObject({ width: 1080, height: 2400, mediaType: 'image/png' });
    await runMobileTool(
      m,
      'mobile_input',
      { action: 'text', text: 'hi there', screenshot: false },
      tmp,
    );
    expect(m.calls).toContainEqual([
      '-s',
      'emulator-5554',
      'shell',
      'input',
      'text',
      "'hi%sthere'",
    ]);
    const bad = await runMobileTool(m, 'mobile_input', { action: 'key', key: 'explode' }, tmp);
    expect(bad.ok).toBe(false);
  });

  it('lists, opens and installs apps; the .apk must be in the folder', async () => {
    const m = new FakePhone(phoneAnswer);
    const list = await runMobileTool(m, 'mobile_app', { action: 'list', query: 'shop' }, tmp);
    expect(list.content).toBe('com.example.shop');
    expect(m.calls).toContainEqual([
      '-s',
      'emulator-5554',
      'shell',
      'pm',
      'list',
      'packages',
      '-3',
    ]);
    const open = await runMobileTool(
      m,
      'mobile_app',
      { action: 'launch', package: 'com.example.shop' },
      tmp,
    );
    expect(open.ok).toBe(true);
    const none = await runMobileTool(
      m,
      'mobile_app',
      { action: 'launch', package: 'com.nope.app' },
      tmp,
    );
    expect(none.ok).toBe(false);
    expect(none.content).toMatch(/pantalla de inicio/);
    mkdirSync(join(tmp, 'app', 'build'), { recursive: true });
    writeFileSync(join(tmp, 'app', 'build', 'app-debug.apk'), 'apk');
    expect(await m.apks(tmp)).toEqual(['app/build/app-debug.apk']);
    const inst = await runMobileTool(
      m,
      'mobile_app',
      { action: 'install', apk: 'app/build/app-debug.apk' },
      tmp,
    );
    expect(inst.ok, inst.content).toBe(true);
    expect(
      m.calls.some((c) => c[2] === 'install' && c[3] === '-r' && c[4]!.endsWith('app-debug.apk')),
    ).toBe(true);
    const out = await runMobileTool(
      m,
      'mobile_app',
      { action: 'install', apk: '../../evil.apk' },
      tmp,
    );
    expect(out.ok).toBe(false);
    expect(out.content).toMatch(/inside the open folder/);
  });

  it('pairs and connects over Wi-Fi', async () => {
    const m = new FakePhone(phoneAnswer);
    const pair = await runMobileTool(
      m,
      'mobile_connect',
      { address: '192.168.1.20:37000', pair_code: '123456' },
      tmp,
    );
    expect(pair.ok, pair.content).toBe(true);
    expect(m.calls).toContainEqual(['pair', '192.168.1.20:37000', '123456']);
    const con = await runMobileTool(m, 'mobile_connect', { address: '192.168.1.20:5555' }, tmp);
    expect(con.content).toMatch(/connected/);
    await expect(m.connect('nope')).rejects.toThrow(/IP:puerto/);
  });

  it('approval cards: touching and apps ask; clearing and uninstalling never get "always"', () => {
    expect(toInput({ action: 'swipe', x: 1, y: 2, x2: 3, y2: 4 })).toMatchObject({ kind: 'swipe' });
    const tap = mobilePreview('mobile_input', { action: 'tap', x: 1, y: 2 });
    expect(tap).toMatchObject({ risk: 'medium', allowKey: 'mobile_input:' });
    expect(mobilePreview('mobile_input', { action: 'text', text: 'ñ' })).toHaveProperty('error');
    expect(mobilePreview('mobile_app', { action: 'list' })).toBeNull();
    expect(mobilePreview('mobile_app', { action: 'launch', package: 'com.a.b' })).toHaveProperty(
      'allowKey',
    );
    const clear = mobilePreview('mobile_app', { action: 'clear', package: 'com.a.b' });
    expect(clear).toMatchObject({ risk: 'high' });
    expect(clear).not.toHaveProperty('allowKey');
    expect(
      mobilePreview('mobile_app', { action: 'uninstall', package: 'com.a.b' }),
    ).not.toHaveProperty('allowKey');
    expect(mobilePreview('mobile_app', { action: 'launch', package: 'x; reboot' })).toHaveProperty(
      'error',
    );
    const pair = mobilePreview('mobile_connect', { address: '10.0.0.2:4000', pair_code: '654321' });
    expect(pair).toMatchObject({ command: 'adb pair 10.0.0.2:4000 ******' });
    expect(pair).not.toHaveProperty('allowKey');
    expect(mobilePreview('mobile_connect', { address: 'bad' })).toHaveProperty('error');
  });
});
