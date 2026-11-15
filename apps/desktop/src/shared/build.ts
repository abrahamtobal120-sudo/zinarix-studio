/**
 * Build (Phase 9): "describe your app" → a folder the agent fills with a static web app,
 * previewed live in the Design panel and deployed to Vercel in one click. Pure helpers.
 */

/** Saved in <app>/.zinarix/build.json. */
export interface BuildInfo {
  description: string;
  createdAt: number;
  /** Vercel project name (lowercase, digits, hyphens). */
  projectName: string;
  lastDeploy?: { id: string; url: string; at: number; production: boolean };
}

export interface BuildView extends BuildInfo {
  root: string;
}

export interface BuildDeployView {
  id: string;
  url: string;
  /** Vercel readyState: QUEUED, BUILDING, READY, ERROR, CANCELED. */
  state: string;
}

export const BUILD_FILE = '.zinarix/build.json';

/** Folder / project name from the description: "Una app de tareas" → "app-de-tareas". */
export function slugify(text: string, max = 40): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((w) => w && !STOP.has(w))
    .slice(0, 5)
    .join('-')
    .slice(0, max)
    .replace(/-+$/, '');
  return s || 'mi-app';
}

const STOP = new Set([
  'a', 'an', 'the', 'of', 'for', 'with', 'and', 'that', 'to', 'my', 'make', 'build', 'create',
  'un', 'una', 'unos', 'el', 'la', 'los', 'las', 'de', 'del', 'para', 'con', 'y', 'que', 'mi',
  'haz', 'hazme', 'crea', 'creame', 'quiero', 'app', 'aplicacion', 'web', 'simple', 'sencilla',
]);

/** A free folder name: "app", then "app-2", "app-3"… */
export function freeName(base: string, taken: (name: string) => boolean): string {
  if (!taken(base)) return base;
  for (let i = 2; i < 1000; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
  return `${base}-${Date.now().toString(36)}`;
}

/** Vercel project names: lowercase letters, digits, '.', '_', '-'; up to 100; no '---'. */
export function vercelName(name: string): string {
  const n = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{3,}/g, '--')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, 100);
  return n || 'zinarix-app';
}

/** Rules the agent follows in a Build folder (written to .zinarix/rules.md). */
export const BUILD_RULES = `# Zinarix Build

Esta carpeta es una app web creada con "Build". Reglas para el agente:

- Haz una app **estática**: \`index.html\` en la raíz, más \`styles.css\` y \`app.js\` (o los
  archivos que necesites). Sin paso de compilación, sin \`npm install\` y sin frameworks que
  necesiten bundler: tiene que abrirse tal cual en la vista previa y desplegarse así en Vercel.
- Puedes usar módulos ES (\`<script type="module">\`). No cargues librerías de CDNs salvo que
  el usuario lo pida.
- Guarda los datos del usuario en \`localStorage\` (no hay servidor).
- Diseño responsivo y accesible: etiquetas en los campos, contraste suficiente, se usa con
  teclado.
- Escribe los textos de la app en el idioma en que el usuario la describió.
- No crees archivos ocultos (que empiezan con ".") salvo los de \`.zinarix/\`: no se publican.
- Cuando termines, resume en 3–5 líneas qué hace la app y cómo probarla.
`;

/** First message of the Build chat. */
export function buildPrompt(description: string): string {
  return `Crea esta app web en la carpeta actual siguiendo las reglas de .zinarix/rules.md (estática, index.html en la raíz, sin compilación):

${description.trim()}

Reemplaza el index.html provisional. Yo la veo en la vista previa en vivo mientras trabajas.`;
}

/** Placeholder page so the preview has something to show from the first second. */
export function starterHtml(title: string): string {
  const esc = title.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc}</title>
    <style>
      body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #555; }
    </style>
  </head>
  <body>
    <p>Construyendo “${esc}”…</p>
  </body>
</html>
`;
}

export const DEPLOY_MAX_FILES = 2000;
export const DEPLOY_MAX_BYTES = 100 * 1024 * 1024;

/** Whether a project-relative path is published (hidden files and node_modules never are). */
export function deployable(rel: string): boolean {
  const parts = rel.split(/[\\/]/);
  return !parts.some((p) => p.startsWith('.') || p === 'node_modules');
}
