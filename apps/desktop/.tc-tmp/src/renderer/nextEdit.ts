/**
 * Fase 8 — next-edit prediction in the editor ("Tab" like Cursor's). After the user edits,
 * the "inline" model proposes the next edits (several, possibly multi-line). The first one is
 * shown in place (old lines struck through, new lines in a zone below them); Tab jumps to
 * it, Tab again applies it — and adds the imports it needs — and the next one is shown, so a
 * renamed parameter is carried to every call site in successive Tabs. Esc dismisses.
 */
import {
  adaptiveDebounce,
  cursorOnHunk,
  formatRecentEdits,
  lineDiff,
  pushRecentEdit,
  rebaseAfterUserEdit,
  relocateHunk,
  shiftAfterApply,
  visitOrder,
} from '../shared/nextEdit';
import type { NextEditHunk, RecentEdit } from '../shared/nextEdit';
import { addMissingImports, applyingImports } from './autoImport';
import { tl } from './i18nLsp';
import { languageFor, monaco } from './monaco';
import { api, getState, newRequestId, toast } from './store';
import './next-edit.css';

/** Lines the model sees above / below the cursor. */
const ABOVE = 60;
const BELOW = 120;
/** Files larger than this are not tracked (diffing every keystroke would be slow). */
const MAX_LINES = 20_000;
/** Re-read the acceptance metric (adaptive debounce) at most this often. */
const STATS_EVERY = 5 * 60_000;

type Editor = monaco.editor.IStandaloneCodeEditor;

function enabled(): boolean {
  const p = getState().prefs;
  return p.inlineCompletions && p.nextEdit;
}

function pathOf(model: monaco.editor.ITextModel): string | null {
  return model.uri.scheme === 'file' ? model.uri.path.replace(/^\//, '') : null;
}

/** First column with text on a line (where the cursor lands after a jump). */
function firstTextColumn(model: monaco.editor.ITextModel, line: number): number {
  return Math.max(1, model.getLineFirstNonWhitespaceColumn(line));
}

/** Attaches next-edit prediction to the editor; dispose to detach. */
export function attachNextEdit(ed: Editor): monaco.IDisposable {
  const subs: monaco.IDisposable[] = [];
  const snapshots = new Map<string, string[]>();
  let recent: RecentEdit[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: string | null = null;
  let queue: NextEditHunk[] = [];
  /** How many hunks of the current batch were accepted (a batch with none counts as dismissed). */
  let acceptedInBatch = 0;
  let batchSize = 0;
  /** True while the editor itself changes the text (applying, auto-import). */
  let ours = 0;
  let debounce = 450;
  let statsAt = 0;
  let zoneId: string | null = null;
  /** What is drawn now (hunk + hint place): cursor moves that change nothing skip the redraw. */
  let drawn = '';
  const decorations = ed.createDecorationsCollection();
  const visible = ed.createContextKey<boolean>('zxNextEditVisible', false);

  const refreshDebounce = (): void => {
    if (Date.now() - statsAt < STATS_EVERY) return;
    statsAt = Date.now();
    void api()
      .ai.suggestionStats()
      .then((rows) => {
        debounce = adaptiveDebounce(rows.find((r) => r.kind === 'nextEdit'));
      })
      .catch(() => undefined);
  };

  const snapshot = (model: monaco.editor.ITextModel): void => {
    if (model.getLineCount() <= MAX_LINES)
      snapshots.set(model.uri.toString(), model.getLinesContent());
    else snapshots.delete(model.uri.toString());
  };

  const clearView = (): void => {
    drawn = '';
    decorations.clear();
    if (zoneId) {
      const id = zoneId;
      ed.changeViewZones((acc) => acc.removeZone(id));
      zoneId = null;
    }
    visible.set(false);
  };

  const endBatch = (): void => {
    if (batchSize && !acceptedInBatch)
      void api()
        .ai.suggestionOutcome('nextEdit', 'dismissed', 1)
        .catch(() => undefined);
    batchSize = 0;
    acceptedInBatch = 0;
  };

  const dismiss = (): void => {
    if (!queue.length) return;
    queue = [];
    clearView();
    endBatch();
  };

  const cancelRequest = (): void => {
    clearTimeout(timer);
    if (inFlight) void api().ai.abort(inFlight);
    inFlight = null;
  };

  /** Draws the first hunk of the queue (and the Tab hint). */
  const render = (): void => {
    const model = ed.getModel();
    const h = queue[0];
    if (!model || !h) return clearView();
    const cursor = ed.getPosition()?.lineNumber ?? h.startLine;
    const on = cursorOnHunk(h, cursor);
    const count =
      batchSize > 1
        ? ` · ${tl('nextEditCount', { i: batchSize - queue.length + 1, n: batchSize })}`
        : '';
    const hint = (on ? tl('nextEditApply') : tl('nextEditJump', { line: h.startLine })) + count;
    const hintLine = on ? h.startLine : cursor;
    const key = `${h.startLine}:${h.endLine}:${hintLine}:${on}:${queue.length}`;
    if (key === drawn && visible.get()) return;
    const ds: monaco.editor.IModelDeltaDecoration[] = [];
    for (let l = h.startLine; l <= h.endLine; l++)
      ds.push({
        range: new monaco.Range(l, 1, l, 1),
        options: {
          isWholeLine: true,
          className: 'zx-ne-old',
          inlineClassName: h.replacement.length ? 'zx-ne-old-text' : 'zx-ne-del-text',
          overviewRuler: { color: '#3b82f6', position: monaco.editor.OverviewRulerLane.Center },
          minimap: { color: '#3b82f6', position: monaco.editor.MinimapPosition.Inline },
        },
      });
    clearView();
    drawn = key;
    // The hint goes where the user is looking: on the cursor line, or on the hunk once there.
    ds.push({
      range: new monaco.Range(
        hintLine,
        model.getLineMaxColumn(hintLine),
        hintLine,
        model.getLineMaxColumn(hintLine),
      ),
      options: { after: { content: `  ${hint}`, inlineClassName: 'zx-ne-hint' } },
    });
    decorations.set(ds);
    if (h.replacement.length) {
      const font = ed.getOption(monaco.editor.EditorOption.fontInfo);
      const node = document.createElement('div');
      node.className = 'zx-ne-zone';
      node.style.fontFamily = font.fontFamily;
      node.style.fontSize = `${font.fontSize}px`;
      node.style.lineHeight = `${font.lineHeight}px`;
      for (const line of h.replacement) {
        const row = document.createElement('div');
        row.className = 'zx-ne-new';
        row.textContent = line || ' ';
        node.appendChild(row);
      }
      ed.changeViewZones((acc) => {
        zoneId = acc.addZone({
          afterLineNumber: h.endLine,
          heightInLines: h.replacement.length,
          domNode: node,
        });
      });
    }
    visible.set(true);
  };

  /** The queue re-checked against the document (after our own edits moved lines). */
  const revalidate = (model: monaco.editor.ITextModel): void => {
    const lineAt = (n: number) =>
      n >= 1 && n <= model.getLineCount() ? model.getLineContent(n) : undefined;
    queue = queue.map((h) => relocateHunk(h, lineAt)).filter((h): h is NextEditHunk => !!h);
  };

  const request = async (): Promise<void> => {
    const model = ed.getModel();
    const pos = ed.getPosition();
    if (!enabled() || !model || !pos) return;
    const path = pathOf(model);
    if (!path || !recent.some((e) => e.path === path)) return;
    refreshDebounce();
    const start = Math.max(1, pos.lineNumber - ABOVE);
    const end = Math.min(model.getLineCount(), pos.lineNumber + BELOW);
    const lines: string[] = [];
    for (let l = start; l <= end; l++) lines.push(model.getLineContent(l));
    const version = model.getVersionId();
    const rid = newRequestId();
    inFlight = rid;
    try {
      const r = await api().ai.nextEdit(rid, {
        path,
        language: languageFor(path),
        edits: formatRecentEdits(recent),
        startLine: start,
        lines,
        cursor: { line: pos.lineNumber, column: pos.column },
      });
      if (inFlight !== rid || ed.getModel() !== model || model.getVersionId() !== version) return;
      // A fresher answer replaces what is still shown from the previous one.
      if (queue.length) {
        queue = [];
        clearView();
        endBatch();
      }
      queue = visitOrder(r.hunks, ed.getPosition()?.lineNumber ?? pos.lineNumber);
      revalidate(model);
      batchSize = queue.length;
      acceptedInBatch = 0;
      render();
    } catch {
      // no suggestion
    } finally {
      if (inFlight === rid) inFlight = null;
    }
  };

  const schedule = (delay = debounce): void => {
    cancelRequest();
    if (!enabled()) return;
    timer = setTimeout(() => void request(), delay);
  };

  const apply = (h: NextEditHunk): void => {
    const model = ed.getModel();
    if (!model) return;
    const eol = model.getEOL();
    let range: monaco.Range;
    let text: string;
    if (h.replacement.length) {
      range = new monaco.Range(h.startLine, 1, h.endLine, model.getLineMaxColumn(h.endLine));
      text = h.replacement.join(eol);
    } else if (h.endLine < model.getLineCount()) {
      range = new monaco.Range(h.startLine, 1, h.endLine + 1, 1);
      text = '';
    } else {
      const prev = Math.max(1, h.startLine - 1);
      range = new monaco.Range(
        prev,
        model.getLineMaxColumn(prev),
        h.endLine,
        model.getLineMaxColumn(h.endLine),
      );
      text = '';
    }
    ours++;
    try {
      ed.pushUndoStop();
      ed.executeEdits('zx-next-edit', [{ range, text, forceMoveMarkers: true }]);
      ed.pushUndoStop();
    } finally {
      ours--;
    }
    const path = pathOf(model);
    if (path)
      recent = pushRecentEdit(recent, {
        path,
        line: h.startLine,
        before: h.original,
        after: h.replacement,
      });
    snapshot(model);
    acceptedInBatch++;
    void api()
      .ai.suggestionOutcome('nextEdit', 'accepted', 1)
      .catch(() => undefined);
    const last = h.startLine + Math.max(0, h.replacement.length - 1);
    if (h.replacement.length)
      ed.setPosition({ lineNumber: last, column: model.getLineMaxColumn(last) });
    queue = shiftAfterApply(queue.slice(1), h);
    revalidate(model);
    if (queue.length) render();
    else {
      clearView();
      endBatch();
      // Chain: once the batch is done, look for what follows — right away, the user is not
      // typing (no keystrokes to wait out), so the next suggestion appears sooner.
      schedule(0);
    }
    if (h.replacement.length && getState().prefs.autoImport) {
      const inserted = {
        startLineNumber: h.startLine,
        startColumn: 1,
        endLineNumber: last,
        endColumn: 1,
      };
      // The import edits are recognised as ours while they are written (applyingImports), not
      // during the whole wait for diagnostics: the user's typing meanwhile must still count.
      void addMissingImports(model, inserted).then((n) => {
        if (n) toast(n === 1 ? tl('nextEditImports', { n }) : tl('nextEditImportsMany', { n }));
      });
    }
  };

  /** Tab: jump to the suggestion, or apply it when the cursor is already there. */
  const onTab = (): void => {
    const model = ed.getModel();
    const h = queue[0];
    if (!model || !h) return;
    const cursor = ed.getPosition()?.lineNumber ?? 0;
    if (!cursorOnHunk(h, cursor)) {
      ed.setPosition({ lineNumber: h.startLine, column: firstTextColumn(model, h.startLine) });
      ed.revealLineInCenterIfOutsideViewport(h.startLine);
      render();
      return;
    }
    apply(h);
  };

  subs.push(
    ed.addAction({
      id: 'zx.nextEdit.accept',
      label: 'Next edit: jump / apply',
      keybindings: [monaco.KeyCode.Tab],
      precondition:
        'zxNextEditVisible && !inlineSuggestionVisible && !suggestWidgetVisible && !inSnippetMode',
      keybindingContext: 'editorTextFocus',
      run: onTab,
    }),
    ed.addAction({
      id: 'zx.nextEdit.dismiss',
      label: 'Next edit: dismiss',
      keybindings: [monaco.KeyCode.Escape],
      precondition: 'zxNextEditVisible && !suggestWidgetVisible',
      keybindingContext: 'editorTextFocus',
      run: dismiss,
    }),
    ed.onDidChangeModel(() => {
      cancelRequest();
      dismiss();
      const m = ed.getModel();
      if (m) snapshot(m);
    }),
    ed.onDidChangeModelContent((e) => {
      const model = ed.getModel();
      if (!model) return;
      const key = model.uri.toString();
      if (ours || applyingImports()) {
        snapshot(model);
        // An import added lines above: the hunks still shown move with their text.
        if (!ours && queue.length) {
          revalidate(model);
          if (queue.length) render();
          else {
            clearView();
            endBatch();
          }
        }
        return;
      }
      const prev = snapshots.get(key);
      if (e.isFlush || !prev || e.isUndoing || e.isRedoing) {
        snapshot(model);
        cancelRequest();
        dismiss();
        return;
      }
      if (model.getLineCount() > MAX_LINES) return;
      const now = model.getLinesContent();
      snapshots.set(key, now);
      const d = lineDiff(prev, now);
      const path = pathOf(model);
      if (d && path) recent = pushRecentEdit(recent, { path, ...d });
      if (queue.length && d) {
        // Typing what the suggestion proposes keeps it (and saves a request); a change
        // elsewhere keeps the hunks it did not touch until the fresher answer arrives.
        const lineAt = (n: number) => (n >= 1 && n <= now.length ? now[n - 1] : undefined);
        const r = rebaseAfterUserEdit(queue, d, lineAt);
        // Typed exactly as suggested: the prediction was right, not a dismissal.
        if (r.completed) acceptedInBatch++;
        queue = r.queue;
        if (queue.length) render();
        else {
          clearView();
          endBatch();
        }
        if (r.typedThrough) {
          cancelRequest();
          return;
        }
      }
      schedule();
    }),
    ed.onDidChangeCursorPosition((e) => {
      // Re-draw the hint where the cursor now is (jump vs. apply).
      if (queue.length && e.reason !== monaco.editor.CursorChangeReason.ContentFlush) render();
    }),
  );
  const m = ed.getModel();
  if (m) snapshot(m);
  const disposeModels = monaco.editor.onWillDisposeModel((model) =>
    snapshots.delete(model.uri.toString()),
  );

  return {
    dispose() {
      cancelRequest();
      clearView();
      disposeModels.dispose();
      for (const s of subs) s.dispose();
    },
  };
}
