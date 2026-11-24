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
 * packaged apps, vendored code, and the template folders of other tools).
 */
const SKIP =
  /(^|\/)(node_modules|bower_components|jspm_packages|dist|build|out|release|release[-_][^/]*|[a-z0-9]+-unpacked|\.next|\.nuxt|\.svelte-kit|\.output|\.vercel|\.turbo|\.cache|\.angular|\.astro|storybook-static|coverage|vendor|vendors|third[_-]?party|external|externals|extern|target|\.venv|venv|__pycache__|\.git|\.zinarix|templates|_templates|partials|_partials|includes|_includes|layouts|_layouts|doxygen|_build|_site)\//;

/**
 * Documentation folders below the root (a vendored project's "blender/doc/…", "lib/docs/…")
 * hold templates and generated references, not the site. A root docs/ (GitHub Pages) stays.
 */
const NESTED_DOCS = /^[^/]+\/(?:.+\/)?(doc|docs)\//;

/** Folders where a web project usually keeps its site, searched first. */
const SITE_DIRS = /^(website|site|web|www|public|docs|src|static|html)\//;

/** Pages shown at most in the list (a big folder must not flood the panel). */
export const MAX_PAGES = 100;

/** Friendly name of a page from its file ("acerca-de.html" → "Acerca de"). */
export function pageName(file: string): string {
  const base = file
    .split('/')
    .pop()!
    .replace(/\.html?$/i, '');
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

/** True for the main page of a site: index.html at the root, in website/, public/, apps/x/… */
function isEntry(file: string): boolean {
  return /^(?:(?:website|site|web|www|public|docs|src|static|html)\/|(?:apps|packages|sites)\/[^/]+\/(?:public\/|src\/)?)?index\.html?$/i.test(
    file,
  );
}

/** Where the folder of a page usually sits: the root and site folders first. */
function group(file: string): number {
  if (!file.includes('/')) return 0;
  if (SITE_DIRS.test(file)) return 1;
  if (/^(apps|packages|sites)\//.test(file)) return 2;
  return 3;
}

/**
 * Pages of a plain HTML site, by their path alone: real entry pages first (index.html at
 * the root, website/, public/, apps/x/), then by folder and name; dependencies, build
 * output, vendored code and template folders are left out, the same address only once.
 */
export function htmlPages(files: string[], skip: RegExp = SKIP, limit = MAX_PAGES): DesignPage[] {
  const nestedDocs = skip === SKIP;
  const seen = new Set<string>();
  const out: DesignPage[] = [];
  const sorted = files
    .filter(
      (f) =>
        /\.html?$/i.test(f) &&
        !skip.test(f) &&
        !/(^|\/)\./.test(f) &&
        !(nestedDocs && NESTED_DOCS.test(f)) &&
        // "report.template.html", "nav.partial.html": pieces for other tools.
        !(nestedDocs && /\.(template|tpl|tmpl|partial)\.html?$/i.test(f)),
    )
    .sort((a, b) => {
      const ea = isEntry(a) ? 0 : 1;
      const eb = isEntry(b) ? 0 : 1;
      const da = a.split('/').length;
      const db = b.split('/').length;
      const ia = /(^|\/)index\.html?$/i.test(a) ? 0 : 1;
      const ib = /(^|\/)index\.html?$/i.test(b) ? 0 : 1;
      return ea - eb || group(a) - group(b) || da - db || ia - ib || a.localeCompare(b);
    });
  for (const file of sorted) {
    if (out.length >= limit) break;
    const path = pagePath(file);
    const key = path.replace(/\/$/, '').toLowerCase() || '/';
    if (seen.has(key)) continue; // about.html and about/index.html: one address
    seen.add(key);
    out.push({ file, path, name: pageName(file) });
  }
  return out;
}

/**
 * Why an HTML file is not a page to show and edit (null: it is one). Files of other tools
 * use template syntax ("{{ release }}", "{% block %}", "<% %>") that only shows as raw text,
 * and fragments (a footer, a partial) have no <html> or <body> of their own.
 */
export function pageProblem(html: string): 'template' | 'fragment' | null {
  if (/\{\{[\s\S]*?\}\}|\{%[\s\S]*?%\}|<%[\s\S]*?%>/.test(html)) return 'template';
  if (!/<html[\s>]|<body[\s>]/i.test(html)) return 'fragment';
  return null;
}

/**
 * Tells whether a project path is ignored by a .gitignore (its common patterns: names,
 * folders, globs with * ** ?, anchored /paths and !exceptions; the last match wins).
 */
export function gitignoreMatcher(text: string): (file: string) => boolean {
  const rules: { re: RegExp; neg: boolean }[] = [];
  const glob = (p: string) => {
    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i]!;
      if (c === '*' && p[i + 1] === '*') {
        // "**/" any folders (or none), a trailing "**" everything inside.
        if (p[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else if (c === '*') re += '[^/]*';
      else if (c === '?') re += '[^/]';
      else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return re;
  };
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('#')) continue;
    const neg = line.startsWith('!');
    if (neg) line = line.slice(1);
    const dirOnly = line.endsWith('/');
    line = line.replace(/\/+$/, '');
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    if (!line) continue;
    const head = anchored ? '^' : '(?:^|/)';
    // A folder pattern matches everything inside it; a name matches the file or a folder.
    const tail = dirOnly ? '/' : '(?:/|$)';
    try {
      rules.push({ re: new RegExp(head + glob(line) + tail), neg });
    } catch {
      /* a pattern we can't read: skipped */
    }
  }
  return (file) => {
    let ignored = false;
    for (const r of rules) if (r.re.test(file)) ignored = !r.neg;
    return ignored;
  };
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
  return (
    /<script\b[^>]*\btype\s*=\s*["']?module["']?[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\.(tsx?|jsx|vue|svelte)\b/i.test(
      html,
    ) ||
    /<script\b[^>]*\bsrc\s*=\s*["']?[^"'\s>]*\.(tsx?|jsx|vue|svelte)\b[^>]*\btype\s*=\s*["']?module/i.test(
      html,
    )
  );
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
  /** When given, only these HTML files can be pages (they were read and are real pages). */
  allowed?: Set<string>;
  /** Paths ignored by the project's .gitignore (never pages). */
  ignored?: (file: string) => boolean;
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
    .sort(
      (a, b) => a.dir.split('/').length - b.dir.split('/').length || a.dir.localeCompare(b.dir),
    );
  const web = (a: DesignApp) => a.kind !== 'desktop';

  if (root) {
    const app = appOf('', root);
    const apps = [app, ...nested].filter(web);
    return {
      kind: root.kind,
      label: root.label,
      editable: false,
      devUrl: root.devUrl ?? undefined,
      pages: [],
      apps,
    };
  }

  // Pages inside an app of a monorepo belong to that app (its entry or its public/ folder).
  const appDirs = nested.map((a) => `${a.dir}/`);
  const { ignored, allowed } = extra;
  const candidates = files.filter(
    (f) =>
      !(ignored && ignored(f)) &&
      !extra.entries?.has(f) &&
      (!allowed || allowed.has(f)) &&
      !appDirs.some((d) => f.startsWith(d)),
  );
  const pages = htmlPages(candidates);
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
