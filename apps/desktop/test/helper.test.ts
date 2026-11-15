import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HelperChunk } from '../src/main/helper.js';
import { Bm25, MODEL_NAME, retrieve, systemPrompt, tokenize } from '../src/main/helper.js';

const chunks: HelperChunk[] = [
  { source: 'g', title: 'Cambiar el tema', text: 'Ver > Alternar tema claro/oscuro. Ajustes > Apariencia > Tema de color.' },
  { source: 'g', title: 'Abrir un proyecto', text: 'Archivo > Abrir carpeta… (Ctrl+O) y elige la carpeta.' },
  { source: 'g', title: 'Conectar una IA', text: 'IA > Proveedores y llaves… pega tu llave de API.' },
  { source: 'g', title: 'Terminal', text: 'Ver > Terminal (Ctrl+J) abre la terminal integrada.' },
];

describe('help assistant retrieval', () => {
  it('normalizes accents, plurals, stopwords and synonyms', () => {
    expect(tokenize('¿Cómo cambio los Ajustes?')).toEqual(['cambio', 'ajust']);
    // "configuración" and "opciones" are folded into the docs' word "ajustes".
    expect(tokenize('configuración opciones')).toEqual(['ajust', 'ajust']);
    expect(tokenize('clave')).toEqual(tokenize('llaves'));
  });

  it('ranks the chunk that answers the question first', () => {
    const idx = new Bm25(chunks);
    expect(idx.search('¿cómo pongo el modo oscuro?')[0]!.chunk.title).toBe('Cambiar el tema');
    expect(idx.search('quiero abrir una carpeta')[0]!.chunk.title).toBe('Abrir un proyecto');
    expect(idx.search('dónde pego mi clave de OpenAI')[0]!.chunk.title).toBe('Conectar una IA');
    expect(idx.search('xyzzy')).toEqual([]);
  });

  it('uses the previous question for follow-ups and fits the budget', () => {
    const idx = new Bm25(chunks);
    const hits = retrieve(idx, '¿y el atajo?', '¿cómo abro la terminal?', 200);
    expect(hits[0]!.chunk.title).toBe('Terminal');
    expect(hits.reduce((n, h) => n + h.chunk.text.length + h.chunk.title.length, 0)).toBeLessThan(
      200,
    );
  });

  it('puts the chunks in a Spanish system prompt that says "no lo sé"', () => {
    const p = systemPrompt(new Bm25(chunks).search('tema'));
    expect(p).toContain('Cambiar el tema');
    expect(p).toMatch(/No lo sé/);
  });

  it('accepts Ollama model names only', () => {
    for (const ok of ['qwen2.5:1.5b', 'llama3.2:1b', 'user/model:q4_K_M', 'gemma3'])
      expect(MODEL_NAME.test(ok), ok).toBe(true);
    for (const bad of ['', '../x', 'a b', 'x;rm -rf', ':tag'])
      expect(MODEL_NAME.test(bad), bad).toBe(false);
  });

  it('the packaged knowledge (guide + generated reference + docs) answers real questions', async () => {
    const url = pathToFileURL(
      fileURLToPath(new URL('../scripts/helper-knowledge.mjs', import.meta.url)),
    ).href;
    const mod = (await import(url)) as { buildKnowledge(): { chunks: HelperChunk[] } };
    const { chunks: all } = mod.buildKnowledge();
    expect(all.length).toBeGreaterThan(30);
    const idx = new Bm25(all);
    const top = (q: string) =>
      idx
        .search(q, 3)
        .map((h) => `${h.chunk.title}\n${h.chunk.text}`)
        .join('\n');
    expect(top('¿Cómo cambio el tema a oscuro?')).toMatch(/tema/i);
    expect(top('¿Cuál es el atajo para guardar?')).toMatch(/Ctrl\+S/);
    expect(top('¿Cómo conecto mi llave de OpenAI?')).toMatch(/Proveedores/);
    // Internal documents are left out.
    expect(all.some((c) => c.source.includes('auditoria-seguridad'))).toBe(false);
  });
});
