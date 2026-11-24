/** Types shared by the debugger and the extensions (main ↔ renderer). */

export type DebugKind = 'node' | 'python' | 'go' | 'lldb' | 'godot';

/** A launch configuration (a subset of VS Code's launch.json). */
export interface DebugConfig {
  name: string;
  /** VS Code types are accepted: node, pwa-node, python, debugpy, go, lldb, codelldb, cppdbg… */
  type: string;
  request: 'launch' | 'attach';
  program?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** attach: port of a debug server (debugpy --listen, node --inspect, dlv). */
  port?: number;
  host?: string;
  stopOnEntry?: boolean;
  /** Godot: scene to run ("main", "current", res://… or a .tscn path). */
  scene?: string;
}

export interface Breakpoint {
  /** 1-based line. */
  line: number;
  condition?: string;
  /** Logpoint: prints this message ({expr} parts are evaluated) instead of stopping. */
  logMessage?: string;
}

/**
 * A logpoint for debuggers without them (Chrome DevTools Protocol): a breakpoint condition that
 * prints and never stops. "x = {x}, total {a + b}" → console.log(`x = ${x}, total ${a + b}`).
 */
export function logpointCondition(message: string, condition?: string): string {
  let tpl = '';
  let i = 0;
  while (i < message.length) {
    const open = message.indexOf('{', i);
    const close = open < 0 ? -1 : message.indexOf('}', open + 1);
    if (open < 0 || close < 0) {
      tpl += literal(message.slice(i));
      break;
    }
    tpl += literal(message.slice(i, open));
    const expr = message.slice(open + 1, close).trim();
    tpl += expr
      ? `\${(() => { try { return (${expr}); } catch (e) { return '<' + e + '>'; } })()}`
      : '{}';
    i = close + 1;
  }
  const log = `(console.log(\`${tpl}\`), false)`;
  return condition?.trim() ? `(${condition.trim()}) && ${log}` : log;
}

const literal = (s: string) =>
  s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');

export interface DebugFrame {
  id: number;
  name: string;
  /** Workspace-relative path when inside the project, else absolute; undefined = no source. */
  path?: string;
  /** Absolute path of the source (to open files outside the project). */
  absPath?: string;
  line: number;
  column: number;
}

export interface DebugVariable {
  name: string;
  value: string;
  type?: string;
  /** > 0: has children (load them with debug:variables). */
  ref: number;
}

export type DebugState = 'idle' | 'starting' | 'running' | 'stopped';

export type DebugEvent =
  | { kind: 'state'; state: DebugState; name?: string }
  | {
      kind: 'stopped';
      reason: string;
      threadId: number;
      frames: DebugFrame[];
      description?: string;
    }
  | { kind: 'output'; category: 'stdout' | 'stderr' | 'console' | 'info'; text: string }
  /** The adapter verified (or moved) breakpoints of a file. */
  | { kind: 'breakpoints'; path: string; lines: number[] };

export interface DebugConfigList {
  /** Configurations read from .zinarix/launch.json or .vscode/launch.json. */
  configs: DebugConfig[];
  file?: string;
}

// ---------------- extensions ----------------

export interface ExtensionSearchItem {
  id: string; // namespace.name
  namespace: string;
  name: string;
  displayName: string;
  version: string;
  description: string;
  publisher: string;
  downloads: number;
  /** Icon URL on open-vsx.org (the renderer asks main for it as a data URL). */
  iconUrl?: string;
}

export interface ExtThemeData {
  label: string;
  /** vs | vs-dark | hc-black | hc-light (from uiTheme). */
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  /** VS Code color theme JSON with includes resolved. */
  theme: { colors?: Record<string, string>; tokenColors?: unknown[] };
}

export interface ExtLanguageData {
  id: string;
  extensions?: string[];
  filenames?: string[];
  aliases?: string[];
  /** Parsed language-configuration.json. */
  configuration?: Record<string, unknown>;
}

export interface ExtSnippetData {
  language: string;
  snippets: Record<string, unknown>;
}

export interface InstalledExtension {
  id: string;
  displayName: string;
  publisher: string;
  version: string;
  description: string;
  enabled: boolean;
  icon?: string; // data URL
  themes: ExtThemeData[];
  languages: ExtLanguageData[];
  snippets: ExtSnippetData[];
  /** Contributions Zinarix cannot use (code, grammars, debuggers…). */
  unsupported: string[];
}
