/**
 * B7: git marks in the editor margin. Each editor shows, beside the line numbers, which lines
 * were added (green), modified (blue) or deleted (red) since the version git has in its index,
 * and can jump between the changes or put one back.
 */
import * as monaco from 'monaco-editor';
import { gutterMarks, nextMark, type GutterMark } from '../shared/gitGutter';
import { t } from './i18n';
import { api, getState, subscribeStore } from './store';

type Editor = monaco.editor.IStandaloneCodeEditor;

/** The git version of each open file ('' = not in git: no marks). Shared by both editors. */
const bases = new Map<string, Promise<string>>();
const attached = new Set<() => void>();

function pathOf(model: monaco.editor.ITextModel | null): string | null {
  if (!model || model.uri.scheme !== 'file' || !getState().workspace) return null;
  return model.uri.path.replace(/^\//, '');
}

function baseOf(path: string): Promise<string> {
  let b = bases.get(path);
  if (!b) {
    b = api()
      .git.diff(path, false)
      .then((d) => d.before)
      .catch(() => '');
    bases.set(path, b);
  }
  return b;
}

/** Git changed (commit, stage, checkout…): read the base versions again and redraw. */
export function refreshGitGutter(): void {
  bases.clear();
  for (const redraw of attached) redraw();
}

let watching = false;
function watchStore(): void {
  if (watching) return;
  watching = true;
  let fs = getState().fsVersion;
  let root = getState().workspace?.root;
  let timer: ReturnType<typeof setTimeout> | undefined;
  subscribeStore(() => {
    const s = getState();
    if (s.fsVersion === fs && s.workspace?.root === root) return;
    fs = s.fsVersion;
    root = s.workspace?.root;
    clearTimeout(timer);
    timer = setTimeout(refreshGitGutter, 500);
  });
}

function decoration(m: GutterMark): monaco.editor.IModelDeltaDecoration {
  const cls =
    m.kind === 'added'
      ? 'zx-git-add'
      : m.kind === 'modified'
        ? 'zx-git-mod'
        : m.above
          ? 'zx-git-del'
          : 'zx-git-del below';
  const tip =
    m.kind === 'added'
      ? t('gitGutterAdded')
      : m.kind === 'modified'
        ? t('gitGutterModified')
        : t('gitGutterDeleted');
  return {
    range: new monaco.Range(m.start, 1, m.end, 1),
    options: {
      isWholeLine: true,
      linesDecorationsClassName: `zx-git ${cls}`,
      linesDecorationsTooltip: tip,
      stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    },
  };
}

/** The edit that puts the git version of one change back. */
function revertEdit(
  model: monaco.editor.ITextModel,
  m: GutterMark,
): monaco.editor.IIdentifiedSingleEditOperation {
  const eol = model.getEOL();
  const last = model.getLineCount();
  if (m.kind === 'deleted') {
    const text = m.old.join(eol);
    return m.above
      ? { range: new monaco.Range(m.start, 1, m.start, 1), text: text + eol }
      : {
          range: new monaco.Range(
            last,
            model.getLineMaxColumn(last),
            last,
            model.getLineMaxColumn(last),
          ),
          text: eol + text,
        };
  }
  if (m.kind === 'modified')
    return {
      range: new monaco.Range(m.start, 1, m.end, model.getLineMaxColumn(m.end)),
      text: m.old.join(eol),
    };
  // Added lines: remove them with one of their line breaks.
  if (m.end < last) return { range: new monaco.Range(m.start, 1, m.end + 1, 1), text: '' };
  if (m.start > 1)
    return {
      range: new monaco.Range(
        m.start - 1,
        model.getLineMaxColumn(m.start - 1),
        m.end,
        model.getLineMaxColumn(m.end),
      ),
      text: '',
    };
  return { range: model.getFullModelRange(), text: '' };
}

export function attachGitGutter(ed: Editor): monaco.IDisposable {
  watchStore();
  const marksShown = ed.createDecorationsCollection();
  let marks: GutterMark[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let run = 0;

  const draw = async (): Promise<void> => {
    const model = ed.getModel();
    const path = pathOf(model);
    const mine = ++run;
    if (!model || !path) {
      marks = [];
      marksShown.clear();
      return;
    }
    const base = await baseOf(path);
    if (mine !== run || ed.getModel() !== model || model.isDisposed()) return;
    marks = base ? gutterMarks(base, model.getValue()) : [];
    marksShown.set(marks.map(decoration));
  };
  const redraw = (): void => void draw();
  const later = (): void => {
    clearTimeout(timer);
    timer = setTimeout(redraw, 250);
  };
  attached.add(redraw);

  const go = (dir: 1 | -1): void => {
    const pos = ed.getPosition();
    const m = nextMark(marks, pos?.lineNumber ?? 1, dir);
    if (!m) return;
    ed.setPosition({ lineNumber: m.start, column: 1 });
    ed.revealLineInCenterIfOutsideViewport(m.start);
    ed.focus();
  };
  const here = (): GutterMark | undefined => {
    const line = ed.getPosition()?.lineNumber ?? 0;
    return marks.find((m) => line >= m.start && line <= m.end);
  };

  const subs: monaco.IDisposable[] = [
    ed.onDidChangeModel(redraw),
    ed.onDidChangeModelContent(later),
    ed.addAction({
      id: 'zx.git.nextChange',
      label: t('gitGutterNext'),
      keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.F3],
      contextMenuGroupId: 'zx-git',
      contextMenuOrder: 1,
      run: () => go(1),
    }),
    ed.addAction({
      id: 'zx.git.prevChange',
      label: t('gitGutterPrev'),
      keybindings: [monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F3],
      contextMenuGroupId: 'zx-git',
      contextMenuOrder: 2,
      run: () => go(-1),
    }),
    ed.addAction({
      id: 'zx.git.revertChange',
      label: t('gitGutterRevert'),
      contextMenuGroupId: 'zx-git',
      contextMenuOrder: 3,
      run: () => {
        const model = ed.getModel();
        const m = here();
        if (!model || !m) return;
        ed.pushUndoStop();
        ed.executeEdits('zx.git.revert', [revertEdit(model, m)]);
        ed.pushUndoStop();
        redraw();
      },
    }),
  ];
  redraw();

  return {
    dispose: () => {
      clearTimeout(timer);
      run++;
      attached.delete(redraw);
      for (const s of subs) s.dispose();
      marksShown.clear();
    },
  };
}

/** For the end-to-end test: the marks of an editor as "kind:start-end". */
export function gutterMarksOf(ed: Editor): string[] {
  return (ed.getModel()?.getAllDecorations() ?? [])
    .filter((d) => d.options.linesDecorationsClassName?.startsWith('zx-git '))
    .map((d) => {
      const kind = /zx-git-(add|mod|del)/.exec(d.options.linesDecorationsClassName ?? '')?.[1];
      return `${kind}:${d.range.startLineNumber}-${d.range.endLineNumber}`;
    })
    .sort();
}
