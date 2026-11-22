/**
 * Test Explorer: a runner's test files as a folder tree relative to the runner's folder, with
 * single-child folder chains merged into one row ("apps/desktop/test"), like VS Code's compact
 * folders.
 */

export interface TestFolder {
  /** Workspace-relative path of the (deepest) folder; '' = the runner's own folder. */
  path: string;
  /** What the row shows: one folder name, or a compacted chain "a/b/c". */
  name: string;
  folders: TestFolder[];
  /** Workspace-relative test files directly inside. */
  files: string[];
}

const join = (a: string, b: string) => (a ? `${a}/${b}` : b);

/** Builds the tree of `files` (workspace-relative, "/") under `root` (workspace-relative). */
export function testFileTree(files: string[], root: string): TestFolder {
  const top: TestFolder = { path: root, name: '', folders: [], files: [] };
  const prefix = root ? `${root}/` : '';
  for (const file of files) {
    // A file outside the runner's folder (should not happen) hangs from its full path.
    const rel = prefix && file.startsWith(prefix) ? file.slice(prefix.length) : file;
    const base = prefix && file.startsWith(prefix) ? root : '';
    const parts = rel.split('/');
    parts.pop();
    let node = top;
    let path = base;
    for (const part of parts) {
      path = join(path, part);
      let next = node.folders.find((f) => f.name === part);
      if (!next) {
        next = { path, name: part, folders: [], files: [] };
        node.folders.push(next);
      }
      node = next;
    }
    node.files.push(file);
  }
  const tidy = (f: TestFolder, isRoot: boolean): TestFolder => {
    let cur = f;
    // A folder holding only one folder is shown merged with it.
    while (!isRoot && !cur.files.length && cur.folders.length === 1) {
      const only = cur.folders[0]!;
      cur = { ...only, name: `${cur.name}/${only.name}` };
    }
    return {
      ...cur,
      folders: cur.folders
        .map((x) => tidy(x, false))
        .sort((a, b) => a.name.localeCompare(b.name)),
      files: [...cur.files].sort((a, b) => baseName(a).localeCompare(baseName(b))),
    };
  };
  return tidy(top, true);
}

/** Every file under a folder (any depth). */
export function filesUnder(f: TestFolder): string[] {
  return [...f.files, ...f.folders.flatMap(filesUnder)];
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf('/') + 1);
}

/**
 * The name a test file shows: its base name without the test suffix and extension
 * ("agent.test.ts" → "agent", "test_api.py" → "test_api").
 */
export function testFileLabel(file: string): string {
  const name = baseName(file);
  const bare = name.replace(/[._-](test|spec)\.[cm]?[jt]sx?$/i, '');
  if (bare !== name && bare) return bare;
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}
