import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

/**
 * Fase 2 — byte-exact checkpoints. A checkpoint keeps the file as text (`before`), which is
 * what the diff review and the model work with. A file that is not valid UTF-8 (Latin-1,
 * binary) would come back changed from that text, so its exact bytes also travel as base64
 * (`beforeBytes`) and a restore writes those. Older checkpoints without it restore the text.
 */

export interface BeforeBytes {
  before: string | null;
  /** The exact bytes (base64) when `before` cannot give them back. */
  beforeBytes?: string;
}

/** `{ beforeBytes }` when decoding the bytes as UTF-8 and encoding them again loses something. */
export function bytesOf(raw: Buffer): { beforeBytes?: string } {
  return Buffer.from(raw.toString('utf8'), 'utf8').equals(raw)
    ? {}
    : { beforeBytes: raw.toString('base64') };
}

/** The file as it is now, as text plus its exact bytes when needed (null = missing). */
export async function snapshot(abs: string): Promise<BeforeBytes> {
  if (!existsSync(abs)) return { before: null };
  const raw = await readFile(abs);
  return { before: raw.toString('utf8'), ...bytesOf(raw) };
}

/** What to write to put the file back (exact bytes when they were kept). */
export function beforeData(cp: BeforeBytes): string | Buffer {
  if (cp.beforeBytes !== undefined) return Buffer.from(cp.beforeBytes, 'base64');
  return cp.before ?? '';
}

/** Whether the file on disk is already as it was (byte for byte when the bytes were kept). */
export async function isAsBefore(abs: string, cp: BeforeBytes): Promise<boolean | undefined> {
  if (!existsSync(abs)) return cp.before === null;
  if (cp.before === null) return false;
  try {
    const raw = await readFile(abs);
    return cp.beforeBytes !== undefined
      ? raw.equals(Buffer.from(cp.beforeBytes, 'base64'))
      : raw.toString('utf8') === cp.before;
  } catch {
    return undefined;
  }
}
