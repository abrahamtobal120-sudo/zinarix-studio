import { describe, expect, it } from 'vitest';
import {
  COMPUTER_CONTROL_KEY,
  COMPUTER_SCREEN_KEY,
  computerLooksOnly,
  computerPreview,
  matchWindow,
  openTarget,
  runComputerTool,
  type ComputerService,
  type WindowInfo,
} from '../src/main/computerTools.js';
import { parseWinList } from '../src/main/computerDrivers.js';
import {
  aiName,
  BAR_LABELS,
  barLabelsFor,
  ComputerControlRun,
  PAUSE_NOTE,
  type BarHandle,
} from '../src/main/computerMode.js';

/** Mejoras de "Controlar la compu": abrir, ventanas, ver de cerca y la pausa. */

function fakeService(cursor = { x: 500, y: 500 }) {
  const log: string[] = [];
  const wins: WindowInfo[] = [
    { id: '11', app: 'notepad', title: 'Sin título: Bloc de notas' },
    { id: '22', app: 'EXCEL', title: 'Ventas 2026.xlsx - Excel' },
    { id: '33', app: 'chrome', title: 'Correo - Google Chrome' },
  ];
  const svc: ComputerService = {
    unavailable: async () => null,
    screenshot: async () => ({ mediaType: 'image/jpeg', data: 'AAAA', width: 1280, height: 720 }),
    cursor: async () => cursor,
    move: async () => undefined,
    click: async (x, y) => void log.push(`click ${x},${y}`),
    drag: async () => undefined,
    scroll: async () => undefined,
    type: async () => undefined,
    keys: async () => undefined,
    zoom: async (x, y, w, h) => (
      log.push(`zoom ${x},${y} ${w}x${h}`),
      { mediaType: 'image/png', data: 'BBBB', width: w * 2, height: h * 2 }
    ),
    open: async (t) =>
      void log.push(
        `open ${t.kind}:${t.kind === 'url' ? t.url : t.kind === 'file' ? t.path : t.name}`,
      ),
    windows: async () => wins,
    focus: async (id) => (log.push(`focus ${id}`), true),
  };
  return { svc, log };
}

describe('computer_open', () => {
  it('accepts programs by name, web pages, settings pages and documents', () => {
    expect(openTarget('notepad')).toEqual({ kind: 'app', name: 'notepad' });
    expect(openTarget('Google Chrome')).toEqual({ kind: 'app', name: 'Google Chrome' });
    expect(openTarget('https://example.com/a?b=1')).toEqual({
      kind: 'url',
      url: 'https://example.com/a?b=1',
    });
    expect(openTarget('ms-settings:display')).toMatchObject({ kind: 'url' });
    expect(openTarget('mailto:a@b.c')).toMatchObject({ kind: 'url' });
    expect(openTarget('C:\\Users\\yo\\Documents\\informe.docx')).toMatchObject({ kind: 'file' });
    expect(openTarget('~/notas.txt')).toMatchObject({ kind: 'file' });
  });

  it('refuses whatever would run code or reach the shell', () => {
    for (const bad of [
      'C:\\Users\\yo\\Downloads\\setup.exe',
      'C:\\temp\\x.bat',
      '/tmp/x.sh',
      'D:\\a\\b.ps1',
      'C:\\x\\acceso.lnk',
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'notepad & calc',
      'calc; rm -rf /',
      'a|b',
      'ftp://x',
      '',
      'notepad\ncalc',
    ])
      expect(openTarget(bad), bad).toHaveProperty('error');
  });

  it('opens, waits and returns a screenshot', async () => {
    const { svc, log } = fakeService();
    const r = await runComputerTool(
      svc,
      'computer_open',
      { target: 'notepad', wait: 0 },
      undefined,
      0,
    );
    expect(r.ok).toBe(true);
    expect(log).toEqual(['open app:notepad']);
    expect(r.image).toBeDefined();
  });

  it('a failure tells the AI what else to try', async () => {
    const { svc } = fakeService();
    svc.open = async () => {
      throw new Error('This command cannot be run');
    };
    const r = await runComputerTool(
      svc,
      'computer_open',
      { target: 'nadaexiste', wait: 0 },
      undefined,
      0,
    );
    expect(r.ok).toBe(false);
    expect(r.content).toMatch(/Start menu/);
  });

  it('is approved as controlling the computer', () => {
    const p = computerPreview('computer_open', { target: 'https://example.com' });
    expect(p.allowKey).toBe(COMPUTER_CONTROL_KEY);
    expect(p.action).toBe('abrir https://example.com');
  });
});

describe('computer_windows', () => {
  const list: WindowInfo[] = [
    { id: '1', app: 'notepad', title: 'Sin título: Bloc de notas' },
    { id: '2', app: 'EXCEL', title: 'Ventas.xlsx - Excel' },
    { id: '3', app: 'chrome', title: 'Excel tips - Google Chrome' },
  ];
  it('matches the program first, then the title, then all the words', () => {
    expect(matchWindow(list, 'excel')?.id).toBe('2');
    expect(matchWindow(list, 'Bloc de notas')?.id).toBe('1');
    expect(matchWindow(list, 'tips chrome')?.id).toBe('3');
    expect(matchWindow(list, 'word')).toBeNull();
    expect(matchWindow(list, '  ')).toBeNull();
  });

  it('lists without a screenshot and switches with one', async () => {
    const { svc, log } = fakeService();
    const l = await runComputerTool(svc, 'computer_windows', {}, undefined, 0);
    expect(l.ok).toBe(true);
    expect(l.image).toBeUndefined();
    expect(l.content).toMatch(/EXCEL: Ventas 2026\.xlsx - Excel/);
    const f = await runComputerTool(svc, 'computer_windows', { focus: 'excel' }, undefined, 0);
    expect(f.ok).toBe(true);
    expect(log).toEqual(['focus 22']);
    expect(f.image).toBeDefined();
    const miss = await runComputerTool(
      svc,
      'computer_windows',
      { focus: 'photoshop' },
      undefined,
      0,
    );
    expect(miss.ok).toBe(false);
    expect(miss.content).toMatch(/notepad/);
  });

  it('listing is "seeing", switching is "controlling"', () => {
    expect(computerPreview('computer_windows', {}).allowKey).toBe(COMPUTER_SCREEN_KEY);
    expect(computerPreview('computer_windows', { focus: 'x' }).allowKey).toBe(COMPUTER_CONTROL_KEY);
    expect(computerLooksOnly('computer_windows', {})).toBe(true);
    expect(computerLooksOnly('computer_windows', { focus: 'x' })).toBe(false);
  });

  it('reads the helpers window list', () => {
    expect(parseWinList('132\t40\tnotepad\tNota\tcon tab\r\n\n7\t9\tEXCEL\t\n')).toEqual([
      { id: '132', pid: 40, app: 'notepad', title: 'Nota con tab' },
      { id: '7', pid: 9, app: 'EXCEL', title: '' },
    ]);
  });
});

describe('computer_zoom', () => {
  it('returns a detailed view and how to convert its coordinates', async () => {
    const { svc, log } = fakeService();
    const r = await runComputerTool(
      svc,
      'computer_zoom',
      { x: 100, y: 50, width: 200, height: 100 },
      undefined,
      0,
    );
    expect(r.ok).toBe(true);
    expect(log).toEqual(['zoom 100,50 200x100']);
    expect(r.image?.width).toBe(400);
    expect(r.content).toMatch(/x = 100 \+ zx × 0\.5000/);
    expect(computerPreview('computer_zoom', { x: 1, y: 1, width: 10, height: 10 }).allowKey).toBe(
      COMPUTER_SCREEN_KEY,
    );
  });
  it('needs a real region', async () => {
    const { svc } = fakeService();
    const r = await runComputerTool(
      svc,
      'computer_zoom',
      { x: 1, y: 1, width: 2, height: 100 },
      undefined,
      0,
    );
    expect(r.ok).toBe(false);
  });
});

// ---------- The bar: pause, take over, stop ----------

function makeRun(cursorAt: { x: number; y: number } = { x: 0, y: 0 }) {
  const log: string[] = [];
  const cur = { ...cursorAt };
  let min = false;
  const win = {
    isDestroyed: () => false,
    isMinimized: () => min,
    minimize: () => {
      min = true;
      log.push('minimize');
    },
    restore: () => {
      min = false;
      log.push('restore');
    },
    show: () => void log.push('show'),
    focus: () => undefined,
  };
  const bar: BarHandle = {
    status: (t) => void log.push(`bar ${t}`),
    paused: (on, takeover) => void log.push(`paused ${on}${takeover ? ' takeover' : ''}`),
    destroy: () => void log.push('bar destroyed'),
  };
  let stopped = 0;
  let unregistered = 0;
  const run = new ComputerControlRun(win, () => void stopped++, BAR_LABELS.es, {
    cursor: async () => ({ ...cur }),
    makeBar: () => bar,
    registerStop: () => () => void unregistered++,
  });
  return { run, log, cur, stopped: () => stopped, unregistered: () => unregistered };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('Controlar la compu: the bar', () => {
  it('numbers the steps', async () => {
    const { run, log } = makeRun();
    await run.before();
    run.status('clic en 1,2');
    run.status('escrito (4 car.)');
    expect(log).toContain('bar Paso 1: clic en 1,2');
    expect(log).toContain('bar Paso 2: escrito (4 car.)');
  });

  it('moving the mouse pauses the AI until Continuar, and the action is not carried out', async () => {
    const { run, log, cur } = makeRun({ x: 300, y: 300 });
    await run.before();
    await run.after();
    // The user grabs the mouse.
    cur.x = 600;
    let done: string | undefined | null = null;
    const p = run.before().then((n) => (done = n));
    await tick();
    await tick();
    expect(done).toBeNull();
    expect(run.isPaused).toBe(true);
    expect(log).toContain('paused true takeover');
    run.resume();
    await p;
    expect(done).toBe(PAUSE_NOTE);
    // From where the user left the mouse there is no new pause.
    await run.after();
    expect(await run.before()).toBeUndefined();
  });

  it('a tiny jiggle is not a takeover', async () => {
    const { run, cur } = makeRun({ x: 300, y: 300 });
    await run.before();
    await run.after();
    cur.x = 305;
    expect(await run.before()).toBeUndefined();
    expect(run.isPaused).toBe(false);
  });

  it('a screenshot after a pause goes on without the note', async () => {
    const { run } = makeRun();
    await run.before();
    run.pause();
    const p = run.before(undefined, true);
    run.resume();
    expect(await p).toBeUndefined();
  });

  it('"Ver chat" brings the window back and pauses', async () => {
    const { run, log } = makeRun();
    await run.before();
    expect(log).toContain('minimize');
    run.showChat();
    expect(log).toContain('restore');
    expect(run.isPaused).toBe(true);
    const p = run.before();
    run.resume();
    expect(await p).toBe(PAUSE_NOTE);
    // It gets out of the way again for the next action.
    expect(log.filter((x) => x === 'minimize')).toHaveLength(2);
  });

  it('the chat Stop button frees a paused AI', async () => {
    const { run } = makeRun();
    await run.before();
    run.pause();
    const ctrl = new AbortController();
    const p = run.before(ctrl.signal);
    ctrl.abort();
    expect(await p).toBeUndefined();
  });

  it('Detener (or the shortcut) stops the run and lets the shortcut go', async () => {
    const { run, log, stopped, unregistered } = makeRun();
    await run.before();
    run.pause();
    const p = run.before();
    run.stopRun();
    await p;
    expect(stopped()).toBe(1);
    expect(unregistered()).toBe(1);
    expect(log).toContain('bar destroyed');
    expect(log).toContain('restore');
  });

  it('after asking the user, their mouse moves do not count as a takeover', async () => {
    const { run, cur } = makeRun({ x: 10, y: 10 });
    await run.before();
    await run.after();
    run.needUser();
    cur.x = 900;
    expect(await run.before()).toBeUndefined();
  });

  it('the bar says which Zinarix is driving, with the edition name', () => {
    expect(aiName('Zinarix Studio')).toBe('Zinarix Studio AI');
    expect(aiName('Zinarix Studio AI')).toBe('Zinarix Studio AI');
    expect(aiName('Zinarix Studio Pro + AI')).toBe('Zinarix Studio Pro + AI');
    expect(aiName('Zinarix Studio Pro')).toBe('Zinarix Studio Pro AI');
    expect(barLabelsFor('es', 'Zinarix Studio').title).toBe('Zinarix Studio AI navegando…');
    expect(barLabelsFor('es', 'Zinarix Studio AI').pausedTitle).toBe('Zinarix Studio AI en pausa');
    expect(barLabelsFor('en', 'Zinarix Studio').title).toBe('Zinarix Studio AI navigating…');
    expect(barLabelsFor('en', 'Zinarix Studio').pause).toBe('Pause');
  });

  it('the bar speaks English too', () => {
    expect(BAR_LABELS.en.pause).toBe('Pause');
    expect(BAR_LABELS.en.stopHint).toMatch(/Ctrl\+Alt\+Esc/);
  });
});
