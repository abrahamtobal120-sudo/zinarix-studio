import { describe, expect, it } from 'vitest';
import { chromeKind, isWindows11, overlayColors, pickMaterial } from '../src/shared/windowChrome';

describe('isWindows11', () => {
  it('reads the build number, not the major version', () => {
    expect(isWindows11('10.0.22000')).toBe(true);
    expect(isWindows11('10.0.26300')).toBe(true);
    expect(isWindows11('10.0.19045')).toBe(false);
    expect(isWindows11('6.3.9600')).toBe(false);
    expect(isWindows11('')).toBe(false);
    expect(isWindows11('garbage')).toBe(false);
  });
});

describe('pickMaterial', () => {
  const win11 = { platform: 'win32', release: '10.0.26300', enabled: true, highContrast: false };
  it('Mica only on Windows 11', () => {
    expect(pickMaterial(win11)).toBe('mica');
    expect(pickMaterial({ ...win11, release: '10.0.19045' })).toBe('none');
  });
  it('vibrancy on macOS, nothing on Linux', () => {
    expect(pickMaterial({ ...win11, platform: 'darwin', release: '24.0.0' })).toBe('vibrancy');
    expect(pickMaterial({ ...win11, platform: 'linux', release: '6.8.0' })).toBe('none');
  });
  it('off with the setting or with high contrast', () => {
    expect(pickMaterial({ ...win11, enabled: false })).toBe('none');
    expect(pickMaterial({ ...win11, highContrast: true })).toBe('none');
    expect(pickMaterial({ ...win11, platform: 'darwin', highContrast: true })).toBe('none');
  });
});

describe('overlayColors', () => {
  it('uses the theme colors when opaque', () => {
    expect(overlayColors('#21222c', '#f8f8f2', 'none', 100)).toEqual({
      color: '#21222c',
      symbolColor: '#f8f8f2',
      height: 34,
    });
  });
  it('is transparent over Mica', () => {
    expect(overlayColors('#21222c', '#fff', 'mica', 100).color).toBe('#00000000');
  });
  it('grows with the interface size and clamps it', () => {
    expect(overlayColors('#000', '#fff', 'none', 150).height).toBe(51);
    expect(overlayColors('#000', '#fff', 'none', 9999).height).toBe(102);
    expect(overlayColors('#000', '#fff', 'none', 0).height).toBe(34);
  });
  it('falls back when the color is not a plain hex', () => {
    const c = overlayColors('rgb(1,2,3)', 'red', 'none', 100);
    expect(c.color).toBe('#1e1e1e');
    expect(c.symbolColor).toBe('#cccccc');
  });
});

describe('chromeKind', () => {
  it('macOS keeps the traffic lights; the rest draw our bar', () => {
    expect(chromeKind('darwin')).toBe('mac');
    expect(chromeKind('win32')).toBe('overlay');
    expect(chromeKind('linux')).toBe('overlay');
  });
});
