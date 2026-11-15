import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Source maps (v3), only what the debugger needs: original line ↔ generated line/column, so a
 * breakpoint in a .ts file lands where the transformed code (Vitest, tsx, bundles) really runs.
 */

/** One mapping segment, all 0-based. */
interface Segment {
  genLine: number;
  genCol: number;
  source: number;
  line: number;
  col: number;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_INDEX = new Int8Array(128).fill(-1);
for (let i = 0; i < B64.length; i++) B64_INDEX[B64.charCodeAt(i)] = i;

/** Decodes the "mappings" string into segments that point at a source. */
export function decodeMappings(mappings: string): Segment[] {
  const out: Segment[] = [];
  let genLine = 0;
  let genCol = 0;
  let source = 0;
  let line = 0;
  let col = 0;
  let i = 0;
  const fields: number[] = [];
  while (i <= mappings.length) {
    const c = mappings[i];
    if (c === ';' || c === ',' || c === undefined) {
      if (fields.length) {
        genCol += fields[0]!;
        if (fields.length >= 4) {
          source += fields[1]!;
          line += fields[2]!;
          col += fields[3]!;
          out.push({ genLine, genCol, source, line, col });
        }
        fields.length = 0;
      }
      if (c === ';') {
        genLine++;
        genCol = 0;
      }
      i++;
      continue;
    }
    // One base64 VLQ value.
    let value = 0;
    let shift = 0;
    let cont = true;
    while (cont && i < mappings.length) {
      const digit = B64_INDEX[mappings.charCodeAt(i++)] ?? -1;
      if (digit < 0) return out; // malformed: keep what was read
      cont = (digit & 32) !== 0;
      value += (digit & 31) << shift;
      shift += 5;
    }
    fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
  }
  return out;
}

export interface RawSourceMap {
  version?: number;
  sources?: (string | null)[];
  sourceRoot?: string;
  mappings?: string;
}

/** A parsed map of one generated script. */
export class SourceMap {
  /** Absolute file paths of the sources (normalised, see `pathKey`). */
  readonly sources: string[];
  private readonly segments: Segment[];
  /** Segments sorted by generated position (for generated → original). */
  private readonly byGen: Segment[];

  constructor(raw: RawSourceMap, scriptUrl: string) {
    const base = raw.sourceRoot
      ? new URL(raw.sourceRoot.replace(/\/?$/, '/'), scriptUrl).href
      : scriptUrl;
    this.sources = (raw.sources ?? []).map((s) => {
      if (!s) return '';
      try {
        // Windows absolute paths and plain absolute paths are not URLs.
        if (/^[A-Za-z]:[\\/]/.test(s) || s.startsWith('/')) return pathKey(s);
        const url = new URL(s, base);
        return url.protocol === 'file:' ? pathKey(fileURLToPath(url)) : '';
      } catch {
        return '';
      }
    });
    this.segments = decodeMappings(raw.mappings ?? '');
    this.byGen = [...this.segments].sort((a, b) => a.genLine - b.genLine || a.genCol - b.genCol);
  }

  hasSource(absPath: string): boolean {
    return this.sources.includes(pathKey(absPath));
  }

  /**
   * Where a breakpoint on a 1-based original line runs: the first generated position mapped to
   * that line (or the next lines with code, up to 4 below, like VS Code). 0-based result.
   */
  generatedFor(absPath: string, line: number): { line: number; column: number } | null {
    const src = this.sources.indexOf(pathKey(absPath));
    if (src < 0) return null;
    for (let l = line - 1; l < line + 4; l++) {
      let best: Segment | undefined;
      for (const s of this.segments)
        if (s.source === src && s.line === l)
          if (
            !best ||
            s.genLine < best.genLine ||
            (s.genLine === best.genLine && s.genCol < best.genCol)
          )
            best = s;
      if (best) return { line: best.genLine, column: best.genCol };
    }
    return null;
  }

  /** Original position (1-based line and column) of a 0-based generated position. */
  originalFor(
    genLine: number,
    genCol: number,
  ): { path: string; line: number; column: number } | null {
    let lo = 0;
    let hi = this.byGen.length - 1;
    let found = -1;
    // Last segment at or before (genLine, genCol).
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = this.byGen[mid]!;
      if (s.genLine < genLine || (s.genLine === genLine && s.genCol <= genCol)) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    let s = found >= 0 ? this.byGen[found] : undefined;
    // Before the first segment of the line: take the first one on that line.
    if (!s || s.genLine !== genLine) s = this.byGen.find((x) => x.genLine === genLine);
    if (!s) return null;
    const path = this.sources[s.source];
    return path ? { path, line: s.line + 1, column: s.col + 1 } : null;
  }
}

/** Comparable form of a path: forward slashes, lower-case drive letter on Windows. */
export function pathKey(p: string): string {
  const fwd = p.replace(/\\/g, '/');
  return /^[A-Za-z]:\//.test(fwd) ? fwd[0]!.toLowerCase() + fwd.slice(1) : fwd;
}

/** The map of a script from its sourceMappingURL (inline data: URL or a file next to it). */
export async function loadSourceMap(
  sourceMapUrl: string,
  scriptUrl: string,
  readFileText: (path: string) => Promise<string>,
): Promise<SourceMap | null> {
  try {
    let text: string;
    if (sourceMapUrl.startsWith('data:')) {
      const comma = sourceMapUrl.indexOf(',');
      const meta = sourceMapUrl.slice(5, comma);
      const data = sourceMapUrl.slice(comma + 1);
      text = meta.includes(';base64')
        ? Buffer.from(data, 'base64').toString('utf8')
        : decodeURIComponent(data);
    } else {
      const base =
        /^[A-Za-z]:[\\/]/.test(scriptUrl) || scriptUrl.startsWith('/')
          ? pathToFileURL(scriptUrl).href
          : scriptUrl;
      const url = new URL(sourceMapUrl, base);
      if (url.protocol !== 'file:') return null;
      text = await readFileText(fileURLToPath(url));
    }
    const base =
      /^[A-Za-z]:[\\/]/.test(scriptUrl) || scriptUrl.startsWith('/')
        ? pathToFileURL(scriptUrl).href
        : scriptUrl;
    return new SourceMap(JSON.parse(text) as RawSourceMap, base);
  } catch {
    return null;
  }
}
