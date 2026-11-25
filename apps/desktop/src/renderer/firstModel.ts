import type { ModelInfo } from '@omni/shared';

/**
 * The model to start with when a local runtime (Ollama, LM Studio…) was just detected and the
 * user has not chosen any model yet: without it the chat says "choose a model" although one is
 * ready to use. Among the models of the detected providers: one that can use tools first (the
 * chat opens in agent mode), then the largest context window, then the order of the list.
 */
export function firstRunModel(models: ModelInfo[], detected: string[]): string | null {
  const own = models.filter((m) => detected.includes(m.provider) && m.kind === 'chat');
  if (!own.length) return null;
  const rank = (m: ModelInfo) => (m.capabilities.tools === false ? 0 : 1);
  const best = own.reduce((a, b) => {
    if (rank(b) !== rank(a)) return rank(b) > rank(a) ? b : a;
    return (b.context ?? 0) > (a.context ?? 0) ? b : a;
  });
  return `${best.provider}/${best.id}`;
}
