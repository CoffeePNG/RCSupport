import type Database from "better-sqlite3";
export function migrateStaff(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS staff_members (
      guild_id TEXT NOT NULL, user_id TEXT NOT NULL, joined_at INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active','inactive')), PRIMARY KEY(guild_id,user_id)
    );
    CREATE TABLE IF NOT EXISTS staff_assignments (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, position TEXT NOT NULL,
      senior INTEGER NOT NULL CHECK(senior IN (0,1)), designation TEXT NOT NULL DEFAULT '',
      effective_at INTEGER NOT NULL, ended_at INTEGER,
      FOREIGN KEY(guild_id,user_id) REFERENCES staff_members(guild_id,user_id)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS staff_assignment_active ON staff_assignments(guild_id,user_id,position,senior,designation) WHERE ended_at IS NULL;
    CREATE TABLE IF NOT EXISTS staff_vacancies (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, position TEXT NOT NULL, senior INTEGER NOT NULL,
      designation TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS staff_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      target_id TEXT, action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL,
      created_at INTEGER NOT NULL, source TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_sync (
      guild_id TEXT PRIMARY KEY, revision INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 1,
      last_error TEXT, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS staff_rosters (
      guild_id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, message_ids TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS staff_role_grants (
      org_id TEXT NOT NULL, user_id TEXT NOT NULL, guild_id TEXT NOT NULL, role_id TEXT NOT NULL,
      PRIMARY KEY(org_id,user_id,guild_id,role_id)
    );
    CREATE TABLE IF NOT EXISTS staff_confirmations (
      id TEXT PRIMARY KEY, guild_id TEXT NOT NULL, actor_id TEXT NOT NULL, target_id TEXT NOT NULL,
      snapshot TEXT NOT NULL, expires_at INTEGER NOT NULL
    );
  `);
}
