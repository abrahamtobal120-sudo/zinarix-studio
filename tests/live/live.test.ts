/**
 * Phase 1 acceptance against REAL providers. Opt-in, never runs in CI by default:
 *
 *   OMNI_LIVE_TESTS=1 ANTHROPIC_API_KEY=… OPENAI_API_KEY=… GROQ_API_KEY=… pnpm test tests/live
 *
 * Each provider with a key in the environment must: list real models, and stream a reply.
 * Pick the model per provider with OMNI_LIVE_<ID>=<model> (otherwise the first catalog model).
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OmniCore, envVarNames } from '@omni/core';

const enabled = process.env.OMNI_LIVE_TESTS === '1';
const core = enabled
  ? OmniCore.open({
      home: mkdtempSync(join(tmpdir(), 'omni-live-')),
      env: { ...process.env, OMNI_NO_KEYCHAIN: '1' },
    })
  : undefined;
const targets = core
  ? core
      .providers()
      .filter((p) => p.status === 'active' && envVarNames(p).some((v) => process.env[v]))
  : [];

describe.skipIf(!enabled)('live providers', () => {
  it('has keys for at least 3 providers', () => {
    expect(targets.map((p) => p.id).length).toBeGreaterThanOrEqual(3);
  });

  for (const p of targets) {
    it(`${p.id}: lists models and streams`, async () => {
      const cfg = await core!.providerConfig(p.id);
      const listed = await core!.models.list(cfg, { refresh: true });
      expect(listed.error).toBeUndefined();
      expect(listed.models.length).toBeGreaterThan(0);
      const model =
        process.env[`OMNI_LIVE_${p.id.toUpperCase().replace(/-/g, '_')}`] ??
        p.fallbackModels[0]?.id ??
        listed.models.find((m) => m.kind === 'chat')!.id;
      let text = '';
      let chunks = 0;
      for await (const ev of core!.stream(
        {
          model: `${p.id}/${model}`,
          messages: [{ role: 'user', content: 'Reply with the single word: pong' }],
          maxTokens: 2000,
          noFallback: true,
        },
        new AbortController().signal,
      )) {
        if (ev.type === 'text') {
          text += ev.delta;
          chunks++;
        }
      }
      expect(text.toLowerCase()).toContain('pong');
      expect(chunks).toBeGreaterThan(0);
    }, 120_000);
  }
});
