import { formatEstimate } from './mediaGen.js';
import type { GenEstimate, GenKind } from './mediaGen.js';

/**
 * Fase 10B: the generation plan of an agent task ("video + voz"), its total cost and the
 * spending caps. Pure: the media tools and the tests use it.
 *
 * - The agent shows a plan with every step and its cost and the user approves it once.
 * - A later generate_* call that matches a step of the approved plan runs without asking
 *   again; one that is not in the plan asks.
 * - A model without a published price always asks on its own (its cost is not estimated).
 * - Over the cap (per conversation, per day) the agent stops and asks before spending.
 */
export interface GenPlanStep {
  tool: string;
  kind: GenKind;
  provider: string;
  model: string;
  /** "OpenAI · GPT Image 2" for the card. */
  label: string;
  /** Prompt, or the text to read aloud. */
  prompt: string;
  estimate: GenEstimate;
  /** Matches the later tool call (see stepKey). */
  key: string;
  /** The result goes onto the timeline (generate_* with insert: true). */
  insert: boolean;
}

export interface GenTotal {
  /** null when at least one step has no estimated cost: never shown as 0. */
  usd: number | null;
  /** Sum of the steps that do have a cost. */
  knownUsd: number;
  unknownSteps: number;
  approximate: boolean;
}

export function planTotal(steps: readonly Pick<GenPlanStep, 'estimate'>[]): GenTotal {
  let knownUsd = 0;
  let unknownSteps = 0;
  let approximate = false;
  for (const s of steps) {
    if (s.estimate.usd === null) unknownSteps++;
    else knownUsd += s.estimate.usd;
    approximate ||= s.estimate.approximate;
  }
  return { usd: unknownSteps ? null : knownUsd, knownUsd, unknownSteps, approximate };
}

const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();

/** What identifies a step: the tool, the model and the text (spacing and case aside). */
export function stepKey(tool: string, provider: string, model: string, prompt: string): string {
  return `${tool}|${provider}/${model}|${norm(prompt)}`;
}

export interface SpendCaps {
  conversationUsd: number;
  dayUsd: number;
}

export interface SpendSoFar {
  conversationUsd: number;
  todayUsd: number;
}

export type CapCheck =
  | { ok: true }
  | { ok: false; which: 'conversation' | 'day'; limit: number; spent: number; adding: number };

/** Whether spending `adding` more USD stays within both caps. */
export function checkCap(spent: SpendSoFar, caps: SpendCaps, adding: number): CapCheck {
  const eps = 1e-9;
  if (spent.conversationUsd + adding > caps.conversationUsd + eps)
    return {
      ok: false,
      which: 'conversation',
      limit: caps.conversationUsd,
      spent: spent.conversationUsd,
      adding,
    };
  if (spent.todayUsd + adding > caps.dayUsd + eps)
    return { ok: false, which: 'day', limit: caps.dayUsd, spent: spent.todayUsd, adding };
  return { ok: true };
}

export type Gate =
  | { ask: false; reason: 'plan' }
  | { ask: true; reason: 'not_in_plan' | 'no_price' }
  | { ask: true; reason: 'over_cap'; cap: Extract<CapCheck, { ok: false }> };

/** Whether one generation needs its own approval (and why). */
export function gateGeneration(o: {
  planned: boolean;
  estimate: GenEstimate;
  spent: SpendSoFar;
  caps: SpendCaps;
}): Gate {
  if (o.estimate.usd === null) return { ask: true, reason: 'no_price' };
  const cap = checkCap(o.spent, o.caps, o.estimate.usd);
  if (!cap.ok) return { ask: true, reason: 'over_cap', cap };
  if (!o.planned) return { ask: true, reason: 'not_in_plan' };
  return { ask: false, reason: 'plan' };
}

/** An approved plan of one conversation: which steps were already generated. */
export interface ApprovedPlan {
  steps: { key: string; done: boolean; priced: boolean }[];
  at: number;
}

export function approvePlan(steps: readonly GenPlanStep[], at = Date.now()): ApprovedPlan {
  return {
    steps: steps.map((s) => ({ key: s.key, done: false, priced: s.estimate.usd !== null })),
    at,
  };
}

/** The first pending step with this key (-1 = not in the plan). */
export function planIndex(plan: ApprovedPlan | undefined, key: string): number {
  return plan ? plan.steps.findIndex((s) => !s.done && s.key === key) : -1;
}

export function markDone(plan: ApprovedPlan, key: string): ApprovedPlan {
  const i = planIndex(plan, key);
  if (i < 0) return plan;
  return { ...plan, steps: plan.steps.map((s, j) => (j === i ? { ...s, done: true } : s)) };
}

const usd = (n: number) => `${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)} USD`;

/** "2.00 USD por conversación: llevas 1.95 USD y esto suma 0.12 USD." */
export function capText(c: Extract<CapCheck, { ok: false }>, lang: 'es' | 'en' = 'es'): string {
  return lang === 'en'
    ? `This goes over the spending cap of ${usd(c.limit)} per ${c.which === 'conversation' ? 'conversation' : 'day'}: spent ${usd(c.spent)}, this adds ${usd(c.adding)}.`
    : `Esto pasa el tope de gasto de ${usd(c.limit)} por ${c.which === 'conversation' ? 'conversación' : 'día'}: llevas ${usd(c.spent)} y esto suma ${usd(c.adding)}.`;
}

/** Total for the card: "$0.068", "~$0.07", or "costo no estimado (+ $0.05 de lo que sí)". */
export function formatTotal(t: GenTotal, lang: 'es' | 'en' = 'es'): string {
  if (t.usd !== null)
    return formatEstimate({ usd: t.usd, approximate: t.approximate, detail: '' }, lang);
  const unk = lang === 'en' ? 'cost not estimated' : 'costo no estimado';
  if (!t.knownUsd) return unk;
  const known = formatEstimate({ usd: t.knownUsd, approximate: t.approximate, detail: '' }, lang);
  return lang === 'en'
    ? `${unk} (${known} for the steps with a price + ${t.unknownSteps} without)`
    : `${unk} (${known} de los pasos con precio + ${t.unknownSteps} sin precio)`;
}

/** The plan as numbered lines for the approval card. */
export function planLines(steps: readonly GenPlanStep[], lang: 'es' | 'en' = 'es'): string[] {
  return steps.map(
    (s, i) =>
      `${i + 1}. ${s.label}: "${s.prompt.length > 80 ? `${s.prompt.slice(0, 79)}…` : s.prompt}" — ${formatEstimate(s.estimate, lang)}${s.insert ? (lang === 'en' ? ' → timeline' : ' → línea de tiempo') : ''}`,
  );
}
