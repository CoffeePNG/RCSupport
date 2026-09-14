import { db } from "../../db/connect";
import { Warning } from "../tickets/ticket";

function rowToWarning(row: any): Warning {
  return {
    id: row.id,
    guildId: row.guild_id,
    userId: row.user_id,
    moderatorId: row.moderator_id,
    reason: row.reason,
    createdAt: row.created_at,
    active: !!row.active,
  };
}

export function addWarning(
  guildId: string,
  userId: string,
  moderatorId: string,
  reason: string
): Warning {
  const info = db
    .prepare(
      `INSERT INTO warnings (guild_id, user_id, moderator_id, reason, created_at, active)
       VALUES (?, ?, ?, ?, ?, 1)`
    )
    .run(guildId, userId, moderatorId, reason, Date.now());
  return rowToWarning(
    db.prepare(`SELECT * FROM warnings WHERE id = ?`).get(info.lastInsertRowid)
  );
}

export function getWarnings(guildId: string, userId: string, activeOnly = true): Warning[] {
  const rows = db
    .prepare(
      activeOnly
        ? `SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? AND active = 1 ORDER BY created_at DESC`
        : `SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC`
    )
    .all(guildId, userId) as any[];
  return rows.map(rowToWarning);
}

export function deactivateWarning(guildId: string, warningId: number): boolean {
  const info = db
    .prepare(
      `UPDATE warnings SET active = 0 WHERE id = ? AND guild_id = ? AND active = 1`
    )
    .run(warningId, guildId);
  return info.changes > 0;
}
