import { describe, expect, it } from 'vitest';
import type { ExtThemeData } from '../src/shared/devtools';
import {
  contrast,
  extThemeId,
  langConfig,
  parseHex,
  snippetItems,
  themeRules,
  themeToApp,
  toHex,
} from '../src/shared/extContrib';

const REQUIRED = [
  '--bg',
  '--bg-2',
  '--bg-3',
  '--bg-4',
  '--activity',
  '--border',
  '--fg',
  '--fg-dim',
  '--fg-strong',
  '--accent',
  '--accent-hover',
  '--accent-fg',
  '--focus',
  '--sel',
  '--hover',
  '--status',
  '--status-fg',
  '--danger',
  '--ok',
  '--warn',
  '--code-bg',
  '--brand',
  '--brand-1',
  '--brand-2',
  '--brand-grad',
];

const c = (v: string) => parseHex(v)!;

describe('parseHex', () => {
  it('lee las formas de color de VS Code', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseHex('#282a36')).toEqual({ r: 40, g: 42, b: 54, a: 1 });
    expect(parseHex('#00000080')!.a).toBeCloseTo(0.5, 2);
    expect(toHex(parseHex('#F8f')!)).toBe('#ff88ff');
  });
  it('rechaza lo que no es un color', () => {
    for (const v of ['red', '#12', '#12345', 'rgb(1,2,3)', '', null, 7, '#gggggg'])
      expect(parseHex(v)).toBeNull();
  });
});

describe('themeToApp', () => {
  const dracula: ExtThemeData = {
    label: 'Dracula',
    base: 'vs-dark',
    theme: {
      colors: {
        'editor.background': '#282a36',
        'editor.foreground': '#f8f8f2',
        'sideBar.background': '#21222c',
        'activityBar.background': '#343746',
        'button.background': '#44475a',
        'button.foreground': '#f8f8f2',
        'statusBar.background': '#191a21',
        'statusBar.foreground': '#f8f8f2',
        'list.hoverBackground': '#44475a75',
        focusBorder: '#6272a4',
      },
      tokenColors: [
        { scope: 'comment', settings: { foreground: '#6272a4' } },
        { scope: ['string'], settings: { foreground: '#f1fa8c' } },
        { scope: 'keyword, storage', settings: { foreground: '#ff79c6' } },
      ],
    },
  };

  it('da todas las variables de un tema, sin transparencias', () => {
    const app = themeToApp(dracula);
    expect(app.dark).toBe(true);
    for (const k of REQUIRED) expect(app.vars[k], k).toBeTruthy();
    for (const k of REQUIRED.filter((k) => k !== '--brand-grad'))
      expect(app.vars[k], k).toMatch(/^#[0-9a-f]{6}$/);
    expect(app.vars['--bg']).toBe('#282a36');
    expect(app.vars['--bg-2']).toBe('#21222c');
    // The see-through hover color is painted over the background.
    expect(app.vars['--hover']).not.toBe('#44475a');
  });

  it('el texto se puede leer sobre su fondo', () => {
    const v = themeToApp(dracula).vars;
    expect(contrast(c(v['--fg']!), c(v['--bg']!))).toBeGreaterThanOrEqual(7);
    expect(contrast(c(v['--fg-dim']!), c(v['--bg']!))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c(v['--accent-fg']!), c(v['--accent']!))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c(v['--status-fg']!), c(v['--status']!))).toBeGreaterThanOrEqual(4.5);
    for (const k of ['--danger', '--ok', '--warn'])
      expect(contrast(c(v[k]!), c(v['--bg']!)), k).toBeGreaterThanOrEqual(4.5);
  });

  it('un tema casi vacío sigue siendo usable, claro u oscuro', () => {
    for (const base of ['vs', 'vs-dark', 'hc-black', 'hc-light'] as const) {
      const app = themeToApp({ label: 'x', base, theme: {} });
      expect(app.dark).toBe(base === 'vs-dark' || base === 'hc-black');
      for (const k of REQUIRED) expect(app.vars[k], `${base} ${k}`).toBeTruthy();
      const v = app.vars;
      expect(contrast(c(v['--fg']!), c(v['--bg']!))).toBeGreaterThanOrEqual(7);
      expect(contrast(c(v['--accent-fg']!), c(v['--accent']!))).toBeGreaterThanOrEqual(4.5);
      expect(contrast(c(v['--border']!), c(v['--bg']!))).toBeGreaterThan(1.1);
    }
  });

  it('corrige un texto que el tema dejó ilegible', () => {
    const app = themeToApp({
      label: 'malo',
      base: 'vs-dark',
      theme: {
        colors: {
          'editor.background': '#202020',
          'editor.foreground': '#303030',
          'button.background': '#ffffff',
          'button.foreground': '#fafafa',
          'statusBar.background': '#ffcc00',
          'statusBar.foreground': '#ffdd33',
        },
      },
    });
    const v = app.vars;
    expect(contrast(c(v['--fg']!), c(v['--bg']!))).toBeGreaterThanOrEqual(7);
    expect(contrast(c(v['--accent-fg']!), c(v['--accent']!))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(c(v['--status-fg']!), c(v['--status']!))).toBeGreaterThanOrEqual(4.5);
  });

  it('solo pasa al editor colores válidos', () => {
    const app = themeToApp({
      label: 'x',
      base: 'vs',
      theme: { colors: { 'editor.background': '#ffffff', 'editor.foreground': 'nope' } },
    });
    expect(app.editor).toEqual({ 'editor.background': '#ffffff' });
  });
});

describe('themeRules', () => {
  it('traduce los scopes de TextMate a tokens de Monaco', () => {
    const rules = themeRules([
      { scope: 'comment', settings: { foreground: '#6272a4', fontStyle: 'italic' } },
      { scope: 'string', settings: { foreground: '#f1fa8c' } },
      { scope: 'keyword, storage', settings: { foreground: '#ff79c6' } },
      { scope: ['constant.numeric'], settings: { foreground: '#bd93f9' } },
    ]);
    const by = Object.fromEntries(rules.map((r) => [r.token, r]));
    expect(by.comment).toEqual({ token: 'comment', foreground: '6272a4', fontStyle: 'italic' });
    expect(by.string!.foreground).toBe('f1fa8c');
    expect(by.keyword!.foreground).toBe('ff79c6');
    expect(by['keyword.type']!.foreground).toBe('ff79c6');
    expect(by.number!.foreground).toBe('bd93f9');
  });

  it('gana la entrada más específica y, en empate, la última', () => {
    const rules = themeRules([
      { scope: 'constant.numeric', settings: { foreground: '#111111' } },
      { scope: 'constant', settings: { foreground: '#222222' } },
      { scope: 'string', settings: { foreground: '#333333' } },
      { scope: 'string', settings: { foreground: '#444444' } },
      { scope: 'source.js meta.block string.regexp', settings: { foreground: '#555555' } },
    ]);
    const by = Object.fromEntries(rules.map((r) => [r.token, r.foreground]));
    expect(by.number).toBe('111111');
    expect(by.constant).toBe('222222');
    expect(by.string).toBe('444444');
    expect(by.regexp).toBe('555555');
  });

  it('ignora entradas rotas', () => {
    expect(
      themeRules([
        null,
        3,
        'x',
        {},
        { scope: 'comment' },
        { scope: 5, settings: {} },
        {
          scope: 'comment',
          settings: { foreground: 'azul' },
        },
      ]),
    ).toEqual([]);
  });
});

describe('snippetItems', () => {
  it('aplana prefijos y cuerpos', () => {
    const items = snippetItems({
      'For Loop': {
        prefix: ['for', 'fori'],
        body: ['for (;;) {', '\t$0', '}'],
        description: 'Bucle',
      },
      Log: { prefix: 'log', body: 'console.log($1)' },
      'Sin cuerpo': { prefix: 'x' },
      'Sin prefijo': { body: 'y' },
      Roto: 4,
    });
    expect(items.map((i) => i.prefix)).toEqual(['for', 'fori', 'log']);
    expect(items[0]).toEqual({
      name: 'For Loop',
      prefix: 'for',
      body: 'for (;;) {\n\t$0\n}',
      description: 'Bucle',
    });
    expect(items[2]!.description).toBe('');
  });
});

describe('langConfig', () => {
  it('toma comentarios, corchetes y pares, en sus dos formas', () => {
    expect(
      langConfig({
        comments: { lineComment: '#', blockComment: ['/*', '*/'] },
        brackets: [['{', '}'], ['(', ')'], ['x'], 5],
        autoClosingPairs: [
          { open: '"', close: '"', notIn: ['string', 3] },
          ['[', ']'],
          { open: '' },
        ],
        surroundingPairs: [['<', '>']],
      }),
    ).toEqual({
      comments: { lineComment: '#', blockComment: ['/*', '*/'] },
      brackets: [
        ['{', '}'],
        ['(', ')'],
      ],
      autoClosingPairs: [
        { open: '"', close: '"', notIn: ['string'] },
        { open: '[', close: ']' },
      ],
      surroundingPairs: [{ open: '<', close: '>' }],
    });
  });

  it('deja fuera las expresiones regulares descargadas', () => {
    const cfg = langConfig({
      wordPattern: '(a+)+$',
      indentationRules: { increaseIndentPattern: '(a+)+$' },
      onEnterRules: [{ beforeText: '(a+)+$' }],
    });
    expect(cfg).toEqual({});
    expect(langConfig(undefined)).toEqual({});
  });
});

describe('extThemeId', () => {
  it('distingue temas del mismo nombre en extensiones distintas', () => {
    expect(extThemeId('a.b', 'Dark')).not.toBe(extThemeId('a.c', 'Dark'));
  });
});
