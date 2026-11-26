import type { ChatMode } from '../../../shared/agentModes';
import type { MentionKind } from '../../../shared/mentions';
import { commands } from '../../commands';
import { formatUsd } from '../../format';
import { lang, t } from '../../i18n';
import { ps } from '../PhasesPanel';
import type { Part, Turn } from './types';

/** What the AI reads instead of the compacted messages. */
export function compactedHistory(
  summary: string,
): { role: 'user' | 'assistant'; content: string }[] {
  return [
    { role: 'user', content: `${t('chatCompactPreface')}\n\n${summary}` },
    { role: 'assistant', content: t('chatCompactAck') },
  ];
}

/** An image pasted, dropped or picked for the next message. */
export interface PendingImage {
  mediaType: string;
  /** base64, without the data: prefix */
  data: string;
  name: string;
}
export const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
export const MAX_CHAT_IMAGES = 6;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function readImage(file: File): Promise<PendingImage> {
  return new Promise((ok, fail) => {
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result);
      const i = url.indexOf(',');
      ok({ mediaType: file.type, data: url.slice(i + 1), name: file.name || t('chatImageName') });
    };
    r.onerror = () => fail(r.error ?? new Error('read failed'));
    r.readAsDataURL(file);
  });
}

let turnSeq = 0;
/** A new message id (unique in this window; saved conversations get theirs when loaded). */
export function newTurnId(): string {
  return `t${Date.now().toString(36)}-${(turnSeq++).toString(36)}`;
}

/** "/" commands of the message box: a ready-made prompt (or an action). */
export interface Slash {
  /** Spanish name (also accepted when the interface is in English). */
  name: string;
  /** English name (also accepted when the interface is in Spanish). */
  en: string;
  hint: string;
  prompt?: string;
  agent?: boolean;
  action?: 'new' | 'agent' | 'chat' | 'plan' | 'rules' | 'commit' | 'docs' | 'phases' | 'compact';
}
export function slashCommands(): Slash[] {
  return [
    { name: 'explicar', en: 'explain', hint: t('slashExplain'), prompt: t('slashExplainPrompt') },
    { name: 'revisar', en: 'review', hint: t('slashReview'), prompt: t('slashReviewPrompt') },
    { name: 'arreglar', en: 'fix', hint: t('slashFix'), prompt: t('slashFixPrompt'), agent: true },
    {
      name: 'pruebas',
      en: 'tests',
      hint: t('slashTests'),
      prompt: t('slashTestsPrompt'),
      agent: true,
    },
    { name: 'docs', en: 'docs', hint: t('slashDocs'), prompt: t('slashDocsPrompt') },
    {
      name: 'optimizar',
      en: 'optimize',
      hint: t('slashOptimize'),
      prompt: t('slashOptimizePrompt'),
    },
    {
      name: 'seguridad',
      en: 'security',
      hint: t('slashSecurity'),
      prompt: t('slashSecurityPrompt'),
    },
    { name: 'commit', en: 'commit', hint: t('slashCommit'), action: 'commit' },
    { name: 'reglas', en: 'rules', hint: t('rulesEdit'), action: 'rules' },
    { name: 'init', en: 'init', hint: t('slashInit'), prompt: t('slashInitPrompt'), agent: true },
    { name: 'agente', en: 'agent', hint: t('slashAgent'), action: 'agent' },
    { name: 'plan', en: 'plan', hint: t('slashPlan'), action: 'plan' },
    { name: 'fases', en: 'phases', hint: ps().menu, action: 'phases' },
    { name: 'chat', en: 'chat', hint: t('slashChat'), action: 'chat' },
    { name: 'nuevo', en: 'new', hint: t('newChat'), action: 'new' },
    { name: 'compactar', en: 'compact', hint: t('chatCompact'), action: 'compact' },
    { name: 'indexar', en: 'index', hint: t('slashIndexDocs'), action: 'docs' },
  ];
}

/** Why a project rule entered the prompt, for the rules menu. */
export function ruleReason(reason: string): string {
  if (reason === 'always') return t('rulesWhyAlways');
  if (reason === 'folder') return t('rulesWhyFolder');
  if (reason === 'mention') return t('rulesWhyMention');
  return t('rulesWhyGlob', { glob: reason });
}

/** Name of a "/" command in the interface language (the other one also works). */
export function slashName(c: Slash): string {
  return lang === 'en' ? c.en : c.name;
}

/** The "/" command typed, in either language. */
export function findSlash(name: string): Slash | undefined {
  const n = name.toLowerCase();
  return slashCommands().find((c) => c.name === n || c.en === n);
}

/** Workspace files mentioned as "@path" in a prompt (only paths that exist). */
export function mentionedFiles(prompt: string, files: string[]): string[] {
  const known = new Set(files);
  const out: string[] = [];
  for (const m of prompt.matchAll(/(^|\s)@([^\s@]+)/g)) {
    const p = m[2]!.replace(/[.,;:!?)]+$/, '');
    if (known.has(p) && !out.includes(p)) out.push(p);
  }
  return out.slice(0, 12);
}

/** i18n key of each special mention's hint in the "@" menu. */
export const MENTION_HINT = {
  git: 'mentionGit',
  terminal: 'mentionTerminal',
  problems: 'mentionProblems',
  web: 'mentionWeb',
  docs: 'mentionDocs',
} as const satisfies Record<MentionKind, string>;

export interface Suggest {
  kind: 'slash' | 'file';
  /** Text range of the input being completed. */
  from: number;
  to: number;
  /** `insert`: text put in the box instead of "@id " (e.g. "@web:" waits for the address). */
  items: { id: string; label: string; hint?: string; insert?: string; special?: boolean }[];
  index: number;
}

export const LAST_KEY = 'zs.lastConversation';
/** Most recent messages sent as history (main rejects more than 500). */
export const MAX_HISTORY = 400;
export function remember(id: string | undefined): void {
  try {
    if (id) localStorage.setItem(LAST_KEY, id);
    else localStorage.removeItem(LAST_KEY);
  } catch {
    // storage unavailable: the conversation is still saved, just not reopened automatically
  }
}

export interface SavedDisplay {
  parts?: Part[];
  model?: string;
  reasoning?: string;
  notices?: string[];
  meta?: { usd: number | null; inputTokens: number; outputTokens: number; latencyMs: number };
  error?: string;
  context?: string[];
  request?: string;
  /** Fase 3: the agent mode the answer ran in. */
  mode?: ChatMode;
}

/**
 * Puts every answer right after its question: answers sent alongside are saved in the order
 * they ended (q1, q2, a2, a1), and are shown as q1, a1, q2, a2.
 */
export function pairTurns(turns: Turn[]): Turn[] {
  const answers = new Map<string, Turn>();
  const asked = new Set<string>();
  for (const x of turns) {
    if (!x.rid) continue;
    if (x.role === 'assistant') answers.set(x.rid, x);
    else asked.add(x.rid);
  }
  const out: Turn[] = [];
  for (const x of turns) {
    // An answer goes under its question (placed there below).
    if (x.role === 'assistant' && x.rid && asked.has(x.rid)) continue;
    out.push(x);
    const a = x.role === 'user' && x.rid ? answers.get(x.rid) : undefined;
    if (a) out.push(a);
  }
  return out;
}

export function metaLine(m: {
  usd: number | null;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}): string {
  return `${m.inputTokens}→${m.outputTokens} ${t('chatTokens')} · ${fmtUsd(m.usd)} · ${(m.latencyMs / 1000).toFixed(1)}s`;
}

export function fmtUsd(n: number | null): string {
  return n === null ? '–' : formatUsd(n);
}

/** Shortcut of a command as shown in the menus (the user's own one if changed; ⌘ on macOS). */
export function shortcutOf(id: string): string {
  return commands().find((c) => c.id === id)?.keys ?? '';
}

export type ReasoningLevel = 'low' | 'medium' | 'high';
export const REASONING_KEY = 'zinarix.reasoning';
export const loadReasoning = (): ReasoningLevel | '' => {
  const v = localStorage.getItem(REASONING_KEY);
  return v === 'low' || v === 'medium' || v === 'high' ? v : '';
};

/** "Ahorrador de tokens": one switch for every chat, kept between sessions. */
export const SAVER_KEY = 'zinarix.tokenSaver';
export const loadSaver = (): boolean => localStorage.getItem(SAVER_KEY) === '1';
export const saveSaver = (on: boolean): void => {
  if (on) localStorage.setItem(SAVER_KEY, '1');
  else localStorage.removeItem(SAVER_KEY);
};

/** Turns "Compactar chat" sums up: not compacted yet, answered, with text (summaries too). */
export function compactable(turns: Turn[], running: ReadonlyMap<string, unknown>): Turn[] {
  return turns.filter(
    (x) =>
      !x.compacted && !x.error && !(x.rid && running.has(x.rid)) && (x.summary || x.content.trim()),
  );
}
