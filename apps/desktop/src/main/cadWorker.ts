/**
 * Fase 7: the built-in OpenSCAD (WebAssembly, GPL-2.0-or-later). build.mjs bundles it into
 * dist/openscad/cadWorker.mjs, which ships as a separate program next to the app (like FFmpeg:
 * resources/openscad with its license, notice and source). It runs as its own Node process
 * (Electron with ELECTRON_RUN_AS_NODE), so a long render never freezes the app and can be killed. It reads one
 * JSON request on stdin and writes one JSON answer on stdout. No network, no disk writes:
 * the model's files arrive in the request and live in WebAssembly's memory.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export interface WasmRequest {
  /** Path inside the virtual disk -> base64 bytes (the model and the files it uses). */
  files: Record<string, string>;
  /** The .scad to render (a key of files). */
  main: string;
  /** -D overrides and other flags. */
  args: string[];
  /** Output file name with extension (.stl, .off, .amf, .3mf, .obj). */
  out: string;
  /** Font files (absolute paths on this PC) for text(). */
  fonts: string[];
}

export interface WasmResponse {
  rc: number;
  log: string;
  /** base64 of the output file. */
  output?: string;
}

export async function runScadWasm(req: WasmRequest): Promise<WasmResponse> {
  const { createOpenSCAD } = await import('openscad-wasm-prebuilt');
  const log: string[] = [];
  const o = await createOpenSCAD({
    noInitialRun: true,
    print: (s) => log.push(s),
    printErr: (s) => log.push(s),
  });
  const m = o.getInstance();
  const mkdirs = (p: string) => {
    const parts = p.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts.slice(0, -1)) {
      cur += `/${part}`;
      try {
        m.FS.mkdir(cur);
      } catch {
        // exists
      }
    }
  };
  if (req.fonts.length) {
    m.FS.mkdir('/fonts');
    req.fonts.forEach((f, i) => {
      try {
        m.FS.writeFile(`/fonts/f${i}${f.slice(f.lastIndexOf('.'))}`, readFileSync(f));
      } catch {
        // a font that cannot be read is skipped
      }
    });
    m.FS.writeFile(
      '/fonts/fonts.conf',
      '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>/fonts</dir><cachedir>/tmp/fc</cachedir></fontconfig>',
    );
    (m as unknown as { ENV: Record<string, string> }).ENV.FONTCONFIG_FILE = '/fonts/fonts.conf';
  }
  for (const [p, b64] of Object.entries(req.files)) {
    const path = `/work/${p}`;
    mkdirs(path);
    m.FS.writeFile(path, Buffer.from(b64, 'base64'));
  }
  mkdirs(`/work/${req.main}`);
  const out = `/out/${req.out}`;
  mkdirs(out);
  let rc: number;
  try {
    rc = m.callMain([`/work/${req.main}`, '-o', out, ...req.args]);
  } catch (e) {
    // Emscripten throws an ExitStatus (or an abort) instead of returning.
    const st = (e as { status?: number })?.status;
    rc = typeof st === 'number' ? st : 1;
    if (typeof st !== 'number') log.push(`ERROR: ${String((e as Error)?.message ?? e)}`);
  }
  let output: string | undefined;
  try {
    output = Buffer.from(m.FS.readFile(out) as Uint8Array).toString('base64');
  } catch {
    // no output (an error)
  }
  // Paths in messages refer to the virtual disk; the caller maps them back.
  return { rc, log: log.join('\n'), ...(output !== undefined && rc === 0 ? { output } : {}) };
}

// Run as a process: one request on stdin, one answer on stdout.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const chunks: Buffer[] = [];
  process.stdin.on('data', (d: Buffer) => chunks.push(d));
  process.stdin.on('end', () => {
    void (async () => {
      let res: WasmResponse;
      try {
        res = await runScadWasm(JSON.parse(Buffer.concat(chunks).toString('utf8')) as WasmRequest);
      } catch (e) {
        res = { rc: 1, log: `ERROR: ${(e as Error).message}` };
      }
      process.stdout.write(JSON.stringify(res), () => process.exit(0));
    })();
  });
}
