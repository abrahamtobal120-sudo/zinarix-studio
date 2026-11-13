import type { OmniCore } from '@omni/core';
import type { NextEditRequestView, NextEditView } from '../shared/lsp.js';
import { parseNextEdit } from '../shared/lsp.js';

export const NEXT_EDIT_SYSTEM =
  'You predict the NEXT edit a programmer will make, like Cursor Tab. You get their most recent edits ' +
  'and the code around the cursor with line numbers ("12| code"). Guess the single most likely next change ' +
  'that follows from the recent edits (e.g. the same rename, a parameter to add at the call sites, the matching ' +
  'change in a nearby line, finishing a pattern). Answer ONLY with strict JSON on one line: ' +
  '{"line": <line number>, "original": "<that line exactly as it is now>", "replacement": "<the full new text of that line; use \\n for several lines>"}. ' +
  'If there is no confident next edit, answer exactly: none. Never repeat an edit that is already done. No markdown, no explanation.';

export function nextEditPrompt(req: NextEditRequestView): string {
  const width = String(req.startLine + req.lines.length).length;
  const code = req.lines
    .map((l, i) => `${String(req.startLine + i).padStart(width)}| ${l}`)
    .join('\n');
  return (
    `File: ${req.path} (language: ${req.language})\n` +
    `<recent-edits>\n${req.edits.slice(-3000) || '(none)'}\n</recent-edits>\n` +
    `Cursor: line ${req.cursor.line}, column ${req.cursor.column}\n` +
    `<code>\n${code}\n</code>\nNext edit JSON (or none):`
  );
}

/** Asks the "inline" role model for the next edit; any failure means "no suggestion". */
export async function predictNextEdit(
  core: OmniCore,
  req: NextEditRequestView,
  signal: AbortSignal,
): Promise<NextEditView | null> {
  const lines = req.lines.slice(0, 80).map((l) => l.slice(0, 400));
  const view = { ...req, lines };
  try {
    const r = await core.complete(
      {
        role: 'inline',
        noFallback: true,
        maxTokens: 300,
        temperature: 0.1,
        messages: [
          { role: 'system', content: NEXT_EDIT_SYSTEM },
          { role: 'user', content: nextEditPrompt(view) },
        ],
      },
      signal,
    );
    return parseNextEdit(r.text, view);
  } catch {
    return null;
  }
}
