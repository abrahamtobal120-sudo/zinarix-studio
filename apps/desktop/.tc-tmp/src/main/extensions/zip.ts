import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  /** Offset of the local file header. */
  offset: number;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/**
 * Reads the central directory of a zip (a .vsix). No zip64, no encryption: VS Code
 * extensions never need them, and anything unexpected is refused.
 */
export function readZip(buf: Buffer, maxEntries = 20_000): ZipEntry[] {
  // End of central directory: last 22 bytes + up to 64 KiB of comment.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--)
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new Error('zip64 is not supported');
  if (count > maxEntries) throw new Error('too many files in the archive');
  if (cdOffset + cdSize > buf.length) throw new Error('corrupt zip (central directory)');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw new Error('corrupt zip entry');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString(flags & 0x800 ? 'utf8' : 'latin1');
    if (flags & 1) throw new Error('encrypted zip entries are not supported');
    out.push({ name, method, compressedSize, size, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** The bytes of one entry (stored or deflated), refusing anything bigger than `maxSize`. */
export function extractEntry(buf: Buffer, e: ZipEntry, maxSize: number): Buffer {
  if (e.size > maxSize) throw new Error(`${e.name}: file too large`);
  const p = e.offset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC_SIG) throw new Error('corrupt zip header');
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (data.length !== e.compressedSize) throw new Error('corrupt zip (truncated)');
  if (e.method === 0) return Buffer.from(data);
  if (e.method === 8) {
    const out = inflateRawSync(data, { maxOutputLength: Math.max(1, maxSize) });
    if (out.length !== e.size) throw new Error(`${e.name}: size mismatch`);
    return out;
  }
  throw new Error(`${e.name}: unsupported compression (${e.method})`);
}

/**
 * Normalizes a path inside the archive; null when it could escape the target folder
 * (absolute, drive letter, "..") — the zip-slip guard.
 */
export function safeEntryPath(name: string): string | null {
  const n = name.replace(/\\/g, '/');
  if (n.startsWith('/') || /^[a-zA-Z]:/.test(n) || n.includes('\0')) return null;
  const parts: string[] = [];
  for (const seg of n.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    parts.push(seg);
  }
  return parts.length ? parts.join('/') : null;
}
