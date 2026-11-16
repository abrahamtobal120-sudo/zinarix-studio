import { PROVIDER_LOGOS } from '../providerLogos';

// White initials sit on these, so every one is >= 4.5:1 against white (the 600 shades of
// orange, green, cyan, teal and pink were 3.6-4.1:1).
const COLORS = [
  '#2563eb',
  '#7c3aed',
  '#be185d',
  '#c2410c',
  '#047857',
  '#0e7490',
  '#4f46e5',
  '#b45309',
  '#be123c',
  '#0f766e',
];

export function providerColor(id: string): string {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length]!;
}

/** Provider logo on a light tile; colored initials when the provider has no logo. */
export function ProviderLogo({
  id,
  name,
  size = 28,
}: {
  id: string;
  name?: string;
  size?: number;
}) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.24) };
  if (PROVIDER_LOGOS.has(id)) {
    return (
      <span className="plogo" style={style} title={name}>
        <img src={`./providers/${id}.svg`} alt="" draggable={false} />
      </span>
    );
  }
  const initials = (name ?? id)
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span
      className="plogo initials"
      style={{
        ...style,
        background: providerColor(id),
        fontSize: Math.max(10, Math.round(size * 0.38)),
      }}
      title={name}
    >
      {initials}
    </span>
  );
}
