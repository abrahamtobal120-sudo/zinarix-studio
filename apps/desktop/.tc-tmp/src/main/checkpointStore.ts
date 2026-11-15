import { createHash } from 'node:crypto';
import {
  appendFileSync,
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
import { join } from 'node:path';
import type { CheckpointLike } from '../shared/checkpoints.js';

/**
 * Fase 2 — the agent's checkpoints on disk, one file per conversation (its helpers included),
 * so "Volver aquí", "Revisar cambios" and "Revertir" keep working after the app is closed.
 * Each change is one JSON line appended as it happens; a rewind or a revert rewrites the
 * file (aside and renamed, so a cut in the middle leaves the previous version whole). A last
 * line cut by a power failure is ignored when reading.
 */
export class CheckpointStore {
  constructor(private readonly dir: string) {}

  private file(conversationId: string): string {
    const h = createHash('sha256').update(conversationId).digest('hex').slice(0, 32);
    return join(this.dir, `${h}.jsonl`);
  }

  load<C extends CheckpointLike>(conversationId: string): C[] {
    const f = this.file(conversationId);
    if (!existsSync(f)) return [];
    const out: C[] = [];
    let text: string;
    try {
      text = readFileSync(f, 'utf8');
    } catch {
      return [];
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const v = JSON.parse(line) as C;
        if (typeof v?.path === 'string' && (v.before === null || typeof v.before === 'string'))
          out.push(v);
      } catch {
        // a line cut while being written: what came before it is whole
      }
    }
    return out;
  }

  append(conversationId: string, cp: CheckpointLike): void {
    try {
      mkdirSync(this.dir, { recursive: true });
      appendFileSync(this.file(conversationId), JSON.stringify(cp) + '\n', { mode: 0o600 });
    } catch (e) {
      console.error('could not save a checkpoint', e instanceof Error ? e.message : e);
    }
  }

  /** Replaces what is saved (after a rewind, a revert or a review); empty removes the file. */
  replace(conversationId: string, cps: readonly CheckpointLike[]): void {
    const f = this.file(conversationId);
    try {
      if (!cps.length) {
        rmSync(f, { force: true });
        return;
      }
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${f}.tmp`;
      const fd = openSync(tmp, 'w', 0o600);
      try {
        writeSync(fd, cps.map((c) => JSON.stringify(c) + '\n').join(''));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      renameSync(tmp, f);
    } catch (e) {
      console.error('could not save the checkpoints', e instanceof Error ? e.message : e);
    }
  }

  remove(conversationId: string): void {
    rmSync(this.file(conversationId), { force: true });
  }
}
