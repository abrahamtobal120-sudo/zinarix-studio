/**
 * Modo Fases: the user writes the changes they want in a Markdown file, an AI reads it (and the
 * project) and splits it into phases and subphases, and then the chat runs one subphase per
 * message, in order, checking each one before going on. Pure: no Electron, no I/O.
 */

export type SubStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface Subphase {
  /** "1.2": phase 1, subphase 2. */
  id: string;
  title: string;
  /** What to do, concretely (files, changes, how it is checked). */
  detail: string;
  status: SubStatus;
  /** What the AI said it did (or why it failed). */
  summary?: string;
}

export interface Phase {
  id: string;
  title: string;
  goal?: string;
  subphases: Subphase[];
}

export interface PhasePlan {
  /** The Markdown file of the changes (relative to the project). */
  source: string;
  title: string;
  phases: Phase[];
  /** When it was made (ISO). */
  created: string;
}

export const MAX_PHASES = 20;
export const MAX_SUBPHASES = 25;
const MAX_TITLE = 200;
const MAX_DETAIL = 4000;
const MAX_SUMMARY = 1500;
/** The document is cut to this many characters inside the prompts. */
export const MAX_DOC = 60_000;

const clip = (s: unknown, n: number): string =>
  typeof s === 'string' ? s.replace(/\s+$/g, '').trim().slice(0, n) : '';

/** Where the progress of a plan is kept in the project. */
export function phasesStatePath(source: string): string {
  const slug =
    source
      .replace(/\\/g, '/')
      .replace(/\.(md|markdown|txt)$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120) || 'plan';
  return `.zinarix/fases/${slug}.json`;
}

export function isPhasesDoc(path: string): boolean {
  return /\.(md|markdown|txt)$/i.test(path);
}

// ---------------- analysis ----------------

const ANALYZE = {
  es: (
    path: string,
  ) => `MODO FASES. El archivo "${path}" (va adjunto) describe los cambios que quiero en este proyecto.
1. Léelo completo y revisa el proyecto lo necesario (archivos, estructura, cómo se prueba) para entender qué hay que tocar.
2. Divide TODO el trabajo en FASES (bloques grandes, en orden de dependencia) y cada fase en SUBFASES pequeñas: cada subfase debe poder hacerse en un solo turno de un agente y terminar en un estado que compila / funciona, con una forma concreta de verificarla.
3. No cambies nada todavía.
Responde con un resumen de 2 a 4 líneas y, al final, EXACTAMENTE un bloque \`\`\`json con esta forma (textos en español):
\`\`\`json
{"title": "nombre corto del plan", "phases": [{"title": "Fase…", "goal": "para qué sirve", "subphases": [{"title": "Subfase…", "detail": "qué archivos y qué cambio concreto, y cómo se verifica"}]}]}
\`\`\`
Máximo ${MAX_PHASES} fases y ${MAX_SUBPHASES} subfases por fase. No dejes fuera nada de lo que pide el documento.`,
  en: (
    path: string,
  ) => `PHASES MODE. The file "${path}" (attached) describes the changes I want in this project.
1. Read it fully and look at the project as much as needed (files, structure, how it is tested) to understand what has to change.
2. Split ALL the work into PHASES (big blocks, in dependency order) and each phase into small SUBPHASES: each subphase must fit in one agent turn and end in a state that builds / works, with a concrete way to check it.
3. Do not change anything yet.
Answer with a 2-4 line summary and, at the end, EXACTLY one \`\`\`json block shaped like this:
\`\`\`json
{"title": "short plan name", "phases": [{"title": "Phase…", "goal": "what it is for", "subphases": [{"title": "Subphase…", "detail": "which files, what concrete change, and how it is checked"}]}]}
\`\`\`
At most ${MAX_PHASES} phases and ${MAX_SUBPHASES} subphases per phase. Leave out nothing the document asks for.`,
} as const;

/** The message that asks the AI (in plan mode, read-only) to split the document. */
export function analyzePrompt(path: string, lang: 'es' | 'en' = 'es'): string {
  return ANALYZE[lang](path);
}

/** The JSON blocks of an answer, last first. */
function jsonCandidates(text: string): string[] {
  const out: string[] = [];
  const fence = /```(?:json|JSON)?\s*\n([\s\S]*?)```/g;
  for (let m = fence.exec(text); m; m = fence.exec(text)) out.push(m[1]!);
  out.reverse();
  // No fence: the outermost {...} of the text.
  const a = text.indexOf('{');
  const b = text.lastIndexOf('}');
  if (a >= 0 && b > a) out.push(text.slice(a, b + 1));
  return out;
}

/** Turns what the model wrote into a plan (null when there is no usable one). */
export function parsePhasePlan(text: string, source: string, now = new Date()): PhasePlan | null {
  for (const raw of jsonCandidates(text)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    const plan = planFromData(data, source, now);
    if (plan) return plan;
  }
  return null;
}

function planFromData(data: unknown, source: string, now: Date): PhasePlan | null {
  if (!data || typeof data !== 'object') return null;
  const o = data as Record<string, unknown>;
  const rawPhases = Array.isArray(o.phases) ? o.phases : Array.isArray(data) ? data : null;
  if (!rawPhases) return null;
  const phases: Phase[] = [];
  for (const p of rawPhases.slice(0, MAX_PHASES)) {
    if (!p || typeof p !== 'object') continue;
    const po = p as Record<string, unknown>;
    const title = clip(po.title ?? po.name, MAX_TITLE);
    const rawSubs = Array.isArray(po.subphases)
      ? po.subphases
      : Array.isArray(po.steps)
        ? po.steps
        : [];
    const n = phases.length + 1;
    const subphases: Subphase[] = [];
    for (const s of rawSubs.slice(0, MAX_SUBPHASES)) {
      const so = (typeof s === 'string' ? { title: s } : s) as Record<string, unknown> | null;
      if (!so || typeof so !== 'object') continue;
      const st = clip(so.title ?? so.name, MAX_TITLE);
      const detail = clip(so.detail ?? so.description ?? '', MAX_DETAIL);
      if (!st && !detail) continue;
      subphases.push({
        id: `${n}.${subphases.length + 1}`,
        title: st || detail.split('\n')[0]!.slice(0, MAX_TITLE),
        detail,
        status: 'pending',
      });
    }
    if (!title && !subphases.length) continue;
    // A phase without subphases is one subphase by itself.
    if (!subphases.length)
      subphases.push({ id: `${n}.1`, title, detail: clip(po.goal, MAX_DETAIL), status: 'pending' });
    const goal = clip(po.goal, MAX_DETAIL);
    phases.push({
      id: String(n),
      title: title || `Fase ${n}`,
      ...(goal ? { goal } : {}),
      subphases,
    });
  }
  if (!phases.length) return null;
  return {
    source,
    title: clip(o.title, MAX_TITLE) || source.split('/').pop()!,
    phases,
    created: now.toISOString(),
  };
}

/**
 * The plan straight from the document, without an AI: "#"/"##" headings are phases, their
 * "###" headings or list items are subphases. Used when the AI gave no usable plan.
 */
export function phasesFromMarkdown(md: string, source: string, now = new Date()): PhasePlan | null {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  let docTitle = '';
  const heads = lines.flatMap((l, i) => {
    const m = /^(#{1,3})\s+(.+?)\s*#*\s*$/.exec(l);
    return m ? [{ level: m[1]!.length, text: m[2]!, i }] : [];
  });
  // The phase level: "##" when the file has a single "#" title, else the top level used.
  const ones = heads.filter((h) => h.level === 1);
  if (ones.length === 1 && heads.some((h) => h.level === 2)) docTitle = ones[0]!.text;
  const phaseLevel = docTitle ? 2 : Math.min(...heads.map((h) => h.level), 9);
  const data: {
    title: string;
    phases: { title: string; subphases: { title: string; detail: string }[] }[];
  } = {
    title: docTitle,
    phases: [],
  };
  const body = (from: number, to: number) => lines.slice(from, to).join('\n').trim();
  const phaseHeads = heads.filter((h) => h.level === phaseLevel);
  if (!phaseHeads.length) {
    // No headings: each top-level list item is a subphase of one phase.
    const items = listItems(lines, 0, lines.length);
    if (!items.length) return null;
    data.phases.push({ title: source.split('/').pop()!, subphases: items });
  }
  phaseHeads.forEach((h, k) => {
    const end = phaseHeads[k + 1]?.i ?? lines.length;
    const subs = heads.filter((x) => x.level === phaseLevel + 1 && x.i > h.i && x.i < end);
    const subphases = subs.length
      ? subs.map((s, j) => ({
          title: s.text,
          detail: body(s.i + 1, subs[j + 1]?.i ?? end),
        }))
      : listItems(lines, h.i + 1, end);
    data.phases.push({
      title: h.text,
      subphases: subphases.length ? subphases : [{ title: h.text, detail: body(h.i + 1, end) }],
    });
  });
  return planFromData(data, source, now);
}

/** Top-level "- x" / "1. x" items between two lines, with their indented lines as the detail. */
function listItems(lines: string[], from: number, to: number): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = [];
  for (let i = from; i < to; i++) {
    const m = /^(?:[-*+]|\d+[.)])\s+(?:\[[ xX~]\]\s+)?(.+)$/.exec(lines[i]!);
    if (!m) {
      if (out.length && /^\s+\S/.test(lines[i]!)) out.at(-1)!.detail += `\n${lines[i]!.trim()}`;
      continue;
    }
    out.push({ title: m[1]!.trim(), detail: m[1]!.trim() });
  }
  return out;
}

// ---------------- running ----------------

export interface SubRef {
  phase: number;
  sub: number;
}

export function allSubs(plan: PhasePlan): Subphase[] {
  return plan.phases.flatMap((p) => p.subphases);
}

export function findSub(plan: PhasePlan, id: string): SubRef | null {
  for (let p = 0; p < plan.phases.length; p++) {
    const s = plan.phases[p]!.subphases.findIndex((x) => x.id === id);
    if (s >= 0) return { phase: p, sub: s };
  }
  return null;
}

/** The next subphase to do: the first one not done or skipped (a failed one is retried). */
export function nextSub(plan: PhasePlan): Subphase | null {
  return allSubs(plan).find((s) => s.status !== 'done' && s.status !== 'skipped') ?? null;
}

export function phasesProgress(plan: PhasePlan): { done: number; total: number } {
  const subs = allSubs(plan);
  return {
    done: subs.filter((s) => s.status === 'done' || s.status === 'skipped').length,
    total: subs.length,
  };
}

/** A copy of the plan with one subphase changed. */
export function setSub(plan: PhasePlan, id: string, change: Partial<Subphase>): PhasePlan {
  return {
    ...plan,
    phases: plan.phases.map((p) => ({
      ...p,
      subphases: p.subphases.map((s) => (s.id === id ? { ...s, ...change } : s)),
    })),
  };
}

/** After reopening, a subphase left "running" (the app closed mid-way) is pending again. */
export function resetRunning(plan: PhasePlan): PhasePlan {
  return {
    ...plan,
    phases: plan.phases.map((p) => ({
      ...p,
      subphases: p.subphases.map((s) => (s.status === 'running' ? { ...s, status: 'pending' } : s)),
    })),
  };
}

const MARK: Record<SubStatus, string> = {
  pending: '[ ]',
  running: '[~]',
  done: '[x]',
  failed: '[!]',
  skipped: '[-]',
};

/** The plan as a short checklist (what the agent sees of the whole). */
export function planOutline(plan: PhasePlan, current?: string): string {
  return plan.phases
    .map(
      (p) =>
        `Fase ${p.id}: ${p.title}\n` +
        p.subphases
          .map(
            (s) =>
              `  ${MARK[s.status]} ${s.id} ${s.title}${s.id === current ? '   <== AHORA' : ''}` +
              (s.status === 'done' && s.summary
                ? `\n      → ${s.summary.split('\n')[0]!.slice(0, 200)}`
                : ''),
          )
          .join('\n'),
    )
    .join('\n');
}

const RESULT_OK = 'RESULTADO: OK';
const RESULT_FAIL = 'RESULTADO: FALLO';

/** The message that runs one subphase. */
export function subphasePrompt(plan: PhasePlan, id: string, lang: 'es' | 'en' = 'es'): string {
  const ref = findSub(plan, id);
  if (!ref) return '';
  const phase = plan.phases[ref.phase]!;
  const sub = phase.subphases[ref.sub]!;
  const { total } = phasesProgress(plan);
  const n = allSubs(plan).findIndex((s) => s.id === id) + 1;
  const retry = sub.status === 'failed' && sub.summary;
  if (lang === 'en')
    return `PHASES MODE — subphase ${sub.id} (${n} of ${total}) of the plan "${plan.title}" (from ${plan.source}).

Phase ${phase.id}: ${phase.title}${phase.goal ? `\nPhase goal: ${phase.goal}` : ''}
Subphase ${sub.id}: ${sub.title}
${sub.detail ? `What to do:\n${sub.detail}\n` : ''}${retry ? `\nThe previous try failed: ${sub.summary}\n` : ''}
Whole plan (for context; [x] done, [ ] pending):
${planOutline(plan, id)}

Rules:
- Do ONLY this subphase. Do not start the next ones; earlier ones are already done (do not redo them).
- Read ${plan.source} if you need the user's original words.
- Check it works (build, tests or running it) before finishing.
- End your answer with one line: "${RESULT_OK}" and a one-sentence summary of what you changed, or "${RESULT_FAIL}: <reason>" if it could not be done.`;
  return `MODO FASES — subfase ${sub.id} (${n} de ${total}) del plan "${plan.title}" (de ${plan.source}).

Fase ${phase.id}: ${phase.title}${phase.goal ? `\nObjetivo de la fase: ${phase.goal}` : ''}
Subfase ${sub.id}: ${sub.title}
${sub.detail ? `Qué hacer:\n${sub.detail}\n` : ''}${retry ? `\nEl intento anterior falló: ${sub.summary}\n` : ''}
Plan completo (para contexto; [x] hecho, [ ] pendiente):
${planOutline(plan, id)}

Reglas:
- Haz SOLO esta subfase. No empieces las siguientes; las anteriores ya están hechas (no las rehagas).
- Lee ${plan.source} si necesitas las palabras originales del usuario.
- Verifica que funciona (compilar, pruebas o ejecutarlo) antes de terminar.
- Termina tu respuesta con una línea: "${RESULT_OK}" y un resumen de una frase de lo que cambiaste, o "${RESULT_FAIL}: <motivo>" si no se pudo.`;
}

/** Whether a user message is one of the subphase messages (any language). */
export function isSubphasePrompt(text: string): boolean {
  return /^(MODO FASES — subfase|PHASES MODE — subphase) /.test(text.trimStart());
}

/** Whether a user message is the analysis request. */
export function isAnalyzePrompt(text: string): boolean {
  return /^(MODO FASES\. El archivo|PHASES MODE\. The file) /.test(text.trimStart());
}

/**
 * What the agent said about its subphase: ok / failed and a summary. With no result line the
 * answer counts as done (the agent finished without complaining) and its last line is the summary.
 */
export function parseSubResult(text: string): { ok: boolean; summary: string; marked: boolean } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i]!.replace(/[*_`>]/g, '').trim();
    const fail = /^(RESULTADO|RESULT)\s*:\s*(FALLO|FAIL(ED)?)\b\s*:?\s*(.*)$/i.exec(l);
    if (fail)
      return {
        ok: false,
        summary: clip(fail[4] || lines.slice(i + 1).join(' '), MAX_SUMMARY) || 'Falló',
        marked: true,
      };
    const ok = /^(RESULTADO|RESULT)\s*:\s*OK\b\s*[:.\-—]?\s*(.*)$/i.exec(l);
    if (ok)
      return {
        ok: true,
        summary: clip(
          ok[2] || lines.slice(i + 1).join(' ') || lines.slice(0, i).filter(Boolean).at(-1),
          MAX_SUMMARY,
        ),
        marked: true,
      };
  }
  const last =
    lines
      .map((l) => l.trim())
      .filter(Boolean)
      .at(-1) ?? '';
  return { ok: true, summary: clip(last, MAX_SUMMARY), marked: false };
}

/** Reads a saved plan (null when it is not one). */
export function readSavedPlan(text: string): PhasePlan | null {
  try {
    const d = JSON.parse(text) as Partial<PhasePlan>;
    if (!d || typeof d.source !== 'string' || !Array.isArray(d.phases)) return null;
    const plan = planFromData(d, d.source, new Date(d.created ?? Date.now()));
    if (!plan) return null;
    // Keep the saved statuses and summaries (planFromData resets them).
    const saved = new Map(
      d.phases
        .flatMap((p) => (Array.isArray(p?.subphases) ? p.subphases : []))
        .map((s) => [s?.id, s]),
    );
    let out = plan;
    for (const s of allSubs(plan)) {
      const old = saved.get(s.id);
      if (old && typeof old.status === 'string' && old.status in MARK)
        out = setSub(out, s.id, {
          status: old.status,
          ...(typeof old.summary === 'string' ? { summary: clip(old.summary, MAX_SUMMARY) } : {}),
        });
    }
    return resetRunning({
      ...out,
      created: typeof d.created === 'string' ? d.created : out.created,
    });
  } catch {
    return null;
  }
}
