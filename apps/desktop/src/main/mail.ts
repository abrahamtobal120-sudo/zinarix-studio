import { resolveMx } from 'node:dns/promises';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ImapFlow } from 'imapflow';
import type { FetchMessageObject, MessageAddressObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import type { AddressObject, ParsedMail } from 'mailparser';
import { createTransport } from 'nodemailer';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { TokenStore } from './token-store.js';
import type {
  MailAccount,
  MailDraft,
  MailFolderView,
  MailListView,
  MailMessageView,
  MailStatus,
  MailTarget,
} from '../shared/api.js';

const PAGE = 50;
/** Inline (cid:) images bigger than this are left out of the shown HTML. */
const MAX_INLINE = 3_000_000;

/** IMAP/SMTP servers of the common providers, by email domain. */
const PRESETS: [RegExp, Omit<MailAccount, 'email' | 'user'>][] = [
  [
    /^(gmail|googlemail)\.com$/,
    { imapHost: 'imap.gmail.com', imapPort: 993, smtpHost: 'smtp.gmail.com', smtpPort: 465 },
  ],
  [
    /^(outlook|hotmail|live|msn)\.[a-z.]+$/,
    {
      imapHost: 'outlook.office365.com',
      imapPort: 993,
      smtpHost: 'smtp-mail.outlook.com',
      smtpPort: 587,
    },
  ],
  [
    /^(yahoo|ymail)\.[a-z.]+$/,
    {
      imapHost: 'imap.mail.yahoo.com',
      imapPort: 993,
      smtpHost: 'smtp.mail.yahoo.com',
      smtpPort: 465,
    },
  ],
  [
    /^(icloud|me|mac)\.com$/,
    { imapHost: 'imap.mail.me.com', imapPort: 993, smtpHost: 'smtp.mail.me.com', smtpPort: 587 },
  ],
  [
    /^(zoho)\.[a-z.]+$/,
    { imapHost: 'imap.zoho.com', imapPort: 993, smtpHost: 'smtp.zoho.com', smtpPort: 465 },
  ],
];

/** IMAP role of each place a message can be moved to (archive: Gmail has no \\Archive, only All Mail). */
const TARGET_ROLES: Record<MailTarget, string[]> = {
  inbox: ['\\Inbox'],
  junk: ['\\Junk'],
  trash: ['\\Trash'],
  archive: ['\\Archive', '\\All'],
};

/** Mail hosts of the big providers, by MX record: custom domains on Google Workspace / Microsoft 365. */
const MX_PRESETS: [RegExp, string][] = [
  [/(^|\.)(google|googlemail)\.com$/, 'gmail.com'],
  [/\.mail\.protection\.outlook\.com$/, 'outlook.com'],
  [/(^|\.)zoho\.[a-z.]+$/, 'zoho.com'],
];

function presetFor(domain: string): Omit<MailAccount, 'email' | 'user'> | null {
  return PRESETS.find(([re]) => re.test(domain))?.[1] ?? null;
}

/** Known servers for an address, by domain or by its MX records (null: the user has to type them). */
export async function mailPreset(email: string): Promise<MailAccount | null> {
  const domain = email.trim().toLowerCase().split('@')[1] ?? '';
  let hit = presetFor(domain);
  if (!hit && domain) {
    const mx = await resolveMx(domain).catch(() => []);
    const host = mx.sort((a, b) => a.priority - b.priority)[0]?.exchange.toLowerCase() ?? '';
    const via = MX_PRESETS.find(([re]) => re.test(host))?.[1];
    if (via) hit = presetFor(via);
  }
  return hit ? { email: email.trim(), user: email.trim(), ...hit } : null;
}

/** Google shows app passwords as "abcd efgh ijkl mnop"; the spaces are not part of them. */
function cleanPass(acc: MailAccount, pass: string): string {
  return acc.imapHost === 'imap.gmail.com' ? pass.replace(/\s+/g, '') : pass;
}

function errText(e: unknown): string {
  const err = e as { authenticationFailed?: boolean; responseText?: string; code?: string };
  const text = `${err.responseText ?? ''} ${(e as Error).message ?? ''}`;
  if (/web login required|application-specific password/i.test(text))
    return 'Google pide una "contraseña de aplicación" (tienes la verificación en 2 pasos). Créala en myaccount.google.com/apppasswords y pégala aquí en vez de tu contraseña normal.';
  if (/imap.*(disabled|not enabled)|IMAP access/i.test(text))
    return 'El acceso IMAP está desactivado en esta cuenta. En Gmail: Configuración → Reenvío y correo POP/IMAP → Habilitar IMAP (en Workspace, el administrador también debe permitirlo).';
  if (err.authenticationFailed || err.code === 'EAUTH')
    return 'El servidor rechazó el usuario o la contraseña. En Gmail, Outlook, Yahoo e iCloud tienes que usar una "contraseña de aplicación", no tu contraseña normal.';
  if (err.code === 'ENOTFOUND') return 'No se encontró el servidor de correo. Revisa el host.';
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT')
    return 'No se pudo conectar con el servidor de correo. Revisa el host y el puerto.';
  return err.responseText || (e as Error).message || String(e);
}

function addr(list: MessageAddressObject[] | undefined): string {
  return (list ?? [])
    .map((a) => (a.name ? `${a.name} <${a.address}>` : (a.address ?? '')))
    .join(', ');
}

function parsedAddr(a: AddressObject | AddressObject[] | undefined): string {
  if (!a) return '';
  return (Array.isArray(a) ? a : [a]).map((x) => x.text).join(', ');
}

/** The message's HTML with its inline (cid:) images embedded; remote content stays blocked. */
function htmlOf(mail: ParsedMail): string | null {
  if (!mail.html) return null;
  let html = mail.html;
  for (const a of mail.attachments) {
    if (!a.cid || a.size > MAX_INLINE) continue;
    const uri = `data:${a.contentType};base64,${a.content.toString('base64')}`;
    html = html.split(`cid:${a.cid}`).join(uri);
  }
  return html;
}

/**
 * The user's own mailbox, over IMAP (read, flags, move) and SMTP (send). Server settings live in
 * `mail.json`; the password in the OS keychain (TokenStore). One IMAP connection is kept open
 * and reopened when it drops.
 */
export class Mail {
  private readonly cfgFile: string;
  private readonly secret: TokenStore;
  private client: ImapFlow | null = null;
  private connecting: Promise<ImapFlow> | null = null;
  /** Last opened message, parsed (attachments are saved from it without downloading again). */
  private last: { key: string; mail: ParsedMail } | null = null;

  constructor(dir: string) {
    this.cfgFile = join(dir, 'mail.json');
    this.secret = new TokenStore(join(dir, 'mail-password.bin'), 'mail-password');
  }

  private account(): MailAccount | null {
    if (!existsSync(this.cfgFile)) return null;
    try {
      return JSON.parse(readFileSync(this.cfgFile, 'utf8')) as MailAccount;
    } catch {
      return null;
    }
  }

  status(): MailStatus {
    const account = this.account();
    return { connected: !!account && !!this.secret.get(), account };
  }

  preset(email: string): Promise<MailAccount | null> {
    return mailPreset(email);
  }

  private imap(acc: MailAccount, pass: string): ImapFlow {
    const c = new ImapFlow({
      host: acc.imapHost,
      port: acc.imapPort,
      secure: acc.imapPort === 993,
      auth: { user: acc.user, pass },
      logger: false,
      emitLogs: false,
    });
    // Without a listener a dropped connection would crash the app.
    c.on('error', () => {});
    c.on('close', () => {
      if (this.client === c) this.client = null;
    });
    return c;
  }

  private smtp(acc: MailAccount, pass: string) {
    return createTransport({
      host: acc.smtpHost,
      port: acc.smtpPort,
      secure: acc.smtpPort === 465,
      requireTLS: acc.smtpPort !== 465,
      auth: { user: acc.user, pass },
    });
  }

  /** Checks both servers with these settings and keeps them (password in the keychain). */
  async connect(acc: MailAccount, pass: string): Promise<MailStatus> {
    pass = cleanPass(acc, pass);
    const c = this.imap(acc, pass);
    try {
      await c.connect();
    } catch (e) {
      throw new Error(`IMAP: ${errText(e)}`);
    }
    try {
      await this.smtp(acc, pass).verify();
    } catch (e) {
      await c.logout().catch(() => {});
      throw new Error(`SMTP: ${errText(e)}`);
    }
    await this.disconnect();
    writeFileSync(this.cfgFile, JSON.stringify(acc, null, 2), { mode: 0o600 });
    this.secret.set(pass);
    this.client = c;
    return this.status();
  }

  private async disconnect(): Promise<void> {
    const c = this.client;
    this.client = null;
    this.last = null;
    if (c) await c.logout().catch(() => c.close());
  }

  async logout(): Promise<MailStatus> {
    await this.disconnect();
    rmSync(this.cfgFile, { force: true });
    this.secret.delete();
    return this.status();
  }

  private creds(): { acc: MailAccount; pass: string } {
    const acc = this.account();
    const pass = this.secret.get();
    if (!acc || !pass) throw new Error('No hay una cuenta de correo conectada.');
    return { acc, pass };
  }

  private async conn(): Promise<ImapFlow> {
    if (this.client?.usable) return this.client;
    this.connecting ??= (async () => {
      const { acc, pass } = this.creds();
      const c = this.imap(acc, pass);
      try {
        await c.connect();
      } catch (e) {
        throw new Error(errText(e));
      }
      this.client = c;
      return c;
    })().finally(() => (this.connecting = null));
    return this.connecting;
  }

  /** Runs `fn` with `folder` selected (one folder at a time on the shared connection). */
  private async inFolder<T>(folder: string, fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = await this.conn();
    const lock = await c.getMailboxLock(folder);
    try {
      return await fn(c);
    } finally {
      lock.release();
    }
  }

  async folders(): Promise<MailFolderView[]> {
    const c = await this.conn();
    const list = await c.list({ statusQuery: { unseen: true, messages: true } });
    return list
      .filter((f) => !f.flags.has('\\Noselect') && !f.flags.has('\\NonExistent'))
      .map((f) => ({
        path: f.path,
        name: f.name,
        specialUse: f.specialUse ?? null,
        unseen: f.status?.unseen ?? 0,
        messages: f.status?.messages ?? 0,
      }));
  }

  /** One page of messages, newest first; `query` searches sender and subject. */
  async list(folder: string, page: number, query: string): Promise<MailListView> {
    return this.inFolder(folder, async (c) => {
      const box = c.mailbox;
      const exists = box ? box.exists : 0;
      const q = query.trim();
      let range: string;
      let total: number;
      let byUid = false;
      if (q) {
        const uids =
          (await c.search({ or: [{ from: q }, { subject: q }, { to: q }] }, { uid: true })) || [];
        total = uids.length;
        const slice = uids.slice(Math.max(0, total - (page + 1) * PAGE), total - page * PAGE);
        if (!slice.length) return { total, messages: [] };
        range = slice.join(',');
        byUid = true;
      } else {
        total = exists;
        const end = exists - page * PAGE;
        if (end < 1) return { total, messages: [] };
        range = `${Math.max(1, end - PAGE + 1)}:${end}`;
      }
      const rows: FetchMessageObject[] = [];
      for await (const m of c.fetch(
        range,
        { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true },
        { uid: byUid },
      ))
        rows.push(m);
      rows.sort((a, b) => b.uid - a.uid);
      return {
        total,
        messages: rows.map((m) => ({
          uid: m.uid,
          from: addr(m.envelope?.from),
          to: addr(m.envelope?.to),
          subject: m.envelope?.subject ?? '',
          date: new Date(m.envelope?.date ?? m.internalDate ?? 0).getTime(),
          seen: m.flags?.has('\\Seen') ?? false,
          flagged: m.flags?.has('\\Flagged') ?? false,
          attachments: /"?attachment"?/i.test(JSON.stringify(m.bodyStructure ?? {})),
        })),
      };
    });
  }

  /** Downloads and parses a message (and marks it read). */
  async open(folder: string, uid: number): Promise<MailMessageView> {
    const mail = await this.inFolder(folder, async (c) => {
      const m = await c.fetchOne(String(uid), { source: true }, { uid: true });
      if (!m || !m.source) throw new Error('El correo ya no existe.');
      await c.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      return simpleParser(m.source);
    });
    this.last = { key: `${folder}\n${uid}`, mail };
    const refs = mail.references;
    return {
      uid,
      messageId: mail.messageId ?? null,
      references: Array.isArray(refs) ? refs : refs ? [refs] : [],
      from: parsedAddr(mail.from),
      replyTo: parsedAddr(mail.replyTo) || parsedAddr(mail.from),
      to: parsedAddr(mail.to),
      cc: parsedAddr(mail.cc),
      subject: mail.subject ?? '',
      date: mail.date?.getTime() ?? 0,
      html: htmlOf(mail),
      text: mail.text ?? '',
      attachments: mail.attachments
        .map((a, index) => ({
          index,
          filename: a.filename ?? `adjunto-${index + 1}`,
          size: a.size,
          contentType: a.contentType,
          inline: a.contentDisposition === 'inline' && !!a.cid,
        }))
        .filter((a) => !a.inline),
    };
  }

  /** Content of an attachment of the message opened last. */
  attachment(folder: string, uid: number, index: number): { filename: string; content: Buffer } {
    if (this.last?.key !== `${folder}\n${uid}`) throw new Error('Vuelve a abrir el correo.');
    const a = this.last.mail.attachments[index];
    if (!a) throw new Error('Ese adjunto no existe.');
    return { filename: a.filename ?? `adjunto-${index + 1}`, content: a.content };
  }

  async setFlag(folder: string, uid: number, flag: 'seen' | 'flagged', on: boolean): Promise<void> {
    const name = flag === 'seen' ? '\\Seen' : '\\Flagged';
    await this.inFolder(folder, (c) =>
      on
        ? c.messageFlagsAdd(String(uid), [name], { uid: true })
        : c.messageFlagsRemove(String(uid), [name], { uid: true }),
    );
  }

  /** Path of the folder with this IMAP role (\\Trash, \\Drafts…), or null if the server has none. */
  private async roleFolder(...roles: string[]): Promise<string | null> {
    const fs = await this.folders();
    for (const r of roles) {
      if (r === '\\Inbox') return fs.find((f) => f.specialUse === r)?.path ?? 'INBOX';
      const hit = fs.find((f) => f.specialUse === r)?.path;
      if (hit) return hit;
    }
    return null;
  }

  /** Moves the message to the trash (deletes it for good when it is already there). */
  async trash(folder: string, uid: number): Promise<void> {
    const trash = await this.roleFolder('\\Trash');
    await this.inFolder(folder, async (c) => {
      if (trash && trash !== folder) await c.messageMove(String(uid), trash, { uid: true });
      else await c.messageDelete(String(uid), { uid: true });
    });
  }

  /** Moves the message to the inbox, spam, trash or archive. */
  async move(folder: string, uid: number, to: MailTarget): Promise<void> {
    const target = await this.roleFolder(...TARGET_ROLES[to]);
    if (!target) throw new Error('Tu servidor de correo no tiene esa carpeta.');
    if (target === folder) return;
    await this.inFolder(folder, (c) => c.messageMove(String(uid), target, { uid: true }));
  }

  /** The draft as a raw RFC 822 message, sent from the account. */
  private async compose(acc: MailAccount, d: MailDraft) {
    const node = new MailComposer({
      from: acc.name ? { name: acc.name, address: acc.email } : acc.email,
      to: d.to || undefined,
      cc: d.cc || undefined,
      subject: d.subject,
      text: d.text,
      inReplyTo: d.inReplyTo ?? undefined,
      references: d.references?.length ? d.references : undefined,
    }).compile();
    return { raw: await node.build(), envelope: node.getEnvelope() };
  }

  /** Saves the draft in the Drafts folder, replacing the copy it was opened from. */
  async saveDraft(d: MailDraft): Promise<number | null> {
    const { acc } = this.creds();
    const drafts = await this.roleFolder('\\Drafts');
    if (!drafts) throw new Error('Tu servidor de correo no tiene carpeta de borradores.');
    const { raw } = await this.compose(acc, d);
    const res = await (await this.conn()).append(drafts, raw, ['\\Draft', '\\Seen']);
    if (d.draftUid) await this.deleteDraft(d.draftUid).catch(() => {});
    return (res && res.uid) || null;
  }

  async deleteDraft(uid: number): Promise<void> {
    const drafts = await this.roleFolder('\\Drafts');
    if (!drafts) return;
    await this.inFolder(drafts, (c) => c.messageDelete(String(uid), { uid: true }));
  }

  async send(d: MailDraft): Promise<void> {
    const { acc, pass } = this.creds();
    const { raw, envelope } = await this.compose(acc, d);
    try {
      await this.smtp(acc, pass).sendMail({ envelope, raw });
    } catch (e) {
      throw new Error(errText(e));
    }
    // A draft that was sent is not a draft anymore.
    if (d.draftUid) await this.deleteDraft(d.draftUid).catch(() => {});
    // Gmail files sent mail by itself; other servers need a copy in the Sent folder.
    if (acc.smtpHost === 'smtp.gmail.com') return;
    try {
      const sent = await this.roleFolder('\\Sent');
      if (sent) await (await this.conn()).append(sent, raw, ['\\Seen']);
    } catch {
      /* sent anyway; only the copy is missing */
    }
  }
}
