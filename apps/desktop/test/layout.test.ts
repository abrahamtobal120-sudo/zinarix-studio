import { describe, expect, it } from 'vitest';
import {
  capture,
  cleanSize,
  defaultLayout,
  EDITOR_MIN_BESIDE_PANEL,
  keepArrangements,
  LAYOUT_VERSION,
  migrateLayout,
  panelSideWidth,
  PRESETS,
  PRESETS_VERSION,
  resetSpace,
  setSize,
  SIDE_VIEWS,
  SPACES,
  switchSpace,
  type Arrangement,
} from '../src/shared/layout';

const right: Arrangement = {
  sidebar: 'git',
  panelOpen: true,
  panelPosition: 'right',
  chatOpen: false,
  studio: false,
};

describe('migrateLayout', () => {
  it('nothing saved → presets, starting in Código', () => {
    const m = migrateLayout(null);
    expect(m.from).toBe(0);
    expect(m.presetsChanged).toBe(false);
    expect(m.layout).toEqual(defaultLayout());
    expect(m.layout.space).toBe('code');
  });

  it('v1 (the loose localStorage keys) keeps the dragged sizes', () => {
    const m = migrateLayout(null, { side: '312', chat: '540', panel: '300' });
    expect(m.from).toBe(1);
    expect(m.layout.version).toBe(LAYOUT_VERSION);
    expect(m.layout.sizes).toEqual({ side: 312, chat: 540, panel: 300, panelSide: null });
    expect(m.layout.spaces).toEqual(defaultLayout().spaces);
  });

  it('v1 values the old code ignored are ignored here too', () => {
    // Before Fase 17 App.tsx only used side >= 160, chat >= 280, panel >= 100.
    const m = migrateLayout(null, { side: '20', chat: 'abc', panel: '' });
    expect(m.from).toBe(0);
    expect(m.layout.sizes).toEqual({ side: null, chat: null, panel: null, panelSide: null });
  });

  it('a v2 layout survives a save/load round trip', () => {
    let l = defaultLayout();
    l = switchSpace(l, right, 'video').layout;
    l = setSize(l, 'panelSide', 500);
    l = { ...l, zen: true, density: 'compact' };
    const back = migrateLayout(JSON.parse(JSON.stringify(l)));
    expect(back.layout).toEqual(l);
    expect(back.from).toBe(2);
    expect(back.presetsChanged).toBe(false);
  });

  it('a broken field falls back to its preset and keeps the rest', () => {
    const raw = {
      version: 2,
      presets: PRESETS_VERSION,
      space: 'nope',
      spaces: {
        code: { ...right, sidebar: 'not-a-view', panelPosition: 'left' },
        video: 'garbage',
      },
      sizes: { side: -5, chat: 'wide', panel: 99999, panelSide: Number.NaN },
      zen: 'yes',
      density: 'tiny',
    };
    const { layout } = migrateLayout(raw);
    expect(layout.space).toBe('code');
    expect(layout.spaces.code).toEqual({ ...right, sidebar: 'explorer', panelPosition: 'bottom' });
    expect(layout.spaces.video).toEqual(PRESETS.video);
    expect(layout.sizes).toEqual({ side: null, chat: null, panel: 4000, panelSide: null });
    expect(layout.zen).toBe(false);
    expect(layout.density).toBe('comfortable');
  });

  it('a closed side bar (null) is kept, not replaced by the preset', () => {
    const l = defaultLayout();
    l.spaces.code = { ...l.spaces.code, sidebar: null };
    expect(migrateLayout(JSON.parse(JSON.stringify(l))).layout.spaces.code.sidebar).toBeNull();
  });

  it('a layout from a newer Zinarix keeps what this version knows', () => {
    const raw = {
      ...JSON.parse(JSON.stringify(defaultLayout())),
      version: 7,
      space: 'cloud',
      futureThing: { a: 1 },
    };
    const m = migrateLayout(raw);
    expect(m.from).toBe(7);
    expect(m.layout.version).toBe(LAYOUT_VERSION);
    expect(m.layout.space).toBe('cloud');
  });

  it('never throws on junk', () => {
    for (const junk of [undefined, 42, 'x', [], [1, 2], { version: 2, spaces: null, sizes: 3 }])
      expect(() => migrateLayout(junk)).not.toThrow();
  });
});

describe('stability: the layout never changes by itself', () => {
  it('older presets → notice, arrangements untouched', () => {
    const saved = { ...defaultLayout(), presets: PRESETS_VERSION - 1 };
    saved.spaces.code = { ...right };
    const m = migrateLayout(JSON.parse(JSON.stringify(saved)));
    expect(m.presetsChanged).toBe(true);
    expect(m.layout.spaces.code).toEqual(right);
  });

  it('"Mantener la mía" clears the notice and keeps them', () => {
    const l = { ...defaultLayout(), presets: 0 };
    l.spaces.code = { ...right };
    const kept = keepArrangements(l);
    expect(kept.presets).toBe(PRESETS_VERSION);
    expect(kept.spaces.code).toEqual(right);
  });

  it('"Restablecer todo" applies the current presets', () => {
    const l = { ...defaultLayout(), presets: 0 };
    l.spaces.code = { ...right };
    const r = resetSpace(l, 'all');
    expect(r.presets).toBe(PRESETS_VERSION);
    expect(r.spaces).toEqual(defaultLayout().spaces);
  });
});

describe('workspaces', () => {
  it('each preset uses a real side view', () => {
    for (const id of SPACES) {
      const s = PRESETS[id].sidebar;
      if (s !== null) expect(SIDE_VIEWS).toContain(s);
    }
  });

  it('switching keeps what was on screen for the workspace it leaves', () => {
    const l = defaultLayout();
    const a = switchSpace(l, right, 'design');
    expect(a.layout.space).toBe('design');
    expect(a.layout.spaces.code).toEqual(right);
    expect(a.show).toEqual(PRESETS.design);
    const b = switchSpace(a.layout, a.show, 'code');
    expect(b.show).toEqual(right);
  });

  it('the arrangement returned is a copy', () => {
    const { layout, show } = switchSpace(defaultLayout(), PRESETS.code, 'video');
    show.chatOpen = false;
    expect(layout.spaces.video.chatOpen).toBe(true);
  });

  it('capture returns the same object when nothing changed', () => {
    const l = defaultLayout();
    expect(capture(l, { ...PRESETS.code })).toBe(l);
    expect(capture(l, right)).not.toBe(l);
  });

  it('reset puts one workspace back and leaves the others', () => {
    let l = switchSpace(defaultLayout(), right, 'design').layout;
    l = capture(l, { ...right, sidebar: 'mail' });
    const r = resetSpace(l, 'design');
    expect(r.spaces.design).toEqual(PRESETS.design);
    expect(r.spaces.code).toEqual(right);
  });
});

describe('sizes', () => {
  it('cleanSize clamps to the limits and rejects junk', () => {
    expect(cleanSize('side', 100)).toBeNull();
    expect(cleanSize('side', 5000)).toBe(900);
    expect(cleanSize('chat', 300.6)).toBe(301);
    expect(cleanSize('panel', Infinity)).toBeNull();
    expect(cleanSize('panel', '250')).toBe(250);
  });

  it('setSize returns the same layout for no change or a bad value', () => {
    const l = setSize(defaultLayout(), 'side', 300);
    expect(setSize(l, 'side', 300)).toBe(l);
    expect(setSize(l, 'side', 10)).toBe(l);
    expect(setSize(l, 'side', 320).sizes.side).toBe(320);
  });

  it('a panel at the right leaves the editor its room', () => {
    expect(panelSideWidth(500, 1200)).toBe(500);
    expect(panelSideWidth(2000, 1200)).toBe(1200 - EDITOR_MIN_BESIDE_PANEL);
    expect(panelSideWidth(null, 1000)).toBe(400);
    // A tiny window: the panel keeps its minimum even if the editor gets squeezed.
    expect(panelSideWidth(500, 300)).toBe(200);
  });
});
