const ICONS: [RegExp, string][] = [
  [/\.(ts|tsx|mts|cts)$/i, '🟦'],
  [/\.(js|jsx|mjs|cjs)$/i, '🟨'],
  [/\.json$/i, '🔧'],
  [/\.(md|mdx|txt)$/i, '📝'],
  [/\.(py)$/i, '🐍'],
  [/\.(rs)$/i, '🦀'],
  [/\.(go)$/i, '🐹'],
  [/\.(java|kt)$/i, '☕'],
  [/\.(c|h|cpp|hpp|cc)$/i, '⚙️'],
  [/\.(cs)$/i, '#️⃣'],
  [/\.(php)$/i, '🐘'],
  [/\.(rb)$/i, '💎'],
  [/\.(html|htm)$/i, '🌐'],
  [/\.(css|scss|less)$/i, '🎨'],
  [/\.(sh|bash|zsh|ps1)$/i, '💲'],
  [/\.(ya?ml|toml|ini|env.*)$/i, '⚙️'],
  [/^\.env/i, '🔐'],
  [/\.(png|jpe?g|gif|svg|webp|ico)$/i, '🖼️'],
  [/\.(sql|db|sqlite)$/i, '🗄️'],
  [/(^dockerfile|\.dockerfile)$/i, '🐳'],
  [/\.(lock)$/i, '🔒'],
];

export function fileIcon(name: string): string {
  for (const [re, icon] of ICONS) if (re.test(name)) return icon;
  return '📄';
}
