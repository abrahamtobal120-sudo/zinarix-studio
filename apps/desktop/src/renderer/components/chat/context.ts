import type { AgentKitView, ChatContext } from '../../../shared/api';
import {
  MENTION_KINDS,
  formatProblems,
  mentionSource,
  parseMentions,
  stripMentions,
} from '../../../shared/mentions';
import type { MentionKind } from '../../../shared/mentions';
import { errText } from '../../errText';
import { t } from '../../i18n';
import { monaco } from '../../monaco';
import { api, getEditor, getState, toast } from '../../store';
import { currentProblems } from '../Problems';
import { activeTerminalId, terminalContext, terminalIdByNumber } from '../Terminal';
import {
  MENTION_HINT,
  findSlash,
  mentionedFiles,
  slashCommands,
  slashName,
  type Suggest,
} from './helpers';

/**
 * What travels with a message besides its text (the open file, the "@" mentions) and the
 * "/" and "@" menu of the message box. No React state here: ChatSession passes what it has.
 */

/** The file open in the editor (and its selection) as context of the next message. */
export const currentFileContext = (): ChatContext[] => {
  const ed = getEditor();
  const model = ed?.getModel();
  const path = getState().active;
  if (!ed || !model || !path) return [];
  const sel = ed.getSelection();
  const selected = sel && !sel.isEmpty() ? model.getValueInRange(sel) : '';
  const out: ChatContext[] = [];
  if (selected)
    out.push({
      source: `selection:${path}:${sel!.startLineNumber}-${sel!.endLineNumber}`,
      content: selected,
    });
  const value = model.getValue();
  if (value.length < 200_000) out.push({ source: `file:${path}`, content: value });
  return out;
};

/** Reads the files mentioned with "@" so they travel as context. */
export const mentionContext = async (prompt: string, files: string[]): Promise<ChatContext[]> => {
  const out: ChatContext[] = [];
  // Fase 8: @git, @terminal, @problems, @web and @docs. A mention that cannot be filled
  // (no terminal, page down, unknown docs) stays as plain text and a toast says why.
  const question = stripMentions(prompt) || prompt;
  let docsUsed = 0;
  for (const m of parseMentions(prompt)) {
    const source = mentionSource(m);
    try {
      if (m.kind === 'git' || m.kind === 'web') {
        const content = await api().ai.mention(m.kind, m.arg ?? null);
        if (content.trim()) out.push({ source, content });
      } else if (m.kind === 'terminal') {
        const tid = m.arg ? terminalIdByNumber(Number(m.arg)) : activeTerminalId();
        const ctx = tid === null ? null : terminalContext(tid, 'session');
        if (ctx) out.push(ctx);
        else toast(t('termNone'));
      } else if (m.kind === 'problems') {
        const sev = (v: monaco.MarkerSeverity) =>
          v >= monaco.MarkerSeverity.Error
            ? 'error'
            : v >= monaco.MarkerSeverity.Warning
              ? 'warning'
              : 'info';
        const text = formatProblems(
          currentProblems().map((p) => ({ ...p, severity: sev(p.severity) })),
          m.arg?.toLowerCase() === 'errors' ? 'errors' : 'all',
        );
        out.push({ source, content: text || '(no problems)' });
      } else if (m.kind === 'docs' && docsUsed < 4) {
        // "@docs:name" searches that documentation; bare "@docs" searches all of it.
        docsUsed++;
        const hits = await api().knowledge.searchDocs(question, m.arg);
        if (hits.length)
          out.push({
            source,
            content: hits
              .map((h) => `## ${h.title ?? ''}\n${h.source}\n\n${h.text}`)
              .join('\n\n---\n\n'),
          });
      }
    } catch (e) {
      // unknown name / unreachable: the mention stays as plain text (the agent can still look)
      if (m.kind !== 'docs') toast(`@${source}: ${errText(e)}`);
    }
  }
  for (const path of mentionedFiles(prompt, files)) {
    try {
      const f = await api().workspace.readFile(path);
      if (!f.binary && !f.tooLarge && f.content.length < 400_000)
        out.push({ source: `file:${path}`, content: f.content });
    } catch {
      // unreadable: the mention stays as plain text
    }
  }
  return out;
};

/** What the "/" and "@" menu lists: the project's commands, skills, files and docs names. */
export interface SuggestSource {
  commands: AgentKitView['commands'];
  skills: AgentKitView['skills'];
  files: string[];
  docNames: string[];
  /** Asks for the names of the indexed documentation (they arrive for the next keystroke). */
  loadDocs: () => void;
}

/** The "/" or "@" menu for the text left of the caret, or null when there is none. */
export function suggestFor(value: string, caret: number, src: SuggestSource): Suggest | null {
  const left = value.slice(0, caret);
  const slash = /^\/(\S*)$/.exec(left);
  if (slash) {
    const q = slash[1]!.toLowerCase();
    const items = slashCommands()
      .filter((c) => c.name.startsWith(q) || c.en.startsWith(q))
      .map((c) => {
        // Typed in the other language: keep suggesting the name being typed.
        const name = slashName(c).startsWith(q)
          ? slashName(c)
          : c.name.startsWith(q)
            ? c.name
            : c.en;
        return { id: name, label: `/${name}`, hint: c.hint };
      });
    for (const c of src.commands)
      if (c.name.startsWith(q) && !findSlash(c.name))
        items.push({
          id: c.name,
          label: `/${c.name}`,
          hint: `${c.argumentHint ? `${c.argumentHint} · ` : ''}${c.description || t('slashCustom')}`,
        });
    for (const k of src.skills)
      if (
        k.name.startsWith(q) &&
        !findSlash(k.name) &&
        !src.commands.some((c) => c.name === k.name)
      )
        items.push({
          id: k.name,
          label: `/${k.name}`,
          hint: `${t('slashSkill')} · ${k.description}`,
        });
    return items.length ? { kind: 'slash', from: 0, to: caret, items, index: 0 } : null;
  }
  const at = /(^|\s)@([^\s@]*)$/.exec(left);
  if (at) {
    const q = at[2]!.toLowerCase();
    const from = caret - at[2]!.length - 1;
    // "@docs:" — the names of the indexed documentation.
    if (q.startsWith('docs:')) {
      const dq = q.slice(5);
      const items = src.docNames
        .filter((n) => n.toLowerCase().startsWith(dq))
        .slice(0, 12)
        .map((n) => ({ id: `docs:${n}`, label: `@docs:${n}`, special: true }));
      if (!src.docNames.length) src.loadDocs();
      return items.length ? { kind: 'file', from, to: caret, items, index: 0 } : null;
    }
    // Fase 8: the special mentions first, then the files.
    const specials = MENTION_KINDS.filter((k) => k.startsWith(q)).map((k: MentionKind) => ({
      id: k,
      label: `@${k}`,
      hint: t(MENTION_HINT[k]),
      insert: k === 'web' || k === 'docs' ? `@${k}:` : undefined,
      special: true,
    }));
    if (q === '' || 'docs'.startsWith(q)) src.loadDocs();
    const scored = src.files
      .map((f) => {
        const lower = f.toLowerCase();
        const name = lower.slice(lower.lastIndexOf('/') + 1);
        const score = !q
          ? 1
          : name.startsWith(q)
            ? 3
            : name.includes(q)
              ? 2
              : lower.includes(q)
                ? 1
                : 0;
        return { f, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.f.length - b.f.length)
      .slice(0, 12);
    const items = [
      ...specials,
      ...scored.slice(0, 12 - Math.min(specials.length, 5)).map(({ f }) => ({
        id: f,
        label: f.slice(f.lastIndexOf('/') + 1),
        hint: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '',
      })),
    ];
    return items.length ? { kind: 'file', from, to: caret, items, index: 0 } : null;
  }
  return null;
}
