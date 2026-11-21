import type { ToolDefinition } from '@omni/shared';
import {
  VIDEO_ASK_TOOLS,
  VIDEO_READ_TOOLS,
  VIDEO_TOOL_LIST,
  type VideoAgentResult,
} from '../shared/videoAgent.js';
import type { SystemPreview } from './system.js';
import { TRANSITION_KINDS } from '../shared/videoFx.js';

/**
 * Fase 13B: agent tools that edit Video Studio. The project lives in the renderer, so each call
 * goes to the window (VideoUi) and is applied there with the same pure functions the buttons
 * use, as one Ctrl+Z step. Reads need no approval; edits are approved with a summary of what
 * changes on the timeline (and may be allowed for the conversation: they undo); transcribing
 * and exporting are approved every time.
 */
const MEDIA = {
  type: 'string',
  description:
    'Media id or file name (from video_state). Omit it to use the first media with a transcript / sound on the timeline.',
};
const RANGES = {
  type: 'array',
  description: 'Word stretches as [[first word number, last word number], …] (inclusive).',
  items: { type: 'array', items: { type: 'integer' }, minItems: 1, maxItems: 2 },
};
const CLIP = { type: 'string', description: 'Clip id from video_state' };
const WHEEL = {
  type: 'object',
  properties: Object.fromEntries(['m', 'r', 'g', 'b'].map((k) => [k, { type: 'number', minimum: -1, maximum: 1 }])),
};
const CURVE_PTS = {
  type: 'array',
  maxItems: 12,
  items: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 2, maxItems: 2 },
};
const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

export const VIDEO_TOOLS: ToolDefinition[] = [
  {
    name: 'video_state',
    description:
      'Read the project open in Video Studio: format, duration, media (ids, which have a transcript), tracks and clips with their ids and times. Call it first; ids change after edits, so call it again when unsure.',
    parameters: obj({}),
  },
  {
    name: 'video_transcript',
    description:
      'Read the transcript of a media item, one numbered word per line: "[12] hola 3.42" (word number, word, start second). Use the numbers with video_keep_ranges and video_cut_words. Long transcripts come in pages.',
    parameters: obj({ media: MEDIA, page: { type: 'integer', minimum: 1 } }),
  },
  {
    name: 'video_add_media',
    description:
      'Import a video, audio or image file (absolute path) into Video Studio and put it on the timeline (at "start" seconds, default the end of the first free track). Use it for files from generate_image / generate_video / generate_speech too.',
    parameters: obj(
      {
        path: { type: 'string' },
        start: { type: 'number', minimum: 0 },
        track: { type: 'string', description: 'Track id or name (optional)' },
      },
      ['path'],
    ),
  },
  {
    name: 'video_keep_ranges',
    description:
      'Keep ONLY these stretches of what is said in a media item, in the order given, back to back (everything else of that media leaves the timeline). This is the tool for shorts and highlights: read video_transcript, choose the interesting word ranges, pass them here. Returns the new duration.',
    parameters: obj({ media: MEDIA, ranges: RANGES }, ['ranges']),
  },
  {
    name: 'video_cut_words',
    description:
      'Cut these word stretches out of every clip of a media item and close the gaps (text-based editing).',
    parameters: obj({ media: MEDIA, ranges: RANGES }, ['ranges']),
  },
  {
    name: 'video_remove_fillers',
    description: 'Cut the filler words ("eh", "em", "um"…) of a transcribed media item.',
    parameters: obj({ media: MEDIA }),
  },
  {
    name: 'video_remove_silences',
    description:
      'Find the silences of a media item with FFmpeg and cut them (keeping a little air).',
    parameters: obj({
      media: MEDIA,
      noise_db: { type: 'number', minimum: -80, maximum: -10, description: 'Default -35' },
      min_seconds: { type: 'number', minimum: 0.2, maximum: 10, description: 'Default 0.6' },
    }),
  },
  {
    name: 'video_split_scenes',
    description: 'Split a clip at every scene change FFmpeg finds.',
    parameters: obj({
      clip: CLIP,
      sensitivity: { type: 'number', minimum: 0, maximum: 1, description: 'Default 0.5' },
    }),
  },
  {
    name: 'video_split',
    description: 'Split a clip in two at a timeline second.',
    parameters: obj({ clip: CLIP, at: { type: 'number' } }, ['clip', 'at']),
  },
  {
    name: 'video_trim',
    description: 'Move the start and/or end edge of a clip to these timeline seconds.',
    parameters: obj({ clip: CLIP, start: { type: 'number' }, end: { type: 'number' } }, ['clip']),
  },
  {
    name: 'video_move',
    description: 'Move a clip to a timeline second and, optionally, another track of its kind.',
    parameters: obj(
      { clip: CLIP, start: { type: 'number', minimum: 0 }, track: { type: 'string' } },
      ['clip'],
    ),
  },
  {
    name: 'video_delete',
    description: 'Delete clips. ripple (default true) closes the gaps on their tracks.',
    parameters: obj(
      { clips: { type: 'array', items: { type: 'string' } }, ripple: { type: 'boolean' } },
      ['clips'],
    ),
  },
  {
    name: 'video_add_title',
    description:
      'Add an animated title (text over the video). style: title, subtitle, lower (lower third), caption, cta, quote.',
    parameters: obj(
      {
        text: { type: 'string' },
        start: { type: 'number', minimum: 0, description: 'Default: the playhead' },
        duration: { type: 'number', minimum: 0.2, maximum: 600, description: 'Default 4' },
        style: { type: 'string', enum: ['title', 'subtitle', 'lower', 'caption', 'cta', 'quote'] },
        position: { type: 'string', enum: ['top', 'center', 'bottom'] },
        color: { type: 'string', description: '"#rrggbb"' },
      },
      ['text'],
    ),
  },
  {
    name: 'video_captions',
    description:
      'Make captions from the transcripts of what is on the timeline, as editable titles on a "Subtítulos" track (redoing replaces them). Run it after the cuts. style: classic, yellow, bold, minimal.',
    parameters: obj({ style: { type: 'string', enum: ['classic', 'yellow', 'bold', 'minimal'] } }),
  },
  {
    name: 'video_set_format',
    description:
      'Change the canvas aspect: 16:9, 9:16 (vertical: TikTok, Reels, Shorts), 1:1, 4:5, 21:9. Shots are zoomed to fill, centred (fill:false keeps them whole with bars).',
    parameters: obj(
      {
        aspect: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:5', '21:9'] },
        fill: { type: 'boolean' },
      },
      ['aspect'],
    ),
  },
  {
    name: 'video_speed_ramp',
    description:
      'Speed ramp on a video or audio clip: the speed changes gradually along it (slow motion in the middle, a fast start…). Presets: hero (normal → slow motion → normal), bullet (fast → very slow → fast), montage (normal → fast → normal), flashIn (fast start), flashOut (fast end), slowEnd (slows down at the end). Or "points": the curve as [{at: 0…1 along the clip, speed: 0.25…4}]. The clip becomes several short steps (one per quarter second of source) shown as one ramp; later clips on its track move so nothing overlaps. remove=true turns the steps back into one clip.',
    parameters: obj(
      {
        clip: CLIP,
        preset: {
          type: 'string',
          enum: ['hero', 'bullet', 'montage', 'flashIn', 'flashOut', 'slowEnd'],
        },
        points: {
          type: 'array',
          maxItems: 16,
          items: obj(
            {
              at: { type: 'number', minimum: 0, maximum: 1 },
              speed: { type: 'number', minimum: 0.25, maximum: 4 },
            },
            ['at', 'speed'],
          ),
        },
        steps: {
          type: 'integer',
          minimum: 3,
          maximum: 40,
          description: 'How many steps (default: automatic)',
        },
        remove: { type: 'boolean' },
      },
      ['clip'],
    ),
  },
  {
    name: 'video_color',
    description:
      'Colour correction of video / image clips (default: every one on the timeline). Values change only what you give; the rest of the clip’s correction stays. reset=true removes the correction. preset: a ready style (neutral, warm, cool, tealOrange, matte, punchy, bleach) that replaces the wheels and balance. lift (shadows), gamma (midtones), gain (highlights): {m: master, r, g, b}, each -1…1, small values (±0.05…0.2) look natural. temperature (-1 cool … 1 warm) and tint (-1 green … 1 magenta). curve: a master RGB curve preset (sSoft, sStrong = S contrast; fade = faded blacks; brighten, darken = midtones). curves: points per curve {m, r, g, b}: [[in, out], …] with 0…1 values (e.g. {"b": [[0,0.05],[0.5,0.55],[1,1]]} lifts the blue); [] removes that curve.',
    parameters: obj({
      clips: { type: 'array', items: { type: 'string' }, maxItems: 200, description: 'Clip ids (optional)' },
      preset: { type: 'string', enum: ['neutral', 'warm', 'cool', 'tealOrange', 'matte', 'punchy', 'bleach'] },
      lift: WHEEL,
      gamma: WHEEL,
      gain: WHEEL,
      temperature: { type: 'number', minimum: -1, maximum: 1 },
      tint: { type: 'number', minimum: -1, maximum: 1 },
      curve: { type: 'string', enum: ['sSoft', 'sStrong', 'fade', 'brighten', 'darken'] },
      curves: obj({ m: CURVE_PTS, r: CURVE_PTS, g: CURVE_PTS, b: CURVE_PTS }),
      reset: { type: 'boolean' },
    }),
  },
  {
    name: 'video_auto_zoom',
    description:
      'Auto zoom on a screen recording made in Zinarix (like Screen Studio): wherever the mouse comes to rest, the picture zooms in towards it, follows it to the next resting place and zooms back out. Uses the cursor path saved with the recording (full-screen recordings only). It writes scale / x / y keyframes on the clip (replacing the ones it had). scale: how much it zooms (1.1…3, default 1.8). remove=true takes the zoom off.',
    parameters: obj(
      {
        clip: CLIP,
        scale: { type: 'number', minimum: 1.1, maximum: 3 },
        remove: { type: 'boolean' },
      },
      ['clip'],
    ),
  },
  {
    name: 'video_proxies',
    description:
      'Proxy files: light 540p copies of heavy videos (4K, high bitrate) so the preview plays smoothly; the export always uses the originals. action "make" creates them (for "media" ids, default every video bigger than 1080p on the timeline), "status" lists which media have one, "on" / "off" switches the preview between proxies and originals. Does not change the project.',
    parameters: obj(
      {
        action: { type: 'string', enum: ['make', 'status', 'on', 'off'] },
        media: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 100,
          description: 'Media ids or names (optional)',
        },
      },
      ['action'],
    ),
  },
  {
    name: 'video_transitions',
    description:
      'List the transitions available: the built-in kinds and the custom ones the user saved or that people shared in the Zinarix Studio repository (ids for video_add_transition "transition_id").',
    parameters: obj({}),
  },
  {
    name: 'video_add_transition',
    description:
      'Put a transition on clips (default: every video clip that follows another, i.e. every cut). Use a built-in "kind", a saved "transition_id", or INVENT a new one with "custom": curves of how the incoming clip looks from t=0 (start) to t=1 (fully in). Channels: alpha 0…1 (opacity), dx / dy -1…1 (offset as share of the frame width / height, + is right / down), scale 0.1…3, reveal 0…1 (share shown from the left). Every channel is forced to end in place at t=1 (alpha 1, dx 0, dy 0, scale 1, reveal 1). Example "zoom with a turn-in from the right": {"name":"Zoom desde la derecha","channels":{"alpha":[{"t":0,"v":0},{"t":0.4,"v":1}],"dx":[{"t":0,"v":0.3}],"scale":[{"t":0,"v":1.6},{"t":0.7,"v":0.95}]}}. A new custom transition is saved in the user’s library. remove=true takes the transitions off.',
    parameters: obj({
      clips: { type: 'array', items: { type: 'string' }, description: 'Clip ids (optional)' },
      kind: { type: 'string', enum: [...TRANSITION_KINDS] },
      transition_id: { type: 'string', description: 'A custom transition from video_transitions' },
      custom: {
        type: 'object',
        description: 'A new transition (data only)',
        properties: {
          name: { type: 'string', maxLength: 40 },
          description: { type: 'string', maxLength: 200 },
          ease: { type: 'string', enum: ['smooth', 'linear'] },
          channels: {
            type: 'object',
            properties: {
              alpha: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    t: { type: 'number', minimum: 0, maximum: 1 },
                    v: { type: 'number' },
                  },
                  required: ['t', 'v'],
                },
                maxItems: 12,
              },
              dx: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    t: { type: 'number', minimum: 0, maximum: 1 },
                    v: { type: 'number' },
                  },
                  required: ['t', 'v'],
                },
                maxItems: 12,
              },
              dy: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    t: { type: 'number', minimum: 0, maximum: 1 },
                    v: { type: 'number' },
                  },
                  required: ['t', 'v'],
                },
                maxItems: 12,
              },
              scale: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    t: { type: 'number', minimum: 0, maximum: 1 },
                    v: { type: 'number' },
                  },
                  required: ['t', 'v'],
                },
                maxItems: 12,
              },
              reveal: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    t: { type: 'number', minimum: 0, maximum: 1 },
                    v: { type: 'number' },
                  },
                  required: ['t', 'v'],
                },
                maxItems: 12,
              },
            },
          },
        },
        required: ['name', 'channels'],
      },
      duration: { type: 'number', minimum: 0.1, maximum: 4, description: 'Seconds (default 0.6)' },
      remove: { type: 'boolean' },
    }),
  },
  {
    name: 'video_share_transition',
    description:
      'Propose one of the user’s custom transitions to the Zinarix Studio repository on GitHub so every user gets it: opens GitHub in the browser with the file filled in (a fork and a pull request for people who cannot write to the repo). Nothing is published until the user confirms on GitHub.',
    parameters: obj(
      {
        transition_id: { type: 'string' },
        author: {
          type: 'string',
          maxLength: 40,
          description: 'Name to credit (optional, only if the user gave it)',
        },
      },
      ['transition_id'],
    ),
  },
  {
    name: 'video_transcribe',
    description:
      'Transcribe a media item with word times (local whisper.cpp when installed, else a connected provider, which uploads the audio). Needed before video_transcript, video_keep_ranges, video_cut_words, video_remove_fillers and video_captions.',
    parameters: obj({
      media: MEDIA,
      engine: { type: 'string', description: 'Engine id (optional): whisper.cpp, openai, groq' },
      lang: { type: 'string', description: 'Language code like "es" (optional: auto)' },
    }),
  },
  {
    name: 'video_export',
    description:
      'Render the timeline to an MP4 file and wait until it is done. preset: yt1080 (default), yt4k, vertical, square, web, max. "path" is optional (default: the project folder, or Videos).',
    parameters: obj({
      preset: { type: 'string', enum: ['yt1080', 'yt4k', 'vertical', 'square', 'web', 'max'] },
      path: { type: 'string', description: 'Absolute .mp4 path (optional)' },
      loudness: { type: 'number', enum: [-14, -16, -23], description: 'Normalise to LUFS' },
    }),
  },
];

export const VIDEO_TOOL_NAMES = new Set<string>(VIDEO_TOOL_LIST);
export const VIDEO_READ_ONLY = new Set<string>(VIDEO_READ_TOOLS);
const ASK = new Set<string>(VIDEO_ASK_TOOLS);

export const VIDEO_PROMPT_PART =
  '- video_*: edit the project open in Video Studio. Flow for edits of what is said: video_state → video_transcribe (if no transcript) → video_transcript → video_keep_ranges (shorts, highlights) or video_cut_words / video_remove_fillers / video_remove_silences → video_set_format (9:16 for shorts) → video_captions → video_export. Every edit is one Ctrl+Z step for the user. Choose word ranges that make complete sentences. Generated media goes onto the timeline with video_add_media. Transitions: video_transitions lists them; video_add_transition puts one on the cuts, and can invent a new one ("custom" curves), which is saved in the user’s library; video_share_transition proposes it to the Zinarix Studio repository so other users get it (only when the user asks to share). Slow motion / speed-up that changes along a clip: video_speed_ramp. Colour correction, looks, contrast curves: video_color. Zoom towards the mouse in a screen recording: video_auto_zoom. When the user says playback is slow or choppy with 4K or heavy files: video_proxies make.';

/** The window that holds Video Studio: dry runs a call (approval card) or applies it. */
export interface VideoUi {
  call(
    name: string,
    args: Record<string, unknown>,
    dry: boolean,
    signal?: AbortSignal,
  ): Promise<VideoAgentResult>;
}

/**
 * Approval card for a video_* call, from a dry run in the window (null = a read, no approval).
 * A call that cannot apply is refused before asking ({ error }), with the reason for the model.
 */
export async function videoPreview(
  ui: VideoUi | undefined,
  name: string,
  a: Record<string, unknown>,
): Promise<SystemPreview | { error: string } | null> {
  if (VIDEO_READ_ONLY.has(name)) return null;
  if (!ui) return { error: 'Video Studio is not available.' };
  let r: VideoAgentResult;
  try {
    r = await ui.call(name, a, true);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  if (!r.ok) return { error: r.content };
  const ask = ASK.has(name);
  return {
    risk: 'medium',
    action: r.content,
    warning: ask ? r.summary : `${r.summary}. Se deshace con Ctrl+Z en Video Studio.`,
    ...(ask ? {} : { allowKey: 'video:edit' }),
  };
}

export async function runVideoTool(
  ui: VideoUi | undefined,
  name: string,
  a: Record<string, unknown>,
  signal: AbortSignal,
): Promise<VideoAgentResult> {
  if (!ui)
    return { ok: false, content: 'Video Studio is not available.', summary: 'no disponible' };
  try {
    return await ui.call(name, a, false, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, content: msg, summary: 'falló' };
  }
}
