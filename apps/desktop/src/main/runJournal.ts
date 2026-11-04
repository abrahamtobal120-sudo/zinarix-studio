import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { dirname } from 'node:path';
import type { TurnDisplay } from './ai.js';

/** An agent run in progress: its question and everything it did so far. */
export interface JournalEntry {
  conversationId: string;
  prompt: string;
  text: string;
  display: TurnDisplay;
  at: number;
}

/** Text alone is written at most this often (every tool step is written at once). */
const TEXT_EVERY_MS = 3000;

/**
 * Agent runs in progress, written to disk (and synced) at every step: the history only gets a
 * turn when it ends, so a power cut in the middle would lose what the agent had already done.
 * What is left here at the next start is saved into its conversation, and the chat goes on.
 */
export class RunJournal {
  private readonly entries = new Map<string, JournalEntry>();
  private lastWrite = 0;

  constructor(private readonly file: string) {}

  /** Runs the previous session left halfway (a shutdown cut them). The journal starts empty. */
  takeLeftovers(): JournalEntry[] {
    let out: JournalEntry[] = [];
    try {
      if (existsSync(this.file)) {
        const v = JSON.parse(readFileSync(this.file, 'utf8')) as unknown;
        if (Array.isArray(v))
          out = v.filter(
            (e): e is JournalEntry =>
              typeof e === 'object' &&
              e !== null &&
              typeof (e as JournalEntry).conversationId === 'string' &&
              typeof (e as JournalEntry).prompt === 'string' &&
              Array.isArray((e as JournalEntry).display?.parts),
          );
      }
    } catch {
      // cut while writing (the rename did not happen) or damaged: nothing to recover
    }
    this.write();
    return out;
  }

  /** Records the run's progress; `textOnly` (a text delta) is written only now and then. */
  put(requestId: string, entry: JournalEntry, textOnly = false): void {
    this.entries.set(requestId, entry);
    if (textOnly && Date.now() - this.lastWrite < TEXT_EVERY_MS) return;
    this.write();
  }

  /** The run ended (its turn is in the history now). */
  drop(requestId: string): void {
    if (this.entries.delete(requestId)) this.write();
  }

  private write(): void {
    this.lastWrite = Date.now();
    try {
      if (!this.entries.size) {
        rmSync(this.file, { force: true });
        return;
      }
      mkdirSync(dirname(this.file), { recursive: true });
      // Written aside and renamed: a cut in the middle leaves the previous version whole.
      const tmp = `${this.file}.tmp`;
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeSync(fd, JSON.stringify([...this.entries.values()]));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, this.file);
    } catch (e) {
      console.error('could not write the run journal', e instanceof Error ? e.message : e);
    }
  }
}
