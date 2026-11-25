import { describe, expect, it } from 'vitest';
import { diskPath } from '../src/renderer/diskPath';

describe('diskPath (explorer "copy path")', () => {
  it('uses backslashes under a Windows root', () => {
    expect(diskPath('C:\\Users\\ana\\proyecto', 'src/app.ts')).toBe(
      'C:\\Users\\ana\\proyecto\\src\\app.ts',
    );
    expect(diskPath('C:\\proyecto\\', 'a.txt')).toBe('C:\\proyecto\\a.txt');
  });

  it('uses slashes under a POSIX root', () => {
    expect(diskPath('/home/ana/proyecto', 'src/app.ts')).toBe('/home/ana/proyecto/src/app.ts');
    expect(diskPath('/home/ana/proyecto/', 'a.txt')).toBe('/home/ana/proyecto/a.txt');
  });
});
