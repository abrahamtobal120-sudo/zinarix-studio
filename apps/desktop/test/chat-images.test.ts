import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '@omni/shared';
import { addImageParts, dropOldImages, imagesAsFiles } from '../src/main/chatImages.js';
import { withProtocol } from '../src/main/textTools.js';

const img = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };

describe('chat images', () => {
  it('adds image parts after the text', () => {
    expect(addImageParts({ role: 'user', content: 'mira' }, [img])).toEqual({
      role: 'user',
      content: [
        { type: 'text', text: 'mira' },
        { type: 'image', mediaType: 'image/png', data: img.data },
      ],
    });
  });

  it('keeps images through the text tool protocol', () => {
    const m = addImageParts({ role: 'user', content: 'x' }, [img]);
    const c = withProtocol([m], 'TOOLS', 'user')[0]!.content as { type: string }[];
    expect(c.some((p) => p.type === 'image')).toBe(true);
  });

  it('writes files for CLI agents', () => {
    const m = imagesAsFiles({ role: 'user', content: 'x' }, [img]);
    const path = /- (.+\.png)/.exec(m.content as string)![1]!;
    expect(existsSync(path)).toBe(true);
  });

  it('drops images of older turns', () => {
    const msgs: ChatMessage[] = [
      addImageParts({ role: 'user', content: 'old' }, [img]),
      { role: 'assistant', content: 'ok' },
      addImageParts({ role: 'user', content: 'new' }, [img]),
    ];
    dropOldImages(msgs);
    expect(msgs[0]!.content).toBe('old\n[image attached earlier]');
    expect(Array.isArray(msgs[2]!.content)).toBe(true);
  });
});
