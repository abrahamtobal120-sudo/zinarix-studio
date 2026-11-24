import { describe, expect, it } from 'vitest';
import {
  applyIopub,
  collapseCarriageReturns,
  emptyNotebook,
  executeRequest,
  kernelName,
  newCell,
  NotebookError,
  notebookLanguage,
  parseNotebook,
  pickMime,
  serializeNotebook,
  splitLines,
  stripAnsi,
  type OutputState,
} from '../src/shared/notebook.js';

// Written by Jupyter (nbformat.writes: sorted keys, indent 1, trailing newline), with extra
// keys the editor does not know: notebook-level, cell-level, output-level and an output type.
const JUPYTER = `${JSON.stringify(
  {
    cells: [
      {
        attachments: { 'a.png': { 'image/png': 'iVBORw0KGgo=' } },
        cell_type: 'markdown',
        id: 'md-1',
        metadata: { tags: ['intro'] },
        source: ['# Title\n', '\n', 'Some *text*'],
      },
      {
        cell_type: 'code',
        execution_count: 3,
        id: 'code-1',
        metadata: { collapsed: false, custom: { deep: [1, 2, { x: null }] } },
        outputs: [
          { name: 'stdout', output_type: 'stream', text: ['hello\n', 'world\n'] },
          {
            data: { 'image/png': 'iVBORw0KGgo=\n', 'text/plain': ['<Figure>'] },
            metadata: { 'image/png': { width: 300 } },
            output_type: 'display_data',
          },
          {
            data: { 'text/plain': ['42'] },
            execution_count: 3,
            metadata: {},
            output_type: 'execute_result',
            zfuture: true,
          },
          {
            ename: 'ValueError',
            evalue: 'bad',
            output_type: 'error',
            traceback: ['\u001b[0;31mValueError\u001b[0m: bad'],
          },
          { output_type: 'some_future_output', payload: { a: 1 } },
        ],
        source: ['print("hello")\n', 'print("world")'],
      },
      { cell_type: 'raw', id: 'raw-1', metadata: {}, source: [] },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.11.4' },
      widgets: { state: {} },
    },
    nbformat: 4,
    nbformat_minor: 5,
    zinarix_unknown_top: { keep: 'me' },
  },
  null,
  1,
)}\n`;

describe('ipynb parse/serialize', () => {
  it('round-trips a Jupyter file byte for byte, unknown metadata included', () => {
    const nb = parseNotebook(JUPYTER);
    expect(serializeNotebook(nb)).toBe(JUPYTER);
  });

  it('reads cells, sources and outputs', () => {
    const nb = parseNotebook(JUPYTER);
    expect(nb.cells.map((c) => c.cell_type)).toEqual(['markdown', 'code', 'raw']);
    expect(nb.cells[0]!.source).toBe('# Title\n\nSome *text*');
    const code = nb.cells[1]!;
    expect(code.execution_count).toBe(3);
    expect(code.outputs.map((o) => o.output_type)).toEqual([
      'stream',
      'display_data',
      'execute_result',
      'error',
    ]);
    expect(code.outputs[0]).toMatchObject({ name: 'stdout', text: 'hello\nworld\n' });
    expect(notebookLanguage(nb)).toBe('python');
    expect(kernelName(nb)).toBe('python3');
  });

  it('keeps unknown keys after edits', () => {
    const nb = parseNotebook(JUPYTER);
    nb.cells[1]!.source = 'x = 1';
    nb.cells.push(newCell('markdown', 'new'));
    const back = JSON.parse(serializeNotebook(nb));
    expect(back.zinarix_unknown_top).toEqual({ keep: 'me' });
    expect(back.metadata.widgets).toEqual({ state: {} });
    expect(back.cells[0].attachments).toBeDefined();
    expect(back.cells[1].source).toEqual(['x = 1']);
    expect(back.cells[1].metadata.custom).toEqual({ deep: [1, 2, { x: null }] });
    expect(back.cells[1].outputs[2].zfuture).toBe(true);
    expect(back.cells[1].outputs[4]).toEqual({
      output_type: 'some_future_output',
      payload: { a: 1 },
    });
    expect(back.cells[3]).toMatchObject({ cell_type: 'markdown', source: ['new'] });
    expect(back.cells[3].id).toMatch(/^[a-z0-9]{12}$/);
    // Markdown cells never get outputs / execution_count.
    expect(back.cells[3].outputs).toBeUndefined();
  });

  it('keeps the indentation of files written by other tools', () => {
    const two = JSON.stringify(JSON.parse(JUPYTER), null, 2) + '\n';
    expect(serializeNotebook(parseNotebook(two)).split('\n')[1]).toMatch(/^ {2}"/);
  });

  it('opens an empty file as a new notebook and rejects other formats', () => {
    expect(parseNotebook('').cells).toHaveLength(1);
    expect(parseNotebook(serializeNotebook(emptyNotebook())).cells[0]!.cell_type).toBe('code');
    expect(() => parseNotebook('{not json')).toThrow(NotebookError);
    expect(() => parseNotebook('{"nbformat":3,"worksheets":[]}')).toThrow(/nbformat 3/);
    expect(() => parseNotebook('[]')).toThrow(NotebookError);
  });

  it('splits lines like nbformat', () => {
    expect(splitLines('a\nb\n')).toEqual(['a\n', 'b\n']);
    expect(splitLines('a\nb')).toEqual(['a\n', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('kernel messages and outputs', () => {
  it('builds an execute_request (protocol 5)', () => {
    const m = executeRequest('1+1', { msgId: 'm1', session: 's1', date: 'd' });
    expect(m).toMatchObject({
      channel: 'shell',
      header: { msg_id: 'm1', msg_type: 'execute_request', session: 's1', version: '5.3' },
      content: { code: '1+1', silent: false, store_history: true, allow_stdin: false },
    });
  });

  it('merges streams, keeps rich outputs, handles errors and clear_output', () => {
    let st: OutputState = { outputs: [], clearPending: false };
    st = applyIopub(st, 'status', { execution_state: 'busy' });
    st = applyIopub(st, 'stream', { name: 'stdout', text: 'a' });
    st = applyIopub(st, 'stream', { name: 'stdout', text: 'b\n' });
    st = applyIopub(st, 'stream', { name: 'stderr', text: 'warn\n' });
    expect(st.outputs).toHaveLength(2);
    expect(st.outputs[0]).toMatchObject({ text: 'ab\n' });
    st = applyIopub(st, 'display_data', {
      data: { 'text/plain': 'x' },
      metadata: {},
      transient: { display_id: 'd1' },
    });
    st = applyIopub(st, 'update_display_data', {
      data: { 'text/plain': 'y' },
      metadata: {},
      transient: { display_id: 'd1' },
    });
    expect(st.outputs[2]).toMatchObject({ data: { 'text/plain': 'y' } });
    st = applyIopub(st, 'execute_result', { data: { 'text/plain': '2' }, execution_count: 7 });
    expect(st.outputs[3]).toMatchObject({ output_type: 'execute_result', execution_count: 7 });
    st = applyIopub(st, 'clear_output', { wait: true });
    expect(st.outputs).toHaveLength(4);
    st = applyIopub(st, 'error', { ename: 'E', evalue: 'v', traceback: ['t'] });
    expect(st.outputs).toEqual([
      { output_type: 'error', ename: 'E', evalue: 'v', traceback: ['t'], extra: {} },
    ]);
    st = applyIopub(st, 'clear_output', { wait: false });
    expect(st.outputs).toEqual([]);
  });

  it('collapses progress bars and strips ANSI colors', () => {
    expect(collapseCarriageReturns('10%\r50%\r100%\ndone')).toBe('100%\ndone');
    expect(collapseCarriageReturns('a\r\nb')).toBe('a\nb');
    let st: OutputState = { outputs: [], clearPending: false };
    st = applyIopub(st, 'stream', { name: 'stdout', text: '1/3\r' });
    st = applyIopub(st, 'stream', { name: 'stdout', text: '2/3\r3/3\n' });
    expect(st.outputs[0]).toMatchObject({ text: '3/3\n' });
    expect(stripAnsi('\u001b[0;31mValueError\u001b[0m: bad')).toBe('ValueError: bad');
  });

  it('picks the richest supported mime type', () => {
    const data = { 'text/plain': 'p', 'image/png': 'b64', 'text/html': '<b>' };
    expect(pickMime(data, ['text/plain', 'image/png'])).toBe('image/png');
    expect(pickMime(data, ['text/plain'])).toBe('text/plain');
    expect(pickMime({ 'x/y': 1 }, ['text/plain'])).toBeNull();
  });
});
