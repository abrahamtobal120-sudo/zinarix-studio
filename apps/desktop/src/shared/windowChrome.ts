/**
 * Fase 18: the window's own title bar and its material (Mica on Windows 11, vibrancy on macOS).
 * Pure: main/main.ts asks it what to set and the renderer asks it what to draw.
 */

/** Height of the title bar in CSS pixels at 100 % interface size. */
export const TITLE_BAR_HEIGHT = 34;

/** How the window draws its title bar on this system. */
export type ChromeKind =
  /** Windows and Linux: our bar with the menu; the system draws only − □ × at the right. */
  | 'overlay'
  /** macOS: our bar with room for the traffic lights at the left; the menu stays at the top. */
  | 'mac';

export function chromeKind(platform: string): ChromeKind {
  return platform === 'darwin' ? 'mac' : 'overlay';
}

/**
 * Windows 11 is "10.0.22000" or later (the major version stayed 10). Mica needs it; on
 * Windows 10 acrylic lags while dragging the window, so it gets no material.
 */
export function isWindows11(release: string): boolean {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(release);
  if (!m) return false;
  return Number(m[1]) > 10 || (Number(m[1]) === 10 && Number(m[3]) >= 22000);
}

export interface MaterialInput {
  platform: string;
  /** os.release() */
  release: string;
  /** The "Efectos de ventana" setting. */
  enabled: boolean;
  /** The system asks for high contrast (nativeTheme or forced-colors). */
  highContrast: boolean;
}

export type Material = 'mica' | 'vibrancy' | 'none';

/** Which see-through material the window gets. Never one the system can't draw. */
export function pickMaterial(i: MaterialInput): Material {
  if (!i.enabled || i.highContrast) return 'none';
  if (i.platform === 'darwin') return 'vibrancy';
  if (i.platform === 'win32' && isWindows11(i.release)) return 'mica';
  return 'none';
}

export interface OverlayColors {
  /** Background behind − □ ×. Transparent over Mica so the material shows. */
  color: string;
  symbolColor: string;
  /** In device pixels: the bar grows with the interface size. */
  height: number;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Colors of the system's window buttons, from the theme's bar color and text color. */
export function overlayColors(
  bg: string,
  fg: string,
  material: Material,
  zoomPercent: number,
): OverlayColors {
  const safeBg = HEX.test(bg.trim()) ? bg.trim() : '#1e1e1e';
  const safeFg = HEX.test(fg.trim()) ? fg.trim() : '#cccccc';
  const zoom = Math.min(300, Math.max(50, zoomPercent || 100)) / 100;
  return {
    color: material === 'mica' ? '#00000000' : safeBg,
    symbolColor: safeFg,
    height: Math.round(TITLE_BAR_HEIGHT * zoom),
  };
}

/** What main tells the renderer after applying the window chrome. */
export interface ChromeState {
  kind: ChromeKind;
  material: Material;
}
