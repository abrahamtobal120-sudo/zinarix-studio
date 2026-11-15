import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import { MEDIA_MODELS, estimateMediaCost, findMediaModel, getMediaProvider } from '@omni/providers';
import type { MediaModel } from '@omni/providers';
import { genFileName, genRequestIssue } from '../shared/mediaGen.js';
import type {
  GenEstimate,
  GenEvent,
  GenModelView,
  GenRequest,
  GenResult,
} from '../shared/mediaGen.js';

/**
 * Fase 10: generates images, video and speech with the providers the user connected and saves
 * the files to `<project>/media/generated` (or to the app data folder when no folder is open).
 * The Generate panel imports them into the video Media Library; the agent tools get the paths.
 */
export class MediaService {
  private running = new Map<string, AbortController>();

  constructor(
    private core: OmniCore,
    private userData: string,
  ) {}

  private view(m: MediaModel, connected: Set<string>): GenModelView {
    let providerName = m.provider;
    try {
      providerName = this.core.provider(m.provider).name;
    } catch {
      /* provider missing from the catalog: keep the id */
    }
    return {
      provider: m.provider,
      providerName,
      id: m.id,
      label: m.label,
      kind: m.kind,
      connected: connected.has(m.provider),
      priced: m.price !== null,
      ...(m.aspects ? { aspects: [...m.aspects] } : {}),
      ...(m.duration ? { duration: { ...m.duration } } : {}),
      ...(m.voices ? { voices: [...m.voices] } : {}),
      ...(m.maxCount ? { maxCount: m.maxCount } : {}),
      ...(m.qualities ? { qualities: [...m.qualities] } : {}),
      ...(m.transparent ? { transparent: true } : {}),
      ...(m.note ? { note: m.note } : {}),
      source: m.source,
      verifiedAt: m.verifiedAt,
    };
  }

  async models(): Promise<GenModelView[]> {
    const connected = new Set((await this.core.connectedProviders()).map((p) => p.id));
    return MEDIA_MODELS.map((m) => this.view(m, connected));
  }

  async model(provider: string, id: string): Promise<GenModelView | undefined> {
    const m = findMediaModel(provider, id);
    if (!m) return undefined;
    const connected = new Set((await this.core.connectedProviders()).map((p) => p.id));
    return this.view(m, connected);
  }

  estimate(req: GenRequest): GenEstimate {
    return estimateMediaCost(findMediaModel(req.provider, req.model), req);
  }

  outDir(workspaceRoot: string | undefined): string {
    return workspaceRoot
      ? join(workspaceRoot, 'media', 'generated')
      : join(this.userData, 'generated-media');
  }

  /** Runs one generation; `id` lets abort() stop it. Errors come back as an 'error' event. */
  async generate(
    id: string,
    req: GenRequest,
    workspaceRoot: string | undefined,
    emit: (e: GenEvent) => void = () => {},
    outer?: AbortSignal,
  ): Promise<GenResult> {
    const issue = genRequestIssue(req, await this.model(req.provider, req.model));
    if (issue) {
      emit({ type: 'error', message: issue });
      throw new Error(issue);
    }
    const ac = new AbortController();
    const stop = () => ac.abort();
    outer?.addEventListener('abort', stop, { once: true });
    this.running.set(id, ac);
    const started = Date.now();
    try {
      const cfg = await this.core.providerConfig(req.provider);
      const r = await getMediaProvider(req.provider).generate(cfg, req, ac.signal, (p) =>
        emit({ type: 'progress', ...p }),
      );
      const dir = this.outDir(workspaceRoot);
      await mkdir(dir, { recursive: true });
      const at = new Date();
      const paths: string[] = [];
      for (const [i, f] of r.files.entries()) {
        const path = join(dir, genFileName(req.kind, req.prompt, f.ext, i, at));
        await writeFile(path, f.data);
        paths.push(path);
      }
      const result: GenResult = {
        paths,
        warnings: r.warnings,
        estimate: this.estimate(req),
        ms: Date.now() - started,
      };
      emit({ type: 'done', result });
      return result;
    } catch (e) {
      const message = ac.signal.aborted ? 'Cancelado.' : e instanceof Error ? e.message : String(e);
      emit({ type: 'error', message });
      throw e instanceof Error ? e : new Error(message);
    } finally {
      outer?.removeEventListener('abort', stop);
      this.running.delete(id);
    }
  }

  abort(id: string): void {
    this.running.get(id)?.abort();
  }
}
