import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config";

const dir = path.dirname(config.databasePath);
if (dir && !fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

export const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id TEXT PRIMARY KEY,
    mod_log_channel_id TEXT,
    panel_channel_id TEXT,
    panel_message_id TEXT,
    panel_title TEXT,
    panel_description TEXT
  );

  CREATE TABLE IF NOT EXISTS ticket_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    type_key TEXT NOT NULL,
    display_name TEXT NOT NULL,
    department TEXT NOT NULL,
    channel_prefix TEXT NOT NULL,
    review_channel_id TEXT,
    open_message TEXT NOT NULL,
    claim_message TEXT NOT NULL,
    option_description TEXT,
    UNIQUE (guild_id, type_key)
  );

  CREATE TABLE IF NOT EXISTS ticket_leads (
    ticket_config_id INTEGER NOT NULL REFERENCES ticket_configs (id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    PRIMARY KEY (ticket_config_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    type_key TEXT NOT NULL,
    creator_id TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    message_id TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    claimed_by TEXT,
    created_at INTEGER NOT NULL,
    claimed_at INTEGER,
    closed_at INTEGER,
    closed_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tickets_guild_type ON tickets (guild_id, type_key);
  CREATE INDEX IF NOT EXISTS idx_tickets_channel ON tickets (channel_id);

  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_warnings_guild_user ON warnings (guild_id, user_id);

  CREATE TABLE IF NOT EXISTS todos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    content TEXT,
    assignee_id TEXT,
    created_by TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    created_at INTEGER NOT NULL,
    completed_at INTEGER,
    completed_by TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_todos_guild_status ON todos (guild_id, status);
  CREATE INDEX IF NOT EXISTS idx_todos_guild_assignee ON todos (guild_id, assignee_id);
`);

function ensureColumn(table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn("tickets", "message_id", "TEXT");
ensureColumn("guild_settings", "panel_channel_id", "TEXT");
ensureColumn("guild_settings", "panel_message_id", "TEXT");
ensureColumn("guild_settings", "panel_title", "TEXT");
ensureColumn("guild_settings", "panel_description", "TEXT");
ensureColumn("ticket_configs", "option_description", "TEXT");
ensureColumn("guild_settings", "todo_panel_channel_id", "TEXT");
ensureColumn("guild_settings", "todo_panel_message_id", "TEXT");
ensureColumn("todos", "title", "TEXT NOT NULL DEFAULT ''");

function columnIsNotNull(table: string, column: string): boolean {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as {
    name: string;
    notnull: number;
  }[];
  return columns.some((c) => c.name === column && c.notnull === 1);
}

/**
 * Databases created before task titles existed have `todos.content NOT NULL`.
 * The title backfill below moves content into title and nulls content out,
 * which that old constraint rejects. SQLite can't drop a NOT NULL in place,
 * so rebuild the table with the current schema and copy the rows across.
 */
if (columnIsNotNull("todos", "content")) {
  const rebuild = db.transaction(() => {
    db.exec(`
      CREATE TABLE todos_migrate (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT,
        assignee_id TEXT,
        created_by TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at INTEGER NOT NULL,
        completed_at INTEGER,
        completed_by TEXT
      );

      INSERT INTO todos_migrate (
        id, guild_id, title, content, assignee_id,
        created_by, status, created_at, completed_at, completed_by
      )
      SELECT
        id, guild_id, title, content, assignee_id,
        created_by, status, created_at, completed_at, completed_by
      FROM todos;

      DROP TABLE todos;
      ALTER TABLE todos_migrate RENAME TO todos;

      CREATE INDEX IF NOT EXISTS idx_todos_guild_status ON todos (guild_id, status);
      CREATE INDEX IF NOT EXISTS idx_todos_guild_assignee ON todos (guild_id, assignee_id);
    `);
  });
  rebuild();
}

// Old rows stored the task text in `content`; it belongs in `title` now.
db.exec(`UPDATE todos SET title = content, content = NULL WHERE title = '' AND content IS NOT NULL`);
