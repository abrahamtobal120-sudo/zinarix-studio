import type { ReactNode } from 'react';

/** [pattern, badge text, colour] — a JetBrains-style coloured badge per file type. */
const BADGES: [RegExp, string, string][] = [
  [/\.d\.ts$/i, 'D', '#3178c6'],
  [/\.(test|spec)\.(t|j)sx?$/i, 'T', '#22a06b'],
  [/\.tsx$/i, 'TX', '#3178c6'],
  [/\.(ts|mts|cts)$/i, 'TS', '#3178c6'],
  [/\.jsx$/i, 'JX', '#d4a72c'],
  [/\.(js|mjs|cjs)$/i, 'JS', '#d4a72c'],
  [/^package\.json$/i, 'N', '#cb3837'],
  [/\.(json|jsonc|json5)$/i, '{}', '#c5a332'],
  [/\.(md|mdx)$/i, 'M↓', '#4f8fd6'],
  [/\.txt$/i, 'TX', '#8a8f9a'],
  [/\.py$/i, 'PY', '#3572a5'],
  [/\.rs$/i, 'RS', '#c86a3c'],
  [/\.go$/i, 'GO', '#00a7d0'],
  [/\.(java)$/i, 'JV', '#b07219'],
  [/\.(kt|kts)$/i, 'KT', '#a97bff'],
  [/\.(c|h)$/i, 'C', '#5c6bc0'],
  [/\.(cpp|hpp|cc|cxx)$/i, 'C+', '#f34b7d'],
  [/\.cs$/i, 'C#', '#178600'],
  [/\.php$/i, 'PH', '#777bb4'],
  [/\.rb$/i, 'RB', '#cc342d'],
  [/\.swift$/i, 'SW', '#f05138'],
  [/\.(html|htm)$/i, '<>', '#e34c26'],
  [/\.(css)$/i, '#', '#2965f1'],
  [/\.(scss|sass|less)$/i, 'S', '#c6538c'],
  [/\.vue$/i, 'V', '#41b883'],
  [/\.svelte$/i, 'SV', '#ff3e00'],
  [/\.(sh|bash|zsh|fish)$/i, '$', '#4caf50'],
  [/\.(ps1|bat|cmd)$/i, '>', '#3b78c2'],
  [/\.(ya?ml)$/i, 'Y', '#cb4a4a'],
  [/\.(toml|ini|conf|cfg)$/i, '⚙', '#8a8f9a'],
  [/\.(sql|db|sqlite)$/i, 'DB', '#e38c00'],
  [/(^dockerfile|\.dockerfile|^docker-compose.*\.ya?ml)$/i, 'DK', '#2496ed'],
  [/\.(xml|svg)$/i, '<>', '#f0a030'],
  [/\.(csv|tsv|xlsx?)$/i, 'CSV', '#22a06b'],
  [/\.pdf$/i, 'PDF', '#e5252a'],
  [/\.(zip|tar|gz|tgz|7z|rar)$/i, 'ZIP', '#8a6d3b'],
  [/^(license|licence)(\.\w+)?$/i, '©', '#c5a332'],
];

const SVG = (children: ReactNode) => (
  <svg className="ficon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
    {children}
  </svg>
);

const glyph = (d: string, color: string) =>
  SVG(
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />,
  );

export function fileIcon(path: string): ReactNode {
  const name = path.split(/[\\/]/).pop() ?? path;
  if (/^\.env/i.test(name))
    return glyph(
      'M10 2.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM7.5 8.5L2.5 13.5M4 12l1.5 1.5',
      '#e0b341',
    );
  if (/^\.git(ignore|attributes|modules)$/i.test(name))
    return glyph('M8 2l6 6-6 6-6-6zM8 5v6M8 8h3', '#f05033');
  if (/\.(lock)$|^pnpm-lock\.yaml$|-lock\.json$/i.test(name))
    return glyph('M4 7.5h8v6H4zM5.5 7.5V5a2.5 2.5 0 0 1 5 0v2.5', '#8a8f9a');
  if (/\.(png|jpe?g|gif|webp|ico|bmp|avif)$/i.test(name))
    return glyph('M2.5 3h11v10h-11zM2.5 11l3.5-3.5 3 3 2-2 2.5 2.5M10.5 5.8h.01', '#a074c4');
  for (const [re, text, color] of BADGES) {
    if (!re.test(name)) continue;
    const size = text === '{}' ? 8 : text.length >= 3 ? 5.2 : text.length === 2 ? 6.6 : 8.5;
    return SVG(
      <>
        <rect x="1" y="1.5" width="14" height="13" rx="3" fill={color} opacity="0.18" />
        <rect
          x="1"
          y="1.5"
          width="14"
          height="13"
          rx="3"
          fill="none"
          stroke={color}
          strokeOpacity="0.55"
        />
        <text
          x="8"
          y="8.3"
          fill={color}
          fontSize={size}
          fontWeight="700"
          fontFamily="Inter, system-ui, sans-serif"
          textAnchor="middle"
          dominantBaseline="middle"
        >
          {text}
        </text>
      </>,
    );
  }
  return glyph(
    'M9.5 1.8H4.2a1 1 0 0 0-1 1v10.4a1 1 0 0 0 1 1h7.6a1 1 0 0 0 1-1V4.8zM9.5 1.8v3h3',
    '#8a8f9a',
  );
}

/** Folder glyph, tinted for well-known folder names. */
export function folderIcon(name: string, open: boolean): ReactNode {
  const color = /^(src|lib|app|apps|packages)$/i.test(name)
    ? '#4f8fd6'
    : /^(test|tests|__tests__|spec)$/i.test(name)
      ? '#22a06b'
      : /^(node_modules|dist|build|out|coverage|\.turbo|\.next)$/i.test(name)
        ? '#6b7080'
        : /^\.(git|github|vscode)$/i.test(name)
          ? '#8a8f9a'
          : /^(docs|doc)$/i.test(name)
            ? '#4fa3b8'
            : '#c9a24a';
  return SVG(
    open ? (
      <path
        d="M1.5 4a1 1 0 0 1 1-1h3.3l1.4 1.5H12.5a1 1 0 0 1 1 1V6.5H4.3a1 1 0 0 0-.95.68L1.5 12.5zM3.35 7.18A1 1 0 0 1 4.3 6.5h10a.6.6 0 0 1 .57.8l-1.6 5.1a1 1 0 0 1-.95.7H1.5z"
        fill={color}
      />
    ) : (
      <path
        d="M1.5 4a1 1 0 0 1 1-1h3.3l1.4 1.5h6.3a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"
        fill={color}
      />
    ),
  );
}
