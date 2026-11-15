import { describe, expect, it } from 'vitest';
import { expandVars, parseTasksJson, type TaskContext } from '../src/shared/vscodeTasks.js';

const ctx: TaskContext = {
  root: '/repo',
  file: 'src/a.ts',
  platform: 'linux',
  packageManager: 'pnpm',
};

const TASKS = `{
  // VS Code writes JSONC
  "version": "2.0.0",
  "tasks": [
    { "label": "tsc", "type": "shell", "command": "tsc", "args": ["-p", "tsconfig.json"], "group": { "kind": "build", "isDefault": true } },
    { "label": "lint", "type": "shell", "command": "eslint", "args": ["\${file}", "--fix"], "options": { "cwd": "\${workspaceFolder}/web" } },
    { "type": "npm", "script": "test", "path": "packages/core", "group": "test" },
    { "label": "all", "dependsOn": ["tsc", "lint"] },
    { "label": "win", "command": "make", "windows": { "command": "nmake" } },
    { "label": "ask", "command": "deploy \${input:env}" },
    { "label": "loop-a", "command": "a", "dependsOn": "loop-b" },
    { "label": "loop-b", "command": "b", "dependsOn": "loop-a" },
    { "label": "escape", "command": "x", "options": { "cwd": "../outside" } },
    { "label": "watch", "command": "vite", "isBackground": true },
  ],
}`;

describe('parseTasksJson', () => {
  const tasks = parseTasksJson(TASKS, ctx);
  const by = (l: string) => tasks.find((t) => t.label === l)!;

  it('builds the command with its args, group and cwd', () => {
    expect(by('tsc')).toMatchObject({
      command: 'tsc -p tsconfig.json',
      group: 'build',
      isDefault: true,
    });
    expect(by('lint').command).toBe('cd "web" && eslint /repo/src/a.ts --fix');
  });

  it('runs npm tasks with the project package manager, in their folder', () => {
    expect(by('npm: test')).toMatchObject({
      command: 'cd "packages/core" && pnpm run test',
      group: 'test',
    });
  });

  it('runs dependencies first', () => {
    expect(by('all').command).toBe(
      'tsc -p tsconfig.json && cd "web" && eslint /repo/src/a.ts --fix',
    );
  });

  it('uses the OS-specific command', () => {
    expect(by('win').command).toBe('make');
    expect(
      parseTasksJson(TASKS, { ...ctx, platform: 'windows' }).find((t) => t.label === 'win')!
        .command,
    ).toBe('nmake');
  });

  it('flags what it cannot run: input variables, loops, a cwd outside the folder', () => {
    expect(by('ask').problem).toBe('${input:env}');
    expect(by('loop-a').problem).toBe('dependsOn loop');
    expect(by('escape').problem).toBe('options.cwd');
    expect(by('watch')).toMatchObject({ background: true, command: 'vite' });
  });

  it('broken JSON gives no tasks', () => {
    expect(parseTasksJson('{ nope', ctx)).toEqual([]);
  });
});

describe('expandVars', () => {
  it('expands file variables with the platform separator', () => {
    expect(
      expandVars('${fileDirname}${pathSeparator}${fileBasenameNoExtension}', {
        ...ctx,
        root: 'C:\\r',
        platform: 'windows',
      }),
    ).toEqual({
      value: 'C:\\r\\src\\a',
    });
  });
});
