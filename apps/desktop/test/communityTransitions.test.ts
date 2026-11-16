import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseTransitionFile, transitionFile } from '../src/shared/videoTransitions.js';

/**
 * Guards community/transitions (what users propose by pull request): every file must be a
 * valid transition, already in the exact normalized form, named after its id.
 */
const DIR = join(__dirname, '..', '..', '..', 'community', 'transitions');
const files = readdirSync(DIR).filter((f) => f !== 'README.md');

describe('community/transitions', () => {
  it('has transitions', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)('%s is a valid Zinarix transition', (f) => {
    expect(f).toMatch(/^[a-z0-9-]+\.json$/);
    const text = readFileSync(join(DIR, f), 'utf8').replace(/\r\n/g, '\n');
    const d = parseTransitionFile(text);
    if ('error' in d) throw new Error(`${f}: ${d.error}`);
    expect(`${d.id}.json`).toBe(f);
    // Exactly what Zinarix would write: nothing extra, nothing out of range.
    expect(text).toBe(transitionFile(d));
  });

  it('ids are unique', () => {
    const ids = files.map((f) => f.replace(/\.json$/, ''));
    expect(new Set(ids).size).toBe(ids.length);
  });
});
