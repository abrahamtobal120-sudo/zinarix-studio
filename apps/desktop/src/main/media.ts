import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { OmniCore } from '@omni/core';
import { MEDIA_MODELS, estimateMediaCost, findMediaModel, getMediaProvider } from '@omni/providers';
import type { MediaModel } from '@omni/providers';
import { genFileName, genRequestIssue } from '../shared/mediaGen.js';
import {
  LOCAL_VOICE_MODEL,
  LOCAL_VOICE_PROVIDER,
  localVoices,
  speakLocally,
} from './localVoice.js';

const isLocalVoice = (provider: string, id: string) =>
  provider === LOCAL_VOICE_PROVIDER && id === LOCAL_VOICE_MODEL;

/** The free voice of this computer, as a speech model of the Generate panel. */
async function localVoiceView(): Promise<GenModelView> {
  const v = await localVoices().catch(() => ({ available: false, voices: [] as string[] }));
  return {
    provider: LOCAL_VOICE_PROVIDER,
    providerName: 'Este equipo',
    id: LOCAL_VOICE_MODEL,
    label: 'Voz del sistema (gratis, sin internet)',
    kind: 'speech',
    connected: v.available,
    priced: true,
    local: true,
    ...(v.voices.length ? { voices: v.voices } : {}),
    note: v.available
      ? 'Usa las voces instaladas en tu computadora: no cuesta nada y el texto no sale de tu equipo. Para voces más naturales conecta OpenAI, Gemini o ElevenLabs.'
      : 'No se encontró un lector de voz en este equipo (en Linux instala espeak-ng).',
    source: 'local',
    verifiedAt: '2026-11-21',
  };
}
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
    // The free voice first: it is what the panel picks unless the user chooses a paid one.
    return [await localVoiceView(), ...MEDIA_MODELS.map((m) => this.view(m, connected))];
  }

  async model(provider: string, id: string): Promise<GenModelView | undefined> {
    if (isLocalVoice(provider, id)) return localVoiceView();
    const m = findMediaModel(provider, id);
    if (!m) return undefined;
    const connected = new Set((await this.core.connectedProviders()).map((p) => p.id));
    return this.view(m, connected);
  }

  estimate(req: GenRequest): GenEstimate {
    if (isLocalVoice(req.provider, req.model))
      return { usd: 0, approximate: false, detail: 'gratis, en este equipo' };
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
      const r = isLocalVoice(req.provider, req.model)
        ? await (async () => {
            emit({ type: 'progress', stage: 'waiting' });
            const data = await speakLocally(req.prompt, req.voice, ac.signal);
            return { files: [{ data, ext: 'wav' }], warnings: [] as string[] };
          })()
        : await getMediaProvider(req.provider).generate(
            await this.core.providerConfig(req.provider),
            req,
            ac.signal,
            (p) => emit({ type: 'progress', ...p }),
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
