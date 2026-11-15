/**
 * Build (Phase 9): creates the folder of a new app, keeps its .zinarix/build.json and
 * deploys its files to Vercel. The agent writes the app (through a normal chat in
 * auto-approve mode); the Design panel previews it.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import type { BuildDeployView, BuildInfo, BuildView } from '../shared/build.js';
import {
  BUILD_FILE,
  BUILD_RULES,
  DEPLOY_MAX_BYTES,
  DEPLOY_MAX_FILES,
  deployable,
  freeName,
  slugify,
  starterHtml,
  vercelName,
} from '../shared/build.js';
import type { Vercel } from './vercel.js';

const RECENT_MAX = 20;

export class BuildService {
  private readonly recentFile: string;

  constructor(
    dir: string,
    private readonly vercel: () => Vercel,
  ) {
    this.recentFile = join(dir, 'build-recent.json');
  }

  /** Creates <parent>/<slug> with the Build rules and a placeholder page. Returns its path. */
  create(parent: string, description: string): BuildView {
    const desc = description.trim();
    if (desc.length < 4) throw new Error('Describe la app con un poco más de detalle.');
    const base = resolve(parent);
    mkdirSync(base, { recursive: true });
    const name = freeName(slugify(desc), (n) => existsSync(join(base, n)));
    const root = join(base, name);
    mkdirSync(join(root, '.zinarix'), { recursive: true });
    writeFileSync(join(root, '.zinarix', 'rules.md'), BUILD_RULES);
    writeFileSync(join(root, 'index.html'), starterHtml(desc.split('\n')[0]!.slice(0, 80)));
    const info: BuildInfo = {
      description: desc,
      createdAt: Date.now(),
      projectName: vercelName(name),
    };
    this.writeInfo(root, info);
    this.remember(root);
    return { ...info, root };
  }

  /** The Build data of a folder, or null when it was not made with Build. */
  info(root: string): BuildView | null {
    try {
      const j = JSON.parse(readFileSync(join(root, BUILD_FILE), 'utf8')) as Partial<BuildInfo>;
      if (typeof j.description !== 'string' || typeof j.projectName !== 'string') return null;
      return {
        root,
        description: j.description,
        createdAt: typeof j.createdAt === 'number' ? j.createdAt : 0,
        projectName: vercelName(j.projectName),
        ...(j.lastDeploy && typeof j.lastDeploy.url === 'string'
          ? { lastDeploy: j.lastDeploy }
          : {}),
      };
    } catch {
      return null;
    }
  }

  /** Recently built apps that still exist, newest first. */
  recent(): BuildView[] {
    let list: string[] = [];
    try {
      const raw = JSON.parse(readFileSync(this.recentFile, 'utf8')) as unknown;
      if (Array.isArray(raw)) list = raw.filter((x): x is string => typeof x === 'string');
    } catch {
      /* none yet */
    }
    return list.map((r) => this.info(r)).filter((x): x is BuildView => x !== null);
  }

  private remember(root: string): void {
    const list = [
      root,
      ...this.recent()
        .map((b) => b.root)
        .filter((r) => r !== root),
    ];
    mkdirSync(join(this.recentFile, '..'), { recursive: true });
    writeFileSync(this.recentFile, JSON.stringify(list.slice(0, RECENT_MAX)));
  }

  private writeInfo(root: string, info: BuildInfo): void {
    mkdirSync(join(root, '.zinarix'), { recursive: true });
    writeFileSync(join(root, BUILD_FILE), JSON.stringify(info, null, 2));
  }

  /** Publishes the folder's files to Vercel as a static site. */
  async deploy(root: string, teamId: string | null, production: boolean): Promise<BuildDeployView> {
    const info = this.info(root);
    if (!info) throw new Error('Esta carpeta no se creó con Build.');
    const files = collectFiles(root);
    if (!files.some((f) => f.file === 'index.html'))
      throw new Error('Falta index.html en la raíz de la app.');
    const d = await this.vercel().deployFiles(info.projectName, files, teamId, production);
    const { root: _root, ...saved } = info;
    void _root;
    this.writeInfo(root, {
      ...saved,
      lastDeploy: { id: d.id, url: d.url, at: Date.now(), production },
    });
    return { id: d.id, url: d.url, state: d.state };
  }

  deployState(id: string, teamId: string | null): Promise<string> {
    return this.vercel().deploymentState(id, teamId);
  }
}

/** The files Build publishes: everything but hidden files, node_modules and symlinks. */
export function collectFiles(root: string): { file: string; data: Buffer }[] {
  const out: { file: string; data: Buffer }[] = [];
  let bytes = 0;
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      const rel = relative(root, abs).split(sep).join('/');
      if (!deployable(rel)) continue;
      const st = lstatSync(abs);
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) walk(abs);
      else if (st.isFile()) {
        if (out.length >= DEPLOY_MAX_FILES)
          throw new Error(`La app tiene más de ${DEPLOY_MAX_FILES} archivos.`);
        bytes += st.size;
        if (bytes > DEPLOY_MAX_BYTES) throw new Error('La app pesa más de 100 MB.');
        out.push({ file: rel, data: readFileSync(abs) });
      }
    }
  };
  walk(root);
  return out;
}
