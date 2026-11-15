/**
 * Typed contract of the visual editor (Panel de Edición): what the preview script reports,
 * what the panel asks of it, and the edit operations written to the project's files.
 */

/** "file#N": the N-th element (in source order) of a plain HTML file of the project. */
export type DesignSrc = string;

/** One element of the page, for the Layers tree. */
export interface DesignLayer {
  src: DesignSrc;
  tag: string;
  /** Start of its text (or alt/placeholder), to tell it apart: "Bienvenidos", "Comprar". */
  text: string;
  /** Hidden in the preview with the eye of the Layers panel (never written to the file). */
  hidden?: boolean;
  children: DesignLayer[];
}

/** What the panel needs to know about the selected element. */
export interface DesignSelection {
  src: DesignSrc;
  tag: string;
  text: string;
  /** Holds only text and inline formatting (it can be written on directly). */
  editable: boolean;
  /** Text shown (first 2000 characters). */
  value: string;
  /** Computed styles the Properties panel shows. */
  style: Record<string, string>;
  /** Styles already set on the element itself (what "Restablecer" removes). */
  inline: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** Containers up to the page, nearest first (for "seleccionar el contenedor"). */
  parents: { src: DesignSrc; tag: string; text: string }[];
  /** Image address, when it is an image. */
  image?: string;
  /** Short HTML of the element (for "Pedir a la IA"). */
  outer: string;
}

export type DesignKey = 'undo' | 'redo' | 'save' | 'escape' | 'ai';

/** Preview → panel. */
export type DesignPreviewMsg =
  | { type: 'ready'; title: string; tree: DesignLayer[] }
  /** The page changed by itself (an app that draws its screens with JavaScript). */
  | { type: 'tree'; title: string; tree: DesignLayer[] }
  /** The address inside the app changed (its own links and buttons, in live mode). */
  | { type: 'location'; path: string }
  /** The page was scrolled (the panel keeps it to restore it after a reload). */
  | { type: 'scroll'; y: number }
  | { type: 'hover'; src: DesignSrc | null }
  | { type: 'select'; selection: DesignSelection | null }
  | { type: 'textChanged'; src: DesignSrc; html: string }
  | { type: 'key'; key: DesignKey }
  | { type: 'action'; action: 'ai' | 'parent'; src: DesignSrc }
  /** A link of the page was followed in visitor mode (another page of the project). */
  | { type: 'navigate'; path: string };

/** Panel → preview. */
export type DesignPreviewCmd =
  | { type: 'select'; src: DesignSrc | null }
  | { type: 'hover'; src: DesignSrc | null }
  | { type: 'style'; src: DesignSrc; styles: Record<string, string | null> }
  | { type: 'editText'; src: DesignSrc }
  | { type: 'format'; command: 'bold' | 'italic' | 'underline' | 'strikeThrough' }
  | { type: 'setHidden'; src: DesignSrc; hidden: boolean }
  | { type: 'mode'; mode: 'edit' | 'visitor' }
  | { type: 'outlines'; on: boolean }
  | { type: 'scrollTo'; y: number };

/** One change to the project, written to its files (and undone as a whole). */
export type DesignOp =
  | { kind: 'setText'; src: DesignSrc; html: string }
  | { kind: 'setStyle'; src: DesignSrc; styles: Record<string, string | null> };

export type DesignKind =
  | 'html'
  | 'vite'
  | 'next'
  | 'nuxt'
  | 'astro'
  | 'svelte'
  | 'angular'
  | 'remix'
  /** A desktop app (Electron): it has screens, but they are not a web page to preview. */
  | 'desktop'
  | 'unknown';

/**
 * A web app found in the folder (the folder itself, or one of the apps of a monorepo) that
 * the panel can show by its dev server or by its built files.
 */
export interface DesignApp {
  /** Project-relative folder of its package.json ("" = the folder itself). */
  dir: string;
  kind: DesignKind;
  /** Plain words: "React con Vite", "Next.js". */
  label: string;
  /** Address its dev server usually runs on ("http://localhost:5173"). */
  devUrl: string | null;
  /** Project-relative folder with a built index.html ("dist", "apps/web/build"), if any. */
  built: string | null;
}

/**
 * How the panel shows the project:
 * - edit: plain HTML pages, edited with clicks and written to the files;
 * - live: a running dev server (Vite, Next…) shown through the panel; click to select and
 *   ask the AI to change it in the code;
 * - built: the built files (dist/, build/, out/), also changed through the AI;
 * - none: nothing to show yet (a framework project whose preview is not running).
 */
export type DesignMode = 'edit' | 'live' | 'built' | 'none';

export interface DesignPage {
  /** Project-relative file ("index.html", "blog/post.html"). */
  file: string;
  /** Address shown to the person ("/", "/blog/post"). */
  path: string;
  name: string;
}

export interface DesignHistory {
  canUndo: boolean;
  canRedo: boolean;
  /** Labels of the steps that can be undone, newest first. */
  steps: string[];
  /** Labels of the steps that can be redone, next first. */
  redo: string[];
}

export interface DesignSessionView {
  kind: DesignKind;
  /** Changes made in the panel are written to the project's files. */
  editable: boolean;
  /** Plain words about the kind of project ("Página web (HTML)", "React con Vite"). */
  label: string;
  pages: DesignPage[];
  /** Address the preview frame loads (zxp://…), null when nothing can be shown. */
  base: string | null;
  history: DesignHistory;
  mode: DesignMode;
  /** The web app shown (or to show) in live/built mode. */
  app: DesignApp | null;
  /** Every web app found in the folder (more than one in a monorepo). */
  apps: DesignApp[];
  /** Dev server address shown in live mode. */
  live: string | null;
}

/** Result of an edit: the new history, and whether the preview must reload to stay in sync. */
export interface DesignApplyResult {
  history: DesignHistory;
  reload: boolean;
  /** File changed (undo/redo may touch a page other than the one shown). */
  file: string;
}
