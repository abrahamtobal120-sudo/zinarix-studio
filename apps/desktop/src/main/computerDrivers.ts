import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
import type { KeyCombo, MouseButton, WindowInfo } from './computerTools.js';

/**
 * Real mouse and keyboard per platform (no Electron, so it is tested on its own).
 * Windows: one PowerShell process kept alive with a small user32 helper (SendInput), so
 * actions take milliseconds. macOS: JXA (CoreGraphics + System Events; needs the
 * Accessibility permission). Linux (X11): xdotool. Coordinates are screen pixels
 * (macOS: points).
 */

export interface Driver {
  unavailable(): Promise<string | null>;
  pos(): Promise<{ x: number; y: number }>;
  move(x: number, y: number): Promise<void>;
  click(x: number, y: number, b: MouseButton, n: number): Promise<void>;
  drag(x1: number, y1: number, x2: number, y2: number): Promise<void>;
  scroll(x: number, y: number, dx: number, dy: number): Promise<void>;
  type(text: string): Promise<void>;
  keys(c: KeyCombo): Promise<void>;
  /** Starts an installed program by name (no shell). */
  openApp(name: string): Promise<void>;
  /** Visible top-level windows, top-most first, with the process id that owns each. */
  windows(): Promise<(WindowInfo & { pid: number })[]>;
  focus(id: string): Promise<boolean>;
}

// ---------- Windows ----------

const WIN_HELPER = String.raw`
using System; using System.Runtime.InteropServices; using System.Threading;
public static class ZxIn {
  [StructLayout(LayoutKind.Sequential)] public struct MI { public int dx; public int dy; public uint data; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct KI { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] public struct U { [FieldOffset(0)] public MI mi; [FieldOffset(0)] public KI ki; }
  [StructLayout(LayoutKind.Sequential)] public struct IN { public uint type; public U u; }
  [StructLayout(LayoutKind.Sequential)] public struct PT { public int x; public int y; }
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint n, IN[] i, int size);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out PT p);
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern short VkKeyScanW(char c);
  public delegate bool EW(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EW f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int a, out int v, int s);
  public static void Init() { SetProcessDPIAware(); }
  /** Visible, uncloaked, unowned windows with a title: "hwnd\tpid\tprocess\ttitle" lines. */
  public static string Windows() {
    var sb = new System.Text.StringBuilder();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h) || GetWindow(h, 4) != IntPtr.Zero) return true;
      if ((GetWindowLong(h, -20) & 0x80) != 0) return true;
      int cloaked = 0; DwmGetWindowAttribute(h, 14, out cloaked, 4);
      if (cloaked != 0) return true;
      var t = new System.Text.StringBuilder(512); GetWindowTextW(h, t, 512);
      if (t.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      string name = "";
      try { name = System.Diagnostics.Process.GetProcessById((int)pid).ProcessName; } catch {}
      sb.Append(h.ToInt64()).Append('\t').Append(pid).Append('\t').Append(name).Append('\t')
        .Append(t.ToString().Replace('\t', ' ').Replace('\n', ' ').Replace('\r', ' ')).Append('\n');
      return true;
    }, IntPtr.Zero);
    return Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(sb.ToString()));
  }
  public static string Focus(long id) {
    var h = new IntPtr(id);
    if (!IsWindow(h)) return "0";
    if (IsIconic(h)) ShowWindow(h, 9);
    // Windows lets a process take the foreground right after a key press of its own.
    Send(new[] { Vk(0x12, false), Vk(0x12, true) });
    SetForegroundWindow(h); BringWindowToTop(h);
    Thread.Sleep(80);
    return GetForegroundWindow() == h ? "1" : "0";
  }
  public static string Pos() { PT p; GetCursorPos(out p); return p.x + " " + p.y; }
  static void Send(IN[] a) {
    if (SendInput((uint)a.Length, a, Marshal.SizeOf(typeof(IN))) != a.Length)
      throw new Exception("Windows blocked the input (a program running as administrator may have the focus).");
  }
  static IN M(uint f, int data) { var i = new IN(); i.type = 0; i.u.mi.flags = f; i.u.mi.data = unchecked((uint)data); return i; }
  static IN K(ushort vk, ushort scan, uint f) { var i = new IN(); i.type = 1; i.u.ki.vk = vk; i.u.ki.scan = scan; i.u.ki.flags = f; return i; }
  static bool Ext(int vk) { return (vk >= 0x21 && vk <= 0x28) || vk == 0x2D || vk == 0x2E || vk == 0x5B || vk == 0x5D || vk == 0x2C; }
  static IN Vk(int vk, bool up) { return K((ushort)vk, 0, (Ext(vk) ? 1u : 0u) | (up ? 2u : 0u)); }
  public static void Move(int x, int y) { SetCursorPos(x, y); }
  public static void Click(int x, int y, string b, int n) {
    SetCursorPos(x, y); Thread.Sleep(40);
    uint d = b == "right" ? 0x08u : b == "middle" ? 0x20u : 0x02u;
    for (int k = 0; k < n; k++) { Send(new[] { M(d, 0), M(d * 2, 0) }); Thread.Sleep(60); }
  }
  public static void Drag(int x1, int y1, int x2, int y2) {
    SetCursorPos(x1, y1); Thread.Sleep(60); Send(new[] { M(0x02, 0) }); Thread.Sleep(60);
    for (int s = 1; s <= 20; s++) { SetCursorPos(x1 + (x2 - x1) * s / 20, y1 + (y2 - y1) * s / 20); Thread.Sleep(15); }
    Thread.Sleep(60); Send(new[] { M(0x04, 0) });
  }
  public static void Scroll(int x, int y, int dx, int dy) {
    SetCursorPos(x, y); Thread.Sleep(40);
    if (dy != 0) Send(new[] { M(0x0800, -dy * 120) });
    if (dx != 0) Send(new[] { M(0x01000, dx * 120) });
  }
  public static void Text(string t) {
    foreach (char c in t) {
      if (c == '\r') continue;
      if (c == '\n') Send(new[] { Vk(0x0D, false), Vk(0x0D, true) });
      else if (c == '\t') Send(new[] { Vk(0x09, false), Vk(0x09, true) });
      else Send(new[] { K(0, c, 4), K(0, c, 6) });
      Thread.Sleep(4);
    }
  }
  public static void Keys(string mods, int vk, string ch) {
    var m = new System.Collections.Generic.List<int>();
    if (mods != "-") foreach (var s in mods.Split(',')) m.Add(int.Parse(s));
    bool uni = false; char uc = '\0';
    if (vk == 0 && ch.Length > 0) {
      short r = VkKeyScanW(ch[0]);
      if (r == -1) { uni = true; uc = ch[0]; }
      else {
        vk = r & 0xff; int st = (r >> 8) & 0xff;
        if ((st & 1) != 0 && !m.Contains(0x10)) m.Add(0x10);
        if ((st & 2) != 0 && !m.Contains(0x11)) m.Add(0x11);
        if ((st & 4) != 0 && !m.Contains(0x12)) m.Add(0x12);
      }
    }
    var l = new System.Collections.Generic.List<IN>();
    foreach (var v in m) l.Add(Vk(v, false));
    if (uni) { l.Add(K(0, uc, 4)); l.Add(K(0, uc, 6)); }
    else if (vk != 0) { l.Add(Vk(vk, false)); l.Add(Vk(vk, true)); }
    for (int i = m.Count - 1; i >= 0; i--) l.Add(Vk(m[i], true));
    Send(l.ToArray());
  }
}`;

export const WIN_LOOP = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
${WIN_HELPER}
'@
[ZxIn]::Init()
[Console]::Out.WriteLine('READY'); [Console]::Out.Flush()
$utf8 = [Text.Encoding]::UTF8
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    $r = ''
    switch ($p[0]) {
      'pos' { $r = [ZxIn]::Pos() }
      'move' { [ZxIn]::Move([int]$p[1], [int]$p[2]) }
      'click' { [ZxIn]::Click([int]$p[1], [int]$p[2], $p[3], [int]$p[4]) }
      'drag' { [ZxIn]::Drag([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4]) }
      'scroll' { [ZxIn]::Scroll([int]$p[1], [int]$p[2], [int]$p[3], [int]$p[4]) }
      'text' { [ZxIn]::Text($utf8.GetString([Convert]::FromBase64String($p[1]))) }
      'keys' { $ch = ''; if ($p[3] -ne '-') { $ch = $utf8.GetString([Convert]::FromBase64String($p[3])) }; [ZxIn]::Keys($p[1], [int]$p[2], $ch) }
      'wins' { $r = [ZxIn]::Windows() }
      'focus' { $r = [ZxIn]::Focus([long]$p[1]) }
      'open' { Start-Process -FilePath ($utf8.GetString([Convert]::FromBase64String($p[1]))) }
      default { throw "unknown command $($p[0])" }
    }
    [Console]::Out.WriteLine("OK $r")
  } catch {
    [Console]::Out.WriteLine('ERR ' + ($_.Exception.Message -replace '\\s+', ' '))
  }
  [Console]::Out.Flush()
}`;

/** Windows virtual-key codes of the named keys and modifiers. */
export const WIN_VK: Record<string, number> = {
  ctrl: 0x11,
  alt: 0x12,
  shift: 0x10,
  meta: 0x5b,
  enter: 0x0d,
  esc: 0x1b,
  tab: 0x09,
  space: 0x20,
  backspace: 0x08,
  delete: 0x2e,
  insert: 0x2d,
  home: 0x24,
  end: 0x23,
  pageup: 0x21,
  pagedown: 0x22,
  up: 0x26,
  down: 0x28,
  left: 0x25,
  right: 0x27,
  capslock: 0x14,
  printscreen: 0x2c,
  menu: 0x5d,
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, 0x70 + i])),
};

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');

/** "id\tpid\tprocess\ttitle" lines (the helpers' window list). */
export function parseWinList(text: string): (WindowInfo & { pid: number })[] {
  const out: (WindowInfo & { pid: number })[] = [];
  for (const line of text.split('\n')) {
    const [id, pid, app, ...rest] = line.replace(/\r$/, '').split('\t');
    if (!id || !pid) continue;
    out.push({ id, pid: Number(pid) || 0, app: app ?? '', title: rest.join(' ').trim() });
  }
  return out;
}

export class WinDriver implements Driver {
  private proc?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private waiting: ((line: string) => void)[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  async unavailable() {
    return null;
  }

  private start(): Promise<void> {
    if (this.ready && this.proc && this.proc.exitCode === null) return this.ready;
    const encoded = Buffer.from(WIN_LOOP, 'utf16le').toString('base64');
    const proc = spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { windowsHide: true },
    );
    this.proc = proc;
    let stderr = '';
    proc.stderr.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-2000)));
    const rl = createInterface({ input: proc.stdout });
    this.ready = new Promise<void>((resolve, reject) => {
      const onLine = (line: string) => {
        if (line.trim() === 'READY') {
          resolve();
          return;
        }
        this.waiting.shift()?.(line);
      };
      rl.on('line', onLine);
      proc.on('exit', () => {
        reject(new Error(`The input helper stopped. ${stderr.trim().slice(0, 400)}`));
        for (const w of this.waiting.splice(0)) w('ERR the input helper stopped');
        this.proc = undefined;
        this.ready = undefined;
      });
      proc.on('error', (e) => reject(e));
    });
    return this.ready;
  }

  /** One command at a time; resolves with what follows "OK". */
  private cmd(line: string): Promise<string> {
    const run = async () => {
      await this.start();
      const reply = await new Promise<string>((resolve) => {
        this.waiting.push(resolve);
        this.proc!.stdin.write(`${line}\n`);
      });
      if (!reply.startsWith('OK')) throw new Error(reply.replace(/^ERR\s*/, '') || 'input failed');
      return reply.slice(2).trim();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async pos() {
    const [x, y] = (await this.cmd('pos')).split(' ').map(Number);
    return { x: x ?? 0, y: y ?? 0 };
  }
  async move(x: number, y: number) {
    await this.cmd(`move ${x} ${y}`);
  }
  async click(x: number, y: number, b: MouseButton, n: number) {
    await this.cmd(`click ${x} ${y} ${b} ${n}`);
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    await this.cmd(`drag ${x1} ${y1} ${x2} ${y2}`);
  }
  async scroll(x: number, y: number, dx: number, dy: number) {
    await this.cmd(`scroll ${x} ${y} ${dx} ${dy}`);
  }
  async type(text: string) {
    // Long texts in pieces so one line never gets huge.
    for (let i = 0; i < text.length; i += 400) await this.cmd(`text ${b64(text.slice(i, i + 400))}`);
  }
  async keys(c: KeyCombo) {
    const mods = c.mods.length ? c.mods.map((m) => WIN_VK[m]).join(',') : '-';
    const named = c.key !== null && c.key.length > 1 ? WIN_VK[c.key] : undefined;
    const ch = c.key !== null && named === undefined ? c.key : '';
    await this.cmd(`keys ${mods} ${named ?? 0} ${ch ? b64(ch) : '-'}`);
  }
  async openApp(name: string) {
    await this.cmd(`open ${b64(name)}`);
  }
  async windows() {
    return parseWinList(Buffer.from(await this.cmd('wins'), 'base64').toString('utf8'));
  }
  async focus(id: string) {
    if (!/^-?\d+$/.test(id)) return false;
    return (await this.cmd(`focus ${id}`)) === '1';
  }

  dispose() {
    this.proc?.kill();
  }
}

// ---------- macOS ----------

const MAC_KEYCODE: Record<string, number> = {
  enter: 36,
  esc: 53,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 117,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  up: 126,
  down: 125,
  left: 123,
  right: 124,
  capslock: 57,
  f1: 122,
  f2: 120,
  f3: 99,
  f4: 118,
  f5: 96,
  f6: 97,
  f7: 98,
  f8: 100,
  f9: 101,
  f10: 109,
  f11: 103,
  f12: 111,
};
const MAC_MOD: Record<string, string> = {
  ctrl: 'control down',
  alt: 'option down',
  shift: 'shift down',
  meta: 'command down',
};

function runJxa(script: string): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('osascript', ['-l', 'JavaScript', '-e', script], { timeout: 30_000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim().slice(0, 400))) : resolve(String(out).trim()),
    ),
  );
}

const JXA_MOUSE = `ObjC.import('CoreGraphics');
function ev(t, x, y, b, clicks) { var e = $.CGEventCreateMouseEvent($(), t, $.CGPointMake(x, y), b); if (clicks) $.CGEventSetIntegerValueField(e, 1, clicks); $.CGEventPost($.kCGHIDEventTap, e); }
function sleep(s) { delay(s); }
`;

export class MacDriver implements Driver {
  async unavailable() {
    return null;
  }
  async pos() {
    const out = await runJxa(
      `ObjC.import('CoreGraphics'); var p = $.CGEventGetLocation($.CGEventCreate($())); Math.round(p.x) + ' ' + Math.round(p.y)`,
    );
    const [x, y] = out.split(' ').map(Number);
    return { x: x ?? 0, y: y ?? 0 };
  }
  async move(x: number, y: number) {
    await runJxa(`${JXA_MOUSE} ev(5, ${x}, ${y}, 0);`);
  }
  async click(x: number, y: number, b: MouseButton, n: number) {
    const [down, up, btn] = b === 'right' ? [3, 4, 1] : b === 'middle' ? [25, 26, 2] : [1, 2, 0];
    let s = `${JXA_MOUSE} ev(5, ${x}, ${y}, 0); sleep(0.04);`;
    for (let k = 1; k <= n; k++) s += ` ev(${down}, ${x}, ${y}, ${btn}, ${k}); ev(${up}, ${x}, ${y}, ${btn}, ${k}); sleep(0.06);`;
    await runJxa(s);
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    let s = `${JXA_MOUSE} ev(5, ${x1}, ${y1}, 0); sleep(0.06); ev(1, ${x1}, ${y1}, 0);`;
    for (let k = 1; k <= 20; k++)
      s += ` ev(6, ${Math.round(x1 + ((x2 - x1) * k) / 20)}, ${Math.round(y1 + ((y2 - y1) * k) / 20)}, 0); sleep(0.015);`;
    s += ` ev(2, ${x2}, ${y2}, 0);`;
    await runJxa(s);
  }
  async scroll(x: number, y: number, dx: number, dy: number) {
    await this.move(x, y);
    // Wheel events are variadic in CoreGraphics (out of reach of JXA): use the arrow keys
    // of System Events as a fallback, which scroll the focused view in most apps.
    const code = dy < 0 ? 126 : dy > 0 ? 125 : dx < 0 ? 123 : 124;
    const n = Math.max(Math.abs(dx), Math.abs(dy)) * 3;
    await runJxa(
      `var se = Application('System Events'); for (var i = 0; i < ${n}; i++) { se.keyCode(${code}); delay(0.01); }`,
    );
  }
  async type(text: string) {
    const lines = text.replace(/\r/g, '').split('\n');
    const parts = lines
      .map((l, i) => `${l ? `se.keystroke(${JSON.stringify(l)});` : ''}${i < lines.length - 1 ? ' se.keyCode(36);' : ''}`)
      .join(' ');
    await runJxa(`var se = Application('System Events'); ${parts}`);
  }
  async keys(c: KeyCombo) {
    const using = JSON.stringify(c.mods.map((m) => MAC_MOD[m]));
    if (c.key === null) {
      // Modifiers alone (e.g. "cmd"): nothing to press on macOS.
      return;
    }
    const code = c.key.length > 1 ? MAC_KEYCODE[c.key] : undefined;
    if (c.key.length > 1 && code === undefined) throw new Error(`The key "${c.key}" does not exist on macOS.`);
    await runJxa(
      `var se = Application('System Events'); ${
        code !== undefined
          ? `se.keyCode(${code}, { using: ${using} });`
          : `se.keystroke(${JSON.stringify(c.key)}, { using: ${using} });`
      }`,
    );
  }
  async openApp(name: string) {
    await new Promise<void>((resolve, reject) =>
      execFile('open', ['-a', name], { timeout: 30_000 }, (err, _o, errOut) =>
        err ? reject(new Error(String(errOut || err.message).trim().slice(0, 300))) : resolve(),
      ),
    );
  }
  async windows() {
    // id = "process name\u0001window index" (System Events has no stable window ids).
    const out = await runJxa(`var se = Application('System Events'); var r = [];
var ps = se.processes.whose({ visible: true })();
for (var i = 0; i < ps.length; i++) { var p = ps[i]; var n = p.name(); var pid = p.unixId();
  var ws = []; try { ws = p.windows(); } catch (e) {}
  for (var k = 0; k < ws.length; k++) { var t = ''; try { t = ws[k].name() || ''; } catch (e) {}
    r.push([n + '\\u0001' + (k + 1), pid, n, String(t).replace(/[\\t\\n\\r]/g, ' ')].join('\\t')); } }
r.join('\\n')`);
    return parseWinList(out);
  }
  async focus(id: string) {
    const [proc, idx] = id.split('\u0001');
    if (!proc) return false;
    await runJxa(`var se = Application('System Events'); var p = se.processes.byName(${JSON.stringify(proc)});
p.frontmost = true; try { p.windows[${Math.max(0, Number(idx ?? 1) - 1)}].actions['AXRaise'].perform(); } catch (e) {}`);
    return true;
  }
}

// ---------- Linux (X11) ----------

const X_KEYS: Record<string, string> = {
  ctrl: 'ctrl',
  alt: 'alt',
  shift: 'shift',
  meta: 'super',
  enter: 'Return',
  esc: 'Escape',
  tab: 'Tab',
  space: 'space',
  backspace: 'BackSpace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'Prior',
  pagedown: 'Next',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  capslock: 'Caps_Lock',
  printscreen: 'Print',
  menu: 'Menu',
  ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`f${i + 1}`, `F${i + 1}`])),
};

function xdo(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('xdotool', args, { timeout: 30_000 }, (err, out, errOut) =>
      err ? reject(new Error(String(errOut || err.message).trim().slice(0, 400))) : resolve(String(out)),
    ),
  );
}

export class LinuxDriver implements Driver {
  async unavailable() {
    if (process.env.WAYLAND_DISPLAY && !process.env.DISPLAY)
      return 'Controlling the computer needs an X11 session (Wayland does not allow it). Ask the user to log in with "Xorg".';
    try {
      await xdo(['version']);
      return null;
    } catch {
      return 'Controlling the computer on Linux needs xdotool. Ask the user to install it (e.g. "sudo apt install xdotool").';
    }
  }
  async pos() {
    const out = await xdo(['getmouselocation', '--shell']);
    const x = Number(/X=(\d+)/.exec(out)?.[1] ?? 0);
    const y = Number(/Y=(\d+)/.exec(out)?.[1] ?? 0);
    return { x, y };
  }
  async move(x: number, y: number) {
    await xdo(['mousemove', String(x), String(y)]);
  }
  async click(x: number, y: number, b: MouseButton, n: number) {
    const btn = b === 'right' ? '3' : b === 'middle' ? '2' : '1';
    await xdo(['mousemove', String(x), String(y), 'click', '--repeat', String(n), btn]);
  }
  async drag(x1: number, y1: number, x2: number, y2: number) {
    await xdo(['mousemove', String(x1), String(y1), 'mousedown', '1']);
    await xdo(['mousemove', '--sync', String(x2), String(y2), 'mouseup', '1']);
  }
  async scroll(x: number, y: number, dx: number, dy: number) {
    const btn = dy < 0 ? '4' : dy > 0 ? '5' : dx < 0 ? '6' : '7';
    const n = Math.max(Math.abs(dx), Math.abs(dy));
    await xdo(['mousemove', String(x), String(y), 'click', '--repeat', String(n), btn]);
  }
  async type(text: string) {
    await xdo(['type', '--delay', '8', '--', text]);
  }
  async keys(c: KeyCombo) {
    const key = c.key === null ? null : (X_KEYS[c.key] ?? c.key);
    const names = [...c.mods.map((m) => X_KEYS[m]!), ...(key === null ? [] : [key])];
    await xdo(['key', '--clearmodifiers', names.join('+')]);
  }
  async openApp(name: string) {
    if (/\s/.test(name)) throw new Error('On Linux give the command name of the program (no spaces).');
    await new Promise<void>((resolve, reject) => {
      const p = spawn(name, [], { detached: true, stdio: 'ignore' });
      p.once('error', (e) => reject(new Error(`"${name}" was not found (${e.message}).`)));
      p.once('spawn', () => (p.unref(), resolve()));
    });
  }
  async windows() {
    const ids = (await xdo(['search', '--onlyvisible', '--name', '.']).catch(() => ''))
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .reverse()
      .slice(0, 80);
    const out: (WindowInfo & { pid: number })[] = [];
    for (const id of ids) {
      const title = (await xdo(['getwindowname', id]).catch(() => '')).trim();
      if (!title) continue;
      const pid = Number((await xdo(['getwindowpid', id]).catch(() => '0')).trim()) || 0;
      let app = '';
      if (pid) app = await readFile(`/proc/${pid}/comm`, 'utf8').then((s) => s.trim(), () => '');
      out.push({ id, pid, app, title });
    }
    return out;
  }
  async focus(id: string) {
    if (!/^\d+$/.test(id)) return false;
    await xdo(['windowactivate', '--sync', id]);
    return true;
  }
}

export function platformDriver(): Driver & { dispose?: () => void } {
  return process.platform === 'win32'
    ? new WinDriver()
    : process.platform === 'darwin'
      ? new MacDriver()
      : new LinuxDriver();
}
