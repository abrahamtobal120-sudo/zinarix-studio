/**
 * Every Radix portal (menus, tooltips, dialogs) mounts in one <div id="ui-portal"> at the end of
 * <body>, so their stacking depends only on the --z-* layers and never on DOM order.
 */
export function portalContainer(): HTMLElement | undefined {
  if (typeof document === 'undefined') return undefined;
  let el = document.getElementById('ui-portal');
  if (!el) {
    el = document.createElement('div');
    el.id = 'ui-portal';
    document.body.appendChild(el);
  }
  return el;
}
