import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMode } from '../../shared/agentModes';
import type { PhasePlan, SubStatus } from '../../shared/phases';
import {
  MAX_DOC,
  allSubs,
  analyzePrompt,
  isAnalyzePrompt,
  isPhasesDoc,
  isSubphasePrompt,
  nextSub,
  parsePhasePlan,
  parseSubResult,
  phasesFromMarkdown,
  phasesProgress,
  phasesStatePath,
  readSavedPlan,
  setSub,
  subphasePrompt,
} from '../../shared/phases';
import { lang } from '../i18n';
import { api, openFile, toast } from '../store';
import { Icon } from './Icon';
import { ModalShell } from './ModalShell';
import './phases.css';

/**
 * Modo Fases (UI): pick a Markdown file of changes, the AI splits it into phases and subphases
 * (read-only plan mode), and the chat runs one subphase per message, in order, marking each one
 * done / failed from the agent's "RESULTADO:" line. The progress is saved in .zinarix/fases/.
 */

const ES = {
  menu: 'Modo Fases (plan por fases desde un .md)',
  pickTitle: 'Modo Fases: elige el documento de cambios',
  pickHint:
    'Escribe en un .md los cambios que quieres. La IA lo analiza, lo divide en fases y subfases y luego las hace una por una.',
  pickFilter: 'Buscar .md…',
  pickNone:
    'No hay archivos .md en el proyecto. Crea uno (por ejemplo CAMBIOS.md) con lo que quieres.',
  pickNew: 'Crear CAMBIOS.md',
  noFolder: 'El Modo Fases necesita una carpeta abierta.',
  analyzing: 'Analizando el documento y armando las fases…',
  noPlan: 'La IA no devolvió fases válidas; usé los títulos del documento.',
  noPlanAtAll:
    'No se pudo sacar un plan del documento. Agrégale títulos (##) o una lista de cambios.',
  resumed: 'Plan guardado retomado: {done} de {total} subfases hechas.',
  title: 'Fases',
  start: 'Empezar',
  resume: 'Continuar',
  pause: 'Pausar al terminar esta',
  runOne: 'Solo la siguiente',
  skip: 'Saltar',
  retry: 'Reintentar',
  redo: 'Rehacer',
  reanalyze: 'Volver a analizar',
  close: 'Cerrar el Modo Fases',
  allDone: '¡Listo! Se completaron todas las subfases.',
  failed: 'La subfase {id} falló. Revísala y pulsa Reintentar o Saltar.',
  stopped: 'Modo Fases en pausa.',
  auto: 'Seguir solo con la siguiente',
  progress: '{done}/{total}',
  status: {
    pending: 'Pendiente',
    running: 'En curso',
    done: 'Hecha',
    failed: 'Falló',
    skipped: 'Saltada',
  } as Record<SubStatus, string>,
};
const EN: typeof ES = {
  menu: 'Phases mode (phased plan from a .md)',
  pickTitle: 'Phases mode: pick the changes document',
  pickHint:
    'Write the changes you want in a .md. The AI reads it, splits it into phases and subphases and then does them one by one.',
  pickFilter: 'Search .md…',
  pickNone:
    'There are no .md files in the project. Create one (e.g. CHANGES.md) with what you want.',
  pickNew: 'Create CHANGES.md',
  noFolder: 'Phases mode needs an open folder.',
  analyzing: 'Reading the document and building the phases…',
  noPlan: 'The AI gave no usable phases; the document headings were used.',
  noPlanAtAll: 'No plan could be made from the document. Add headings (##) or a list of changes.',
  resumed: 'Saved plan resumed: {done} of {total} subphases done.',
  title: 'Phases',
  start: 'Start',
  resume: 'Continue',
  pause: 'Pause after this one',
  runOne: 'Only the next one',
  skip: 'Skip',
  retry: 'Retry',
  redo: 'Redo',
  reanalyze: 'Analyse again',
  close: 'Close phases mode',
  allDone: 'Done! Every subphase is complete.',
  failed: 'Subphase {id} failed. Check it and press Retry or Skip.',
  stopped: 'Phases mode paused.',
  auto: 'Go on with the next one by itself',
  progress: '{done}/{total}',
  status: {
    pending: 'Pending',
    running: 'Running',
    done: 'Done',
    failed: 'Failed',
    skipped: 'Skipped',
  },
};
export const ps = (): typeof ES => (lang === 'en' ? EN : ES);
const fill = (s: string, v: Record<string, string | number>) =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(v[k] ?? ''));

export interface PhasesSend {
  (prompt: string, context: { source: string; content: string }[], mode: ChatMode): void;
}

interface Waiting {
  kind: 'analyze' | 'sub';
  /** The subphase being run. */
  id?: string;
}

/**
 * The state and the driver of the phases of one chat. `send` sends a message of the chat with a
 * mode of its own; `onFinished` is called by the chat when an answer ends (with the last user
 * message and the answer), and starts the next subphase when it should.
 */
export function usePhases(opts: {
  root: string | undefined;
  chatMode: ChatMode;
  send: PhasesSend;
}) {
  const [plan, setPlanState] = useState<PhasePlan | null>(null);
  const planNow = useRef<PhasePlan | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [auto, setAuto] = useState(true);
  const autoNow = useRef(true);
  autoNow.current = auto;
  const waiting = useRef<Waiting | null>(null);
  const [picker, setPicker] = useState(false);
  const optsNow = useRef(opts);
  optsNow.current = opts;

  const save = (p: PhasePlan | null) => {
    planNow.current = p;
    setPlanState(p);
    if (!p) return;
    const path = phasesStatePath(p.source);
    void (async () => {
      const ws = api().workspace;
      await ws.createDir('.zinarix').catch(() => undefined);
      await ws.createDir('.zinarix/fases').catch(() => undefined);
      await ws.writeFile(path, JSON.stringify(p, null, 2)).catch(() => undefined);
    })();
  };

  /** The mode subphases run in: the chat's own when it edits files, else the agent. */
  const runMode = (): ChatMode => {
    const m = optsNow.current.chatMode;
    return m === 'auto' || m === 'full' ? m : 'agent';
  };

  const runSub = (p: PhasePlan, id: string) => {
    const prompt = subphasePrompt(p, id, lang === 'en' ? 'en' : 'es');
    if (!prompt) return;
    const next = setSub(p, id, { status: 'running' });
    save(next);
    waiting.current = { kind: 'sub', id };
    optsNow.current.send(prompt, [], runMode());
  };

  const runNext = (p = planNow.current) => {
    if (!p) return;
    const s = nextSub(p);
    if (!s) {
      toast(ps().allDone);
      return;
    }
    runSub(p, s.id);
  };

  /** Opens a document: resumes its saved plan, or asks the AI to split it. */
  const open = async (source: string, fresh = false) => {
    setPicker(false);
    if (!optsNow.current.root) {
      toast(ps().noFolder);
      return;
    }
    if (!fresh) {
      try {
        const saved = await api().workspace.readFile(phasesStatePath(source));
        const p = saved.binary ? null : readSavedPlan(saved.content);
        if (p && p.source === source) {
          save(p);
          const { done, total } = phasesProgress(p);
          toast(fill(ps().resumed, { done, total }));
          return;
        }
      } catch {
        // no saved plan: analyse it
      }
    }
    let content = '';
    try {
      const f = await api().workspace.readFile(source);
      content = f.binary ? '' : f.content;
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
      return;
    }
    save(null);
    setAnalyzing(source);
    waiting.current = { kind: 'analyze' };
    optsNow.current.send(
      analyzePrompt(source, lang === 'en' ? 'en' : 'es'),
      [{ source: `file:${source}`, content: content.slice(0, MAX_DOC) }],
      'plan',
    );
  };

  /** Called by the chat when an answer ends. byUser: the user pressed Stop. */
  const onFinished = (
    userText: string | undefined,
    answer: string,
    error: boolean,
    byUser: boolean,
  ): boolean => {
    const w = waiting.current;
    if (!w || !userText) return false;
    if (w.kind === 'analyze') {
      if (!isAnalyzePrompt(userText)) return false;
      waiting.current = null;
      const source = analyzing;
      setAnalyzing(null);
      if (!source || byUser || error) return true;
      let p = parsePhasePlan(answer, source);
      if (!p) {
        void api()
          .workspace.readFile(source)
          .then((f) => {
            const md = f.binary ? null : phasesFromMarkdown(f.content, source);
            if (md) {
              save(md);
              toast(ps().noPlan);
            } else toast(ps().noPlanAtAll);
          })
          .catch(() => toast(ps().noPlanAtAll));
        return true;
      }
      p = { ...p, source };
      save(p);
      return true;
    }
    if (!isSubphasePrompt(userText) || !w.id) return false;
    waiting.current = null;
    const p = planNow.current;
    if (!p) return true;
    if (byUser || error) {
      save(
        setSub(p, w.id, {
          status: error ? 'failed' : 'pending',
          ...(error ? { summary: answer.slice(-300) || 'Error' } : {}),
        }),
      );
      toast(ps().stopped);
      return true;
    }
    const r = parseSubResult(answer);
    const next = setSub(p, w.id, { status: r.ok ? 'done' : 'failed', summary: r.summary });
    save(next);
    if (!r.ok) {
      toast(fill(ps().failed, { id: w.id }));
      return true;
    }
    if (!nextSub(next)) {
      toast(ps().allDone);
      return true;
    }
    if (autoNow.current) setTimeout(() => runNext(planNow.current), 400);
    return true;
  };

  const skip = (id: string) => {
    const p = planNow.current;
    if (p) save(setSub(p, id, { status: 'skipped' }));
  };
  const reset = (id: string) => {
    const p = planNow.current;
    if (p) save(setSub(p, id, { status: 'pending', summary: undefined }));
  };
  const close = () => {
    waiting.current = null;
    setAnalyzing(null);
    planNow.current = null;
    setPlanState(null);
  };

  return {
    plan,
    analyzing,
    auto,
    setAuto,
    picker,
    setPicker,
    open,
    runNext,
    runSub: (id: string) => planNow.current && runSub(planNow.current, id),
    skip,
    reset,
    close,
    onFinished,
    /** A subphase or the analysis is waiting for its answer. */
    working: () => waiting.current !== null,
  };
}

export type PhasesState = ReturnType<typeof usePhases>;

const ICON: Record<SubStatus, string> = {
  pending: '○',
  running: '◐',
  done: '✓',
  failed: '!',
  skipped: '–',
};

/** The phases above the message box: progress, each subphase with its state, and the controls. */
export function PhasesPanel({ s, busy }: { s: PhasesState; busy: boolean }) {
  const str = ps();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  if (s.analyzing)
    return (
      <div className="phases-panel" role="region" aria-label={str.title}>
        <div className="phases-head">
          <Icon name="layers" size={13} />
          <span className="phases-title">{s.analyzing}</span>
          <span className="phases-note">{str.analyzing}</span>
          <button className="phases-x" title={str.close} aria-label={str.close} onClick={s.close}>
            <Icon name="x" size={12} />
          </button>
        </div>
      </div>
    );
  const plan = s.plan;
  if (!plan) return null;
  const { done, total } = phasesProgress(plan);
  const next = nextSub(plan);
  const running = allSubs(plan).some((x) => x.status === 'running');
  const current = plan.phases.find((p) => p.subphases.some((x) => x.id === (next?.id ?? '')));
  return (
    <div className="phases-panel" role="region" aria-label={str.title}>
      <div className="phases-head">
        <Icon name="layers" size={13} />
        <span className="phases-title" title={plan.source}>
          {plan.title}
        </span>
        <span className="phases-count">{fill(str.progress, { done, total })}</span>
        <div className="phases-bar" aria-hidden>
          <div style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <button
          className="phases-x"
          title={str.reanalyze}
          aria-label={str.reanalyze}
          disabled={busy}
          onClick={() => void s.open(plan.source, true)}
        >
          <Icon name="refresh" size={12} />
        </button>
        <button className="phases-x" title={str.close} aria-label={str.close} onClick={s.close}>
          <Icon name="x" size={12} />
        </button>
      </div>
      <div className="phases-list">
        {plan.phases.map((p) => {
          const pd = p.subphases.filter(
            (x) => x.status === 'done' || x.status === 'skipped',
          ).length;
          const expanded = open[p.id] ?? p === current;
          return (
            <div key={p.id} className="phases-phase">
              <button
                className="phases-phase-head"
                aria-expanded={expanded}
                onClick={() => setOpen((o) => ({ ...o, [p.id]: !expanded }))}
              >
                <Icon name={expanded ? 'chevronDown' : 'chevron'} size={11} />
                <span className="phases-phase-title">
                  {p.id}. {p.title}
                </span>
                <span className="phases-count">
                  {pd}/{p.subphases.length}
                </span>
              </button>
              {expanded && (
                <ul className="phases-subs">
                  {p.subphases.map((x) => (
                    <li
                      key={x.id}
                      className={`phases-sub is-${x.status}`}
                      title={x.detail || x.title}
                    >
                      <span className="phases-mark" aria-label={str.status[x.status]}>
                        {ICON[x.status]}
                      </span>
                      <span className="phases-sub-text">
                        <span className="phases-sub-title">
                          {x.id} {x.title}
                        </span>
                        {x.summary && <span className="phases-sub-sum">{x.summary}</span>}
                      </span>
                      {!busy && !running && (
                        <span className="phases-sub-actions">
                          {(x.status === 'pending' || x.status === 'failed') && (
                            <button
                              title={str.skip}
                              aria-label={str.skip}
                              onClick={() => s.skip(x.id)}
                            >
                              <Icon name="stepOver" size={11} />
                            </button>
                          )}
                          {x.status === 'failed' && (
                            <button
                              title={str.retry}
                              aria-label={str.retry}
                              onClick={() => s.runSub(x.id)}
                            >
                              <Icon name="refresh" size={11} />
                            </button>
                          )}
                          {(x.status === 'done' || x.status === 'skipped') && (
                            <button
                              title={str.redo}
                              aria-label={str.redo}
                              onClick={() => s.reset(x.id)}
                            >
                              <Icon name="undo" size={11} />
                            </button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="phases-foot">
        <label className="phases-auto" title={str.auto}>
          <input type="checkbox" checked={s.auto} onChange={(e) => s.setAuto(e.target.checked)} />
          {str.auto}
        </label>
        {next && !busy && !running && (
          <button className="phases-go" onClick={() => s.runNext()}>
            <Icon name="play" size={12} /> {done ? str.resume : str.start} · {next.id}
          </button>
        )}
        {(busy || running) && s.auto && (
          <button className="phases-pause" onClick={() => s.setAuto(false)}>
            <Icon name="pause" size={12} /> {str.pause}
          </button>
        )}
      </div>
    </div>
  );
}

/** Picks the Markdown file of the changes (the open one first). */
export function PhasesPicker({
  files,
  active,
  onPick,
  onClose,
}: {
  files: string[];
  active: string | null;
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const str = ps();
  const [q, setQ] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const docs = useMemo(() => {
    const all = files.filter((f) => isPhasesDoc(f) && !f.startsWith('.zinarix/'));
    const md = all.filter((f) => /\.(md|markdown)$/i.test(f));
    const list = (md.length ? md : all).sort(
      (a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b),
    );
    if (active && isPhasesDoc(active)) {
      const i = list.indexOf(active);
      if (i > 0) list.splice(i, 1);
      if (i !== 0) list.unshift(active);
    }
    const n = q.trim().toLowerCase();
    return (n ? list.filter((f) => f.toLowerCase().includes(n)) : list).slice(0, 200);
  }, [files, active, q]);
  const createNew = async () => {
    const name = lang === 'en' ? 'CHANGES.md' : 'CAMBIOS.md';
    const body =
      lang === 'en'
        ? '# Changes\n\n## What I want\n\n- \n'
        : '# Cambios\n\n## Lo que quiero\n\n- \n';
    try {
      await api().workspace.writeFile(name, body);
      await openFile(name);
      onClose();
    } catch (e) {
      toast(String(e instanceof Error ? e.message : e));
    }
  };
  return (
    <ModalShell onClose={onClose} className="phases-picker" label={str.pickTitle}>
      <h3>
        <Icon name="layers" size={14} /> {str.pickTitle}
      </h3>
      <p className="phases-picker-hint">{str.pickHint}</p>
      <input
        ref={input}
        className="phases-picker-q"
        placeholder={str.pickFilter}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && docs[0]) onPick(docs[0]);
        }}
      />
      <div className="phases-picker-list" role="listbox">
        {docs.map((f) => (
          <button key={f} role="option" aria-selected={false} onClick={() => onPick(f)}>
            <Icon name="file" size={13} /> {f}
          </button>
        ))}
        {!docs.length && <div className="phases-picker-none">{str.pickNone}</div>}
      </div>
      <div className="phases-picker-foot">
        <button onClick={() => void createNew()}>
          <Icon name="filePlus" size={13} /> {str.pickNew}
        </button>
      </div>
    </ModalShell>
  );
}
