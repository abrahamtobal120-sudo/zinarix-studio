import { describe, expect, it } from 'vitest';
import { fold, searchSettings, type SettingEntry } from '../src/renderer/settingsSearch';

const E = (section: string, label: string, extra: Partial<SettingEntry> = {}): SettingEntry => ({
  section,
  sectionLabel: section,
  label,
  ...extra,
});

const entries: SettingEntry[] = [
  E('appearance', 'Tema', { keywords: 'theme dark oscuro claro' }),
  E('appearance', 'Tamaño de fuente', { keywords: 'font size letra' }),
  E('editor', 'Ajuste de línea', { keywords: 'word wrap' }),
  E('editor', 'Formatear al guardar', { hint: 'Usa Prettier si el proyecto lo tiene' }),
  E('editor', 'Guardado automático', { hint: 'Guarda tras una pausa al escribir' }),
  E('keys', 'Guardar archivo', { command: 'file.save' }),
];

describe('fold', () => {
  it('ignores accents and case', () => {
    expect(fold('Tamaño de LÍNEA')).toBe('tamano de linea');
  });
});

describe('searchSettings', () => {
  it('returns nothing for an empty query', () => {
    expect(searchSettings(entries, '   ')).toEqual([]);
  });

  it('finds a setting typed without accents', () => {
    expect(searchSettings(entries, 'tamano').map((h) => h.label)).toEqual(['Tamaño de fuente']);
    expect(searchSettings(entries, 'linea').map((h) => h.label)).toEqual(['Ajuste de línea']);
  });

  it('finds by keyword in the other language', () => {
    expect(searchSettings(entries, 'word wrap')[0]!.label).toBe('Ajuste de línea');
    expect(searchSettings(entries, 'dark')[0]!.label).toBe('Tema');
  });

  it('needs every word to match', () => {
    expect(searchSettings(entries, 'formatear guardar').map((h) => h.label)).toEqual([
      'Formatear al guardar',
    ]);
    expect(searchSettings(entries, 'formatear tema')).toEqual([]);
  });

  it('ranks a label match above a hint match, and a setting above a shortcut', () => {
    const labels = searchSettings(entries, 'guarda').map((h) => h.label);
    // Label starts with it (setting), label starts with it (shortcut), word inside the label,
    // none of them only in the hint.
    expect(labels).toEqual(['Guardado automático', 'Guardar archivo', 'Formatear al guardar']);
    const prettier = searchSettings(entries, 'prettier');
    expect(prettier).toHaveLength(1);
    expect(prettier[0]!.score).toBeLessThan(searchSettings(entries, 'formatear')[0]!.score);
  });

  it('matches the section name and respects the limit', () => {
    expect(searchSettings(entries, 'editor')).toHaveLength(3);
    expect(searchSettings(entries, 'editor', 2)).toHaveLength(2);
  });
});
