import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { WARN_EVERY_MS, diskAction, mayWarn, textFingerprint } from '../src/renderer/diskSync.js';
import { Workspace } from '../src/main/workspace.js';

/** B3: open files follow the disk (git checkout, formatters, other programs). */

describe('diskSync: what an open tab does about a change on disk', () => {
  it('fingerprints tell texts apart, including line endings', () => {
    expect(textFingerprint('hola\n')).toBe(textFingerprint('hola\n'));
    expect(textFingerprint('hola\n')).not.toBe(textFingerprint('hola\r\n'));
    expect(textFingerprint('ab')).not.toBe(textFingerprint('ba'));
    expect(textFingerprint('')).toBe('0:' + (0x811c9dc5).toString(36));
  });

  it('does nothing when the disk has what the tab last read or wrote', () => {
    const known = textFingerprint('const a = 1;\n');
    // Our own save, seen back through the watcher: even with newer typing, no notice.
    expect(diskAction(known, 'const a = 1;\n', false)).toBe('same');
    expect(diskAction(known, 'const a = 1;\n', true)).toBe('same');
  });

  it('reloads a clean tab and warns on one with unsaved changes', () => {
    const known = textFingerprint('rama main\n');
    expect(diskAction(known, 'rama feature\n', false)).toBe('reload');
    expect(diskAction(known, 'rama feature\n', true)).toBe('warn');
    // A tab opened before fingerprints existed is treated as changed.
    expect(diskAction(undefined, 'x', false)).toBe('reload');
  });

  it('shows the notice once per minute per file', () => {
    const last = new Map<string, number>();
    expect(mayWarn(last, 'a.ts', 1_000)).toBe(true);
    expect(mayWarn(last, 'a.ts', 2_000)).toBe(false);
    expect(mayWarn(last, 'b.ts', 2_000)).toBe(true);
    expect(mayWarn(last, 'a.ts', 1_000 + WARN_EVERY_MS)).toBe(true);
  });
});

describe('Workspace.watch reports which files changed', () => {
  let root: string | undefined;
  let ws: Workspace | undefined;
  afterEach(() => {
    ws?.dispose();
    if (root) rmSync(root, { recursive: true, force: true });
    root = undefined;
    ws = undefined;
  });

  const waitFor = async (ok: () => boolean, ms = 8000) => {
    const end = Date.now() + ms;
    while (!ok() && Date.now() < end) await new Promise((r) => setTimeout(r, 50));
  };

  it('lists changed paths with "/" and leaves .git and node_modules out', async () => {
    root = mkdtempSync(join(tmpdir(), 'zx-watch-paths-'));
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'node_modules'));
    writeFileSync(join(root, 'src', 'a.ts'), 'uno\n');
    ws = new Workspace(root);
    const batches: (string[] | null)[] = [];
    ws.watch((paths) => batches.push(paths));
    // The watcher needs a moment to start on some platforms.
    await new Promise((r) => setTimeout(r, 300));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref\n');
    writeFileSync(join(root, 'node_modules', 'x.js'), '1\n');
    writeFileSync(join(root, 'src', 'a.ts'), 'dos\n');
    await waitFor(() => batches.length > 0);
    const all = batches.flatMap((b) => b ?? []);
    expect(batches.length).toBeGreaterThan(0);
    expect(all).toContain('src/a.ts');
    expect(all.some((p) => p.startsWith('.git') || p.startsWith('node_modules'))).toBe(false);
  });

  it('reports "many" (null) instead of a huge list', async () => {
    root = mkdtempSync(join(tmpdir(), 'zx-watch-many-'));
    ws = new Workspace(root);
    const batches: (string[] | null)[] = [];
    ws.watch((paths) => batches.push(paths));
    await new Promise((r) => setTimeout(r, 300));
    for (let i = 0; i < 400; i++) writeFileSync(join(root, `f${i}.txt`), 'x');
    await waitFor(() => batches.length > 0);
    await new Promise((r) => setTimeout(r, 400));
    expect(batches.some((b) => b === null)).toBe(true);
  });
});
