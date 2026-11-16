import { describe, expect, it } from 'vitest';
import { addTextClip, newProject } from '../src/shared/video.js';
import { STICKER_ANIM, STICKER_GROUPS, stickerSpec, validText } from '../src/shared/videoFx.js';

describe('stickers', () => {
  it('every sticker makes a valid text clip', () => {
    for (const g of STICKER_GROUPS)
      for (const it of g.items) expect(validText(stickerSpec(it, g.id, '#ffd400'))).toBe(true);
  });

  it('shapes take the chosen colour; a bad colour falls back to white', () => {
    expect(stickerSpec('★', 'shapes', '#ff3b30').color).toBe('#ff3b30');
    expect(stickerSpec('★', 'shapes', 'red').color).toBe('#ffffff');
  });

  it('a sticker lands at the playhead with the pop animation', () => {
    const p = newProject();
    const { project, clip } = addTextClip(p, stickerSpec('🔥', 'emoji'), 2, {
      dur: 3,
      anim: STICKER_ANIM,
    });
    expect(clip.start).toBe(2);
    expect(clip.out - clip.in).toBe(3);
    expect(clip.text?.content).toBe('🔥');
    expect(clip.anim?.in).toBe('pop');
    expect(project.clips).toContainEqual(clip);
  });
});
