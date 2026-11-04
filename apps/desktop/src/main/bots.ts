import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  BotKind,
  BotView,
  BotsStatus,
  PhoneAction,
  PhoneRepo,
  PhoneSnapshot,
} from '../shared/api.js';
import type { PhoneRepos } from './phone.js';
import { TokenStore } from './token-store.js';

const KINDS: BotKind[] = ['telegram', 'discord'];
/** Longest message each app accepts. */
const LIMIT: Record<BotKind, number> = { telegram: 4000, discord: 1900 };
/** Longer answers are cut after this many messages (the rest stays in Zinarix). */
const MAX_PARTS = 4;
const RETRY_MS = 5000;

interface Button {
  label: string;
  data: string;
  danger?: boolean;
}

/** Something a person wrote or pressed in the chat app. */
interface Incoming {
  /** Where to answer (the private chat / DM channel). */
  chat: string;
  /** Who it is (linked with the PIN). */
  user: string;
  text?: string;
  /** A button: its data, and how to mark it as handled. */
  button?: { data: string; done(note: string): Promise<void> };
}

interface Link {
  send(chat: string, text: string, buttons?: Button[]): Promise<void>;
  stop(): void;
}

interface LinkEvents {
  message(m: Incoming): void;
  /** Connected (name of the bot), or it stopped for good with this error. */
  ready(name: string, invite?: string): void;
  fail(error: string): void;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((ok) => {
    const t = setTimeout(ok, ms);
    signal.addEventListener('abort', () => (clearTimeout(t), ok()), { once: true });
  });

// ---------------- Telegram (Bot API, long polling: no tunnel, no open ports) ----------------

function telegram(token: string, on: LinkEvents): Link {
  const ctl = new AbortController();
  const api = async (method: string, body: object, timeoutMs = 20_000): Promise<any> => {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(timeoutMs)]),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: unknown;
      description?: string;
    };
    if (!json.ok) {
      const err = new Error(json.description || `HTTP ${res.status}`) as Error & { code?: number };
      err.code = res.status;
      throw err;
    }
    return json.result;
  };

  void (async () => {
    let offset = 0;
    try {
      const me = (await api('getMe', {})) as { username?: string };
      on.ready(`@${me.username ?? 'bot'}`);
      await api('setMyCommands', {
        commands: [
          { command: 'repos', description: 'Lista tus repositorios' },
          { command: 'pull', description: 'git pull de un repo: /pull 2' },
          { command: 'abrir', description: 'Abre un repo en Zinarix: /abrir 2' },
          { command: 'parar', description: 'Detiene la respuesta de la IA' },
          { command: 'nuevo', description: 'Empieza un chat nuevo' },
          { command: 'ayuda', description: 'Qué puedo hacer' },
        ],
      }).catch(() => undefined);
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (!ctl.signal.aborted)
        on.fail(code === 401 || code === 404 ? 'Token de Telegram inválido.' : String(e));
      return;
    }
    while (!ctl.signal.aborted) {
      try {
        const updates = (await api(
          'getUpdates',
          { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
          65_000,
        )) as any[];
        for (const u of updates) {
          offset = u.update_id + 1;
          const m = u.message;
          // Only private chats: in a group anyone could read the answers.
          if (m?.chat?.type === 'private' && typeof m.text === 'string')
            on.message({ chat: String(m.chat.id), user: String(m.from?.id), text: m.text });
          const q = u.callback_query;
          if (q?.message?.chat?.type === 'private' && typeof q.data === 'string') {
            on.message({
              chat: String(q.message.chat.id),
              user: String(q.from?.id),
              button: {
                data: q.data,
                done: async (note) => {
                  await api('answerCallbackQuery', { callback_query_id: q.id, text: note });
                  await api('editMessageReplyMarkup', {
                    chat_id: q.message.chat.id,
                    message_id: q.message.message_id,
                    reply_markup: { inline_keyboard: [] },
                  });
                },
              },
            });
          }
        }
      } catch (e) {
        if (ctl.signal.aborted) return;
        const code = (e as { code?: number }).code;
        if (code === 401 || code === 404) return on.fail('Token de Telegram inválido.');
        if (code === 409)
          on.fail('Otro programa está usando este bot (cierra el otro o crea un bot nuevo).');
        await sleep(RETRY_MS, ctl.signal);
      }
    }
  })();

  return {
    async send(chat, text, buttons) {
      await api('sendMessage', {
        chat_id: chat,
        text,
        link_preview_options: { is_disabled: true },
        ...(buttons
          ? { reply_markup: { inline_keyboard: [buttons.map((b) => ({ text: b.label, callback_data: b.data }))] } }
          : {}),
      });
    },
    stop: () => ctl.abort(),
  };
}

// ---------------- Discord (Gateway websocket for DMs + REST to answer) ----------------

const DISCORD = 'https://discord.com/api/v10';
/** DIRECT_MESSAGES: DMs carry their text without the privileged message-content intent. */
const INTENTS = 1 << 12;

function discord(token: string, on: LinkEvents): Link {
  const ctl = new AbortController();
  const rest = async (path: string, body?: object): Promise<any> => {
    const res = await fetch(`${DISCORD}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: `Bot ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'DiscordBot (https://zinarix.dev, 1)',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([ctl.signal, AbortSignal.timeout(20_000)]),
    });
    if (res.status === 204) return null;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((json as { message?: string }).message || `HTTP ${res.status}`) as Error & {
        code?: number;
      };
      err.code = res.status;
      throw err;
    }
    return json;
  };

  let ws: WebSocket | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  const close = () => {
    if (beat) clearInterval(beat);
    beat = null;
    const s = ws;
    ws = null;
    try {
      s?.close();
    } catch {
      /* already closed */
    }
  };

  const connect = async (): Promise<void> => {
    let url: string;
    try {
      url = ((await rest('/gateway/bot')) as { url: string }).url;
    } catch (e) {
      if (ctl.signal.aborted) return;
      if ((e as { code?: number }).code === 401) return on.fail('Token de Discord inválido.');
      await sleep(RETRY_MS, ctl.signal);
      return connect();
    }
    if (ctl.signal.aborted) return;
    const sock = new WebSocket(`${url}/?v=10&encoding=json`);
    ws = sock;
    let seq: number | null = null;
    let acked = true;
    sock.onmessage = (ev) => {
      const p = JSON.parse(String(ev.data)) as { op: number; d: any; s?: number; t?: string };
      if (typeof p.s === 'number') seq = p.s;
      switch (p.op) {
        case 10: {
          const every = Number(p.d.heartbeat_interval) || 41_250;
          beat = setInterval(() => {
            // No answer to the last heartbeat: the connection is dead, start over.
            if (!acked) return sock.close(4900);
            acked = false;
            sock.send(JSON.stringify({ op: 1, d: seq }));
          }, every);
          sock.send(
            JSON.stringify({
              op: 2,
              d: {
                token,
                intents: INTENTS,
                properties: { os: process.platform, browser: 'zinarix', device: 'zinarix' },
              },
            }),
          );
          break;
        }
        case 11:
          acked = true;
          break;
        case 1:
          sock.send(JSON.stringify({ op: 1, d: seq }));
          break;
        case 7:
        case 9:
          sock.close(4901);
          break;
        case 0:
          if (p.t === 'READY') {
            const app = p.d.application?.id ?? p.d.user?.id;
            on.ready(
              p.d.user?.username ?? 'bot',
              app ? `https://discord.com/oauth2/authorize?client_id=${app}&scope=bot&permissions=0` : undefined,
            );
          } else if (p.t === 'MESSAGE_CREATE') {
            const m = p.d;
            // Only DMs (no guild): in a server channel anyone could read the answers.
            if (!m.guild_id && !m.author?.bot && typeof m.content === 'string' && m.content)
              on.message({ chat: m.channel_id, user: m.author.id, text: m.content });
          } else if (p.t === 'INTERACTION_CREATE' && p.d.type === 3 && !p.d.guild_id) {
            const i = p.d;
            on.message({
              chat: i.channel_id,
              user: i.user?.id ?? i.member?.user?.id,
              button: {
                data: String(i.data?.custom_id ?? ''),
                done: async (note) => {
                  await rest(`/interactions/${i.id}/${i.token}/callback`, {
                    type: 7,
                    data: {
                      content: `${String(i.message?.content ?? '').slice(0, 1800)}\n→ ${note}`,
                      components: [],
                    },
                  });
                },
              },
            });
          }
          break;
      }
    };
    sock.onclose = (ev) => {
      if (ws === sock) close();
      if (ctl.signal.aborted) return;
      if (ev.code === 4004) return on.fail('Token de Discord inválido.');
      if (ev.code === 4013 || ev.code === 4014)
        return on.fail('Discord no permite los permisos del bot (revisa los "Privileged Gateway Intents").');
      void sleep(RETRY_MS, ctl.signal).then(() => !ctl.signal.aborted && connect());
    };
  };
  void connect();

  return {
    async send(chat, text, buttons) {
      await rest(`/channels/${chat}/messages`, {
        content: text,
        allowed_mentions: { parse: [] },
        ...(buttons
          ? {
              components: [
                {
                  type: 1,
                  components: buttons.map((b) => ({
                    type: 2,
                    style: b.danger ? 4 : 3,
                    label: b.label,
                    custom_id: b.data,
                  })),
                },
              ],
            }
          : {}),
      });
    },
    stop: () => {
      ctl.abort();
      close();
    },
  };
}

// ---------------- the bots, on top of the phone remote ----------------

export interface BotDeps {
  /** Folder for the saved tokens and linked chats. */
  dir(): string;
  /** Sends an action to the window the phone remote controls (like the phone page). */
  action(a: PhoneAction): void;
  repos: PhoneRepos;
  /** The phone remote's PIN (wrong tries count there too). */
  checkPin(pin: string): boolean;
  onStatus(s: BotsStatus): void;
}

const HELP = `Escríbeme lo que quieras pedirle a la IA de Zinarix y te respondo aquí.

Comandos:
/repos: tus repositorios (rama, cambios, commits por bajar y por subir)
/pull 2: git pull del repo 2 de la lista (o su nombre)
/abrir 2: abre ese repo en Zinarix, para que la IA trabaje en él
/parar: detiene la respuesta
/nuevo: empieza un chat nuevo
/chats: los chats abiertos · /chat 2: cambia al chat 2

Cuando la IA pida permiso para algo te llegan los botones Aprobar / Rechazar (o responde "si" / "no").`;

/**
 * Telegram and Discord bots (official APIs: no risk of the account being blocked) that work
 * like the phone page: messages go to the chat of the window the phone remote controls, the
 * answers and approval requests come back, and /repos, /pull, /abrir reach the repositories.
 * They run only while the phone remote is on, and only answer chats linked with its PIN.
 */
export class ChatBots {
  private links = new Map<BotKind, Link>();
  private views: Record<BotKind, BotView> = {
    telegram: { saved: false, connected: false, paired: 0 },
    discord: { saved: false, connected: false, paired: 0 },
  };
  private active = false;
  private snapshot: PhoneSnapshot | null = null;
  /** The conversation that gets the answers: the last linked chat that wrote. */
  private target: { kind: BotKind; chat: string } | null = null;
  /** waiting: a message went out; running: the chat got busy with it. */
  private phase: 'idle' | 'waiting' | 'running' = 'idle';
  private turnsAtSend = 0;
  /** Approval requests already sent (tool call ids), and the short codes buttons carry. */
  private asked = new Set<string>();
  private codes = new Map<string, string>();
  private lastRepos = new Map<string, PhoneRepo[]>();

  constructor(private deps: BotDeps) {}

  private store(kind: BotKind): TokenStore {
    return new TokenStore(join(this.deps.dir(), `bot-${kind}.bin`), `bot:${kind}`);
  }

  private pairedFile(): string {
    return join(this.deps.dir(), 'bots.json');
  }

  private paired(): Record<BotKind, string[]> {
    try {
      const j = JSON.parse(readFileSync(this.pairedFile(), 'utf8')) as Partial<Record<BotKind, string[]>>;
      return { telegram: j.telegram ?? [], discord: j.discord ?? [] };
    } catch {
      return { telegram: [], discord: [] };
    }
  }

  private savePaired(p: Record<BotKind, string[]>): void {
    writeFileSync(this.pairedFile(), JSON.stringify(p), { mode: 0o600 });
  }

  status(): BotsStatus {
    const p = this.paired();
    for (const k of KINDS) {
      this.views[k].saved = !!this.store(k).get();
      this.views[k].paired = p[k].length;
    }
    return { telegram: { ...this.views.telegram }, discord: { ...this.views.discord } };
  }

  private changed(): void {
    this.deps.onStatus(this.status());
  }

  /** The phone remote started: the saved bots connect. */
  attach(): void {
    this.active = true;
    for (const k of KINDS) {
      const token = this.store(k).get();
      if (token) this.start(k, token);
    }
  }

  /** The phone remote stopped: the bots disconnect (their tokens stay saved). */
  detach(): void {
    this.active = false;
    for (const k of KINDS) this.halt(k);
    this.snapshot = null;
    this.target = null;
    this.phase = 'idle';
  }

  connect(kind: BotKind, token: string): BotsStatus {
    if (!this.active) throw new Error('Activa primero el control desde el celular.');
    this.store(kind).set(token.trim());
    this.start(kind, token.trim());
    return this.status();
  }

  disconnect(kind: BotKind): BotsStatus {
    this.halt(kind);
    this.store(kind).delete();
    const p = this.paired();
    p[kind] = [];
    this.savePaired(p);
    if (this.target?.kind === kind) this.target = null;
    return this.status();
  }

  private halt(kind: BotKind): void {
    this.links.get(kind)?.stop();
    this.links.delete(kind);
    this.views[kind] = { saved: false, connected: false, paired: 0 };
  }

  private start(kind: BotKind, token: string): void {
    this.halt(kind);
    const events: LinkEvents = {
      message: (m) => {
        if (this.links.get(kind) !== link) return;
        void this.incoming(kind, m).catch(() => undefined);
      },
      ready: (name, invite) => {
        if (this.links.get(kind) !== link) return;
        this.views[kind] = { ...this.views[kind], connected: true, name, invite, error: undefined };
        this.changed();
      },
      fail: (error) => {
        if (this.links.get(kind) !== link) return;
        this.views[kind] = { ...this.views[kind], connected: false, error };
        this.changed();
      },
    };
    const link = kind === 'telegram' ? telegram(token, events) : discord(token, events);
    this.links.set(kind, link);
  }

  /** Sends text in as many messages as needed (up to MAX_PARTS). */
  private async say(kind: BotKind, chat: string, text: string, buttons?: Button[]): Promise<void> {
    const link = this.links.get(kind);
    if (!link) return;
    const max = LIMIT[kind];
    const parts: string[] = [];
    let rest = text.trim() || '(sin texto)';
    while (rest && parts.length < MAX_PARTS) {
      let cut = rest.length <= max ? rest.length : rest.lastIndexOf('\n', max);
      if (cut < max / 2) cut = Math.min(max, rest.length);
      parts.push(rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
    if (rest) parts[parts.length - 1] += '\n\n… (el resto está en Zinarix)';
    for (let i = 0; i < parts.length; i++)
      await link.send(chat, parts[i]!, i === parts.length - 1 ? buttons : undefined);
  }

  private async incoming(kind: BotKind, m: Incoming): Promise<void> {
    const key = `${kind}:${m.chat}`;
    const paired = this.paired();
    if (!paired[kind].includes(m.user)) {
      const pin = /^\/?(?:start|pin)?\s*(\d[\d\s-]{4,10}\d)\s*$/i.exec(m.text ?? '')?.[1];
      if (pin && this.deps.checkPin(pin)) {
        paired[kind].push(m.user);
        this.savePaired(paired);
        this.target = { kind, chat: m.chat };
        this.changed();
        return this.say(kind, m.chat, `Listo, este chat quedó vinculado a Zinarix.\n\n${HELP}`);
      }
      return this.say(
        kind,
        m.chat,
        pin
          ? 'PIN incorrecto.'
          : 'Para usar este bot, escribe el PIN que aparece en Zinarix (Configuración → Celular).',
      );
    }
    this.target = { kind, chat: m.chat };

    if (m.button) {
      const [verb, code] = m.button.data.split(':');
      const id = this.codes.get(code ?? '');
      if (!id) return m.button.done('Ya no está pendiente');
      this.decide(id, verb === 'a');
      return m.button.done(verb === 'a' ? 'Aprobado' : 'Rechazado');
    }

    const text = (m.text ?? '').trim();
    const [cmd = '', ...args] = text.split(/\s+/);
    const arg = args.join(' ');
    switch (cmd.toLowerCase().replace(/@\S+$/, '')) {
      case '/start':
      case '/ayuda':
      case '/help':
        return this.say(kind, m.chat, HELP);
      case '/repos': {
        const repos = await this.deps.repos.list();
        this.lastRepos.set(key, repos);
        if (!repos.length) return this.say(kind, m.chat, 'No encontré repositorios.');
        const lines = repos.map(
          (r, i) =>
            `${i + 1}. ${r.name}${r.open ? ' (abierto)' : ''} · ${r.branch || '?'}` +
            (r.behind ? ` · ↓${r.behind}` : '') +
            (r.ahead ? ` · ↑${r.ahead}` : '') +
            (r.changes ? ` · ${r.changes} cambios` : '') +
            (r.error ? ' · error' : ''),
        );
        return this.say(kind, m.chat, `${lines.join('\n')}\n\n/pull 2 · /abrir 2`);
      }
      case '/pull':
      case '/abrir':
      case '/open': {
        const repo = await this.findRepo(key, arg);
        if (!repo) return this.say(kind, m.chat, 'No encontré ese repo. Usa /repos para ver la lista.');
        try {
          if (cmd.toLowerCase() === '/pull') {
            await this.say(kind, m.chat, `Haciendo pull de ${repo.name}…`);
            const out = await this.deps.repos.pull(repo.path);
            return this.say(kind, m.chat, `${repo.name}:\n${out.trim() || 'Listo.'}`);
          }
          await this.deps.repos.open(repo.path);
          return this.say(kind, m.chat, `${repo.name} abierto en Zinarix.`);
        } catch (e) {
          return this.say(kind, m.chat, `${repo.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      case '/parar':
      case '/stop':
        this.deps.action({ kind: 'stop' });
        return this.say(kind, m.chat, 'Detenido.');
      case '/nuevo':
      case '/new':
        this.deps.action({ kind: 'newChat' });
        return this.say(kind, m.chat, 'Chat nuevo listo.');
      case '/chats': {
        const s = this.snapshot;
        if (!s?.chats.length) return this.say(kind, m.chat, 'No hay chats abiertos.');
        return this.say(
          kind,
          m.chat,
          s.chats
            .map((c, i) => `${i + 1}. ${c.title}${c.id === s.chatId ? ' ←' : ''}${c.busy ? ' (trabajando)' : ''}`)
            .join('\n') + '\n\n/chat 2 para cambiar',
        );
      }
      case '/chat': {
        const c = this.snapshot?.chats[Number(arg) - 1];
        if (!c) return this.say(kind, m.chat, 'Ese chat no existe. Usa /chats.');
        this.deps.action({ kind: 'select', chatId: c.id });
        return this.say(kind, m.chat, `Ahora en: ${c.title}`);
      }
    }

    // "si" / "no" answers the oldest pending approval.
    const pending = this.pendingApprovals()[0];
    if (pending && /^(s[ií]|ok|aprobar|apruebo|yes|y)$/i.test(text)) {
      this.decide(pending.id, true);
      return this.say(kind, m.chat, 'Aprobado.');
    }
    if (pending && /^(no|rechazar|n)$/i.test(text)) {
      this.decide(pending.id, false);
      return this.say(kind, m.chat, 'Rechazado.');
    }

    if (text.startsWith('/')) return this.say(kind, m.chat, `No conozco ese comando.\n\n${HELP}`);
    this.turnsAtSend = this.snapshot?.turns.length ?? 0;
    this.phase = 'waiting';
    this.deps.action({ kind: 'send', text });
  }

  private async findRepo(key: string, arg: string): Promise<PhoneRepo | undefined> {
    const n = Number(arg);
    const listed = this.lastRepos.get(key);
    if (n && listed?.[n - 1]) return listed[n - 1];
    const repos = await this.deps.repos.list();
    this.lastRepos.set(key, repos);
    if (n) return repos[n - 1];
    const q = arg.toLowerCase();
    if (!q) return repos.find((r) => r.open);
    return repos.find((r) => r.name.toLowerCase() === q) ?? repos.find((r) => r.name.toLowerCase().includes(q));
  }

  private pendingApprovals() {
    return (this.snapshot?.turns ?? []).flatMap((t) => t.tools.filter((x) => x.status === 'approval'));
  }

  private decide(toolCallId: string, ok: boolean): void {
    this.deps.action({ kind: 'decide', toolCallId, decision: ok ? 'approve' : 'deny' });
  }

  /** The controlled chat changed: answers and approval requests go to the linked chat. */
  push(s: PhoneSnapshot): void {
    if (!this.active) return;
    this.snapshot = s;
    const to = this.target;
    if (!to || !this.links.has(to.kind)) return;
    for (const tool of this.pendingApprovals()) {
      if (this.asked.has(tool.id)) continue;
      this.asked.add(tool.id);
      const code = String(this.codes.size + 1);
      this.codes.set(code, tool.id);
      void this.say(to.kind, to.chat, `La IA pide permiso para:\n${tool.title}`, [
        { label: 'Aprobar', data: `a:${code}` },
        { label: 'Rechazar', data: `d:${code}`, danger: true },
      ]).catch(() => undefined);
    }
    if (this.phase === 'waiting' && s.busy) this.phase = 'running';
    const last = s.turns.at(-1);
    // Done: busy and then idle again, or idle already with a new answer (it failed quickly).
    const done =
      !s.busy &&
      last?.role === 'assistant' &&
      (this.phase === 'running' || (this.phase === 'waiting' && s.turns.length > this.turnsAtSend + 1));
    if (!done) return;
    this.phase = 'idle';
    const text = [last.text, last.error ? `Error: ${last.error}` : ''].filter(Boolean).join('\n\n');
    void this.say(to.kind, to.chat, text).catch(() => undefined);
  }
}
