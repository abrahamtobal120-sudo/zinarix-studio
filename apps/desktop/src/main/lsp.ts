import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LspCandidate, LspStatus } from '../shared/lsp.js';
import { lspLanguageFor, lspLanguageId, lspMethodAllowed, splitCommand } from '../shared/lsp.js';
import { childEnv } from './env.js';
import {
  MessageReader,
  encodeMessage,
  fileUri,
  findExecutable,
  toClientUris,
  toServerUris,
  uriToRel,
} from './lspProtocol.js';

const REQUEST_TIMEOUT = 20_000;
const INIT_TIMEOUT = 60_000;
const MAX_RESTARTS = 4;

/** What the manager tells the window it works for. */
export type LspEventSink = {
  diagnostics(path: string, diagnostics: unknown[]): void;
  status(status: LspStatus): void;
  /** workspace/applyEdit from a server: the renderer applies it; resolves to "applied". */
  applyEdit(edit: unknown): Promise<boolean>;
};

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'] },
  workspace: {
    applyEdit: true,
    workspaceEdit: { documentChanges: true, resourceOperations: ['create', 'rename', 'delete'] },
    configuration: true,
    workspaceFolders: true,
    didChangeConfiguration: { dynamicRegistration: false },
    symbol: { dynamicRegistration: false },
    executeCommand: { dynamicRegistration: false },
  },
  textDocument: {
    synchronization: { didSave: true, willSave: false, dynamicRegistration: false },
    completion: {
      completionItem: {
        snippetSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        insertReplaceSupport: true,
        labelDetailsSupport: true,
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] },
      },
      contextSupport: true,
    },
    hover: { contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true,
      },
      contextSupport: true,
    },
    definition: { linkSupport: true },
    declaration: { linkSupport: true },
    typeDefinition: { linkSupport: true },
    implementation: { linkSupport: true },
    references: {},
    documentHighlight: {},
    documentSymbol: { hierarchicalDocumentSymbolSupport: true },
    formatting: {},
    rangeFormatting: {},
    rename: { prepareSupport: true },
    codeAction: {
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: [
            '',
            'quickfix',
            'refactor',
            'refactor.extract',
            'refactor.inline',
            'refactor.rewrite',
            'source',
            'source.organizeImports',
          ],
        },
      },
      resolveSupport: { properties: ['edit'] },
      dataSupport: true,
      isPreferredSupport: true,
    },
    publishDiagnostics: { relatedInformation: true, versionSupport: false },
  },
  window: { workDoneProgress: true, showMessage: {} },
};

/** One language server process (JSON-RPC over stdio). */
class LspClient {
  private proc?: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private reader = new MessageReader();
  capabilities: Record<string, unknown> = {};
  ready: Promise<void>;
  private stopping = false;
  onExit?: (code: number | null, stderr: string) => void;

  constructor(
    private readonly exe: string,
    private readonly args: string[],
    private readonly root: string,
    private readonly sink: LspEventSink,
    private readonly languageId: string,
  ) {
    this.ready = this.start();
  }

  private async start(): Promise<void> {
    const win = process.platform === 'win32';
    // npm shims (.cmd/.bat) need a shell on Windows; quote the path (it may have spaces).
    const shell = win && /\.(cmd|bat)$/i.test(this.exe);
    const q = (s: string) => (/[\s"&|<>^]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const proc = shell
      ? spawn(q(this.exe), this.args.map(q), {
          cwd: this.root,
          env: childEnv(process.env),
          shell: true,
          windowsHide: true,
        })
      : spawn(this.exe, this.args, {
          cwd: this.root,
          env: childEnv(process.env),
          windowsHide: true,
        });
    this.proc = proc;
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString('utf8')).slice(-4000);
    });
    proc.stdout?.on('data', (d: Buffer) => {
      let msgs: unknown[];
      try {
        msgs = this.reader.push(d);
      } catch {
        return;
      }
      for (const m of msgs) this.dispatch(m as Record<string, unknown>);
    });
    proc.on('error', (e) => {
      stderr += `\n${e.message}`;
    });
    proc.on('exit', (code) => {
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('language server exited'));
      }
      this.pending.clear();
      if (!this.stopping) this.onExit?.(code, stderr);
    });
    const result = (await this.request(
      'initialize',
      {
        processId: process.pid,
        clientInfo: { name: 'Zinarix Studio' },
        rootUri: fileUri(this.root),
        rootPath: this.root,
        workspaceFolders: [{ uri: fileUri(this.root), name: this.root.split(/[\\/]/).pop() }],
        capabilities: CLIENT_CAPABILITIES,
        initializationOptions: {},
      },
      INIT_TIMEOUT,
    )) as { capabilities?: Record<string, unknown> } | null;
    this.capabilities = result?.capabilities ?? {};
    this.notify('initialized', {});
  }

  private write(msg: unknown): void {
    const stdin = this.proc?.stdin;
    if (!stdin || stdin.destroyed) return;
    stdin.write(encodeMessage(msg));
  }

  request(method: string, params: unknown, timeout = REQUEST_TIMEOUT): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        this.write({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id } });
        reject(new Error(`${method}: timeout`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params });
  }

  private respond(id: unknown, result: unknown, error?: { code: number; message: string }): void {
    this.write(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result });
  }

  private dispatch(m: Record<string, unknown>): void {
    // Response to one of our requests.
    if ('id' in m && !('method' in m)) {
      const p = this.pending.get(m.id as number);
      if (!p) return;
      this.pending.delete(m.id as number);
      clearTimeout(p.timer);
      const err = m.error as { message?: string } | undefined;
      if (err) p.reject(new Error(err.message ?? 'LSP error'));
      else p.resolve(m.result ?? null);
      return;
    }
    const method = String(m.method ?? '');
    const params = m.params as Record<string, unknown> | undefined;
    // Request from the server.
    if ('id' in m) {
      void this.serverRequest(method, params).then(
        (r) => this.respond(m.id, r),
        (e: unknown) =>
          this.respond(m.id, null, {
            code: -32603,
            message: e instanceof Error ? e.message : String(e),
          }),
      );
      return;
    }
    // Notification.
    if (method === 'textDocument/publishDiagnostics' && params) {
      const rel = uriToRel(String(params.uri ?? ''), this.root);
      if (rel !== null)
        this.sink.diagnostics(
          rel,
          toClientUris((params.diagnostics as unknown[]) ?? [], this.root),
        );
    }
  }

  private async serverRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case 'workspace/configuration': {
        const items = (params as { items?: unknown[] } | undefined)?.items ?? [];
        return items.map(() => null);
      }
      case 'workspace/workspaceFolders':
        return [{ uri: fileUri(this.root), name: this.root.split(/[\\/]/).pop() }];
      case 'window/workDoneProgress/create':
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/showMessageRequest':
      case 'workspace/semanticTokens/refresh':
      case 'workspace/inlayHint/refresh':
      case 'workspace/codeLens/refresh':
      case 'workspace/diagnostic/refresh':
        return null;
      case 'workspace/applyEdit': {
        const edit = (params as { edit?: unknown } | undefined)?.edit;
        const applied = await this.sink.applyEdit(toClientUris(edit, this.root));
        return { applied };
      }
      default:
        throw new Error(`unsupported: ${method}`);
    }
  }

  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;
    const proc = this.proc;
    if (!proc || proc.exitCode !== null) return;
    try {
      await Promise.race([
        this.request('shutdown', null, 2000).then(() => this.notify('exit', null)),
        new Promise((r) => setTimeout(r, 2500)),
      ]);
    } catch {
      // already gone or not answering
    }
    setTimeout(() => {
      if (proc.exitCode === null) proc.kill();
    }, 1000);
  }

  get languageIdForDocs(): string {
    return this.languageId;
  }
}

interface ServerSlot {
  client?: LspClient;
  status: LspStatus;
  restarts: number;
  /** Documents of this language that are open (path → language id). */
  docs: Set<string>;
  starting?: Promise<LspClient | undefined>;
}

interface DocState {
  language: string;
  version: number;
  text: string;
}

export interface LspHostOptions {
  enabled: () => boolean;
  /** Per-language command override ("pyright-langserver --stdio"), from Settings. */
  commands: () => Record<string, string>;
  /** Folder for servers that need a data dir (jdtls). */
  dataDir?: string;
}

/**
 * Language servers of one window: one per language, rooted at the window's open folder,
 * started when the first document of that language opens.
 */
export class LspHost {
  private root: string | undefined;
  private readonly slots = new Map<string, ServerSlot>();
  private readonly docs = new Map<string, DocState>();

  constructor(
    private readonly sink: LspEventSink,
    private readonly opts: LspHostOptions,
  ) {}

  /** Follows the window's folder: a different root stops every server. */
  setRoot(root: string | undefined): void {
    if (root === this.root) return;
    void this.dispose();
    this.root = root;
  }

  /** Server for a Monaco language: user override first, then the built-in candidates. */
  private resolve(language: string):
    | { exe: string; args: string[]; name: string; label: string }
    | { missing: string; label: string }
    | null {
    const custom = this.opts.commands()[language]?.trim();
    const entry = lspLanguageFor(language);
    const label = entry?.label ?? language;
    if (custom) {
      const [cmd, ...args] = splitCommand(custom);
      const exe = cmd ? findExecutable(cmd) : null;
      if (!exe) return { missing: `no se encontró "${cmd ?? custom}" (comando de Ajustes)`, label };
      return { exe, args, name: cmd!.split(/[\\/]/).pop()!, label };
    }
    if (!entry) return null;
    for (const c of entry.candidates) {
      const exe = findExecutable(c.command);
      if (exe) return { exe, args: this.args(c), name: c.name, label };
    }
    return { missing: entry.candidates.map((c) => c.install).join('  ·  o  ·  '), label };
  }

  private args(c: LspCandidate): string[] {
    const data = join(
      this.opts.dataDir ?? tmpdir(),
      'lsp-data',
      createHash('sha1').update(this.root ?? '').digest('hex').slice(0, 12),
    );
    return c.args.map((a) => {
      if (!a.includes('${dataDir}')) return a;
      mkdirSync(data, { recursive: true });
      return a.replace('${dataDir}', data);
    });
  }

  private slot(language: string): ServerSlot {
    let s = this.slots.get(language);
    if (!s) {
      s = {
        status: { language, label: lspLanguageFor(language)?.label ?? language, state: 'off' },
        restarts: 0,
        docs: new Set(),
      };
      this.slots.set(language, s);
    }
    return s;
  }

  private setStatus(s: ServerSlot, status: Partial<LspStatus>): void {
    s.status = { ...s.status, ...status };
    this.sink.status(s.status);
  }

  private async ensure(language: string): Promise<LspClient | undefined> {
    const s = this.slot(language);
    if (s.client) return s.client;
    if (s.starting) return s.starting;
    if (!this.root || !this.opts.enabled()) {
      this.setStatus(s, { state: 'off' });
      return undefined;
    }
    const r = this.resolve(language);
    if (!r) return undefined;
    if ('missing' in r) {
      this.setStatus(s, { state: 'missing', label: r.label, detail: r.missing, server: undefined });
      return undefined;
    }
    const root = this.root;
    this.setStatus(s, { state: 'starting', label: r.label, server: r.name, detail: undefined });
    s.starting = (async () => {
      const client = new LspClient(r.exe, r.args, root, this.sink, lspLanguageId(language));
      client.onExit = (code, stderr) => this.crashed(language, client, code, stderr);
      try {
        await client.ready;
      } catch (e) {
        void client.stop();
        this.setStatus(s, {
          state: 'error',
          detail: e instanceof Error ? e.message : String(e),
        });
        return undefined;
      }
      if (this.root !== root) {
        void client.stop();
        return undefined;
      }
      s.client = client;
      const caps = client.capabilities as {
        completionProvider?: { triggerCharacters?: string[] };
        signatureHelpProvider?: { triggerCharacters?: string[] };
      };
      this.setStatus(s, {
        state: 'ready',
        triggerCharacters: caps.completionProvider?.triggerCharacters,
        signatureTriggers: caps.signatureHelpProvider?.triggerCharacters,
      });
      // Documents opened while it started (or before a restart).
      for (const path of s.docs) this.didOpen(client, path);
      return client;
    })().finally(() => {
      s.starting = undefined;
    });
    return s.starting;
  }

  private crashed(language: string, client: LspClient, code: number | null, stderr: string): void {
    const s = this.slots.get(language);
    if (!s || (s.client && s.client !== client)) return;
    s.client = undefined;
    if (s.restarts >= MAX_RESTARTS) {
      this.setStatus(s, {
        state: 'error',
        detail: `se cerró (código ${code ?? '?'}): ${stderr.trim().split('\n').slice(-3).join(' ')}`,
      });
      return;
    }
    const delay = 1000 * 2 ** s.restarts;
    s.restarts++;
    this.setStatus(s, { state: 'starting', detail: `reiniciando (${s.restarts})…` });
    setTimeout(() => {
      if (this.slots.get(language) === s && s.docs.size) void this.ensure(language);
    }, delay);
  }

  private didOpen(client: LspClient, path: string): void {
    const d = this.docs.get(path);
    if (!d || !this.root) return;
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri: fileUri(join(this.root, ...path.split('/'))),
        languageId: client.languageIdForDocs,
        version: d.version,
        text: d.text,
      },
    });
  }

  private uri(path: string): string {
    return fileUri(join(this.root!, ...path.split('/')));
  }

  async open(path: string, language: string, text: string): Promise<LspStatus | null> {
    if (!this.root) return null;
    if (!this.opts.commands()[language]?.trim() && !lspLanguageFor(language)) return null;
    const prev = this.docs.get(path);
    if (prev && prev.language !== language) this.close(path);
    this.docs.set(path, { language, version: 1, text });
    const s = this.slot(language);
    s.docs.add(path);
    if (s.client) this.didOpen(s.client, path);
    else void this.ensure(language);
    return s.status;
  }

  change(path: string, text: string): void {
    const d = this.docs.get(path);
    if (!d || d.text === text) return;
    d.version++;
    d.text = text;
    this.slots.get(d.language)?.client?.notify('textDocument/didChange', {
      textDocument: { uri: this.uri(path), version: d.version },
      contentChanges: [{ text }],
    });
  }

  save(path: string): void {
    const d = this.docs.get(path);
    if (!d) return;
    this.slots.get(d.language)?.client?.notify('textDocument/didSave', {
      textDocument: { uri: this.uri(path) },
      text: d.text,
    });
  }

  close(path: string): void {
    const d = this.docs.get(path);
    if (!d) return;
    this.docs.delete(path);
    const s = this.slots.get(d.language);
    s?.docs.delete(path);
    s?.client?.notify('textDocument/didClose', { textDocument: { uri: this.uri(path) } });
  }

  async request(path: string, method: string, params: unknown): Promise<unknown> {
    if (!lspMethodAllowed(method)) throw new Error(`método LSP no permitido: ${method}`);
    if (!this.root) return null;
    const d = this.docs.get(path);
    if (!d) return null;
    const client = await this.ensure(d.language);
    if (!client) return null;
    const result = await client.request(method, toServerUris(params, this.root));
    return toClientUris(result, this.root);
  }

  /** Capabilities of the server of a document (to know what to offer). */
  status(language: string): LspStatus | null {
    return this.slots.get(language)?.status ?? null;
  }

  statuses(): LspStatus[] {
    return [...this.slots.values()].map((s) => s.status);
  }

  /** Stops every server and starts again with the current settings. */
  async restart(): Promise<void> {
    const open = [...this.docs.entries()];
    await this.dispose();
    for (const [path, d] of open) await this.open(path, d.language, d.text);
  }

  async dispose(): Promise<void> {
    const clients = [...this.slots.values()].map((s) => s.client).filter(Boolean) as LspClient[];
    this.slots.clear();
    this.docs.clear();
    await Promise.all(clients.map((c) => c.stop()));
  }
}
