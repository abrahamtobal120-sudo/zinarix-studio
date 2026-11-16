/**
 * Fase 10C: a voice-over script with several speakers ("Ana: Hola. / Luis: ¿Qué tal?").
 * Pure: the Generate panel, the agent tools and the media service all parse it the same way.
 * Gemini TTS reads the whole script in one call; other models get one call per line and the
 * pieces are joined with FFmpeg.
 */
export interface ScriptLine {
  /** null = no name before the text (the narrator, or the first speaker). */
  speaker: string | null;
  text: string;
}

export interface Script {
  lines: ScriptLine[];
  /** Speaker names in order of appearance (accents and case kept as written). */
  speakers: string[];
}

/** "Ana:", "María José:", "Dr. Pérez:" — starts with a letter, at most 4 words, before ':'. */
const NAMED = /^([\p{L}][\p{L}\p{M}\d.'’-]*(?: [\p{L}\p{M}\d.'’-]+){0,3})\s*:\s*(.*)$/u;

/** Splits on new lines and on " / " (the one-line form of the plan). */
function rawLines(text: string): string[] {
  return text
    .split(/\r?\n|\s+\/\s+/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function parseScript(text: string): Script {
  const lines: ScriptLine[] = [];
  const speakers: string[] = [];
  const seen = new Map<string, string>();
  for (const raw of rawLines(text)) {
    const m = NAMED.exec(raw);
    // "http://…" and "10:30" are not names.
    if (m && !m[2]!.startsWith('//') && m[2]!.trim()) {
      const key = m[1]!.normalize('NFC').toLocaleLowerCase();
      let name = seen.get(key);
      if (!name) {
        name = m[1]!.normalize('NFC');
        seen.set(key, name);
        speakers.push(name);
      }
      lines.push({ speaker: name, text: m[2]!.trim() });
      continue;
    }
    // A line without a name continues the previous speaker (or is the narrator's).
    const prev = lines.at(-1);
    if (prev) prev.text = `${prev.text} ${raw}`;
    else lines.push({ speaker: null, text: raw });
  }
  return { lines, speakers };
}

/** Two or more named speakers: the text is a dialogue, not a single voice-over. */
export function isDialogue(text: string): boolean {
  return parseScript(text).speakers.length >= 2;
}

/** The script back as "Name: text" lines (what Gemini TTS reads). */
export function scriptText(s: Script): string {
  return s.lines.map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text)).join('\n');
}

/**
 * A voice per speaker: the ones given (by name, any case), the rest from the model's list in
 * turn so two speakers never share a voice while there are voices left.
 */
export function assignVoices(
  speakers: readonly string[],
  voices: readonly string[],
  given: Readonly<Record<string, string>> = {},
): { name: string; voice: string }[] {
  const lower = new Map(Object.entries(given).map(([k, v]) => [k.toLocaleLowerCase(), v]));
  const used = new Set<string>();
  const out = speakers.map((name) => {
    const v = lower.get(name.toLocaleLowerCase());
    if (v) used.add(v);
    return { name, voice: v ?? '' };
  });
  let i = 0;
  for (const s of out) {
    if (s.voice) continue;
    const free = voices.filter((v) => !used.has(v));
    const pick = free[0] ?? voices[i++ % Math.max(1, voices.length)] ?? '';
    used.add(pick);
    s.voice = pick;
  }
  return out;
}

/** The voice that reads a line (unnamed lines take the first speaker's voice). */
export function voiceFor(
  line: ScriptLine,
  speakers: readonly { name: string; voice: string }[],
): string {
  const key = line.speaker?.toLocaleLowerCase();
  return (
    speakers.find((s) => s.name.toLocaleLowerCase() === key)?.voice ?? speakers[0]?.voice ?? ''
  );
}
