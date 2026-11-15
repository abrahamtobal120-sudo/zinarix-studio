import type { DesignApp, DesignKind, DesignPage } from '../../shared/design.js';

export interface ProjectProfile {
  kind: DesignKind;
  label: string;
  /** Edits made in the panel can be written to the files (plain HTML for now). */
  editable: boolean;
  /** Address of the dev server the project usually runs on. */
  devUrl?: string;
  pages: DesignPage[];
  /** Web apps of the folder that can be shown live or built (framework projects). */
  apps: DesignApp[];
}

/**
 * Folders whose HTML is never a page of the site (build output, dependencies, tooling,
 * packaged apps).
 */
const SKIP =
  /(^|\/)(node_modules|dist|build|out|release|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.turbo|\.cache|\.angular|\.astro|storybook-static|coverage|vendor|target|\.venv|__pycache__|\.git|\.zinarix)\//;

/** Friendly name of a page from its file ("acerca-de.html" → "Acerca de"). */
export function pageName(file: string): string {
  const base = file.split('/').pop()!.replace(/\.html?$/i, '');
  if (base.toLowerCase() === 'index') {
    const dir = file.split('/').slice(-2, -1)[0];
    return dir ? pageName(`${dir}.html`) : 'Inicio';
  }
  const words = base.replace(/[-_]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function pagePath(file: string): string {
  const p = `/${file}`.replace(/(^|\/)index\.html?$/i, '$1').replace(/\.html?$/i, '');
  return p === '' ? '/' : p;
}

/** Pages of a plain HTML site: index first, then by folder and name. */
export function htmlPages(files: string[], skip: RegExp = SKIP): DesignPage[] {
  return files
    .filter((f) => /\.html?$/i.test(f) && !skip.test(`${f}`) && !/(^|\/)\./.test(f))
    .sort((a, b) => {
      const da = a.split('/').length;
      const db = b.split('/').length;
      const ia = /(^|\/)index\.html?$/i.test(a) ? 0 : 1;
      const ib = /(^|\/)index\.html?$/i.test(b) ? 0 : 1;
      return da - db || ia - ib || a.localeCompare(b);
    })
    .slice(0, 300)
    .map((file) => ({ file, path: pagePath(file), name: pageName(file) }));
}

/** Pages of a built site (dist/, build/…): relative to that folder, which is its root. */
export function builtPages(files: string[], dir: string): DesignPage[] {
  const prefix = `${dir}/`;
  return htmlPages(
    files.filter((f) => f.startsWith(prefix)).map((f) => f.slice(prefix.length)),
    /(^|\/)(node_modules|\.git)\//,
  );
}

/**
 * True when an HTML file is only the entry point of a bundler (Vite, Parcel…): its
 * content is drawn by a script of the source code ("/src/main.tsx"), so editing its text
 * changes nothing that shows.
 */
export function isBundlerEntry(html: string): boolean {
  return /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\.(tsx?|jsx|vue|svelte)\b/i.test(
    html,
  ) ||
    /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\.(tsx?|jsx|vue|svelte)\b[^>]*\btype\s*=\s*["']?module/i.test(html);
}

type Framework = Omit<DesignApp, 'dir' | 'built'>;

/** The web framework of a package.json (null: none, or not a web app). */
export function frameworkOf(pkgJson: string | null): Framework | null {
  if (!pkgJson) return null;
  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(pkgJson) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return null; // a broken package.json: treated as no package.json
  }
  const has = (d: string) => d in deps;
  const fw = (kind: DesignKind, label: string, devUrl: string | null): Framework => ({
    kind,
    label,
    devUrl,
  });
  if (has('electron')) return fw('desktop', 'Aplicación de escritorio (Electron)', null);
  if (has('next')) return fw('next', 'Next.js', 'http://localhost:3000');
  if (has('nuxt')) return fw('nuxt', 'Nuxt', 'http://localhost:3000');
  if (has('astro')) return fw('astro', 'Astro', 'http://localhost:4321');
  if (has('@sveltejs/kit')) return fw('svelte', 'SvelteKit', 'http://localhost:5173');
  if (has('@angular/core')) return fw('angular', 'Angular', 'http://localhost:4200');
  if (has('@remix-run/react') || has('@react-router/dev'))
    return fw('remix', 'Remix / React Router', 'http://localhost:5173');
  if (has('vite')) {
    const ui = has('react') ? 'React' : has('vue') ? 'Vue' : has('svelte') ? 'Svelte' : '';
    return fw('vite', ui ? `${ui} con Vite` : 'Vite', 'http://localhost:5173');
  }
  if (has('react-scripts')) return fw('vite', 'React', 'http://localhost:3000');
  if (has('gatsby')) return fw('vite', 'Gatsby', 'http://localhost:8000');
  if (has('@11ty/eleventy')) return fw('vite', 'Eleventy', 'http://localhost:8080');
  return null;
}

/** Folder with the built site of an app ("dist" with an index.html), if it was built. */
export function builtDir(files: Set<string>, dir: string): string | null {
  const at = (d: string) => (dir ? `${dir}/${d}` : d);
  for (const d of ['dist', 'build', 'out', 'dist/client', '.output/public'])
    if (files.has(`${at(d)}/index.html`)) return at(d);
  return null;
}

export interface ProfileExtra {
  /** package.json of folders inside the project (monorepo apps), by folder. */
  nested?: Record<string, string>;
  /** HTML files that are only a bundler's entry point (see isBundlerEntry). */
  entries?: Set<string>;
}

/**
 * What kind of project is open, from package.json and its files (like the Run panel does),
 * and so how the panel can show and edit it.
 */
export function detectProfile(
  files: string[],
  pkgJson: string | null,
  extra: ProfileExtra = {},
): ProjectProfile {
  const all = new Set(files);
  const appOf = (dir: string, f: Framework): DesignApp => ({
    dir,
    ...f,
    built: f.kind === 'desktop' ? null : builtDir(all, dir),
  });
  const root = frameworkOf(pkgJson);
  const nested = Object.entries(extra.nested ?? {})
    .map(([dir, json]) => {
      const f = frameworkOf(json);
      return f ? appOf(dir, f) : null;
    })
    .filter((a): a is DesignApp => a !== null)
    .sort((a, b) => a.dir.split('/').length - b.dir.split('/').length || a.dir.localeCompare(b.dir));
  const web = (a: DesignApp) => a.kind !== 'desktop';

  if (root) {
    const app = appOf('', root);
    const apps = [app, ...nested].filter(web);
    return { kind: root.kind, label: root.label, editable: false, devUrl: root.devUrl ?? undefined, pages: [], apps };
  }

  // Pages inside an app of a monorepo belong to that app (its entry or its public/ folder).
  const appDirs = nested.map((a) => `${a.dir}/`);
  const pages = htmlPages(files).filter(
    (p) => !extra.entries?.has(p.file) && !appDirs.some((d) => p.file.startsWith(d)),
  );
  const apps = nested.filter(web);
  if (pages.length)
    return { kind: 'html', label: 'Página web (HTML)', editable: true, pages, apps };
  const first = apps[0] ?? nested[0];
  if (first)
    return {
      kind: first.kind,
      label: first.label,
      editable: false,
      devUrl: first.devUrl ?? undefined,
      pages: [],
      apps,
    };
  return { kind: 'unknown', label: 'Proyecto', editable: false, pages: [], apps: [] };
}
