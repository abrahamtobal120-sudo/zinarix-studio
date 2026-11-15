import { PROVIDER_LOGOS } from '../providerLogos';

const COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#059669',
  '#0891b2',
  '#4f46e5',
  '#b45309',
  '#be123c',
  '#0d9488',
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
      style={{ ...style, background: providerColor(id), fontSize: Math.round(size * 0.38) }}
      title={name}
    >
      {initials}
    </span>
  );
}
