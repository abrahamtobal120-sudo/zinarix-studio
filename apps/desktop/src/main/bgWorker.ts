/**
 * Fase 1B: runs a background-removal model (ONNX) with ONNX Runtime Web (WebAssembly, MIT).
 * build.mjs bundles it into dist/bgremove/bgWorker.mjs next to ORT's WebAssembly files; it runs
 * as its own Node process (Electron with ELECTRON_RUN_AS_NODE) so a slow model never freezes the
 * app and can be killed. Reads one JSON request on stdin and writes one JSON answer on stdout.
 * No network: the model file is on disk and the picture arrives already prepared.
 */
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface BgRequest {
  /** Absolute path of the .onnx file. */
  model: string;
  side: number;
  /** base64 of float32 [1, 3, side, side]. */
  input: string;
}

export interface BgResponse {
  /** base64 of float32 [side × side] (the first output). */
  output?: string;
  error?: string;
}

export async function runBgModel(req: BgRequest, wasmDir: string): Promise<BgResponse> {
  const ort = await import('onnxruntime-web');
  ort.env.wasm.numThreads = Math.max(1, Math.min(4, availableParallelism() - 1));
  ort.env.wasm.wasmPaths = pathToFileURL(`${wasmDir}/`).href;
  const buf = Buffer.from(req.input, 'base64');
  const n = 3 * req.side * req.side;
  if (buf.length !== n * 4) return { error: 'Bad input size.' };
  const input = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
  const session = await ort.InferenceSession.create(readFileSync(req.model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  const res = await session.run({
    [session.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, req.side, req.side]),
  });
  const out = res[session.outputNames[0]!]!.data as Float32Array;
  if (out.length < req.side * req.side) return { error: 'The model gave an unexpected output.' };
  const first = out.subarray(0, req.side * req.side);
  return {
    output: Buffer.from(first.buffer, first.byteOffset, first.byteLength).toString('base64'),
  };
}

async function main(): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  let res: BgResponse;
  try {
    const req = JSON.parse(Buffer.concat(chunks).toString('utf8')) as BgRequest;
    res = await runBgModel(req, dirname(fileURLToPath(import.meta.url)));
  } catch (err) {
    res = { error: err instanceof Error ? err.message : String(err) };
  }
  process.stdout.write(JSON.stringify(res), () => process.exit(0));
}

// Only when run as the program (the tests import runBgModel).
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) void main();
