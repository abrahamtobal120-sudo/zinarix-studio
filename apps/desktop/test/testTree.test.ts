import { describe, expect, it } from 'vitest';
import { filesUnder, testFileLabel, testFileTree } from '../src/renderer/testTree';

describe('Test Explorer file tree', () => {
  it('groups files by folder relative to the runner and compacts single-child chains', () => {
    const tree = testFileTree(
      [
        'apps/desktop/test/b.test.ts',
        'apps/desktop/test/a.test.ts',
        'apps/desktop/src/deep/x/y/z.spec.ts',
        'apps/desktop/root.test.ts',
      ],
      'apps/desktop',
    );
    expect(tree.path).toBe('apps/desktop');
    expect(tree.files).toEqual(['apps/desktop/root.test.ts']);
    expect(tree.folders.map((f) => [f.name, f.path])).toEqual([
      ['src/deep/x/y', 'apps/desktop/src/deep/x/y'],
      ['test', 'apps/desktop/test'],
    ]);
    expect(tree.folders[1]!.files).toEqual([
      'apps/desktop/test/a.test.ts',
      'apps/desktop/test/b.test.ts',
    ]);
    expect(filesUnder(tree)).toHaveLength(4);
  });

  it('works for a runner at the workspace root', () => {
    const tree = testFileTree(['test/a.test.ts', 'b.test.ts'], '');
    expect(tree.files).toEqual(['b.test.ts']);
    expect(tree.folders[0]!.name).toBe('test');
  });

  it('drops the test suffix and extension from the shown name', () => {
    expect(testFileLabel('test/agent-escape.test.ts')).toBe('agent-escape');
    expect(testFileLabel('a/Button.spec.tsx')).toBe('Button');
    expect(testFileLabel('tests/test_api.py')).toBe('test_api');
    expect(testFileLabel('x/.test.ts')).toBe('.test');
  });
});
