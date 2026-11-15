import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FFmpeg ships inside the installer under the GPL: every platform must carry
// its license text and the source notice next to the binaries.
const root = join(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

describe('FFmpeg GPL notice in the installer', () => {
  it('has the notice and the GPL text', () => {
    const notice = readFileSync(join(root, 'build/ffmpeg/FFMPEG-NOTICE.txt'), 'utf8');
    expect(notice).toMatch(/GNU General Public License/);
    expect(notice).toMatch(/ffmpeg-6\.1\.1/);
    expect(notice).toMatch(/Written offer/);
    const gpl = readFileSync(join(root, 'build/ffmpeg/COPYING.GPLv3.txt'), 'utf8');
    expect(gpl).toMatch(/GNU GENERAL PUBLIC LICENSE\s+Version 3/);
  });

  it('links the exact source of every build', () => {
    const src = readFileSync(join(root, 'build/ffmpeg/FFMPEG-SOURCE.txt'), 'utf8');
    for (const re of [/Windows x64/, /macOS/, /Linux/, /e38092ef93/, /n6\.1\.1/, /n4\.0\.2/])
      expect(src).toMatch(re);
  });

  for (const platform of ['win', 'mac', 'linux']) {
    it(`${platform} copies the notice next to ffmpeg`, () => {
      const res: { from: string; to: string }[] = pkg.build[platform].extraResources;
      expect(res.some((r) => r.to.startsWith('ffmpeg/ffmpeg'))).toBe(true);
      expect(res).toContainEqual(expect.objectContaining({ from: 'build/ffmpeg', to: 'ffmpeg' }));
      expect(existsSync(join(root, 'build/ffmpeg'))).toBe(true);
    });
  }
});
