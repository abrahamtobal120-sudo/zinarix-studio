import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NotebookKernels } from '../src/main/jupyter.js';
import {
  applyIopub,
  emptyNotebook,
  serializeNotebook,
  type NotebookEvent,
  type OutputState,
} from '../src/shared/notebook.js';

// Real kernel run: needs Python with jupyter_server + ipykernel (ZINARIX_PYTHON or on PATH).
// Skipped (not faked) when there is none.
const root = mkdtempSync(join(tmpdir(), 'zs-nb-'));
writeFileSync(join(root, 'a.ipynb'), serializeNotebook(emptyNotebook()));
const events: NotebookEvent[] = [];
const kernels = new NotebookKernels((e) => events.push(e));
const status = await kernels.status(root);

afterAll(async () => {
  await kernels.dispose();
  rmSync(root, { recursive: true, force: true });
});

function runCell(cellId: string, code: string) {
  return new Promise<{ st: OutputState; done: Extract<NotebookEvent, { kind: 'done' }> }>(
    (resolve) => {
      let st: OutputState = { outputs: [], clearPending: false };
      const start = events.length;
      const tick = setInterval(() => {
        for (const e of events.splice(start)) {
          if (e.kind === 'output' && e.cellId === cellId) st = applyIopub(st, e.msgType, e.content);
          if (e.kind === 'done' && e.cellId === cellId) {
            clearInterval(tick);
            resolve({ st, done: e });
          }
        }
      }, 50);
      void kernels.execute('a.ipynb', cellId, code);
    },
  );
}

describe.skipIf(!status.ok)('Jupyter kernel (live)', () => {
  it('runs cells: stdout, results, state between cells, errors', { timeout: 120_000 }, async () => {
    const info = await kernels.start(root, 'a.ipynb', 'python3');
    expect(info.language).toBe('python');
    const a = await runCell('c1', 'x = 21\nprint("hola")\nx * 2');
    expect(a.done.status).toBe('ok');
    expect(a.done.executionCount).toBe(1);
    expect(a.st.outputs[0]).toMatchObject({ output_type: 'stream', text: 'hola\n' });
    expect(a.st.outputs[1]).toMatchObject({
      output_type: 'execute_result',
      data: { 'text/plain': '42' },
    });
    const b = await runCell('c2', '1/0');
    expect(b.done.status).toBe('error');
    expect(b.st.outputs[0]).toMatchObject({ output_type: 'error', ename: 'ZeroDivisionError' });
    // The kernel runs in the notebook's folder.
    const c = await runCell('c3', 'import os; print(os.path.basename(os.getcwd()))');
    expect(c.st.outputs[0]).toMatchObject({ text: `${root.split(/[\\/]/).pop()}\n` });
    await kernels.restart('a.ipynb');
    const d = await runCell('c4', "print('x' in dir())");
    expect(d.st.outputs[0]).toMatchObject({ text: 'False\n' });
  });
});

describe.skipIf(status.ok)('Jupyter missing', () => {
  it('reports why instead of pretending', () => {
    expect(status.ok).toBe(false);
  });
});
