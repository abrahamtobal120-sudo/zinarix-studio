import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { NotebookKernels } from '../src/main/jupyter.js';
import {
  applyEdits,
  notebookPreview,
  notebookText,
  outputsText,
  runNotebookTool,
} from '../src/main/notebookTools.js';
import { emptyNotebook, newCell, parseNotebook, serializeNotebook } from '../src/shared/notebook.js';

const root = mkdtempSync(join(tmpdir(), 'zs-nbt-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function nbWith(...sources: string[]) {
  const nb = emptyNotebook();
  nb.cells = sources.map((s) => newCell(s.startsWith('#') ? 'markdown' : 'code', s));
  return nb;
}

describe('notebook edits', () => {
  it('replaces, inserts, moves and deletes cells in order', () => {
    const nb = nbWith('a = 1', 'b = 2', '# Title');
    nb.cells[0]!.outputs = [{ output_type: 'stream', name: 'stdout', text: 'x', extra: {} }];
    nb.cells[0]!.execution_count = 3;
    const out = applyEdits(nb, [
      { op: 'replace', cell: 1, source: 'a = 10' },
      { op: 'insert', cell: 4, type: 'code', source: 'print(a)' },
      { op: 'move', cell: 3, to: 1 },
      { op: 'delete', cell: 3 },
    ]);
    expect(out.cells.map((c) => c.source)).toEqual(['# Title', 'a = 10', 'print(a)']);
    // A changed cell loses its old outputs.
    expect(out.cells[1]!.outputs).toEqual([]);
    expect(out.cells[1]!.execution_count).toBeNull();
    // The original is untouched.
    expect(nb.cells.length).toBe(3);
  });

  it('refuses cells that do not exist', () => {
    const nb = nbWith('a');
    expect(() => applyEdits(nb, [{ op: 'delete', cell: 2 }])).toThrow(/1 cells/);
    expect(() => applyEdits(nb, [{ op: 'insert', cell: 3 }])).toThrow(/append/);
    expect(applyEdits(nb, [{ op: 'insert', cell: 2, source: 'b' }]).cells).toHaveLength(2);
  });

  it('changes the type of a cell', () => {
    const out = applyEdits(nbWith('x'), [{ op: 'replace', cell: 1, type: 'markdown' }]);
    expect(out.cells[0]!.cell_type).toBe('markdown');
    expect(serializeNotebook(out)).not.toContain('"outputs"');
  });
});

describe('text for the model', () => {
  it('summarises outputs: text, errors without colours, pictures as markers', () => {
    const t = outputsText([
      { output_type: 'stream', name: 'stdout', text: 'hola\n', extra: {} },
      {
        output_type: 'execute_result',
        data: { 'text/plain': '42', 'text/html': '<b>42</b>' },
        metadata: {},
        execution_count: 1,
        extra: {},
      },
      { output_type: 'display_data', data: { 'image/png': 'AAAA', 'text/plain': '<Figure>' }, metadata: {}, extra: {} },
      { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['\u001b[31mTraceback\u001b[0m', 'line 1'], extra: {} },
    ]);
    expect(t).toContain('hola');
    expect(t).toContain('42');
    expect(t).toContain('[image image/png]');
    expect(t).toContain('ValueError: bad');
    expect(t).not.toContain('\u001b');
  });

  it('numbers the cells', () => {
    const s = notebookText(nbWith('a = 1', '# Hi'));
    expect(s).toContain('--- cell 1 · code ---');
    expect(s).toContain('--- cell 2 · markdown ---');
  });
});

describe('approval cards and paths', () => {
  it('reading needs no approval; editing and running do', () => {
    expect(notebookPreview('notebook_read', { path: 'a.ipynb' }, root)).toBeNull();
    const e = notebookPreview('notebook_edit', { path: 'a.ipynb', edits: [{ op: 'delete', cell: 1 }] }, root);
    expect(e && 'risk' in e && e.risk).toBe('medium');
    const r = notebookPreview('notebook_run', { path: 'a.ipynb' }, root);
    expect(r && 'risk' in r && r.risk).toBe('high');
  });

  it('refuses paths outside the project and files that are not notebooks', () => {
    const out = notebookPreview('notebook_run', { path: '../x.ipynb' }, root);
    expect(out && 'error' in out && out.error).toMatch(/inside/);
    const txt = notebookPreview('notebook_edit', { path: 'a.py', edits: [{ op: 'delete', cell: 1 }] }, root);
    expect(txt && 'error' in txt && txt.error).toMatch(/ipynb/);
  });

  it('notebook_edit creates a new notebook and notebook_read reads it back', async () => {
    const host = () => new NotebookKernels(() => undefined);
    const w = await runNotebookTool(host, 'notebook_edit', {
      path: 'new.ipynb',
      edits: [
        { op: 'replace', cell: 1, source: 'x = 2' },
        { op: 'insert', cell: 2, type: 'markdown', source: '# Notes' },
      ],
    }, root);
    expect(w.ok).toBe(true);
    expect(w.changed).toBe(join(root, 'new.ipynb'));
    const nb = parseNotebook(readFileSync(join(root, 'new.ipynb'), 'utf8'));
    expect(nb.cells.map((c) => c.source)).toEqual(['x = 2', '# Notes']);
    const r = await runNotebookTool(host, 'notebook_read', { path: 'new.ipynb' }, root);
    expect(r.content).toContain('# Notes');
  });
});

// Real kernel: needs Python with jupyter_server + ipykernel (ZINARIX_PYTHON or on PATH).
const kernels = new NotebookKernels(() => undefined);
const status = await kernels.status(root);
afterAll(() => kernels.dispose());

describe.skipIf(!status.ok)('notebook_run on a real kernel', () => {
  it('runs every code cell, saves the outputs and stops at the first error', async () => {
    const nb = nbWith('a = 20', '# text', 'print(a + 1)\na * 2', '1/0', 'print("never")');
    writeFileSync(join(root, 'run.ipynb'), serializeNotebook(nb));
    const r = await runNotebookTool(() => kernels, 'notebook_run', { path: 'run.ipynb' }, root);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('21');
    expect(r.content).toContain('40');
    expect(r.content).toContain('ZeroDivisionError');
    expect(r.content).toContain('not run');
    const saved = parseNotebook(readFileSync(join(root, 'run.ipynb'), 'utf8'));
    expect(saved.cells[2]!.execution_count).toBeGreaterThan(0);
    expect(saved.cells[2]!.outputs.length).toBe(2);
    expect(saved.cells[4]!.outputs).toEqual([]);
  }, 120_000);

  it('keeps variables between calls and returns the last plot to the model', async () => {
    const nb = nbWith(
      'b = a + 1',
      [
        'import base64, IPython.display as d',
        // A 1×1 PNG, shown like matplotlib does.
        'png = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")',
        'd.display(d.Image(png))',
        'b',
      ].join('\n'),
    );
    writeFileSync(join(root, 'run.ipynb'), serializeNotebook(nb));
    const r = await runNotebookTool(() => kernels, 'notebook_run', { path: 'run.ipynb' }, root);
    expect(r.ok).toBe(true);
    expect(r.content).toContain('21');
    expect(r.image?.mediaType).toBe('image/png');
    expect(r.image?.width).toBe(1);
    // restart=true clears the variables.
    writeFileSync(join(root, 'run.ipynb'), serializeNotebook(nbWith('b')));
    const fresh = await runNotebookTool(() => kernels, 'notebook_run', { path: 'run.ipynb', restart: true }, root);
    expect(fresh.ok).toBe(false);
    expect(fresh.content).toContain('NameError');
  }, 120_000);
});
