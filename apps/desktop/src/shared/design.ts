/**
 * Typed contract of the visual editor (Panel de Edición): what the preview script reports,
 * what the panel asks of it, and the edit operations written to the project's files.
 */

/** "file#N" (a numbered node of a plain HTML file) or "rt:N" (a node only the preview knows). */
export type DesignSrc = string;

export interface DesignLayer {
  src: DesignSrc;
  tag: string;
  /** Friendly name: "Título «Bienvenidos»", "Botón «Comprar»", "Imagen". */
  name: string;
  hidden?: boolean;
  children: DesignLayer[];
}

/** What the panel needs to know about the selected element. */
export interface DesignSelection {
  src: DesignSrc;
  tag: string;
  name: string;
  /** Holds only text and inline formatting (it can be written on directly). */
  text: boolean;
  /** Text shown (first 2000 characters). */
  value: string;
  /** Computed styles the Properties panel shows. */
  style: Record<string, string>;
  /** Inline styles already set on the element (what "Restablecer" removes). */
  inline: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  /** Chain of containers up to the page, nearest first (for "seleccionar el contenedor"). */
  parents: { src: DesignSrc; name: string }[];
  /** Image address, when it is an image. */
  image?: string;
  /** Short HTML of the element (for "Pedir a la IA"). */
  outer: string;
}

/** Preview → panel. */
export type DesignPreviewMsg =
  | { type: 'ready'; url: string; title: string; tree: DesignLayer[] }
  | { type: 'hover'; src: DesignSrc | null }
  | { type: 'select'; selection: DesignSelection | null }
  | { type: 'textChanged'; src: DesignSrc; html: string }
  | { type: 'key'; key: 'undo' | 'redo' | 'save' | 'escape' | 'ai' }
  | { type: 'action'; action: 'ai' | 'bold' | 'italic' | 'underline' | 'parent'; src: DesignSrc };

/** Panel → preview. */
export type DesignPreviewCmd =
  | { type: 'select'; src: DesignSrc | null }
  | { type: 'hover'; src: DesignSrc | null }
  | { type: 'style'; src: DesignSrc; styles: Record<string, string | null> }
  | { type: 'editText'; src: DesignSrc }
  | { type: 'setHidden'; src: DesignSrc; hidden: boolean }
  | { type: 'mode'; mode: 'edit' | 'visitor' }
  | { type: 'refresh' };

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
  | 'unknown';

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
  undoLabel: string;
  redoLabel: string;
  /** Labels of the steps that can be undone, newest first. */
  steps: string[];
}

export interface DesignSessionView {
  kind: DesignKind;
  /** Changes made in the panel are written to the project's files. */
  editable: boolean;
  /** Plain words about the kind of project ("Página web (HTML)", "React con Vite"). */
  label: string;
  pages: DesignPage[];
  /** Page shown (a file of pages[], or the address of a dev server). */
  page: string | null;
  url: string | null;
  /** Address of the dev server to try, for projects that need one running. */
  devUrl?: string;
  history: DesignHistory;
}

export type DesignEvent =
  | { type: 'preview'; msg: DesignPreviewMsg }
  | { type: 'history'; history: DesignHistory }
  | { type: 'saving'; state: 'saving' | 'saved' | 'error'; message?: string }
  /** A file shown in the panel changed elsewhere (editor, agent): the preview reloaded. */
  | { type: 'external'; file: string }
  | { type: 'session'; session: DesignSessionView };
