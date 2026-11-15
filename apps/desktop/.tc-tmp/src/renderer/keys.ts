const isMac = navigator.platform.toLowerCase().includes('mac');

const NAMED: Record<string, string> = {
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
};

/**
 * Shortcut text for a key event, in the same format the commands list shows
 * ("Ctrl+Shift+G", "⌘+K"). null for a lone modifier or a plain key without modifiers
 * (those would break typing), except function keys.
 */
export function comboFromEvent(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return null;
  let key: string;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (e.code === 'Backquote') key = '`';
  else key = NAMED[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const fn = /^F\d{1,2}$/.test(key);
  if (!e.ctrlKey && !e.metaKey && !e.altKey && !fn) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push(isMac ? '⌘' : 'Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  parts.push(key);
  return parts.join('+');
}
