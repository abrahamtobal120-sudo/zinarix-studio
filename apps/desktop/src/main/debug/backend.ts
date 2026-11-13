import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { Breakpoint, DebugVariable } from '../../shared/devtools.js';

/** A frame as the backend sees it (absolute source path). */
export interface RawFrame {
  id: number;
  name: string;
  absPath?: string;
  line: number;
  column: number;
}

export interface BackendEvents {
  stopped(reason: string, threadId: number, description?: string): void;
  continued(): void;
  output(category: 'stdout' | 'stderr' | 'console' | 'info', text: string): void;
  exited(code?: number): void;
}

/** One debug session, whatever the protocol behind it (DAP or Chrome DevTools). */
export interface DebugBackend {
  /** Starts the debuggee; resolves once it runs (breakpoints already set). */
  start(breakpoints: Map<string, Breakpoint[]>): Promise<void>;
  /** Replaces the breakpoints of one file; returns the lines actually bound. */
  setBreakpoints(absPath: string, bps: Breakpoint[]): Promise<number[]>;
  resume(threadId: number): Promise<void>;
  pause(threadId: number): Promise<void>;
  step(kind: 'over' | 'into' | 'out', threadId: number): Promise<void>;
  frames(threadId: number): Promise<RawFrame[]>;
  /** Scopes of a frame, as expandable variables. */
  scopes(frameId: number): Promise<DebugVariable[]>;
  variables(ref: number): Promise<DebugVariable[]>;
  evaluate(expression: string, frameId?: number): Promise<DebugVariable>;
  stop(): Promise<void>;
}

/** Finds a program on PATH (with PATHEXT on Windows). */
export function which(name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const dirs = (env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean);
  const exts =
    process.platform === 'win32'
      ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase())]
      : [''];
  for (const d of dirs)
    for (const e of exts) {
      const p = join(d, name + e);
      try {
        if (existsSync(p) && statSync(p).isFile()) return p;
      } catch {
        // unreadable entry
      }
    }
  return null;
}

/** Splits a child's output into lines handed to `emit` (keeps the trailing partial line). */
export function lineSplitter(emit: (line: string) => void): {
  push(s: string): void;
  flush(): void;
} {
  let rest = '';
  return {
    push(s) {
      rest += s;
      const parts = rest.split(/\r?\n/);
      rest = parts.pop() ?? '';
      for (const p of parts) emit(p);
    },
    flush() {
      if (rest) emit(rest);
      rest = '';
    },
  };
}
