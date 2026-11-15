import { describe, expect, it } from 'vitest';
import { isRuleFile, protectedWrite } from '../src/main/guard.js';
import { approvalKey } from '../src/main/agent.js';

describe('rule files are protected writes', () => {
  it('recognizes every rule source of Fase 1', () => {
    for (const p of [
      'AGENTS.md',
      'packages/core/AGENTS.md',
      'CLAUDE.md',
      'src\\CLAUDE.md',
      '.cursorrules',
      '.github/copilot-instructions.md',
      '.github/instructions/ts.instructions.md',
      '.zinarix/rules.md',
      '.zinarix/rules/style.md',
      './AGENTS.md',
    ])
      expect(isRuleFile(p), p).toBe(true);
  });

  it('leaves ordinary files alone', () => {
    for (const p of ['README.md', 'docs/agents.mdx', 'src/AGENTS.md.bak', '.zinarix/notes.md'])
      expect(isRuleFile(p), p).toBe(false);
    expect(protectedWrite('src/App.tsx')).toBeNull();
  });

  it('needs one approval per change, never "always" or auto-approve (/init)', () => {
    expect(protectedWrite('AGENTS.md')).toMatch(/reglas del proyecto/);
    // No approval key: auto mode and the "always" list never cover it.
    expect(approvalKey('write_file', { path: 'AGENTS.md' })).toBeNull();
    expect(approvalKey('write_file', { path: 'src/a.ts' })).toBe('write_file');
  });
});
