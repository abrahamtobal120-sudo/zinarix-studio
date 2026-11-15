import type { DesignKind, DesignPage } from '../../shared/design.js';

export interface ProjectProfile {
  kind: DesignKind;
  label: string;
  /** Edits made in the panel can be written to the files (plain HTML for now). */
  editable: boolean;
  /** Address of the dev server the project usually runs on. */
  devUrl?: string;
  pages: DesignPage[];
}

/** Folders whose HTML is never a page of the site (build output, dependencies, tooling). */
const SKIP = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.svelte-kit|coverage|vendor|\.git|\.zinarix)\//;

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
export function htmlPages(files: string[]): DesignPage[] {
  return files
    .filter((f) => /\.html?$/i.test(f) && !SKIP.test(`${f}`) && !/(^|\/)\./.test(f))
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

/**
 * What kind of project is open, from package.json and its files (like the Run panel does),
 * and so how the panel can show and edit it.
 */
export function detectProfile(files: string[], pkgJson: string | null): ProjectProfile {
  let deps: Record<string, string> = {};
  if (pkgJson) {
    try {
      const pkg = JSON.parse(pkgJson) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      deps = { ...pkg.dependencies, ...pkg.devDependencies };
    } catch {
      // a broken package.json: treated as no package.json
    }
  }
  const has = (d: string) => d in deps;
  const pages = htmlPages(files);
  const fw = (kind: DesignKind, label: string, devUrl: string): ProjectProfile => ({
    kind,
    label,
    editable: false,
    devUrl,
    pages: [],
  });
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
  if (pages.length) return { kind: 'html', label: 'Página web (HTML)', editable: true, pages };
  return { kind: 'unknown', label: 'Proyecto', editable: false, pages: [] };
}
