import { describe, expect, it } from 'vitest';
import {
  analyzePrompt,
  isAnalyzePrompt,
  isSubphasePrompt,
  nextSub,
  parsePhasePlan,
  parseSubResult,
  phasesFromMarkdown,
  phasesProgress,
  phasesStatePath,
  readSavedPlan,
  setSub,
  subphasePrompt,
} from '../src/shared/phases';

const fence = '```';
const answer = `Resumen: dos fases.
${fence}json
{"title":"Login","phases":[
 {"title":"Backend","goal":"API","subphases":[{"title":"Ruta /login","detail":"server.ts"},{"title":"Tests","detail":"vitest"}]},
 {"title":"UI","subphases":[]}
]}
${fence}`;

describe('phases mode', () => {
  it('parses the plan the AI wrote, numbering phases and subphases', () => {
    const p = parsePhasePlan(answer, 'CAMBIOS.md')!;
    expect(p.title).toBe('Login');
    expect(p.phases.map((x) => x.subphases.map((s) => s.id))).toEqual([['1.1', '1.2'], ['2.1']]);
    expect(phasesProgress(p)).toEqual({ done: 0, total: 3 });
  });

  it('falls back to the headings of the document', () => {
    const md = '# Cambios\n\n## Fase A\n- uno\n- dos\n\n## Fase B\n### Paso 1\nhacer x\n';
    const p = phasesFromMarkdown(md, 'c.md')!;
    expect(p.title).toBe('Cambios');
    expect(p.phases.map((x) => x.title)).toEqual(['Fase A', 'Fase B']);
    expect(p.phases[0]!.subphases.map((s) => s.title)).toEqual(['uno', 'dos']);
    expect(p.phases[1]!.subphases[0]!.detail).toBe('hacer x');
  });

  it('runs subphases in order and reads the result line', () => {
    let p = parsePhasePlan(answer, 'CAMBIOS.md')!;
    expect(nextSub(p)!.id).toBe('1.1');
    expect(isSubphasePrompt(subphasePrompt(p, '1.1'))).toBe(true);
    expect(isAnalyzePrompt(analyzePrompt('CAMBIOS.md'))).toBe(true);
    const r = parseSubResult('hice cosas\n**RESULTADO: OK** agregué la ruta');
    expect(r).toMatchObject({ ok: true, summary: 'agregué la ruta', marked: true });
    p = setSub(p, '1.1', { status: 'done', summary: r.summary });
    expect(nextSub(p)!.id).toBe('1.2');
    expect(parseSubResult('RESULTADO: FALLO: no compila')).toMatchObject({
      ok: false,
      summary: 'no compila',
    });
  });

  it('saves and resumes the progress (a running one goes back to pending)', () => {
    let p = parsePhasePlan(answer, 'docs/CAMBIOS.md')!;
    p = setSub(setSub(p, '1.1', { status: 'done', summary: 'ok' }), '1.2', { status: 'running' });
    const back = readSavedPlan(JSON.stringify(p))!;
    expect(back.phases[0]!.subphases.map((s) => s.status)).toEqual(['done', 'pending']);
    expect(phasesStatePath('docs/CAMBIOS.md')).toBe('.zinarix/fases/docs-CAMBIOS.json');
  });
});
