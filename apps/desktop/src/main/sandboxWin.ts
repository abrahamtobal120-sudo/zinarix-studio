/**
 * Fase 5B, Windows: the sandbox of a background task's commands, without native modules.
 *
 * A small C# helper (P/Invoke) that Windows PowerShell 5.1 (always installed) compiles in
 * memory with Add-Type on every command (~0.1 s). Nothing to download or sign, and no DLL
 * on disk: Smart App Control blocks unsigned DLLs by reputation, but not code compiled in
 * memory. The launcher script compiles it and:
 * - labels the worktree and the task's temp folder low integrity (once; later files inherit);
 * - starts the command at low integrity, without admin rights (LUA token, no privileges);
 * - inside a Job Object that kills the whole tree when the launcher ends (cancel, timeout)
 *   and caps its memory.
 * A low-integrity process cannot write anything of medium integrity: the user's files, the
 * app data folder, other worktrees, the registry, other processes. It can still read them
 * and use the network: the caps say so (write ✓, network ✗, secrets ✗) and those commands
 * keep asking for approval. Reference: Codex CLI's Windows sandbox (Apache-2.0); no code
 * of it is copied here.
 *
 * Detection runs a real probe (a write inside must work and one
 * outside must fail). Anything that goes wrong = no sandbox; it is never faked.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  NO_SANDBOX,
  winLauncherArgs,
  type SandboxCaps,
  type WinHelper,
} from '../shared/sandbox.js';

/** Windows PowerShell 5.1 (.NET Framework, always installed): the helper is written for it. */
export function windowsPowerShell(): string {
  return join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
}

/** The helper: labels folders low integrity and runs a command confined. */
export const HELPER_CS = String.raw`using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class ZinarixSandbox {
  [StructLayout(LayoutKind.Sequential)] struct SID_AND_ATTRIBUTES { public IntPtr Sid; public uint Attributes; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string lpReserved; public string lpDesktop; public string lpTitle;
    public uint dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
    public ushort wShowWindow, cbReserved2; public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr hProcess, hThread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMIT { public long PerProcessUserTimeLimit, PerJobUserTimeLimit; public uint LimitFlags; public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass, SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong a, b, c, d, e, f; }
  [StructLayout(LayoutKind.Sequential)] struct EXT_LIMIT { public BASIC_LIMIT Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }

  [DllImport("advapi32.dll", SetLastError = true)] static extern bool OpenProcessToken(IntPtr p, uint access, out IntPtr tok);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool CreateRestrictedToken(IntPtr tok, uint flags, uint nDisable, IntPtr disable, uint nDelete, IntPtr del, uint nRestrict, IntPtr restrict, out IntPtr newTok);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSidToSid(string s, out IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool SetTokenInformation(IntPtr tok, int cls, ref SID_AND_ATTRIBUTES info, uint len);
  [DllImport("advapi32.dll", SetLastError = true)] static extern int GetLengthSid(IntPtr sid);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessAsUser(IntPtr tok, string app, string cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref STARTUPINFO si, out PROCESS_INFORMATION pi);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(string sddl, uint rev, out IntPtr sd, IntPtr size);
  [DllImport("advapi32.dll", SetLastError = true)] static extern bool GetSecurityDescriptorSacl(IntPtr sd, out bool present, out IntPtr sacl, out bool defaulted);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern uint SetNamedSecurityInfo(string name, int type, uint info, IntPtr o, IntPtr g, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern uint GetNamedSecurityInfo(string name, int type, uint info, IntPtr o, IntPtr g, IntPtr dacl, IntPtr sacl, out IntPtr sd);
  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool ConvertSecurityDescriptorToStringSecurityDescriptor(IntPtr sd, uint rev, uint info, out IntPtr sddl, IntPtr len);
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int n);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr h, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int cls, ref EXT_LIMIT info, uint len);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr proc);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h, uint ms);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr h, out uint code);

  static void Check(bool ok, string what) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error(), what); }

  // Marks the folder (and what is below it) as low integrity: the only place a confined command
  // may write. LABEL_SECURITY_INFORMATION propagates to children that inherit.
  public static void AllowWrites(string dir) {
    // Already labeled: files created later inherit the label, so the tree is not walked again.
    IntPtr cur, str;
    if (GetNamedSecurityInfo(dir, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, out cur) == 0 &&
        ConvertSecurityDescriptorToStringSecurityDescriptor(cur, 1, 0x10, out str, IntPtr.Zero)) {
      string have = Marshal.PtrToStringUni(str);
      if (have != null && have.Contains("ML;OICI;NW;;;LW")) return;
    }
    IntPtr sd, sacl; bool present, defaulted;
    // Low mandatory label, inherited by files and folders, no-write-up.
    Check(ConvertStringSecurityDescriptorToSecurityDescriptor("S:(ML;OICI;NW;;;LW)", 1, out sd, IntPtr.Zero), "SDDL");
    Check(GetSecurityDescriptorSacl(sd, out present, out sacl, out defaulted), "GetSacl");
    uint e = SetNamedSecurityInfo(dir, 1, 0x10, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, sacl);
    if (e != 0) throw new Win32Exception((int)e, "SetNamedSecurityInfo");
  }

  // Runs the command at low integrity, without admin privileges, inside a job object that kills
  // the whole tree when this launcher ends (cancel, timeout). Returns its exit code.
  public static int Run(string cmd, ulong memBytes) {
    IntPtr tok, rtok, low;
    // TOKEN_DUPLICATE | TOKEN_ASSIGN_PRIMARY | TOKEN_QUERY | TOKEN_ADJUST_DEFAULT
    Check(OpenProcessToken(GetCurrentProcess(), 0x2 | 0x1 | 0x8 | 0x80, out tok), "OpenProcessToken");
    // DISABLE_MAX_PRIVILEGE | LUA_TOKEN (never elevated, even for an admin account)
    Check(CreateRestrictedToken(tok, 0x1 | 0x4, 0, IntPtr.Zero, 0, IntPtr.Zero, 0, IntPtr.Zero, out rtok), "CreateRestrictedToken");
    Check(ConvertStringSidToSid("S-1-16-4096", out low), "LowSid");
    var label = new SID_AND_ATTRIBUTES { Sid = low, Attributes = 0x20 }; // SE_GROUP_INTEGRITY
    Check(SetTokenInformation(rtok, 25, ref label, (uint)(Marshal.SizeOf(typeof(SID_AND_ATTRIBUTES)) + GetLengthSid(low))), "TokenIntegrityLevel");

    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    Check(job != IntPtr.Zero, "CreateJobObject");
    var lim = new EXT_LIMIT();
    lim.Basic.LimitFlags = 0x2000 | 0x400; // KILL_ON_JOB_CLOSE | DIE_ON_UNHANDLED_EXCEPTION
    if (memBytes > 0) { lim.Basic.LimitFlags |= 0x200; lim.JobMemoryLimit = new UIntPtr(memBytes); }
    Check(SetInformationJobObject(job, 9, ref lim, (uint)Marshal.SizeOf(typeof(EXT_LIMIT))), "SetInformationJobObject");

    var si = new STARTUPINFO();
    si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
    si.dwFlags = 0x100; // STARTF_USESTDHANDLES
    si.hStdInput = GetStdHandle(-10); si.hStdOutput = GetStdHandle(-11); si.hStdError = GetStdHandle(-12);
    foreach (var h in new[] { si.hStdInput, si.hStdOutput, si.hStdError })
      if (h != IntPtr.Zero && h != new IntPtr(-1)) SetHandleInformation(h, 1, 1);
    PROCESS_INFORMATION pi;
    // CREATE_SUSPENDED | CREATE_NO_WINDOW: it joins the job before running any code.
    Check(CreateProcessAsUser(rtok, null, cmd, IntPtr.Zero, IntPtr.Zero, true, 0x4 | 0x08000000, IntPtr.Zero, null, ref si, out pi), "CreateProcessAsUser");
    Check(AssignProcessToJobObject(job, pi.hProcess), "AssignProcessToJobObject");
    ResumeThread(pi.hThread);
    WaitForSingleObject(pi.hProcess, 0xFFFFFFFF);
    uint code; GetExitCodeProcess(pi.hProcess, out code);
    return (int)code;
  }
}
`;

/** Compiles the helper and runs the command confined. Exit 125 = the sandbox could not start
 * (the command did not run; it never falls back to running unconfined). */
export const LAUNCHER_PS1 = String.raw`param([string]$Src, [string]$Root, [string]$Tmp, [string]$Mem, [string]$B64)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -Path $Src
  [ZinarixSandbox]::AllowWrites($Root)
  [ZinarixSandbox]::AllowWrites($Tmp)
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $code = [ZinarixSandbox]::Run(('"' + $ps + '" -NoProfile -NonInteractive -EncodedCommand ' + $B64), [UInt64]$Mem)
} catch {
  [Console]::Error.WriteLine('Sandbox de Windows: ' + $_.Exception.Message)
  exit 125
}
exit $code
`;

const VERSION = createHash('sha256')
  .update(HELPER_CS)
  .update(LAUNCHER_PS1)
  .digest('hex')
  .slice(0, 12);

/** Exit code of a hidden process, or null when it could not start or took too long. */
function run(file: string, args: string[], cwd: string, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(file, args, { cwd, stdio: 'ignore', windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    const t = setTimeout(() => {
      child.kill();
      resolve(null);
    }, timeoutMs);
    child.on('error', () => {
      clearTimeout(t);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve(code);
    });
  });
}

const quote = (p: string): string => `'${p.replace(/'/g, "''")}'`;

/** Writes the helper's source and its launcher into `dir` (named by version). */
export function ensureHelper(dir: string): WinHelper {
  mkdirSync(dir, { recursive: true });
  const source = join(dir, `zinarix-sandbox-${VERSION}.cs`);
  const launcher = join(dir, `zinarix-sandbox-${VERSION}.ps1`);
  if (!existsSync(source)) writeFileSync(source, HELPER_CS, 'utf8');
  if (!existsSync(launcher)) writeFileSync(launcher, LAUNCHER_PS1, 'utf8');
  return { launcher, source };
}

/** Proves that the sandbox confines on this machine: a write inside works, one outside fails. */
export async function detectWindowsSandbox(
  dir = join(tmpdir(), 'zinarix-sandbox'),
): Promise<SandboxCaps> {
  const failed = (why: string): SandboxCaps => ({
    ...NO_SANDBOX,
    reason: `No se pudo preparar el sandbox de Windows (${why}).`,
  });
  let helper: WinHelper;
  try {
    helper = ensureHelper(dir);
  } catch {
    return failed('no se pudo escribir el ayudante');
  }
  const probe = mkdtempSync(join(tmpdir(), 'zinarix-sbx-probe-'));
  try {
    const inside = join(probe, 'inside');
    const outside = join(probe, 'outside');
    mkdirSync(inside);
    mkdirSync(outside);
    const command =
      `Set-Content -LiteralPath 'ok.txt' -Value 1; ` +
      `try { Set-Content -LiteralPath ${quote(join(outside, 'x.txt'))} -Value 1 -ErrorAction Stop; exit 3 } catch { exit 0 }`;
    const code = await run(
      windowsPowerShell(),
      winLauncherArgs(helper, { root: inside, tmp: inside }, command),
      inside,
      30_000,
    );
    if (code !== 0 || !existsSync(join(inside, 'ok.txt')) || existsSync(join(outside, 'x.txt')))
      return failed(
        code === 125
          ? 'Windows PowerShell no pudo iniciar el ayudante'
          : 'la prueba no quedó aislada',
      );
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
  return {
    kind: 'windows',
    write: true,
    network: false,
    secrets: false,
    helper,
    reason:
      'En Windows el sandbox limita la escritura al worktree, pero no restringe la red ni la lectura de otras carpetas.',
  };
}
