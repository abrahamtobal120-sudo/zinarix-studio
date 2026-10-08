import { DatabaseSync } from 'node:sqlite';

/**
 * Versioned migrations. Append only: never edit an applied migration, add a new one.
 * node:sqlite (built into Node >= 22.13) avoids a native build step on every platform.
 */
const MIGRATIONS: string[] = [
  `CREATE TABLE model_cache (
     provider TEXT PRIMARY KEY,
     fetched_at INTEGER NOT NULL,
     models_json TEXT NOT NULL
   );
   CREATE TABLE usage (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     role TEXT NOT NULL DEFAULT 'chat',
     project TEXT,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cached_tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd REAL,
     latency_ms INTEGER,
     ok INTEGER NOT NULL DEFAULT 1
   );
   CREATE INDEX usage_ts ON usage (ts);
   CREATE INDEX usage_provider_ts ON usage (provider, ts);
   CREATE TABLE conversations (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     model TEXT
   );
   CREATE TABLE messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
     ts INTEGER NOT NULL,
     role TEXT NOT NULL,
     content_json TEXT NOT NULL,
     model TEXT
   );
   CREATE INDEX messages_conv ON messages (conversation_id, id);
   CREATE TABLE audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts INTEGER NOT NULL,
     event TEXT NOT NULL,
     provider TEXT,
     model TEXT,
     detail_json TEXT
   );`,
  // 2: conversations belong to a project folder; messages can carry UI-only display data
  // (agent tool cards, cost line, errors) that is never sent to a provider.
  `ALTER TABLE conversations ADD COLUMN project TEXT;
   ALTER TABLE messages ADD COLUMN display_json TEXT;
   CREATE INDEX conversations_project ON conversations (project, updated_at);`,
];

export type Db = DatabaseSync;

export function openDb(file: string): Db {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  migrate(db);
  return db;
}

export function migrate(db: Db): number {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
  const row = db.prepare('SELECT version FROM schema_version').get() as
    { version: number } | undefined;
  let version = row?.version ?? 0;
  if (!row) db.prepare('INSERT INTO schema_version (version) VALUES (0)').run();
  while (version < MIGRATIONS.length) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[version]!);
      version++;
      db.prepare('UPDATE schema_version SET version = ?').run(version);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
  return version;
}

export const SCHEMA_VERSION = MIGRATIONS.length;
