import { existsSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import type {
  DesignApp,
  DesignApplyResult,
  DesignHistory,
  DesignMode,
  DesignOp,
  DesignPage,
  DesignSessionView,
} from '../../shared/design.js';
import { EditError, SRC_ATTR, annotate, shape } from './htmlSource.js';
import { findServer, inject, localOrigin, page, probe, proxy } from './live.js';
import { applyOp, opLabel, parseSrc } from './ops.js';
import {
  builtPages,
  detectProfile,
  gitignoreMatcher,
  htmlPages,
  isBundlerEntry,
  MAX_PAGES,
  pageProblem,
  type ProjectProfile,
} from './projectProfile.js';
import { PREVIEW_TYPES } from './previewServer.js';

/** What the session needs of the open folder (the Workspace, or a fake in tests). */
export interface DesignFiles {
  readFile(rel: string): Promise<{ content: string; binary: boolean; tooLarge: boolean }>;
  writeFile(rel: string, content: string): Promise<void>;
  listFiles(): Promise<string[]>;
  /** Absolute path of a project file (throws if it escapes the project). */
  resolve?(rel: string): string;
}

/** What the preview shows besides plain HTML pages: a dev server, or the built files. */
type Target = { mode: 'live'; app: DesignApp; origin: string } | { mode: 'built'; app: DesignApp };

/** Hidden files and folders (.env, .git) are never served from the built output. */
const HIDDEN = /(^|\/)\./;

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
/** The same script for live and built previews: select and ask the AI (nothing written). */
const LIVE_TAG = `<script src="${EDITOR_SCRIPT_PATH}" data-zx-live></script>`;

/**
 * The visual editor of one window: what kind of project is open, its pages, and the
 * Undo/Redo history of the changes written from the panel. Every change is applied to the
 * file's text (see ops.ts), checked, and written at once (the panel has no "unsaved" state).
 */
export class DesignSession {
  private profile: ProjectProfile | undefined;
  private target: Target | undefined;
  private builtList: DesignPage[] = [];
  private list: string[] = [];
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
    const list = await this.files.listFiles().catch((e: Error) => {
      throw new EditError(
        `No se pudo leer la carpeta del proyecto (${e.message}). Revisa que la carpeta siga existiendo y que tengas permiso para abrirla.`,
      );
    });
    this.list = list;
    const text = (f: string) =>
      this.files
        .readFile(f)
        .then((r) => (r.binary || r.tooLarge ? null : r.content))
        .catch(() => null);
    const pkg = list.includes('package.json') ? await text('package.json') : null;
    // Apps inside the folder (a monorepo: apps/web, packages/site…), a few levels down.
    const nested: Record<string, string> = {};
    for (const f of list) {
      if (Object.keys(nested).length >= 30) break;
      const m = /^((?:[^/]+\/){1,3})package\.json$/.exec(f);
      if (!m || /(^|\/)(node_modules|dist|build|out|release|\.[^/]+)\//.test(f)) continue;
      const json = await text(f);
      if (json) nested[m[1]!.slice(0, -1)] = json;
    }
    // What the project's .gitignore leaves out (a vendored copy of another project, build
    // output) is never a page, even when the file list came without ripgrep.
    const gi = list.includes('.gitignore') ? await text('.gitignore') : null;
    const ignored = gi ? gitignoreMatcher(gi) : undefined;
    // Each candidate page is read: HTML that only starts a bundler (Vite's index.html), the
    // templates of other tools ("{{ release }}") and fragments without <html>/<body> are
    // not pages to show or edit. Only pages read and found real are listed.
    const entries = new Set<string>();
    const allowed = new Set<string>();
    const candidates = htmlPages(ignored ? list.filter((f) => !ignored(f)) : list, undefined, 400);
    for (const p of candidates) {
      if (allowed.size >= MAX_PAGES) break;
      const html = await text(p.file);
      if (html === null || pageProblem(html)) continue;
      if (isBundlerEntry(html)) entries.add(p.file);
      else allowed.add(p.file);
    }
    this.profile = detectProfile(list, pkg, { nested, entries, allowed, ignored });
    this.target = undefined;
    return this.view();
  }

  get mode(): DesignMode {
    if (this.target) return this.target.mode;
    return this.profile?.editable ? 'edit' : 'none';
  }

  view(): DesignSessionView {
    const p = this.profile ?? { kind: 'unknown', label: '', editable: false, pages: [], apps: [] };
    const t = this.target;
    const app = t?.app ?? p.apps[0] ?? null;
    const mode = this.mode;
    const framework = Boolean(app) && mode !== 'edit';
    return {
      kind: framework ? app!.kind : p.kind,
      editable: mode === 'edit',
      label: framework ? app!.label : p.label,
      pages: mode === 'edit' ? p.pages : mode === 'built' ? this.builtList : [],
      base: mode === 'none' ? null : this.origin,
      history: this.history(),
      mode,
      app: mode === 'edit' ? null : app,
      apps: p.apps,
      live: t?.mode === 'live' ? t.origin : null,
    };
  }

  private appAt(dir: string): DesignApp {
    const app = this.profile?.apps.find((a) => a.dir === dir);
    if (!app)
      throw new EditError(
        'Esa parte del proyecto ya no está. Cierra el Panel de Edición y ábrelo de nuevo.',
      );
    return app;
  }

  /** Shows the app through its dev server (already running at `address`). */
  async showLive(dir: string, address: string): Promise<DesignSessionView> {
    const app = this.appAt(dir);
    const origin = localOrigin(address);
    const r = await probe(origin);
    if (!r.ok) throw new EditError(r.problem!);
    this.target = { mode: 'live', app, origin };
    return this.view();
  }

  /** Shows the app's built files (dist/, build/…). */
  async showBuilt(dir: string): Promise<DesignSessionView> {
    const app = this.appAt(dir);
    if (!app.built)
      throw new EditError(
        'Este proyecto todavía no está compilado (no hay carpeta dist/ ni build/). Inicia el proyecto o pide a la IA que lo compile.',
      );
    const list = await this.files.listFiles().catch(() => this.list);
    this.builtList = builtPages(list, app.built);
    if (!this.builtList.length)
      throw new EditError(
        `La carpeta ${app.built}/ ya no tiene páginas. Vuelve a compilar el proyecto.`,
      );
    this.target = { mode: 'built', app };
    return this.view();
  }

  /** Back to choosing how to show a framework project. */
  hide(): DesignSessionView {
    this.target = undefined;
    return this.view();
  }

  /** A dev server answering on this computer (the app's usual address first). */
  detect(dir: string): Promise<string | null> {
    const app = this.profile?.apps.find((a) => a.dir === dir);
    return findServer(app?.devUrl ?? this.profile?.devUrl ?? null);
  }

  /**
   * Requests of the preview frame in live and built mode (null: plain HTML pages, served by
   * the caller as before).
   */
  async respond(req: Request): Promise<Response | null> {
    const t = this.target;
    if (!t) return null;
    if (t.mode === 'live') return proxy(t.origin, req, LIVE_TAG);
    const resolve = this.files.resolve?.bind(this.files);
    const dir = t.app.built;
    if (!resolve || !dir) return page(404, 'No disponible', 'Vuelve a abrir el Panel de Edición.');
    let file: string;
    try {
      file = decodeURIComponent(new URL(req.url).pathname).replace(/^\/+/, '');
    } catch {
      return page(400, 'Dirección no válida', 'Elige una página en la columna de la izquierda.');
    }
    const missing = () =>
      page(404, 'Esta página no existe', 'Elige otra página en la columna de la izquierda.');
    if (HIDDEN.test(file) || file.includes('\0')) return missing();
    try {
      const at = (f: string) => resolve(`${dir}/${f}`);
      if (file === '' || file.endsWith('/')) file += 'index.html';
      if (!existsSync(at(file)) && !extname(file)) {
        // /precios → precios.html or precios/index.html; else the app's own router (SPA).
        file =
          [`${file}.html`, `${file}/index.html`].find((f) => existsSync(at(f))) ?? 'index.html';
      } else if (existsSync(at(file)) && statSync(at(file)).isDirectory())
        file = `${file}/index.html`;
      const ext = extname(file).toLowerCase();
      const body = await readFile(at(file));
      const headers = {
        'content-type': PREVIEW_TYPES[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
        'access-control-allow-origin': '*',
      };
      if (ext === '.html' || ext === '.htm')
        return new Response(inject(body.toString('utf8'), LIVE_TAG), { headers });
      return new Response(body, { headers });
    } catch {
      return missing();
    }
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
      if (!this.profile?.editable || this.mode !== 'edit')
        throw new EditError(
          'En este tipo de proyecto los cambios no se escriben desde el panel: pídeselos a la IA (cuadro «Dime qué quieres cambiar»).',
        );
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
