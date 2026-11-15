import type {
  DesignApplyResult,
  DesignHistory,
  DesignOp,
  DesignSessionView,
} from '../../shared/design.js';
import { EditError, SRC_ATTR, annotate, shape } from './htmlSource.js';
import { applyOp, opLabel, parseSrc } from './ops.js';
import { detectProfile, type ProjectProfile } from './projectProfile.js';

/** What the session needs of the open folder (the Workspace, or a fake in tests). */
export interface DesignFiles {
  readFile(rel: string): Promise<{ content: string; binary: boolean; tooLarge: boolean }>;
  writeFile(rel: string, content: string): Promise<void>;
  listFiles(): Promise<string[]>;
}

interface Step {
  label: string;
  file: string;
  before: string;
  after: string;
}

/** Steps kept for Undo: enough for a long session, bounded so memory stays small. */
const MAX_STEPS = 500;

/** Script added to every page the preview serves (never to the files). */
export const EDITOR_SCRIPT_PATH = '/__zx__/editor.js';

/**
 * The visual editor of one window: what kind of project is open, its pages, and the
 * Undo/Redo history of the changes written from the panel. Every change is applied to the
 * file's text (see ops.ts), checked, and written at once (the panel has no "unsaved" state).
 */
export class DesignSession {
  private profile: ProjectProfile | undefined;
  private undoStack: Step[] = [];
  private redoStack: Step[] = [];
  /** Text of each page as last served to the preview (to tell an outside change). */
  private served = new Map<string, string>();
  /** Writes in flight are queued so two quick edits never race on the same file. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly files: DesignFiles,
    /** Address of the preview for this window, e.g. "zxp://w3". */
    private readonly origin: string,
  ) {}

  async open(): Promise<DesignSessionView> {
    const list = await this.files.listFiles();
    const pkg = list.includes('package.json')
      ? await this.files
          .readFile('package.json')
          .then((f) => f.content)
          .catch(() => null)
      : null;
    this.profile = detectProfile(list, pkg);
    return this.view();
  }

  view(): DesignSessionView {
    const p = this.profile ?? { kind: 'unknown', label: '', editable: false, pages: [] };
    return {
      kind: p.kind,
      editable: p.editable,
      label: p.label,
      pages: p.pages,
      base: p.editable ? this.origin : null,
      history: this.history(),
    };
  }

  history(): DesignHistory {
    return {
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      steps: this.undoStack.map((s) => s.label).reverse(),
      redo: this.redoStack.map((s) => s.label).reverse(),
    };
  }

  /** The page as the preview shows it: numbered elements and the editor script. */
  async serve(file: string): Promise<string> {
    const f = await this.files.readFile(file);
    if (f.binary || f.tooLarge) throw new EditError('La página no se puede mostrar.');
    this.served.set(file, f.content);
    const html = annotate(f.content, file);
    const tag = `<script src="${EDITOR_SCRIPT_PATH}"></script>`;
    const body = html.search(/<\/body\s*>/i);
    return body >= 0 ? html.slice(0, body) + tag + html.slice(body) : html + tag;
  }

  /** True when the page changed on disk since the preview loaded it (editor, agent, git). */
  async stale(file: string): Promise<boolean> {
    const was = this.served.get(file);
    if (was === undefined) return false;
    const now = await this.files.readFile(file).catch(() => null);
    return !now || now.content !== was;
  }

  apply(op: DesignOp): Promise<DesignApplyResult> {
    return this.serial(async () => {
      if (!this.profile?.editable)
        throw new EditError('Este tipo de proyecto todavía no se puede editar desde el panel.');
      const at = parseSrc(op.src);
      if (!at || !this.profile.pages.some((p) => p.file === at.file))
        throw new EditError('Este elemento no pertenece a una página del proyecto.');
      const f = await this.files.readFile(at.file);
      if (f.binary || f.tooLarge) throw new EditError('El archivo no se puede editar.');
      const before = f.content;
      const after = applyOp(before, op);
      if (after.includes(SRC_ATTR)) throw new EditError('El cambio no se pudo guardar limpio.');
      if (after === before) return { history: this.history(), reload: false, file: at.file };
      await this.files.writeFile(at.file, after);
      this.served.set(at.file, after);
      this.push({ label: opLabel(op), file: at.file, before, after });
      return { history: this.history(), reload: shape(before) !== shape(after), file: at.file };
    });
  }

  undo(): Promise<DesignApplyResult | null> {
    return this.serial(() => this.move(this.undoStack, this.redoStack, 'before'));
  }

  redo(): Promise<DesignApplyResult | null> {
    return this.serial(() => this.move(this.redoStack, this.undoStack, 'after'));
  }

  private async move(
    from: Step[],
    to: Step[],
    want: 'before' | 'after',
  ): Promise<DesignApplyResult | null> {
    const step = from.at(-1);
    if (!step) return null;
    const have = want === 'before' ? step.after : step.before;
    const now = await this.files.readFile(step.file).catch(() => null);
    if (!now || now.content !== have) {
      // Someone else changed the file: going back would throw their work away.
      this.undoStack = [];
      this.redoStack = [];
      throw new EditError(
        'El archivo cambió fuera del panel (en el editor o con la IA), así que ya no se puede deshacer este paso.',
      );
    }
    from.pop();
    await this.files.writeFile(step.file, step[want]);
    this.served.set(step.file, step[want]);
    to.push(step);
    return { history: this.history(), reload: true, file: step.file };
  }

  private push(step: Step): void {
    this.undoStack.push(step);
    if (this.undoStack.length > MAX_STEPS) this.undoStack.shift();
    this.redoStack = [];
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
