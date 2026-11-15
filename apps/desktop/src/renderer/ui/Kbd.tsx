/** A keyboard shortcut: "Ctrl+Shift+P" is drawn as separate keys. */
export function Kbd({ keys, className }: { keys: string; className?: string }) {
  const parts = keys
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean);
  return (
    <kbd data-ui="kbd" className={className ? `ui-kbd ${className}` : 'ui-kbd'} aria-label={keys}>
      {parts.map((k, i) => (
        <span key={i} className="ui-kbd-key" aria-hidden="true">
          {k}
        </span>
      ))}
    </kbd>
  );
}
