import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  keepTail,
  lineEnding,
  looksLikeBoard,
  parseBoards,
  parseDevices,
  parseMemory,
  parsePlatformioIni,
  parseProblems,
  parseResult,
  problemPath,
  runArgs,
  validPort,
  validProjectDir,
} from '../src/shared/platformio.js';
import { PlatformioService } from '../src/main/platformio.js';
import { describeResult, pioPreview, runPioTool } from '../src/main/platformioTools.js';

/** Fase 5A (plan de funciones): Arduino / PlatformIO. */

const INI = `; PlatformIO Project Configuration File
[platformio]
default_envs = esp32dev

[env]
framework = arduino
monitor_speed = 115200
lib_deps =
    adafruit/DHT sensor library @ ^1.4.4
    bblanchon/ArduinoJson

[env:uno]
platform = atmelavr
board = uno
monitor_speed = 9600 ; slower

[env:esp32dev]
platform = espressif32
board = esp32dev
upload_port = COM7

[env:esp32-debug]
extends = env:esp32dev
build_type = debug
`;

describe('platformio.ini', () => {
  it('reads envs with [env] values, extends and default_envs', () => {
    const { envs, defaultEnvs } = parsePlatformioIni(INI);
    expect(envs.map((e) => e.name)).toEqual(['uno', 'esp32dev', 'esp32-debug']);
    expect(envs[0]).toMatchObject({
      board: 'uno',
      platform: 'atmelavr',
      framework: 'arduino',
      monitorSpeed: 9600,
    });
    expect(envs[1]).toMatchObject({ board: 'esp32dev', monitorSpeed: 115200, uploadPort: 'COM7' });
    // extends copies the base env (board, platform, upload_port).
    expect(envs[2]).toMatchObject({
      board: 'esp32dev',
      platform: 'espressif32',
      uploadPort: 'COM7',
    });
    expect(defaultEnvs).toEqual(['esp32dev']);
  });

  it('ignores default_envs that do not exist and CRLF / BOM files', () => {
    const r = parsePlatformioIni(
      '\uFEFF[platformio]\r\ndefault_envs = nope, a\r\n[env:a]\r\nboard = pico\r\n',
    );
    expect(r.envs).toHaveLength(1);
    expect(r.envs[0]!.board).toBe('pico');
    expect(r.defaultEnvs).toEqual(['a']);
  });
});

const BUILD_FAIL = `Compiling .pio\\build\\bluepill\\src\\main.cpp.o
src\\main.cpp: In function 'void broken()':
src\\main.cpp:5:24: error: expected primary-expression before ';' token
src\\main.cpp:5:26: error: 'undefinedFn' was not declared in this scope
include/config.h:3:9: warning: "LED" redefined
C:/Users/x/.platformio/packages/framework/cores/arduino/wiring.h:10:1: warning: something
c:/users/x/.platformio/packages/toolchain/bin/ld.exe: warning: firmware.elf has a LOAD segment with RWX permissions
src\\main.cpp:5:24: error: expected primary-expression before ';' token
*** [.pio\\build\\bluepill\\src\\main.cpp.o] Error 1
========================= [FAILED] Took 3.21 seconds =========================`;

const BUILD_OK = `Checking size .pio\\build\\bluepill\\firmware.elf
RAM:   [=         ]   5.2% (used 1072 bytes from 20480 bytes)
Flash: [=         ]  14.9% (used 9760 bytes from 65536 bytes)
========================= [SUCCESS] Took 12.35 seconds =========================`;

describe('build output', () => {
  it('finds errors and warnings with file and line, once each, skipping the linker', () => {
    const p = parseProblems(BUILD_FAIL);
    expect(p).toHaveLength(4);
    expect(p[0]).toEqual({
      file: 'src/main.cpp',
      line: 5,
      column: 24,
      severity: 'error',
      message: "expected primary-expression before ';' token",
    });
    expect(p[2]).toMatchObject({ file: 'include/config.h', severity: 'warning' });
    expect(p.some((x) => /ld\.exe/.test(x.file))).toBe(false);
  });

  it('reads RAM / Flash use and the time', () => {
    expect(parseMemory(BUILD_OK)).toEqual({
      ramUsed: 1072,
      ramTotal: 20480,
      flashUsed: 9760,
      flashTotal: 65536,
    });
    expect(parseMemory('nothing')).toBeNull();
    const r = parseResult(BUILD_OK, true);
    expect(r.seconds).toBe(12.35);
    expect(describeResult(r, '')).toMatch(/SUCCESS in 12\.35s\nRAM 1\.0 KB of 20\.0 KB \(5\.2%\)/);
    expect(parseResult(BUILD_FAIL, false).seconds).toBe(3.21);
  });

  it('turns problem paths into folder paths, never outside it', () => {
    expect(problemPath('', 'src/main.cpp')).toBe('src/main.cpp');
    expect(problemPath('firmware/robot', 'src/main.cpp')).toBe('firmware/robot/src/main.cpp');
    expect(problemPath('', 'C:/Users/x/.platformio/a.h')).toBeNull();
    expect(problemPath('', '/usr/include/a.h')).toBeNull();
    expect(problemPath('', '../outside.c')).toBeNull();
  });
});

describe('checks', () => {
  it('accepts serial ports only', () => {
    for (const p of ['COM3', 'com12', '/dev/ttyUSB0', '/dev/cu.usbserial-1410', 'loop://'])
      expect(validPort(p)).toBe(true);
    for (const p of [
      'COM3 & calc',
      '/etc/passwd',
      'socket://1.2.3.4:23',
      '',
      'COM',
      '/dev/tty0;rm',
    ])
      expect(validPort(p)).toBe(false);
  });

  it('keeps project folders inside the open folder', () => {
    expect(validProjectDir('')).toBe(true);
    expect(validProjectDir('firmware/robot')).toBe(true);
    for (const d of ['..', 'a/../..', '/abs', 'C:\\x', 'a//b'])
      expect(validProjectDir(d)).toBe(false);
  });

  it('builds pio run arguments without a shell', () => {
    expect(runArgs('/p', { dir: '', env: 'uno', target: 'upload', port: 'COM5' })).toEqual([
      'run',
      '-d',
      '/p',
      '-e',
      'uno',
      '-t',
      'upload',
      '--upload-port',
      'COM5',
    ]);
    expect(runArgs('/p', { dir: '', env: null, target: 'build' })).toEqual(['run', '-d', '/p']);
    expect(runArgs('/p', { dir: '', env: 'a', target: 'compiledb' })).toContain('compiledb');
    expect(() => runArgs('/p', { dir: '', env: 'a; rm -rf /', target: 'build' })).toThrow();
    expect(() =>
      runArgs('/p', { dir: '', env: 'a', target: 'upload', port: 'COM5 && x' }),
    ).toThrow();
    expect(() => runArgs('/p', { dir: '', env: 'a', target: 'erase' as never })).toThrow();
  });

  it('tells boards from other serial ports', () => {
    const list = parseDevices(
      JSON.stringify([
        {
          port: 'COM3',
          description: 'Intel(R) Active Management Technology - SOL (COM3)',
          hwid: 'PCI\\VEN_8086',
        },
        { port: 'COM7', description: 'USB-SERIAL CH340 (COM7)', hwid: 'USB VID:PID=1A86:7523' },
        {
          port: 'COM10',
          description: 'Silicon Labs CP210x USB to UART Bridge',
          hwid: 'USB VID:PID=10C4:EA60',
        },
      ]),
    );
    expect(list.map((d) => [d.port, d.board])).toEqual([
      ['COM7', true],
      ['COM10', true],
      ['COM3', false],
    ]);
    expect(looksLikeBoard('Arduino Uno (COM4)', '')).toBe(true);
    expect(parseDevices('not json')).toEqual([]);
  });

  it('reads boards and keeps serial tails at a line start', () => {
    const b = parseBoards(
      JSON.stringify([
        {
          id: 'uno',
          name: 'Arduino Uno',
          platform: 'atmelavr',
          mcu: 'ATMEGA328P',
          frameworks: ['arduino'],
          vendor: 'Arduino',
        },
        { bad: 1 },
      ]),
    );
    expect(b).toEqual([
      {
        id: 'uno',
        name: 'Arduino Uno',
        platform: 'atmelavr',
        mcu: 'ATMEGA328P',
        frameworks: ['arduino'],
        vendor: 'Arduino',
      },
    ]);
    expect(keepTail('aaa\nbbb\nccc', 6)).toBe('ccc');
    expect(lineEnding('hi', 'crlf')).toBe('hi\r\n');
    expect(lineEnding('hi', 'none')).toBe('hi');
  });
});

describe('agent approval cards', () => {
  it('asks for build and upload, not for looking', () => {
    expect(pioPreview('pio_info', { what: 'devices' })).toBeNull();
    expect(pioPreview('serial_monitor', { action: 'read' })).toBeNull();
    const up = pioPreview('pio_upload', { env: 'uno', port: 'COM5' });
    expect(up).toMatchObject({
      risk: 'high',
      command: 'pio run -t upload -e uno --upload-port COM5',
    });
    expect(pioPreview('pio_build', {})).toMatchObject({ risk: 'medium' });
    expect(pioPreview('serial_monitor', { action: 'open', port: 'COM5' })).toMatchObject({
      risk: 'medium',
    });
    expect(pioPreview('serial_monitor', { action: 'send', port: 'COM5' })).toEqual({
      error: 'Missing text to send.',
    });
  });

  it('refuses bad ports, envs and folders before asking', () => {
    expect(pioPreview('pio_upload', { port: 'COM5 & calc' })).toHaveProperty('error');
    expect(pioPreview('pio_build', { env: '$(x)' })).toHaveProperty('error');
    expect(pioPreview('pio_build', { project: '../../etc' })).toHaveProperty('error');
  });
});

// ---------------- with the real PlatformIO (skipped when it is not installed) ----------------

const pio = new PlatformioService();
const st = await pio.status();
// The STM32 platform works offline once installed (ESP32 asks pip for packages on first use).
const hasStm = existsSync(join(homedir(), '.platformio', 'platforms', 'ststm32'));
const tmp = mkdtempSync(join(tmpdir(), 'zs-pio-'));
afterAll(() => {
  pio.dispose();
  rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(st.state !== 'ready')('PlatformIO on this PC', () => {
  it('finds the projects of a folder and the serial ports', async () => {
    mkdirSync(join(tmp, 'robot', 'src'), { recursive: true });
    writeFileSync(join(tmp, 'robot', 'platformio.ini'), INI);
    const list = await pio.projects(tmp);
    expect(list.map((p) => p.dir)).toEqual(['robot']);
    const info = await runPioTool(pio, 'pio_info', {}, tmp);
    expect(info.ok).toBe(true);
    expect(info.content).toMatch(/project "robot".*\n\s+\[env:uno\] board=uno/);
    const dev = await runPioTool(pio, 'pio_info', { what: 'devices' }, tmp);
    expect(dev.ok).toBe(true);
    rmSync(join(tmp, 'robot'), { recursive: true, force: true });
  }, 60_000);

  it('searches boards', async () => {
    const list = await pio.boards('bluepill');
    expect(list.some((b) => b.id === 'bluepill_f103c8')).toBe(true);
  }, 60_000);

  it('serial monitor: open, send and read back on a loopback port', async () => {
    const open = await runPioTool(
      pio,
      'serial_monitor',
      { action: 'open', port: 'loop://', baud: 115200, seconds: 0 },
      tmp,
    );
    expect(open.ok, open.content).toBe(true);
    const sent = await runPioTool(
      pio,
      'serial_monitor',
      { action: 'send', text: 'hola placa', seconds: 1 },
      tmp,
    );
    expect(sent.content).toContain('hola placa');
    const read = await runPioTool(pio, 'serial_monitor', { action: 'read' }, tmp);
    expect(read.content).toContain('hola placa\n');
    await runPioTool(pio, 'serial_monitor', { action: 'close' }, tmp);
    await new Promise((r) => setTimeout(r, 300));
    expect(pio.openPorts()).toEqual([]);
    const closed = await runPioTool(
      pio,
      'serial_monitor',
      { action: 'read', port: 'loop://' },
      tmp,
    );
    expect(closed.ok).toBe(false);
  }, 30_000);

  it('says why a port cannot be opened', async () => {
    await expect(pio.openSerial('COM199', 9600)).rejects.toThrow(/no existe|could not|not/i);
  }, 30_000);

  it.skipIf(!hasStm)(
    'builds a real sketch, then reports its errors with file and line',
    async () => {
      const dir = join(tmp, 'blink');
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(
        join(dir, 'platformio.ini'),
        '[env:bluepill]\nplatform = ststm32\nboard = bluepill_f103c8\nframework = arduino\n',
      );
      writeFileSync(
        join(dir, 'src', 'main.cpp'),
        '#include <Arduino.h>\nvoid setup(){ pinMode(PC13, OUTPUT); }\nvoid loop(){ digitalWrite(PC13, !digitalRead(PC13)); delay(300); }\n',
      );
      const ok = await runPioTool(pio, 'pio_build', { project: 'blink' }, tmp);
      expect(ok.ok, ok.content).toBe(true);
      expect(ok.content).toMatch(/^SUCCESS/);
      expect(ok.content).toMatch(/RAM .* Flash /);
      writeFileSync(
        join(dir, 'src', 'main.cpp'),
        '#include <Arduino.h>\nvoid setup(){ int x = ; }\nvoid loop(){ nope(); }\n',
      );
      const bad = await runPioTool(pio, 'pio_build', { project: 'blink' }, tmp);
      expect(bad.ok).toBe(false);
      expect(bad.content).toMatch(/error: blink\/src\/main\.cpp:2:\d+:/);
      expect(bad.content).toMatch(/error: blink\/src\/main\.cpp:3:\d+: 'nope' was not declared/);
      expect(bad.summary).toBe('2 errores');
      // compile_commands.json for clangd.
      const r = await pio.runJob(tmp, { dir: 'blink', env: null, target: 'compiledb' });
      expect(r.ok).toBe(true);
      expect((await pio.projects(tmp))[0]!.compileDb).toBe(true);
    },
    600_000,
  );
});
