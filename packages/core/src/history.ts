import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '@omni/shared';
import { redactDeep } from '@omni/security';
import type { Db } from './db.js';

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: string | null;
  /** Workspace folder the conversation was started in, if any. */
  project: string | null;
  messageCount?: number;
}

export interface StoredMessage {
  role: ChatMessage['role'];
  message: ChatMessage;
  model: string | null;
  ts: number;
  /** UI-only rendering data stored with the message (never sent to a provider). */
  display: unknown;
}

const CONV_COLUMNS = `c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt, c.model, c.project,
  (SELECT COUNT(*) FROM messages m2 WHERE m2.conversation_id = c.id) AS messageCount`;

/** Conversation history. Messages are stored redacted: history never holds a credential. */
export class History {
  constructor(private readonly db: Db) {}

  create(title: string, model?: string, project?: string): Conversation {
    const now = Date.now();
    const c: Conversation = {
      id: randomUUID(),
      title: title.slice(0, 120) || 'Sin título',
      createdAt: now,
      updatedAt: now,
      model: model ?? null,
      project: project ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO conversations (id, title, created_at, updated_at, model, project) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(c.id, c.title, c.createdAt, c.updatedAt, c.model, c.project);
    return c;
  }

  append(conversationId: string, message: ChatMessage, model?: string, display?: unknown): void {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO messages (conversation_id, ts, role, content_json, model, display_json) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        conversationId,
        now,
        message.role,
        JSON.stringify(redactDeep(message)),
        model ?? null,
        display === undefined ? null : JSON.stringify(redactDeep(display)),
      );
    this.db
      .prepare('UPDATE conversations SET updated_at = ?, model = COALESCE(?, model) WHERE id = ?')
      .run(now, model ?? null, conversationId);
  }

  /** Most recent first; `project` restricts to conversations started in that folder. */
  list(limit = 50, project?: string): Conversation[] {
    return this.db
      .prepare(
        `SELECT ${CONV_COLUMNS} FROM conversations c ${project ? 'WHERE c.project = ?' : ''}
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(...(project ? [project, limit] : [limit])) as unknown as Conversation[];
  }

  search(query: string, limit = 50, project?: string): Conversation[] {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare(
        `SELECT DISTINCT ${CONV_COLUMNS}
         FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE (c.title LIKE ? ESCAPE '\\' OR m.content_json LIKE ? ESCAPE '\\')
         ${project ? 'AND c.project = ?' : ''}
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(
        ...(project ? [like, like, project, limit] : [like, like, limit]),
      ) as unknown as Conversation[];
  }

  get(id: string): { conversation: Conversation; messages: StoredMessage[] } | undefined {
    // Exact id, or an unambiguous prefix (the CLI shows short ids). Prefixes must look like
    // the start of a UUID: `%`/`_` would otherwise match an arbitrary conversation.
    let conversation = this.db
      .prepare(`SELECT ${CONV_COLUMNS} FROM conversations c WHERE c.id = ?`)
      .get(id) as unknown as Conversation | undefined;
    if (!conversation && /^[0-9a-f-]{4,}$/i.test(id)) {
      const matches = this.db
        .prepare(`SELECT ${CONV_COLUMNS} FROM conversations c WHERE c.id LIKE ? LIMIT 2`)
        .all(`${id.toLowerCase()}%`) as unknown as Conversation[];
      if (matches.length === 1) conversation = matches[0];
    }
    if (!conversation) return undefined;
    const rows = this.db
      .prepare(
        'SELECT role, content_json, model, ts, display_json FROM messages WHERE conversation_id = ? ORDER BY id',
      )
      .all(conversation.id) as {
      role: ChatMessage['role'];
      content_json: string;
      model: string | null;
      ts: number;
      display_json: string | null;
    }[];
    return {
      conversation,
      messages: rows.map((r) => ({
        role: r.role,
        message: JSON.parse(r.content_json) as ChatMessage,
        model: r.model,
        ts: r.ts,
        display: r.display_json ? (JSON.parse(r.display_json) as unknown) : null,
      })),
    };
  }

  /**
   * Every conversation with what changes when it is edited (title, folder, model, last
   * message, message count): the cloud sync compares it to tell what to upload.
   */
  fingerprints(): { id: string; updatedAt: number; fp: string }[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.title, c.updated_at AS updatedAt, c.model, c.project,
           (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n
         FROM conversations c`,
      )
      .all() as {
      id: string;
      title: string;
      updatedAt: number;
      model: string | null;
      project: string | null;
      n: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      updatedAt: r.updatedAt,
      fp: JSON.stringify([r.title, r.updatedAt, r.model, r.project, r.n]),
    }));
  }

  /**
   * Writes a conversation exactly as given (same id, timestamps and messages), replacing any
   * local copy. Used by the cloud sync to bring in a conversation from another device.
   */
  importConversation(
    c: Omit<Conversation, 'messageCount'>,
    messages: Omit<StoredMessage, 'role'>[],
  ): void {
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM messages WHERE conversation_id = ?').run(c.id);
      this.db
        .prepare(
          `INSERT INTO conversations (id, title, created_at, updated_at, model, project)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET title = excluded.title, created_at = excluded.created_at,
             updated_at = excluded.updated_at, model = excluded.model, project = excluded.project`,
        )
        .run(c.id, c.title.slice(0, 120), c.createdAt, c.updatedAt, c.model, c.project);
      const ins = this.db.prepare(
        'INSERT INTO messages (conversation_id, ts, role, content_json, model, display_json) VALUES (?, ?, ?, ?, ?, ?)',
      );
      for (const m of messages)
        ins.run(
          c.id,
          m.ts,
          m.message.role,
          JSON.stringify(redactDeep(m.message)),
          m.model ?? null,
          m.display == null ? null : JSON.stringify(redactDeep(m.display)),
        );
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }

  /**
   * Drops the conversation from its `userIndex`-th user message (0-based) on: that question,
   * its answer and everything after ("rewind here"). Returns how many messages were removed.
   */
  truncateAtUser(id: string, userIndex: number): number {
    if (!Number.isInteger(userIndex) || userIndex < 0) return 0;
    const row = this.db
      .prepare(
        "SELECT id FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id LIMIT 1 OFFSET ?",
      )
      .get(id, userIndex) as { id: number } | undefined;
    if (!row) return 0;
    const r = this.db
      .prepare('DELETE FROM messages WHERE conversation_id = ? AND id >= ?')
      .run(id, row.id) as { changes: number | bigint };
    this.db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(Date.now(), id);
    return Number(r.changes);
  }

  rename(id: string, title: string): void {
    this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
  }

  /** Moves a conversation to another project (folder). */
  move(id: string, project: string): void {
    this.db.prepare('UPDATE conversations SET project = ? WHERE id = ?').run(project, id);
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
  }

  clear(): void {
    this.db.exec('DELETE FROM messages; DELETE FROM conversations;');
  }

  exportMarkdown(id: string): string | undefined {
    const data = this.get(id);
    if (!data) return undefined;
    const lines = [
      `# ${data.conversation.title}`,
      '',
      `_${new Date(data.conversation.createdAt).toISOString()}_`,
      '',
    ];
    for (const m of data.messages) {
      if (m.message.role === 'system') continue;
      const who =
        m.message.role === 'user'
          ? '🧑 Usuario'
          : m.message.role === 'assistant'
            ? `🤖 ${m.model ?? 'Asistente'}`
            : '🔧 Herramienta';
      const content = m.message.content;
      const text =
        typeof content === 'string'
          ? content
          : content.map((p) => (p.type === 'text' ? p.text : '[imagen]')).join('\n');
      lines.push(`## ${who}`, '', text, '');
    }
    return lines.join('\n');
  }
}
