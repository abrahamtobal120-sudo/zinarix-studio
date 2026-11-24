/**
 * Fase 13E: voice clean-up recipes, as data and as FFmpeg filters.
 *
 * The phase rule applied to sound: Web Audio cannot play FFmpeg's filters the same way, so the
 * clean sound is made ONCE with FFmpeg into a file of the cache (main/voiceClean.ts) and both the
 * preview and the export play that file. The clip keeps the recipe (preset, intensity) and the
 * key of the original it came from; when either changes, the file is made again.
 *
 * No Electron, no I/O.
 */

export type VoicePresetId = 'denoise' | 'isolate' | 'enhance';
export const VOICE_PRESETS: readonly VoicePresetId[] = ['denoise', 'isolate', 'enhance'];

/** What a clip stores (Clip.voice). */
export interface VoiceFx {
  preset: VoicePresetId;
  /** 0–1: how much of the clean sound is mixed with the original (1 = only the clean one). */
  amount: number;
  /** Cache key of the processed file (original path + size + date + recipe). */
  key?: string;
  /** The processed file (absolute, in the app's cache). Main recomputes it before exporting. */
  file?: string;
}

/** The RNNoise model "Aislar voz" uses (std.rnnn, Xiph RNNoise, BSD-3-Clause). */
export const RNNOISE_MODEL = 'std.rnnn';

/** Loudness "Mejorar voz" leaves the voice at (the usual podcast / social target). */
export const VOICE_LUFS = -16;

export function validVoice(x: unknown): boolean {
  if (x === undefined) return true;
  if (!x || typeof x !== 'object') return false;
  const v = x as VoiceFx;
  return (
    VOICE_PRESETS.includes(v.preset) &&
    typeof v.amount === 'number' &&
    Number.isFinite(v.amount) &&
    v.amount >= 0 &&
    v.amount <= 1 &&
    (v.key === undefined || (typeof v.key === 'string' && /^[a-f0-9]{8,64}$/.test(v.key))) &&
    (v.file === undefined ||
      (typeof v.file === 'string' && v.file.length < 4096 && /\.flac$/i.test(v.file)))
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 1));
const num = (n: number) => String(Math.round(n * 1000) / 1000);

/**
 * The cleaning part of a preset (before the mix with the original). "isolate" names the model
 * by file name only: FFmpeg runs in the model's folder, so no drive letter or colon of a
 * Windows path ever reaches the filter graph.
 */
export function cleanChain(preset: VoicePresetId): string[] {
  switch (preset) {
    case 'denoise':
      // Tracks the noise floor (tn=1): fans, hum, hiss.
      return ['afftdn=nr=30:nf=-60:tn=1'];
    case 'isolate':
      return [`arnndn=m=${RNNOISE_MODEL}`, 'afftdn=nr=12:nf=-55:tn=1'];
    case 'enhance':
      return [
        'highpass=f=80',
        'afftdn=nr=30:nf=-60:tn=1',
        'acompressor=threshold=-24dB:ratio=3:attack=15:release=250:makeup=2',
      ];
  }
}

export interface LoudMeasure {
  input_i: number;
  input_tp: number;
  input_lra: number;
  input_thresh: number;
  target_offset: number;
}

/** loudnorm for "enhance": a measuring pass (no `m`) or the linear second pass. */
export function loudnormFilter(m?: LoudMeasure): string {
  const base = `loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11`;
  if (!m) return `${base}:print_format=json`;
  return (
    `${base}:measured_I=${num(m.input_i)}:measured_TP=${num(m.input_tp)}` +
    `:measured_LRA=${num(m.input_lra)}:measured_thresh=${num(m.input_thresh)}` +
    `:offset=${num(m.target_offset)}:linear=true:print_format=summary`
  );
}

/** The JSON block loudnorm prints at the end of a measuring pass. */
export function parseLoudnorm(log: string): LoudMeasure | null {
  const at = log.lastIndexOf('{');
  const end = log.lastIndexOf('}');
  if (at < 0 || end < at) return null;
  try {
    const j = JSON.parse(log.slice(at, end + 1)) as Record<string, string>;
    const m: LoudMeasure = {
      input_i: Number(j.input_i),
      input_tp: Number(j.input_tp),
      input_lra: Number(j.input_lra),
      input_thresh: Number(j.input_thresh),
      target_offset: Number(j.target_offset),
    };
    // Digital silence measures -inf: nothing to normalise.
    return Object.values(m).every(Number.isFinite) ? m : null;
  } catch {
    return null;
  }
}

/**
 * The whole graph from input 0 to [out]: clean, mix with the original by `amount`, then (for
 * "enhance") the loudness pass. `measure` builds the first loudnorm pass instead.
 */
export function voiceGraph(
  v: Pick<VoiceFx, 'preset' | 'amount'>,
  measure?: LoudMeasure | 'measure',
): string {
  const a = clamp01(v.amount);
  const fmt = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo';
  const clean = cleanChain(v.preset).join(',');
  const parts: string[] = [];
  if (a >= 0.999) parts.push(`[0:a]${fmt},${clean}[mix]`);
  else {
    parts.push(`[0:a]${fmt},asplit=2[o][c]`);
    parts.push(`[c]${clean},volume=${num(a)}[cv]`);
    parts.push(`[o]volume=${num(1 - a)}[ov]`);
    parts.push('[ov][cv]amix=inputs=2:normalize=0:duration=first[mix]');
  }
  if (v.preset === 'enhance')
    parts.push(
      `[mix]${loudnormFilter(measure === 'measure' ? undefined : measure)},aresample=48000[out]`,
    );
  else parts.push('[mix]anull[out]');
  return parts.join(';');
}

/** The recipe part of a cache key (what changes the processed sound). */
export const recipeOf = (v: Pick<VoiceFx, 'preset' | 'amount'>): string =>
  `${v.preset}:${Math.round(clamp01(v.amount) * 100)}`;

/** The processed file a clip should play (when it was made for this recipe), else null. */
export function voiceFileOf(c: { voice?: VoiceFx }): string | null {
  return c.voice?.file ?? null;
}
