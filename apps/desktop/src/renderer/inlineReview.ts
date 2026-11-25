/**
 * C4: review an AI edit inside the editor. The proposed text is applied right away (one undo
 * step) and every changed block is marked: added lines in green, the lines it replaced shown
 * above in red, with Accept / Reject per block (mouse or keyboard) and for all of them.
 * Rejecting a block puts its old lines back; accepting only removes the marks.
 */
import * as monaco from 'monaco-editor';
import { lineHunks, revertEdit } from '../shared/lineHunks';
import { t } from './i18n';

type Editor = monaco.editor.IStandaloneCodeEditor;

interface Block {
  /** Tracks where the block is while the document changes around it. */
  mark: monaco.editor.IEditorDecorationsCollection;
  /** Lines of new text when the review started (0 = the AI only removed lines). */
  added: number;
  /** The lines the AI replaced or removed. */
  old: string[];
  /** A removal at the very end of the file: the mark sits at the end of the last line. */
  atEnd: boolean;
  widget: monaco.editor.IContentWidget;
}

interface Review {
  ed: Editor;
  model: monaco.editor.ITextModel;
  blocks: Block[];
  zones: string[];
  bar: monaco.editor.IOverlayWidget;
  count: HTMLElement;
  subs: monaco.IDisposable[];
}

let review: Review | null = null;
/** `zxReviewActive` of each editor that takes the review keys (main and side group). */
const active = new Map<Editor, monaco.editor.IContextKey<boolean>>();
let seq = 0;
/** True while our own reverts run, so the marks are redrawn once at the end. */
let busy = false;

const KEYS = {
  accept: 'Alt+Y',
  reject: 'Alt+N',
  acceptAll: 'Alt+Shift+Y',
  rejectAll: 'Alt+Shift+N',
  next: 'Alt+J',
};

/** How many blocks are still waiting for an answer (0 = no review open). */
export function pendingReviewBlocks(): number {
  return review?.blocks.length ?? 0;
}

function button(label: string, keys: string, cls: string, run: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.textContent = label;
  b.title = `${label} (${keys})`;
  // mousedown would move the cursor and the focus out of the text first.
  b.addEventListener('mousedown', (e) => e.preventDefault());
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    run();
  });
  return b;
}

/** First line of the block's new text now (for a removal: the line it sat before). */
function lineOf(r: Review, b: Block): number | null {
  const range = b.mark.getRange(0);
  if (!range) return null;
  return b.atEnd ? r.model.getLineCount() + 1 : range.startLineNumber;
}

/** Lines of new text the block covers now (the user may have typed inside it). */
function addedNow(b: Block): number {
  if (!b.added) return 0;
  const range = b.mark.getRange(0);
  // Emptied by the user: nothing of the new text is left to take out.
  if (!range || range.isEmpty()) return 0;
  return range.endLineNumber - range.startLineNumber + 1;
}

function drawZones(r: Review): void {
  const font = r.ed.getOption(monaco.editor.EditorOption.fontInfo);
  r.ed.changeViewZones((acc) => {
    for (const id of r.zones) acc.removeZone(id);
    r.zones = [];
    for (const b of r.blocks) {
      const line = lineOf(r, b);
      if (line === null || !b.old.length) continue;
      const node = document.createElement('div');
      node.className = 'zx-rv-zone';
      node.style.fontFamily = font.fontFamily;
      node.style.fontSize = `${font.fontSize}px`;
      node.style.lineHeight = `${font.lineHeight}px`;
      for (const text of b.old) {
        const row = document.createElement('div');
        row.className = 'zx-rv-old';
        row.textContent = text || ' ';
        node.appendChild(row);
      }
      r.zones.push(
        acc.addZone({ afterLineNumber: line - 1, heightInLines: b.old.length, domNode: node }),
      );
    }
  });
}

function refresh(r: Review): void {
  // A block whose text the user deleted has nothing left to answer.
  r.blocks = r.blocks.filter((b) => {
    if (b.mark.getRange(0)) return true;
    r.ed.removeContentWidget(b.widget);
    b.mark.clear();
    return false;
  });
  if (!r.blocks.length) return endReview();
  r.count.textContent = t('aiRvCount').replace('{n}', String(r.blocks.length));
  drawZones(r);
  for (const b of r.blocks) r.ed.layoutContentWidget(b.widget);
}

/** Close the review, keeping the document as it is now. */
export function endReview(): void {
  const r = review;
  if (!r) return;
  review = null;
  active.get(r.ed)?.set(false);
  for (const s of r.subs) s.dispose();
  for (const b of r.blocks) {
    r.ed.removeContentWidget(b.widget);
    b.mark.clear();
  }
  r.ed.changeViewZones((acc) => {
    for (const id of r.zones) acc.removeZone(id);
  });
  r.ed.removeOverlayWidget(r.bar);
}

function drop(r: Review, b: Block): void {
  r.ed.removeContentWidget(b.widget);
  b.mark.clear();
  r.blocks = r.blocks.filter((x) => x !== b);
}

function revert(r: Review, b: Block): void {
  const line = lineOf(r, b);
  if (line === null) return;
  const edit = revertEdit(
    line,
    addedNow(b),
    b.old,
    r.model.getLineCount(),
    (n) => r.model.getLineLength(n),
    r.model.getEOL(),
  );
  const { text, ...range } = edit;
  r.ed.executeEdits('zx-ai-review', [{ range, text, forceMoveMarkers: true }]);
}

function answer(b: Block, keep: boolean): void {
  const r = review;
  if (!r || !r.blocks.includes(b)) return;
  if (!keep) {
    r.ed.pushUndoStop();
    busy = true;
    try {
      revert(r, b);
    } finally {
      busy = false;
    }
    r.ed.pushUndoStop();
  }
  drop(r, b);
  refresh(r);
  const next = review ? currentBlock() : null;
  if (review && next) reveal(review, next);
}

function answerAll(keep: boolean): void {
  const r = review;
  if (!r) return;
  if (!keep) {
    r.ed.pushUndoStop();
    // Bottom to top, so one revert does not move the lines of the next.
    const order = [...r.blocks].sort((x, y) => (lineOf(r, y) ?? 0) - (lineOf(r, x) ?? 0));
    busy = true;
    try {
      for (const b of order) revert(r, b);
    } finally {
      busy = false;
    }
    r.ed.pushUndoStop();
  }
  endReview();
  r.ed.focus();
}

/** The block under the cursor, else the next one below it, else the first. */
function currentBlock(): Block | null {
  const r = review;
  if (!r || !r.blocks.length) return null;
  const at = r.ed.getPosition()?.lineNumber ?? 1;
  const placed = r.blocks
    .map((b) => ({ b, line: lineOf(r, b) ?? 0, n: Math.max(1, addedNow(b)) }))
    .sort((x, y) => x.line - y.line);
  return (
    placed.find((p) => at >= p.line && at < p.line + p.n)?.b ??
    placed.find((p) => p.line > at)?.b ??
    placed[0]!.b
  );
}

function reveal(r: Review, b: Block): void {
  const line = Math.min(lineOf(r, b) ?? 1, r.model.getLineCount());
  r.ed.setPosition({ lineNumber: line, column: 1 });
  r.ed.revealLineInCenterIfOutsideViewport(line);
}

function nextBlock(): void {
  const r = review;
  if (!r) return;
  const at = r.ed.getPosition()?.lineNumber ?? 1;
  const lines = r.blocks
    .map((b) => ({ b, line: Math.min(lineOf(r, b) ?? 1, r.model.getLineCount()) }))
    .sort((x, y) => x.line - y.line);
  const next = lines.find((p) => p.line > at) ?? lines[0];
  if (next) reveal(r, next.b);
}

/**
 * Replace lines startLine…endLine of the editor's document with `text` and open the review of
 * what changed. Returns the number of blocks to review (0 = the text was the same).
 */
export function proposeEdit(ed: Editor, startLine: number, endLine: number, text: string): number {
  const model = ed.getModel();
  if (!model) return 0;
  endReview();
  const old: string[] = [];
  for (let n = startLine; n <= endLine; n++) old.push(model.getLineContent(n));
  const fresh = text.split(/\r?\n/);
  const hunks = lineHunks(old, fresh);
  if (!hunks.length) return 0;

  ed.pushUndoStop();
  ed.executeEdits('zx-ai-edit', [
    {
      range: new monaco.Range(startLine, 1, endLine, model.getLineMaxColumn(endLine)),
      text: fresh.join(model.getEOL()),
      forceMoveMarkers: true,
    },
  ]);
  ed.pushUndoStop();

  const count = document.createElement('span');
  count.className = 'zx-rv-count';
  const barNode = document.createElement('div');
  barNode.className = 'zx-rv-bar';
  barNode.setAttribute('role', 'toolbar');
  barNode.setAttribute('aria-label', t('aiRvTitle'));
  barNode.append(
    count,
    button(t('aiRvAcceptAll'), KEYS.acceptAll, 'zx-rv-yes', () => answerAll(true)),
    button(t('aiRvRejectAll'), KEYS.rejectAll, 'zx-rv-no', () => answerAll(false)),
  );
  const barId = `zx.review.bar.${++seq}`;
  const bar: monaco.editor.IOverlayWidget = {
    getId: () => barId,
    getDomNode: () => barNode,
    getPosition: () => ({
      preference: monaco.editor.OverlayWidgetPositionPreference.TOP_RIGHT_CORNER,
    }),
  };

  const r: Review = { ed, model, blocks: [], zones: [], bar, count, subs: [] };
  const lineCount = model.getLineCount();
  for (const h of hunks) {
    const line = startLine + h.bStart;
    const atEnd = h.bCount === 0 && line > lineCount;
    const range =
      h.bCount > 0
        ? new monaco.Range(
            line,
            1,
            line + h.bCount - 1,
            model.getLineMaxColumn(line + h.bCount - 1),
          )
        : atEnd
          ? new monaco.Range(
              lineCount,
              model.getLineMaxColumn(lineCount),
              lineCount,
              model.getLineMaxColumn(lineCount),
            )
          : new monaco.Range(line, 1, line, 1);
    const mark = ed.createDecorationsCollection([
      {
        range,
        options: {
          isWholeLine: h.bCount > 0,
          className: h.bCount > 0 ? 'zx-rv-add' : undefined,
          linesDecorationsClassName: h.bCount > 0 ? 'zx-rv-add-gutter' : 'zx-rv-del-gutter',
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      },
    ]);
    const node = document.createElement('div');
    node.className = 'zx-rv-actions';
    const id = `zx.review.block.${++seq}`;
    const block: Block = {
      mark,
      added: h.bCount,
      old: old.slice(h.aStart, h.aStart + h.aCount),
      atEnd,
      widget: {
        getId: () => id,
        getDomNode: () => node,
        getPosition: () => {
          const at = mark.getRange(0);
          if (!at) return null;
          return {
            position: {
              lineNumber: at.startLineNumber,
              column: model.getLineMaxColumn(at.startLineNumber),
            },
            preference: [monaco.editor.ContentWidgetPositionPreference.EXACT],
          };
        },
      },
    };
    node.append(
      button(t('accept'), KEYS.accept, 'zx-rv-yes', () => answer(block, true)),
      button(t('reject'), KEYS.reject, 'zx-rv-no', () => answer(block, false)),
    );
    r.blocks.push(block);
    ed.addContentWidget(block.widget);
  }
  ed.addOverlayWidget(bar);
  r.subs.push(
    model.onDidChangeContent(() => {
      if (review === r && !busy) refresh(r);
    }),
    // Another tab: the text stays as it is, the marks go.
    ed.onDidChangeModel(() => {
      if (review === r) endReview();
    }),
  );
  review = r;
  active.get(ed)?.set(true);
  refresh(r);
  if (review === r && r.blocks[0]) reveal(r, r.blocks[0]);
  ed.focus();
  return hunks.length;
}

/** Keyboard for the review; call once per editor. */
export function attachInlineReview(ed: Editor): monaco.IDisposable {
  active.set(ed, ed.createContextKey<boolean>('zxReviewActive', false));
  const M = monaco.KeyMod;
  const K = monaco.KeyCode;
  const action = (id: string, label: string, keys: number, run: () => void): monaco.IDisposable =>
    ed.addAction({
      id,
      label,
      keybindings: [keys],
      precondition: 'zxReviewActive',
      run,
    });
  const one = (keep: boolean) => () => {
    const b = currentBlock();
    if (b) answer(b, keep);
  };
  const subs = [
    action('zx.review.accept', 'AI edit: accept this change', M.Alt | K.KeyY, one(true)),
    action('zx.review.reject', 'AI edit: reject this change', M.Alt | K.KeyN, one(false)),
    action('zx.review.acceptAll', 'AI edit: accept all', M.Alt | M.Shift | K.KeyY, () =>
      answerAll(true),
    ),
    action('zx.review.rejectAll', 'AI edit: reject all', M.Alt | M.Shift | K.KeyN, () =>
      answerAll(false),
    ),
    action('zx.review.next', 'AI edit: next change', M.Alt | K.KeyJ, nextBlock),
  ];
  return {
    dispose: () => {
      if (review?.ed === ed) endReview();
      for (const s of subs) s.dispose();
      active.delete(ed);
    },
  };
}
