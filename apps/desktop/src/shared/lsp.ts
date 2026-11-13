/**
 * Language servers (LSP) Zinarix knows how to start, by Monaco language id. Shared by the
 * main process (which spawns them) and the renderer (which registers the Monaco providers).
 * TypeScript/JavaScript, JSON, CSS and HTML are left to Monaco's own workers unless the user
 * sets a command for them in Settings.
 */
export interface LspCandidate {
  /** Executable looked up on PATH (Windows: also .cmd / .exe / .bat). */
  command: string;
  args: string[];
  /** Short name shown in the status bar ("pyright"). */
  name: string;
  /** How to install it, shown when no candidate is found. */
  install: string;
}

export interface LspLanguage {
  /** Monaco language id(s) handled by this entry. */
  ids: string[];
  label: string;
  candidates: LspCandidate[];
}

export const LSP_LANGUAGES: LspLanguage[] = [
  {
    ids: ['python'],
    label: 'Python',
    candidates: [
      {
        command: 'pyright-langserver',
        args: ['--stdio'],
        name: 'pyright',
        install: 'npm i -g pyright',
      },
      {
        command: 'basedpyright-langserver',
        args: ['--stdio'],
        name: 'basedpyright',
        install: 'pip install basedpyright',
      },
      { command: 'pylsp', args: [], name: 'pylsp', install: 'pip install python-lsp-server' },
      {
        command: 'jedi-language-server',
        args: [],
        name: 'jedi',
        install: 'pip install jedi-language-server',
      },
    ],
  },
  {
    ids: ['go'],
    label: 'Go',
    candidates: [
      {
        command: 'gopls',
        args: [],
        name: 'gopls',
        install: 'go install golang.org/x/tools/gopls@latest',
      },
    ],
  },
  {
    ids: ['rust'],
    label: 'Rust',
    candidates: [
      {
        command: 'rust-analyzer',
        args: [],
        name: 'rust-analyzer',
        install: 'rustup component add rust-analyzer',
      },
    ],
  },
  {
    ids: ['c', 'cpp', 'objective-c'],
    label: 'C/C++',
    candidates: [
      {
        command: 'clangd',
        args: [],
        name: 'clangd',
        install: 'instala LLVM/clangd (winget install LLVM.LLVM · apt install clangd)',
      },
    ],
  },
  {
    ids: ['java'],
    label: 'Java',
    candidates: [
      {
        command: 'jdtls',
        args: ['-data', '${dataDir}'],
        name: 'jdtls',
        install: 'Eclipse JDT LS (brew install jdtls · descárgalo de download.eclipse.org/jdtls)',
      },
    ],
  },
  {
    ids: ['csharp'],
    label: 'C#',
    candidates: [
      {
        command: 'csharp-ls',
        args: [],
        name: 'csharp-ls',
        install: 'dotnet tool install -g csharp-ls',
      },
      { command: 'OmniSharp', args: ['-lsp'], name: 'OmniSharp', install: 'OmniSharp' },
    ],
  },
  {
    ids: ['php'],
    label: 'PHP',
    candidates: [
      {
        command: 'intelephense',
        args: ['--stdio'],
        name: 'intelephense',
        install: 'npm i -g intelephense',
      },
      {
        command: 'phpactor',
        args: ['language-server'],
        name: 'phpactor',
        install: 'composer global require phpactor/phpactor',
      },
    ],
  },
  {
    ids: ['ruby'],
    label: 'Ruby',
    candidates: [
      { command: 'ruby-lsp', args: [], name: 'ruby-lsp', install: 'gem install ruby-lsp' },
      {
        command: 'solargraph',
        args: ['stdio'],
        name: 'solargraph',
        install: 'gem install solargraph',
      },
    ],
  },
  {
    ids: ['lua'],
    label: 'Lua',
    candidates: [
      {
        command: 'lua-language-server',
        args: [],
        name: 'lua-ls',
        install: 'winget install LuaLS.lua-language-server · brew install lua-language-server',
      },
    ],
  },
  {
    ids: ['shell'],
    label: 'Bash',
    candidates: [
      {
        command: 'bash-language-server',
        args: ['start'],
        name: 'bash-ls',
        install: 'npm i -g bash-language-server',
      },
    ],
  },
  {
    ids: ['yaml'],
    label: 'YAML',
    candidates: [
      {
        command: 'yaml-language-server',
        args: ['--stdio'],
        name: 'yaml-ls',
        install: 'npm i -g yaml-language-server',
      },
    ],
  },
  {
    ids: ['kotlin'],
    label: 'Kotlin',
    candidates: [
      {
        command: 'kotlin-language-server',
        args: [],
        name: 'kotlin-ls',
        install: 'github.com/fwcd/kotlin-language-server (brew install kotlin-language-server)',
      },
    ],
  },
  {
    ids: ['swift'],
    label: 'Swift',
    candidates: [
      {
        command: 'sourcekit-lsp',
        args: [],
        name: 'sourcekit-lsp',
        install: 'viene con el toolchain de Swift',
      },
    ],
  },
  {
    ids: ['scala'],
    label: 'Scala',
    candidates: [
      { command: 'metals', args: [], name: 'metals', install: 'cs install metals (Coursier)' },
    ],
  },
  {
    ids: ['dart'],
    label: 'Dart',
    candidates: [
      {
        command: 'dart',
        args: ['language-server', '--protocol=lsp'],
        name: 'dart',
        install: 'instala el SDK de Dart o Flutter',
      },
    ],
  },
  {
    ids: ['elixir'],
    label: 'Elixir',
    candidates: [
      {
        command: 'elixir-ls',
        args: [],
        name: 'elixir-ls',
        install: 'github.com/elixir-lsp/elixir-ls',
      },
      {
        command: 'language_server.sh',
        args: [],
        name: 'elixir-ls',
        install: 'github.com/elixir-lsp/elixir-ls',
      },
    ],
  },
  {
    ids: ['zig'],
    label: 'Zig',
    candidates: [
      { command: 'zls', args: [], name: 'zls', install: 'winget install zigtools.zls · brew install zls' },
    ],
  },
  {
    ids: ['haskell'],
    label: 'Haskell',
    candidates: [
      {
        command: 'haskell-language-server-wrapper',
        args: ['--lsp'],
        name: 'hls',
        install: 'ghcup install hls',
      },
    ],
  },
  {
    ids: ['dockerfile'],
    label: 'Dockerfile',
    candidates: [
      {
        command: 'docker-langserver',
        args: ['--stdio'],
        name: 'docker-ls',
        install: 'npm i -g dockerfile-language-server-nodejs',
      },
    ],
  },
  {
    ids: ['hcl'],
    label: 'Terraform',
    candidates: [
      {
        command: 'terraform-ls',
        args: ['serve'],
        name: 'terraform-ls',
        install: 'github.com/hashicorp/terraform-ls',
      },
    ],
  },
];

/** Languages Monaco already understands well on its own (no LSP unless configured). */
export const MONACO_NATIVE = new Set([
  'typescript',
  'javascript',
  'json',
  'css',
  'scss',
  'less',
  'html',
  'handlebars',
  'razor',
]);

/** LSP languageId for a Monaco language id (they differ for a few). */
export function lspLanguageId(monacoId: string): string {
  if (monacoId === 'shell') return 'shellscript';
  if (monacoId === 'hcl') return 'terraform';
  return monacoId;
}

export function lspLanguageFor(monacoId: string): LspLanguage | undefined {
  return LSP_LANGUAGES.find((l) => l.ids.includes(monacoId));
}

/** Splits a user-written command line ("node C:/a b/x.js --stdio") honoring quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line))) out.push(m[1] ?? m[2] ?? m[3]!);
  return out;
}

/** State of a language's server, as shown in the status bar. */
export interface LspStatus {
  language: string;
  label: string;
  state: 'starting' | 'ready' | 'missing' | 'error' | 'off';
  /** Server name ("pyright"). */
  server?: string;
  /** How to install it (state 'missing') or what went wrong (state 'error'). */
  detail?: string;
  /** Characters that open completion / signature help (from the server capabilities). */
  triggerCharacters?: string[];
  signatureTriggers?: string[];
}

/** Prefix of workspace-relative document URIs exchanged between renderer and main. */
export const WS_URI = 'zx-ws:/';

/** LSP methods the renderer may call through lsp:request. */
export function lspMethodAllowed(method: string): boolean {
  return (
    method.startsWith('textDocument/') ||
    method === 'completionItem/resolve' ||
    method === 'codeAction/resolve' ||
    method === 'workspace/executeCommand' ||
    method === 'workspace/symbol' ||
    method === 'inlayHint/resolve'
  );
}

/** Next-edit prediction request (renderer → main). */
export interface NextEditRequestView {
  path: string;
  language: string;
  /** Recent edits, already formatted as text. */
  edits: string;
  /** Lines around the cursor; startLine is the 1-based number of lines[0]. */
  startLine: number;
  lines: string[];
  cursor: { line: number; column: number };
}

export interface NextEditView {
  /** 1-based line to change. */
  line: number;
  /** That line's current text. */
  original: string;
  /** Text that replaces the whole line (may contain several lines). */
  replacement: string;
}

/**
 * Reads the model's answer: strict JSON {line, original, replacement}, or "none" / null.
 * Tolerates code fences and text around the JSON object. Returns null when there is no
 * usable edit (missing fields, line outside the window, no change).
 */
export function parseNextEdit(text: string, req: Pick<NextEditRequestView, 'startLine' | 'lines'>): NextEditView | null {
  const s = text.trim();
  if (!s || /^(none|null|\{\s*\})$/i.test(s)) return null;
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let v: unknown;
  try {
    v = JSON.parse(s.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const line = typeof o.line === 'number' ? Math.trunc(o.line) : Number(o.line);
  if (!Number.isFinite(line)) return null;
  if (typeof o.replacement !== 'string') return null;
  const idx = line - req.startLine;
  if (idx < 0 || idx >= req.lines.length) return null;
  const current = req.lines[idx]!;
  const original = typeof o.original === 'string' ? o.original : current;
  // The model must be talking about the line that is really there.
  if (original.trim() !== current.trim()) return null;
  const replacement = o.replacement.replace(/\r\n/g, '\n');
  if (replacement === current) return null;
  return { line, original: current, replacement };
}
