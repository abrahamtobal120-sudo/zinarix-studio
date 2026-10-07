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
}

export interface StoredMessage {
  role: ChatMessage['role'];
  message: ChatMessage;
  model: string | null;
  ts: number;
}

/** Conversation history. Messages are stored redacted: history never holds a credential. */
export class History {
  constructor(private readonly db: Db) {}

  create(title: string, model?: string): Conversation {
    const now = Date.now();
    const c: Conversation = {
      id: randomUUID(),
      title: title.slice(0, 120) || 'Sin título',
      createdAt: now,
      updatedAt: now,
      model: model ?? null,
    };
    this.db
      .prepare(
        'INSERT INTO conversations (id, title, created_at, updated_at, model) VALUES (?, ?, ?, ?, ?)',
      )
      .run(c.id, c.title, c.createdAt, c.updatedAt, c.model);
    return c;
  }

  append(conversationId: string, message: ChatMessage, model?: string): void {
    const now = Date.now();
    this.db
      .prepare(
        'INSERT INTO messages (conversation_id, ts, role, content_json, model) VALUES (?, ?, ?, ?, ?)',
      )
      .run(conversationId, now, message.role, JSON.stringify(redactDeep(message)), model ?? null);
    this.db
      .prepare('UPDATE conversations SET updated_at = ?, model = COALESCE(?, model) WHERE id = ?')
      .run(now, model ?? null, conversationId);
  }

  list(limit = 50): Conversation[] {
    return this.db
      .prepare(
        'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, model FROM conversations ORDER BY updated_at DESC LIMIT ?',
      )
      .all(limit) as unknown as Conversation[];
  }

  search(query: string, limit = 50): Conversation[] {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db
      .prepare(
        `SELECT DISTINCT c.id, c.title, c.created_at AS createdAt, c.updated_at AS updatedAt, c.model
         FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id
         WHERE c.title LIKE ? ESCAPE '\\' OR m.content_json LIKE ? ESCAPE '\\'
         ORDER BY c.updated_at DESC LIMIT ?`,
      )
      .all(like, like, limit) as unknown as Conversation[];
  }

  get(id: string): { conversation: Conversation; messages: StoredMessage[] } | undefined {
    const conversation = this.db
      .prepare(
        'SELECT id, title, created_at AS createdAt, updated_at AS updatedAt, model FROM conversations WHERE id = ? OR id LIKE ?',
      )
      .get(id, `${id}%`) as unknown as Conversation | undefined;
    if (!conversation) return undefined;
    const rows = this.db
      .prepare(
        'SELECT role, content_json, model, ts FROM messages WHERE conversation_id = ? ORDER BY id',
      )
      .all(conversation.id) as {
      role: ChatMessage['role'];
      content_json: string;
      model: string | null;
      ts: number;
    }[];
    return {
      conversation,
      messages: rows.map((r) => ({
        role: r.role,
        message: JSON.parse(r.content_json) as ChatMessage,
        model: r.model,
        ts: r.ts,
      })),
    };
  }

  rename(id: string, title: string): void {
    this.db.prepare('UPDATE conversations SET title = ? WHERE id = ?').run(title, id);
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
