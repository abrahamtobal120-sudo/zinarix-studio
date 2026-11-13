/** Types shared by the debugger and the extensions (main ↔ renderer). */

export type DebugKind = 'node' | 'python' | 'go' | 'lldb';

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
}

export interface Breakpoint {
  /** 1-based line. */
  line: number;
  condition?: string;
}

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
