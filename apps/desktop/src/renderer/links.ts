import { api } from './store';

/** Modifier keys of the click that opened a link (Ctrl/Cmd or Shift: the system browser). */
interface ClickKeys {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Opens a link clicked in the app in the built-in browser (the "Navegador" tab comes to the
 * front). Ctrl/Cmd/Shift + click opens it in the system browser instead.
 */
export function openLink(url: string, keys?: ClickKeys): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (keys && (keys.ctrlKey || keys.metaKey || keys.shiftKey)) {
    if (/^https:\/\//i.test(url)) void api().app.openExternal(url);
    return;
  }
  void api().app.openLink(url);
}
