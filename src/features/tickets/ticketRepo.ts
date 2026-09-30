import { db } from "../../db/connect";
import { Ticket, TicketStatus, TicketTypeLockedError } from "./ticket";

function rowToTicket(row: any): Ticket {
  return {
    id: row.id,
    guildId: row.guild_id,
    typeKey: row.type_key,
    creatorId: row.creator_id,
    channelId: row.channel_id,
    messageId: row.message_id,
    submissionText: row.submission_text ?? null,
    status: row.status,
    claimedBy: row.claimed_by,
    createdAt: row.created_at,
    claimedAt: row.claimed_at,
    closedAt: row.closed_at,
    closedBy: row.closed_by,
  };
}

export function createTicket(
  guildId: string,
  typeKey: string,
  creatorId: string,
  channelId: string,
  submissionText: string | null = null
): Ticket {
  const info = db
    .prepare(
      `INSERT INTO tickets (guild_id, type_key, creator_id, channel_id, status, created_at, submission_text)
       SELECT ?, ?, ?, ?, 'open', ?, ?
       WHERE COALESCE((SELECT enabled FROM ticket_configs WHERE guild_id=? AND type_key=?),1)=1`
    )
    .run(guildId, typeKey, creatorId, channelId, Date.now(), submissionText, guildId, typeKey);
  if (!info.changes) throw new TicketTypeLockedError();
  return getTicketById(info.lastInsertRowid as number)!;
}

export function getTicketById(id: number): Ticket | null {
  const row = db.prepare(`SELECT * FROM tickets WHERE id = ?`).get(id) as any;
  return row ? rowToTicket(row) : null;
}

export function getTicketByChannel(channelId: string): Ticket | null {
  const row = db
    .prepare(`SELECT * FROM tickets WHERE channel_id = ?`)
    .get(channelId) as any;
  return row ? rowToTicket(row) : null;
}

export function setMessageId(id: number, messageId: string): void {
  db.prepare(`UPDATE tickets SET message_id = ? WHERE id = ?`).run(messageId, id);
}

export function setChannelId(id: number, channelId: string): void {
  db.prepare(`UPDATE tickets SET channel_id = ? WHERE id = ?`).run(channelId, id);
}

export function claimTicket(id: number, userId: string): Ticket | null {
  const result = db.prepare(
    `UPDATE tickets SET status = 'claimed', claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open'`
  ).run(userId, Date.now(), id);
  return result.changes ? getTicketById(id) : null;
}

export function closeTicket(id: number, userId: string): Ticket | null {
  db.prepare(
    `UPDATE tickets SET status = 'closed', closed_by = ?, closed_at = ? WHERE id = ?`
  ).run(userId, Date.now(), id);
  return getTicketById(id);
}

export function getCounts(
  guildId: string,
  typeKey: string
): Record<TicketStatus, number> {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) as count FROM tickets WHERE guild_id = ? AND type_key = ? GROUP BY status`
    )
    .all(guildId, typeKey) as any[];
  const counts: Record<TicketStatus, number> = { open: 0, claimed: 0, closed: 0 };
  for (const row of rows) {
    counts[row.status as TicketStatus] = row.count;
  }
  return counts;
}

/** Remove only an allocation whose Discord channel was never created. */
export function discardUncreatedTicket(id: number): void {
  db.prepare(`DELETE FROM tickets WHERE id = ? AND channel_id = ''`).run(id);
}

/** A claim may only be released while it still belongs to the expected person. */
export function releaseTicket(id: number, expectedClaimant: string): Ticket | null {
  return db.transaction(() => {
    const result = db.prepare(`UPDATE tickets SET status='open', claimed_by=NULL, claimed_at=NULL
      WHERE id=? AND status='claimed' AND claimed_by=?`).run(id, expectedClaimant);
    if (!result.changes) return null;
    db.prepare(`INSERT INTO ticket_unclaimed_reminders(ticket_id,since) VALUES(?,?) ON CONFLICT(ticket_id)
      DO UPDATE SET since=excluded.since,reminded_at=NULL,retry_after=0,last_error=NULL`).run(id,Date.now());
    return getTicketById(id);
  })();
}

export interface TicketQueueFilter {
  guildId: string;
  userId: string;
  manager: boolean;
  typeKey?: string;
  status: "all" | "open" | "claimed" | "mine";
  page: number;
}
/** Filter access in SQL before pagination: a lead only sees types they manage. */
export function listTicketQueue(filter: TicketQueueFilter): { tickets: Ticket[]; total: number } {
  const conditions = ["t.guild_id=?", "t.status IN ('open','claimed')", "t.channel_id<>''"];
  const args: (string | number)[] = [filter.guildId];
  if (!filter.manager) {
    conditions.push(`EXISTS (SELECT 1 FROM ticket_configs c JOIN ticket_leads l ON l.ticket_config_id=c.id
      WHERE c.guild_id=t.guild_id AND c.type_key=t.type_key AND l.user_id=?)`);
    args.push(filter.userId);
  }
  if (filter.typeKey) { conditions.push("t.type_key=?"); args.push(filter.typeKey); }
  if (filter.status === "mine") { conditions.push("t.claimed_by=?"); args.push(filter.userId); }
  else if (filter.status !== "all") { conditions.push("t.status=?"); args.push(filter.status); }
  const where = conditions.join(" AND ");
  const count = db.prepare(`SELECT COUNT(*) AS total FROM tickets t WHERE ${where}`).get(...args) as { total: number };
  const rows = db.prepare(`SELECT t.* FROM tickets t WHERE ${where} ORDER BY t.created_at,t.id LIMIT 10 OFFSET ?`)
    .all(...args, (Math.max(1, filter.page) - 1) * 10);
  return { tickets: rows.map(rowToTicket), total: count.total };
}

export interface CloseExport { ticket_id: number; transcript: string; review_channel_id: string | null; review_message_id: string | null; actor_id: string; }
export function getCloseExport(id: number): CloseExport | undefined {
  return db.prepare("SELECT * FROM ticket_close_exports WHERE ticket_id=?").get(id) as CloseExport | undefined;
}
export function saveCloseExport(id: number, transcript: string, reviewChannel: string | null, actor: string): void {
  db.prepare(`INSERT INTO ticket_close_exports(ticket_id,transcript,review_channel_id,actor_id,created_at)
    VALUES(?,?,?,?,?) ON CONFLICT(ticket_id) DO UPDATE SET transcript=excluded.transcript,
    review_channel_id=excluded.review_channel_id,actor_id=excluded.actor_id,created_at=excluded.created_at,review_message_id=NULL`)
    .run(id,transcript,reviewChannel,actor,Date.now());
}
export function recordExportMessage(id: number, messageId: string): void {
  db.prepare("UPDATE ticket_close_exports SET review_message_id=? WHERE ticket_id=?").run(messageId,id);
}
export function finishTicketClose(id: number, actor: string): Ticket {
  return db.transaction(() => {
    const exported = getCloseExport(id);
    if (!exported) throw new Error("A saved transcript is required before closing.");
    if (exported.review_channel_id && !exported.review_message_id) throw new Error("The configured archive must receive the transcript before closing.");
    const ticket=closeTicket(id,actor);
    if (!ticket) throw new Error("Ticket no longer exists.");
    db.prepare("UPDATE ticket_close_exports SET delete_pending=1,delete_after=?,last_error=NULL WHERE ticket_id=?").run(Date.now()+5000,id);
    return ticket;
  })();
}
export function pendingTicketCleanup(): Ticket[] {
  return db.prepare(`SELECT t.* FROM tickets t JOIN ticket_close_exports e ON e.ticket_id=t.id
    WHERE t.status='closed' AND e.delete_pending=1 AND e.delete_after<=? ORDER BY e.delete_after LIMIT 25`).all(Date.now()).map(rowToTicket);
}
export function recordTicketCleanup(id: number, error: string | null): void {
  db.prepare("UPDATE ticket_close_exports SET delete_pending=?,last_error=?,delete_after=? WHERE ticket_id=?")
    .run(error ? 1 : 0,error,error ? Date.now()+30_000 : 0,id);
}

export function hasPendingReassignment(id:number):boolean {
  return !!db.prepare("SELECT 1 FROM ticket_reassignments WHERE ticket_id=?").get(id);
}
