import type { ToolDefinition } from '@omni/shared';
import {
  VIDEO_ASK_TOOLS,
  VIDEO_READ_TOOLS,
  VIDEO_TOOL_LIST,
  type VideoAgentResult,
} from '../shared/videoAgent.js';
import type { SystemPreview } from './system.js';

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
  '- video_*: edit the project open in Video Studio. Flow for edits of what is said: video_state → video_transcribe (if no transcript) → video_transcript → video_keep_ranges (shorts, highlights) or video_cut_words / video_remove_fillers / video_remove_silences → video_set_format (9:16 for shorts) → video_captions → video_export. Every edit is one Ctrl+Z step for the user. Choose word ranges that make complete sentences. Generated media goes onto the timeline with video_add_media.';

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
  if (!ui) return { ok: false, content: 'Video Studio is not available.', summary: 'no disponible' };
  try {
    return await ui.call(name, a, false, signal);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, content: msg, summary: 'falló' };
  }
}
