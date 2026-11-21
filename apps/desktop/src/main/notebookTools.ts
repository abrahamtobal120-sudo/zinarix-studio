import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { ToolDefinition } from '@omni/shared';
import type { NotebookKernels } from './jupyter.js';
import type { SystemPreview } from './system.js';
import type { ComputerShot } from './computerTools.js';
import {
  applyIopub,
  kernelName,
  mimeText,
  newCell,
  parseNotebook,
  serializeNotebook,
  stripAnsi,
  JUPYTER_INSTALL,
  type CellType,
  type NbCell,
  type NbOutput,
  type Notebook,
  type NotebookEvent,
  type OutputState,
} from '../shared/notebook.js';

/**
 * Fase 2A (plan de funciones): the agent reads, edits and runs the cells of a Jupyter
 * notebook of the project. Runs go to the same kernel as the notebook open in the window
 * (one session per notebook), so variables are shared with what the user runs. Outputs are
 * written into the file like Jupyter does; the open notebook reloads it.
 */

/** Where the agent gets the kernels of a folder (the window's, when one has it open). */
export type NotebookHost = (root: string) => NotebookKernels;

const MAX_TEXT = 6000;
const MAX_CELLS_RUN = 200;

export const NOTEBOOK_TOOLS: ToolDefinition[] = [
  {
    name: 'notebook_read',
    description:
      'Read a Jupyter notebook (.ipynb) of the project: every cell numbered from 1 with its type (code / markdown / raw), source and, for code cells, a text summary of its outputs (text, tables as text, errors, "[image]" for plots). Use it before notebook_edit / notebook_run.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the .ipynb file in the project' },
        outputs: { type: 'boolean', description: 'Include the outputs (default true)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'notebook_edit',
    description:
      'Change the cells of a Jupyter notebook of the project (the file is created when it does not exist). Edits apply in order; numbers are 1-based and refer to the notebook as it is after the previous edits. op: "replace" (new source and/or type of cell N, its outputs are cleared), "insert" (new cell placed at position N; N = count+1 appends), "delete" (cell N), "move" (cell N to position "to"). The user approves each call.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the .ipynb file in the project' },
        edits: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              op: { type: 'string', enum: ['replace', 'insert', 'delete', 'move'] },
              cell: { type: 'integer', minimum: 1, description: 'Cell number (1-based)' },
              to: { type: 'integer', minimum: 1, description: 'Target position for "move"' },
              type: { type: 'string', enum: ['code', 'markdown', 'raw'] },
              source: { type: 'string', description: 'Full text of the cell' },
            },
            required: ['op', 'cell'],
          },
        },
      },
      required: ['path', 'edits'],
    },
  },
  {
    name: 'notebook_run',
    description:
      'Run code cells of a Jupyter notebook of the project on its kernel (the same one the user sees in the window, so variables are shared) and save the outputs in the file. Without "cells" runs every code cell from the top. Stops at the first error. Returns the outputs as text and shows you the last plot. The user approves each call: it runs code on the computer.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the .ipynb file in the project' },
        cells: {
          type: 'array',
          items: { type: 'integer', minimum: 1 },
          description: 'Cell numbers to run, in this order (default: every code cell)',
        },
        restart: { type: 'boolean', description: 'Restart the kernel first (fresh variables)' },
        timeout: { type: 'integer', minimum: 5, maximum: 3600, description: 'Seconds per cell (default 300)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'notebook_variables',
    description:
      'List the variables that live in the running kernel of a notebook (name, type, shape of arrays / data frames, length and a short value), like a variable explorer. Only for Python kernels that are already running (the user ran a cell, or notebook_run did). Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path of the .ipynb file in the project' },
      },
      required: ['path'],
    },
  },
];

export const NOTEBOOK_TOOL_NAMES = new Set(NOTEBOOK_TOOLS.map((t) => t.name));

export const NOTEBOOK_PROMPT_PART =
  '- notebook_read, notebook_edit, notebook_run and notebook_variables: Jupyter notebooks (.ipynb). Do not edit .ipynb files with edit_file / write_file (it is JSON): read them with notebook_read, change cells with notebook_edit and run them with notebook_run, which shows you text outputs and the last plot.';

// ------------------------------------------------------------------ paths and files

function notebookPath(root: string, p: unknown): { abs: string; rel: string } {
  if (typeof p !== 'string' || !p.trim()) throw new Error('"path" is required.');
  const abs = isAbsolute(p) ? resolve(p) : resolve(root, p);
  const rel = relative(root, abs);
  if (!rel || rel.startsWith('..') || isAbsolute(rel))
    throw new Error('The notebook must be inside the open project.');
  if (!/\.ipynb$/i.test(abs)) throw new Error('Only .ipynb notebooks.');
  return { abs, rel: rel.replace(/\\/g, '/') };
}

async function load(abs: string, create = false): Promise<Notebook> {
  let text: string;
  try {
    text = await readFile(abs, 'utf8');
  } catch (e) {
    if (create && (e as NodeJS.ErrnoException).code === 'ENOENT') return parseNotebook('');
    throw new Error('The notebook does not exist.');
  }
  return parseNotebook(text);
}

// ------------------------------------------------------------------ text views

/** Outputs as text for the model (images and HTML as short markers). */
export function outputsText(outputs: NbOutput[], max = MAX_TEXT): string {
  const parts: string[] = [];
  for (const o of outputs) {
    if (o.output_type === 'stream') parts.push(stripAnsi(o.text));
    else if (o.output_type === 'error')
      parts.push(
        stripAnsi([`${o.ename}: ${o.evalue}`, ...o.traceback.slice(-6)].join('\n')).trim(),
      );
    else {
      const d = o.data;
      const img = ['image/png', 'image/jpeg', 'image/svg+xml'].find((m) => m in d);
      if ('text/plain' in d) parts.push(mimeText(d['text/plain']));
      else if ('text/markdown' in d) parts.push(mimeText(d['text/markdown']));
      else if ('text/html' in d) parts.push('[HTML output]');
      if (img) parts.push(`[image ${img}]`);
    }
  }
  const s = parts.join('\n').trim();
  return s.length > max ? `${s.slice(0, max)}\n… (${s.length - max} more characters)` : s;
}

export function notebookText(nb: Notebook, withOutputs = true): string {
  if (!nb.cells.length) return '(empty notebook)';
  const lines: string[] = [`kernel: ${kernelName(nb) ?? 'python3'} · ${nb.cells.length} cells`];
  nb.cells.forEach((c, i) => {
    const run = c.cell_type === 'code' && c.execution_count != null ? ` [${c.execution_count}]` : '';
    lines.push(`--- cell ${i + 1} · ${c.cell_type}${run} ---`, c.source || '(empty)');
    if (withOutputs && c.cell_type === 'code' && c.outputs.length) {
      const t = outputsText(c.outputs, 2000);
      if (t) lines.push('>>> output:', t);
    }
  });
  return lines.join('\n');
}

// ------------------------------------------------------------------ edits

interface Edit {
  op: 'replace' | 'insert' | 'delete' | 'move';
  cell: number;
  to?: number;
  type?: CellType;
  source?: string;
}

function parseEdits(v: unknown): Edit[] {
  if (!Array.isArray(v) || !v.length) throw new Error('"edits" needs at least one edit.');
  if (v.length > 200) throw new Error('At most 200 edits per call.');
  return v.map((e, i) => {
    const o = (e ?? {}) as Record<string, unknown>;
    const op = o.op;
    if (op !== 'replace' && op !== 'insert' && op !== 'delete' && op !== 'move')
      throw new Error(`Edit ${i + 1}: unknown op.`);
    const cell = Number(o.cell);
    if (!Number.isInteger(cell) || cell < 1) throw new Error(`Edit ${i + 1}: "cell" must be ≥ 1.`);
    const type = o.type === 'code' || o.type === 'markdown' || o.type === 'raw' ? o.type : undefined;
    if (o.source !== undefined && typeof o.source !== 'string')
      throw new Error(`Edit ${i + 1}: "source" must be text.`);
    return {
      op,
      cell,
      ...(o.to !== undefined ? { to: Number(o.to) } : {}),
      ...(type ? { type } : {}),
      ...(typeof o.source === 'string' ? { source: o.source } : {}),
    };
  });
}

/** Applies the edits to a copy of the notebook. Throws with the edit that does not fit. */
export function applyEdits(nb: Notebook, edits: Edit[]): Notebook {
  const cells = [...nb.cells];
  edits.forEach((e, i) => {
    const n = cells.length;
    const at = e.cell - 1;
    const where = `Edit ${i + 1} (${e.op} ${e.cell})`;
    if (e.op === 'insert') {
      if (at > n) throw new Error(`${where}: the notebook has ${n} cells (use ${n + 1} to append).`);
      cells.splice(at, 0, newCell(e.type ?? 'code', e.source ?? '', nb.nbformat_minor));
      return;
    }
    if (at >= n) throw new Error(`${where}: the notebook has ${n} cells.`);
    if (e.op === 'delete') cells.splice(at, 1);
    else if (e.op === 'move') {
      const to = (e.to ?? 0) - 1;
      if (!Number.isInteger(to) || to < 0 || to >= n) throw new Error(`${where}: "to" must be 1…${n}.`);
      const [c] = cells.splice(at, 1);
      cells.splice(to, 0, c!);
    } else {
      if (e.source === undefined && !e.type) throw new Error(`${where}: give "source" and/or "type".`);
      const old = cells[at]!;
      const type = e.type ?? old.cell_type;
      const next: NbCell = {
        ...old,
        cell_type: type,
        source: e.source ?? old.source,
        outputs: [],
        execution_count: null,
      };
      if (type !== old.cell_type) delete next.extra.cell_type;
      cells[at] = next;
    }
  });
  return { ...nb, cells };
}

function editSummary(edits: Edit[]): string {
  const names = { replace: 'cambiar', insert: 'insertar', delete: 'borrar', move: 'mover' } as const;
  return edits
    .map((e) => `${names[e.op]} ${e.cell}${e.op === 'move' ? `→${e.to}` : ''}${e.type ? ` (${e.type})` : ''}`)
    .join(', ');
}

// ------------------------------------------------------------------ approval

export function notebookPreview(
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
): SystemPreview | { error: string } | null {
  if (name === 'notebook_read' || name === 'notebook_variables') return null;
  if (!root) return { error: 'No folder is open in the editor.' };
  try {
    const { rel } = notebookPath(root, a.path);
    if (name === 'notebook_edit') {
      const edits = parseEdits(a.edits);
      const code = edits.filter((e) => e.source !== undefined).map((e) => `# celda ${e.cell}\n${e.source}`);
      return {
        risk: 'medium',
        action: `editar las celdas de ${rel}: ${editSummary(edits)}`,
        warning: 'Cambia el notebook (las celdas que se cambian pierden sus resultados).',
        path: rel,
        ...(code.length ? { after: code.join('\n\n').slice(0, 8000) } : {}),
        allowKey: `notebook_edit:${rel}`,
      };
    }
    const cells = Array.isArray(a.cells) ? a.cells.map(Number) : null;
    return {
      risk: 'high',
      action: `ejecutar ${cells ? `las celdas ${cells.join(', ')}` : 'todas las celdas'} de ${rel}${a.restart === true ? ' (reiniciando el kernel)' : ''}`,
      warning: 'Ejecuta el código del notebook en tu computadora con su kernel de Python.',
      path: rel,
      allowKey: `notebook_run:${rel}`,
    };
  } catch (err) {
    return { error: (err as Error).message };
  }
}

// ------------------------------------------------------------------ running

/** Size of a PNG from its IHDR chunk. */
function pngSize(b: Buffer): { width: number; height: number } | null {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

function lastImage(outputs: NbOutput[]): ComputerShot | null {
  for (let i = outputs.length - 1; i >= 0; i--) {
    const o = outputs[i]!;
    if (o.output_type !== 'display_data' && o.output_type !== 'execute_result') continue;
    for (const m of ['image/png', 'image/jpeg'] as const) {
      const v = o.data[m];
      if (v === undefined) continue;
      const data = mimeText(v).replace(/\s+/g, '');
      const buf = Buffer.from(data, 'base64');
      const size = m === 'image/png' ? pngSize(buf) : null;
      return { mediaType: m, data, width: size?.width ?? 0, height: size?.height ?? 0 };
    }
  }
  return null;
}

/** Runs one cell on the kernel and collects its outputs (from the kernel's events). */
function runCell(
  kernels: NotebookKernels,
  rel: string,
  cellId: string,
  code: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ outputs: NbOutput[]; status: 'ok' | 'error' | 'aborted' | 'timeout'; count: number | null }> {
  return new Promise((done, fail) => {
    let st: OutputState = { outputs: [], clearPending: false };
    let finished = false;
    const end = (status: 'ok' | 'error' | 'aborted' | 'timeout', count: number | null) => {
      if (finished) return;
      finished = true;
      off();
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      done({ outputs: st.outputs, status, count });
    };
    const off = kernels.on((e: NotebookEvent) => {
      if (e.path !== rel) return;
      if (e.kind === 'kernel' && e.state === 'dead') end('aborted', null);
      if (!('cellId' in e) || e.cellId !== cellId) return;
      if (e.kind === 'output') st = applyIopub(st, e.msgType, e.content);
      else if (e.kind === 'done') end(e.status, e.executionCount);
    });
    const abort = () => {
      void kernels.interrupt(rel).catch(() => undefined);
      end('aborted', null);
    };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      void kernels.interrupt(rel).catch(() => undefined);
      end('timeout', null);
    }, timeoutMs);
    kernels.execute(rel, cellId, code).catch((e: Error) => {
      if (finished) return;
      finished = true;
      off();
      clearTimeout(timer);
      fail(e);
    });
  });
}

export interface NotebookToolResult {
  ok: boolean;
  content: string;
  summary: string;
  image?: ComputerShot;
  /** Absolute path of a notebook the tool wrote (the window reloads it). */
  changed?: string;
}

export async function runNotebookTool(
  host: NotebookHost | undefined,
  name: string,
  a: Record<string, unknown>,
  root: string | undefined,
  signal?: AbortSignal,
): Promise<NotebookToolResult> {
  if (!root) return { ok: false, content: 'No folder is open in the editor.', summary: 'sin carpeta' };
  try {
    const { abs, rel } = notebookPath(root, a.path);
    if (name === 'notebook_read') {
      const nb = await load(abs);
      return { ok: true, content: notebookText(nb, a.outputs !== false), summary: `${nb.cells.length} celdas` };
    }
    if (name === 'notebook_variables') {
      const kernels = host?.(root);
      if (!kernels?.has(rel))
        return {
          ok: false,
          content: 'This notebook has no running kernel: run a cell first (notebook_run), then ask again.',
          summary: 'sin kernel',
        };
      const vars = await kernels.variables(rel, 20_000);
      if (!vars)
        return {
          ok: false,
          content: 'The kernel did not answer (busy with a long cell, or it is not a Python kernel).',
          summary: 'sin respuesta',
        };
      const lines = vars.map(
        (v) =>
          `${v.name}: ${v.type}${v.shape ? ` shape=${v.shape}` : v.size >= 0 ? ` len=${v.size}` : ''} = ${v.value}`,
      );
      return {
        ok: true,
        content: lines.join('\n') || 'No variables yet.',
        summary: `${vars.length} variables`,
      };
    }
    if (name === 'notebook_edit') {
      const nb = await load(abs, true);
      const next = applyEdits(nb, parseEdits(a.edits));
      await writeFile(abs, serializeNotebook(next), 'utf8');
      return {
        ok: true,
        content: `Saved ${rel} (${next.cells.length} cells).\n${notebookText(next, false).slice(0, 3000)}`,
        summary: `${next.cells.length} celdas`,
        changed: abs,
      };
    }
    if (name === 'notebook_run') {
      if (!host) return { ok: false, content: 'Notebooks cannot run here.', summary: 'no disponible' };
      const kernels = host(root);
      const status = await kernels.status(root);
      if (!status.ok)
        return {
          ok: false,
          content: `Jupyter is not installed for Python here (tried: ${status.tried.join(', ') || 'none'}). Ask the user to install it with: ${JUPYTER_INSTALL}`,
          summary: 'falta Jupyter',
        };
      const nb = await load(abs);
      const order = Array.isArray(a.cells)
        ? a.cells.map((n) => Number(n) - 1)
        : nb.cells.flatMap((c, i) => (c.cell_type === 'code' ? [i] : []));
      if (!order.length) return { ok: false, content: 'The notebook has no code cells.', summary: 'sin código' };
      if (order.length > MAX_CELLS_RUN) throw new Error(`At most ${MAX_CELLS_RUN} cells per call.`);
      for (const i of order) {
        const c = nb.cells[i];
        if (!c) throw new Error(`The notebook has ${nb.cells.length} cells (asked for ${i + 1}).`);
        if (c.cell_type !== 'code') throw new Error(`Cell ${i + 1} is ${c.cell_type}, not code.`);
      }
      await kernels.start(root, rel, kernelName(nb));
      if (a.restart === true) await kernels.restart(rel);
      const timeoutMs = (typeof a.timeout === 'number' ? a.timeout : 300) * 1000;
      const report: string[] = [];
      let image: ComputerShot | null = null;
      let failed = false;
      let ran = 0;
      const results: { i: number; cell: NbCell; outputs: NbOutput[]; count: number | null }[] = [];
      for (const i of order) {
        if (signal?.aborted) break;
        const cell = nb.cells[i]!;
        const cellId = cell.id ?? `agent-${i}-${Date.now().toString(36)}`;
        const r = await runCell(kernels, rel, cellId, cell.source, timeoutMs, signal);
        ran++;
        results.push({ i, cell, outputs: r.outputs, count: r.count });
        image = lastImage(r.outputs) ?? image;
        const text = outputsText(r.outputs, 3000);
        const tag = r.status === 'ok' ? '' : r.status === 'timeout' ? ' · TIMEOUT (interrupted)' : r.status === 'aborted' ? ' · aborted' : ' · ERROR';
        report.push(`--- cell ${i + 1}${r.count != null ? ` [${r.count}]` : ''}${tag} ---`, text || '(no output)');
        if (r.status !== 'ok') {
          failed = true;
          break;
        }
      }
      // The file as it is now (the user may have saved it meanwhile): outputs go to the cells
      // that still have the code that ran (found by id, else by position).
      const fresh = await load(abs).catch(() => nb);
      for (const res of results) {
        const j = res.cell.id ? fresh.cells.findIndex((c) => c.id === res.cell.id) : res.i;
        const target = fresh.cells[j];
        if (target && target.cell_type === 'code' && target.source === res.cell.source) {
          target.outputs = res.outputs;
          target.execution_count = res.count;
        }
      }
      await writeFile(abs, serializeNotebook(fresh), 'utf8');
      const left = order.length - ran;
      if (left > 0) report.push(`(${left} cells not run after the problem)`);
      return {
        ok: !failed,
        content: report.join('\n').slice(0, 20_000),
        summary: failed ? `error en la celda ${order[ran - 1]! + 1}` : `${ran} celdas`,
        ...(image && image.width > 0 ? { image } : {}),
        changed: abs,
      };
    }
    return { ok: false, content: `Unknown tool ${name}.`, summary: 'desconocida' };
  } catch (err) {
    return { ok: false, content: (err as Error).message, summary: 'error' };
  }
}
