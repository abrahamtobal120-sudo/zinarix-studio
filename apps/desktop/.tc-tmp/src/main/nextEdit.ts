import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { OmniCore } from '@omni/core';
import type { NextEditRequestView, NextEditResultView } from '../shared/lsp.js';
import { parseNextEdits, suggestionStats } from '../shared/nextEdit.js';
import type { SuggestionEvent, SuggestionStatsRow } from '../shared/nextEdit.js';

export const NEXT_EDIT_SYSTEM =
  'You predict the NEXT edits a programmer will make, like Cursor Tab. You get their most recent edits ' +
  '(as small diffs) and the code around the cursor with line numbers ("12| code"). Propose the changes that ' +
  'follow from the recent edits: the same rename at every other use, a new parameter passed at each call site, ' +
  'the matching change in nearby lines, finishing a pattern. One edit per place that must change, in file order ' +
  '(at most 8). Each edit replaces whole lines start..end (inclusive; start = end for one line) and may span ' +
  'several lines. Answer ONLY with strict JSON on one line: ' +
  '{"edits":[{"start":<line>,"end":<line>,"original":"<those lines exactly as they are now, joined with \\n>",' +
  '"replacement":"<the new text of those lines, joined with \\n>"}]}. ' +
  'If there is no confident next edit, answer exactly: none. Never repeat an edit that is already done; ' +
  'never rewrite code the recent edits do not imply. No markdown, no explanation.';

/** Lines of the window the model sees at most (both sides of the cursor). */
const MAX_WINDOW = 160;

export function nextEditPrompt(req: NextEditRequestView): string {
  const width = String(req.startLine + req.lines.length).length;
  const code = req.lines
    .map((l, i) => `${String(req.startLine + i).padStart(width)}| ${l}`)
    .join('\n');
  return (
    `File: ${req.path} (language: ${req.language})\n` +
    `<recent-edits>\n${req.edits.slice(-3000) || '(none)'}\n</recent-edits>\n` +
    `Cursor: line ${req.cursor.line}, column ${req.cursor.column}\n` +
    `<code>\n${code}\n</code>\nNext edits JSON (or none):`
  );
}

/** The window trimmed around the cursor so the prompt stays small (latency is the goal). */
export function trimWindow(req: NextEditRequestView): NextEditRequestView {
  let { startLine, lines } = req;
  if (lines.length > MAX_WINDOW) {
    const cur = req.cursor.line - startLine;
    const from = Math.max(0, Math.min(lines.length - MAX_WINDOW, cur - Math.floor(MAX_WINDOW / 3)));
    lines = lines.slice(from, from + MAX_WINDOW);
    startLine += from;
  }
  return { ...req, startLine, lines: lines.map((l) => l.slice(0, 400)) };
}

/** Asks the "inline" role model for the next edits; any failure means "no suggestion". */
export async function predictNextEdit(
  core: OmniCore,
  req: NextEditRequestView,
  signal: AbortSignal,
): Promise<NextEditResultView> {
  const view = trimWindow(req);
  const t0 = Date.now();
  try {
    const r = await core.complete(
      {
        role: 'inline',
        noFallback: true,
        maxTokens: 900,
        temperature: 0.1,
        messages: [
          { role: 'system', content: NEXT_EDIT_SYSTEM },
          { role: 'user', content: nextEditPrompt(view) },
        ],
      },
      signal,
    );
    const model = r.provider && r.model ? `${r.provider}/${r.model}` : r.model || '';
    return { hunks: parseNextEdits(r.text, view), model, latencyMs: Date.now() - t0 };
  } catch {
    return { hunks: [], model: '', latencyMs: Date.now() - t0, error: true };
  }
}

const MAX_EVENTS = 3000;

/**
 * Acceptance metric of the AI suggestions (ghost text and next edit): what was shown,
 * accepted or dismissed, and how long each request took, per model. Kept on disk so the
 * numbers survive restarts; Settings shows the summary and the editor tunes its debounce.
 */
export class SuggestionMetrics {
  private events: SuggestionEvent[] | undefined;
  private writing: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly file: string) {}

  private async load(): Promise<SuggestionEvent[]> {
    if (this.events) return this.events;
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as { events?: unknown };
      this.events = Array.isArray(raw.events) ? (raw.events as SuggestionEvent[]) : [];
    } catch {
      this.events = [];
    }
    return this.events;
  }

  async record(list: Omit<SuggestionEvent, 'at'>[]): Promise<void> {
    const events = await this.load();
    const now = Date.now();
    for (const e of list) events.push({ ...e, at: now });
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    this.scheduleSave();
  }

  async stats(): Promise<SuggestionStatsRow[]> {
    return suggestionStats(await this.load());
  }

  async clear(): Promise<void> {
    this.events = [];
    this.scheduleSave(0);
    await this.flush();
  }

  private scheduleSave(delay = 2000): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), delay);
  }

  /** Writes in order (a late write never brings back cleared data). */
  flush(): Promise<void> {
    clearTimeout(this.timer);
    const snapshot = JSON.stringify({ version: 1, events: this.events ?? [] });
    this.writing = this.writing
      .then(async () => {
        await mkdir(dirname(this.file), { recursive: true });
        await writeFile(this.file, snapshot);
      })
      .catch(() => undefined);
    return this.writing;
  }
}
