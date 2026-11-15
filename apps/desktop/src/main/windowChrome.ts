/**
 * Fase 18: the window's own title bar and its material. The pure rules are in
 * shared/windowChrome.ts; this file only talks to Electron.
 */
import { nativeTheme } from 'electron';
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import { release } from 'node:os';
import { chromeKind, overlayColors, pickMaterial } from '../shared/windowChrome.js';
import type { ChromeState, Material } from '../shared/windowChrome.js';

function material(enabled: boolean): Material {
  return pickMaterial({
    platform: process.platform,
    release: release(),
    enabled,
    highContrast: nativeTheme.shouldUseHighContrastColors,
  });
}

/** Options of a new window: our title bar, and the material from the first frame. */
export function chromeOptions(
  light: boolean,
  enabled: boolean,
  zoom: number,
): BrowserWindowConstructorOptions {
  const m = material(enabled);
  // Close to the bar colors of the dark and light themes; the renderer sets the real ones.
  const bg = light ? '#f3f3f3' : '#181818';
  const fg = light ? '#333333' : '#cccccc';
  if (process.platform === 'darwin')
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 12, y: 10 },
      ...(m === 'vibrancy'
        ? { vibrancy: 'sidebar', visualEffectState: 'followWindow', backgroundColor: '#00000000' }
        : {}),
    };
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(bg, fg, m, zoom),
    ...(m === 'mica' ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' } : {}),
  };
}

/**
 * Sets the colors of − □ × and the material after a theme, setting or interface-size change.
 * Returns what was applied, so the renderer makes the bars see-through only when it shows.
 */
export function applyChrome(
  win: BrowserWindow,
  colors: { bg: string; fg: string },
  enabled: boolean,
  zoom: number,
): ChromeState {
  const kind = chromeKind(process.platform);
  const m = material(enabled);
  try {
    if (process.platform === 'darwin') {
      win.setVibrancy(m === 'vibrancy' ? 'sidebar' : null);
    } else {
      if (process.platform === 'win32') win.setBackgroundMaterial(m === 'mica' ? 'mica' : 'none');
      win.setBackgroundColor(m === 'mica' ? '#00000000' : colors.bg);
      win.setTitleBarOverlay(overlayColors(colors.bg, colors.fg, m, zoom));
    }
  } catch {
    // An old system without the API: the window keeps the opaque bar it was created with.
    return { kind, material: 'none' };
  }
  return { kind, material: m };
}
