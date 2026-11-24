/** Fase 10: shared helpers of media generation and the agent tools' approval card. */
import { describe, expect, it } from 'vitest';
import { formatEstimate, genFileName, genRequestIssue, slugify } from '../src/shared/mediaGen';
import type { GenModelView, GenRequest } from '../src/shared/mediaGen';
import { MEDIA_TOOL_NAMES, mediaPreview, mediaRequest } from '../src/main/mediaTools';
import type { MediaService } from '../src/main/media';

const IMG: GenModelView = {
  provider: 'openai',
  providerName: 'OpenAI',
  id: 'gpt-image-2',
  label: 'GPT Image 2',
  kind: 'image',
  connected: true,
  priced: true,
  maxCount: 4,
  source: 'https://example.com',
  verifiedAt: '2026-11-15',
};
const VIDEO: GenModelView = {
  ...IMG,
  provider: 'google-gemini',
  providerName: 'Google',
  id: 'gemini-omni-1.2-flash',
  label: 'Omni',
  kind: 'video',
  priced: false,
};
const TTS_OFF: GenModelView = {
  ...IMG,
  id: 'tts-1',
  label: 'TTS-1',
  kind: 'speech',
  connected: false,
};

function fakeMedia(models: GenModelView[]): MediaService {
  return {
    models: async () => models,
    estimate: (req: GenRequest) =>
      req.model === 'gpt-image-2'
        ? {
            usd: 0.053 * (req.count ?? 1),
            approximate: false,
            detail: `${req.count ?? 1} × $0.053`,
          }
        : { usd: null, approximate: false, detail: 'precio no publicado' },
  } as unknown as MediaService;
}

describe('mediaGen helpers', () => {
  it('slugifies accents and symbols', () => {
    expect(slugify('Un faro en la tormenta ¡ya!')).toBe('un-faro-en-la-tormenta-ya');
    expect(slugify('Ñandú')).toBe('nandu');
    expect(slugify('***')).toBe('medio');
    expect(slugify('a'.repeat(80)).length).toBeLessThanOrEqual(40);
  });

  it('names files by kind, time and index, with a safe extension', () => {
    const at = new Date(2026, 10, 15, 17, 4, 9);
    expect(genFileName('image', 'Un faro', 'png', 0, at)).toBe('image-20261115-170409-un-faro.png');
    expect(genFileName('image', 'Un faro', 'png', 1, at)).toBe(
      'image-20261115-170409-un-faro-2.png',
    );
    expect(genFileName('speech', 'x', '../evil', 0, at)).toMatch(/\.bin$/);
  });

  it('rejects impossible requests before spending', () => {
    const base: GenRequest = {
      kind: 'image',
      provider: 'openai',
      model: 'gpt-image-2',
      prompt: 'x',
    };
    expect(genRequestIssue(base, IMG)).toBeNull();
    expect(genRequestIssue({ ...base, prompt: '  ' }, IMG)).toMatch(/Describe/);
    expect(genRequestIssue(base, undefined)).toMatch(/no genera/);
    expect(genRequestIssue({ ...base, kind: 'video' }, IMG)).toMatch(/genera image/);
    expect(genRequestIssue(base, { ...IMG, connected: false })).toMatch(/Conecta OpenAI/);
  });

  it('formats estimates, with ~ when approximate', () => {
    expect(formatEstimate({ usd: 0.106, approximate: false, detail: '' })).toBe('$0.106');
    expect(formatEstimate({ usd: 0.00123, approximate: true, detail: '' })).toBe('~$0.0012');
    expect(formatEstimate({ usd: null, approximate: false, detail: '' })).toBe('costo no estimado');
  });
});

describe('media agent tools', () => {
  it('has the three tools of the plan', () => {
    expect([...MEDIA_TOOL_NAMES].sort()).toEqual([
      'generate_image',
      'generate_speech',
      'generate_video',
    ]);
  });

  it('picks a connected, priced model when none is asked', async () => {
    const r = await mediaRequest(fakeMedia([TTS_OFF, IMG, VIDEO]), 'generate_image', {
      prompt: 'x',
      count: 9,
      aspect: 'nope',
    });
    expect('req' in r && r.req).toMatchObject({
      provider: 'openai',
      model: 'gpt-image-2',
      count: 4,
    });
    expect('req' in r && r.req.aspect).toBeUndefined();
  });

  it('says what to connect when no model of that kind is', async () => {
    const r = await mediaRequest(fakeMedia([TTS_OFF]), 'generate_speech', { text: 'hola' });
    expect('error' in r && r.error).toMatch(/Settings → Providers/);
  });

  it('rejects an unknown model and lists the real ones', async () => {
    const r = await mediaRequest(fakeMedia([IMG]), 'generate_image', {
      prompt: 'x',
      model: 'openai/dall-e-9',
    });
    expect('error' in r && r.error).toMatch(/openai\/gpt-image-2/);
  });

  it('shows the cost in the approval and never offers "always"', async () => {
    const p = await mediaPreview(fakeMedia([IMG]), 'generate_image', {
      prompt: 'Un faro',
      count: 2,
    });
    expect(p.action).toBe('generar 2 imágenes con OpenAI · GPT Image 2');
    expect(p.warning).toContain('$0.106');
    expect(p.command).toBe('Un faro');
    expect(p.allowKey).toBeUndefined();
  });

  it('says when the price is unknown instead of guessing', async () => {
    const p = await mediaPreview(fakeMedia([VIDEO]), 'generate_video', {
      prompt: 'x',
      duration: 5,
    });
    expect(p.warning).toMatch(/no publica un precio/);
  });
});
