import type { ChatChunk, ChatMessage, ChatRequest, ModelInfo } from '@omni/shared';
import { request, requestJson } from '../http.js';
import { baseModel } from '../models.js';
import { parseSse, safeJson } from '../sse.js';
import type { ProviderAdapter, ProviderConfig } from '../types.js';
import { normalizeStop, testViaModelsOrChat } from './openai-compatible.js';

type Part = Record<string, unknown>;
interface Content {
  role: 'user' | 'model';
  parts: Part[];
}

const modelPath = (id: string) =>
  id.startsWith('models/') || id.startsWith('tunedModels/') ? id : `models/${id}`;

function parseArgs(json: string): unknown {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

export function toGemini(messages: ChatMessage[]): {
  systemInstruction?: { parts: Part[] };
  contents: Content[];
} {
  const system: string[] = [];
  const contents: Content[] = [];
  const toolNames = new Map<string, string>();
  const push = (role: Content['role'], parts: Part[]) => {
    if (!parts.length) return;
    const last = contents[contents.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else contents.push({ role, parts });
  };
  for (const m of messages) {
    switch (m.role) {
      case 'system':
        system.push(m.content);
        break;
      case 'user':
        push(
          'user',
          typeof m.content === 'string'
            ? [{ text: m.content }]
            : m.content.map((p) =>
                p.type === 'text'
                  ? { text: p.text }
                  : { inlineData: { mimeType: p.mediaType, data: p.data } },
              ),
        );
        break;
      case 'assistant':
        for (const c of m.toolCalls ?? []) toolNames.set(c.id, c.name);
        if (m.raw?.adapter === 'google-gemini' && Array.isArray(m.raw.content)) {
          push('model', m.raw.content as Part[]);
          break;
        }
        push('model', [
          ...(m.content ? [{ text: m.content }] : []),
          ...(m.toolCalls ?? []).map((c) => ({
            functionCall: { id: c.id, name: c.name, args: parseArgs(c.arguments) },
          })),
        ]);
        break;
      case 'tool':
        push('user', [
          {
            functionResponse: {
              // ids we synthesized (Gemini sent none) must not be echoed back
              ...(/^call_\d+$/.test(m.toolCallId) ? {} : { id: m.toolCallId }),
              name: m.name ?? toolNames.get(m.toolCallId) ?? 'tool',
              response: m.isError ? { error: m.content } : { content: m.content },
            },
          },
        ]);
        break;
    }
  }
  return {
    systemInstruction: system.length ? { parts: [{ text: system.join('\n\n') }] } : undefined,
    contents,
  };
}

interface GeminiChunk {
  candidates?: {
    content?: {
      parts?: {
        text?: string;
        thought?: boolean;
        functionCall?: { id?: string; name?: string; args?: unknown };
      }[];
    };
    finishReason?: string;
  }[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    cachedContentTokenCount?: number;
  };
  promptFeedback?: { blockReason?: string };
}

async function* chat(
  cfg: ProviderConfig,
  req: ChatRequest,
  signal: AbortSignal,
): AsyncGenerator<ChatChunk> {
  const { systemInstruction, contents } = toGemini(req.messages);
  const generationConfig: Record<string, unknown> = {
    ...(req.maxTokens ? { maxOutputTokens: req.maxTokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.jsonMode ? { responseMimeType: 'application/json' } : {}),
    ...(req.reasoning ? { thinkingConfig: { includeThoughts: true } } : {}),
  };
  const body = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
    ...(req.tools?.length
      ? {
          tools: [
            {
              functionDeclarations: req.tools.map((t) => ({
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              })),
            },
          ],
        }
      : {}),
  };
  const res = await request(cfg, {
    method: 'POST',
    path: `/${modelPath(req.model)}:streamGenerateContent`,
    query: { alt: 'sse' },
    body,
    signal,
  });

  let stop: string | undefined;
  let sawTool = false;
  let usage: GeminiChunk['usageMetadata'];
  let n = 0;
  // Every part as received (thought signatures included) for verbatim replay.
  const rawParts: Part[] = [];
  for await (const ev of parseSse(res.body, {
    signal,
    idleTimeoutMs: cfg.idleTimeoutMs,
    provider: cfg.entry.id,
  })) {
    const chunk = safeJson<GeminiChunk>(ev.data);
    if (!chunk) continue;
    if (chunk.promptFeedback?.blockReason) stop = 'refusal';
    const cand = chunk.candidates?.[0];
    for (const p of cand?.content?.parts ?? []) {
      rawParts.push(p as Part);
      if (p.functionCall) {
        sawTool = true;
        yield {
          type: 'tool_call',
          id: p.functionCall.id ?? `call_${n++}`,
          name: p.functionCall.name ?? '',
          argsDelta: JSON.stringify(p.functionCall.args ?? {}),
        };
      } else if (p.text) {
        yield p.thought ? { type: 'reasoning', delta: p.text } : { type: 'text', delta: p.text };
      }
    }
    if (cand?.finishReason) stop = cand.finishReason;
    if (chunk.usageMetadata) usage = chunk.usageMetadata;
  }
  if (usage) {
    yield {
      type: 'usage',
      inputTokens: usage.promptTokenCount ?? 0,
      outputTokens: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0),
      cachedTokens: usage.cachedContentTokenCount,
    };
  }
  if (rawParts.length) yield { type: 'raw', adapter: 'google-gemini', content: rawParts };
  yield { type: 'done', stopReason: sawTool ? 'tool_use' : normalizeStop(stop) };
}

interface GeminiModel {
  name: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  thinking?: boolean;
}

async function listModels(cfg: ProviderConfig, signal?: AbortSignal): Promise<ModelInfo[]> {
  const out: ModelInfo[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 20; page++) {
    const json = await requestJson<{ models?: GeminiModel[]; nextPageToken?: string }>(cfg, {
      path: '/models',
      query: { pageSize: '1000', ...(pageToken ? { pageToken } : {}) },
      signal,
    });
    for (const m of json.models ?? []) {
      const id = m.name.replace(/^models\//, '');
      const methods = m.supportedGenerationMethods ?? [];
      const isChat = methods.includes('generateContent');
      out.push(
        baseModel(cfg.entry, id, {
          label: m.displayName,
          context: m.inputTokenLimit,
          maxOutput: m.outputTokenLimit,
          kind: isChat
            ? undefined
            : methods.some((x) => x.startsWith('embed'))
              ? 'embedding'
              : 'other',
          capabilities: {
            tools: isChat ? true : false,
            vision: isChat ? true : false,
            reasoning: m.thinking ?? null,
            fim: false,
          },
        }),
      );
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return out;
}

export const googleGemini: ProviderAdapter = {
  id: 'google-gemini',
  listModels,
  chat,
  async embed(cfg, req, signal) {
    const json = await requestJson<{ embeddings?: { values: number[] }[] }>(cfg, {
      method: 'POST',
      path: `/${modelPath(req.model)}:batchEmbedContents`,
      body: {
        requests: req.input.map((text) => ({
          model: modelPath(req.model),
          content: { parts: [{ text }] },
        })),
      },
      signal,
    });
    return (json.embeddings ?? []).map((e) => e.values);
  },
  testConnection(cfg) {
    return testViaModelsOrChat(googleGemini, cfg);
  },
};
