import { db } from "../db/connect";
import { PostMapping } from "./types";

function mapping(row: any): PostMapping | null {
  return row ? {
    discordPostId: row.discord_post_id,
    pluginTicketId: row.plugin_ticket_id,
    reporterDiscordId: row.reporter_discord_id,
    apiAcknowledged: row.api_acknowledged === 1,
  } : null;
}
export function byPost(postId: string): PostMapping | null {
  return mapping(db.prepare("SELECT * FROM rcsupport_posts WHERE discord_post_id = ?").get(postId));
}
export function byPluginTicket(ticketId: number): PostMapping | null {
  return mapping(db.prepare("SELECT * FROM rcsupport_posts WHERE plugin_ticket_id = ?").get(ticketId));
}
export function storePluginPost(ticketId: number, postId: string, reporterId: string): void {
  db.prepare("INSERT OR IGNORE INTO rcsupport_posts (plugin_ticket_id, discord_post_id, reporter_discord_id) VALUES (?, ?, ?)")
    .run(ticketId, postId, reporterId);
}
export function storeNativePost(postId: string): void {
  db.prepare("INSERT OR IGNORE INTO rcsupport_posts (discord_post_id) VALUES (?)").run(postId);
}
export function unacknowledged(): PostMapping[] {
  return (db.prepare("SELECT * FROM rcsupport_posts WHERE plugin_ticket_id IS NOT NULL AND api_acknowledged = 0").all() as any[])
    .map((row) => mapping(row)!);
}
export function acknowledge(postId: string): void {
  db.prepare("UPDATE rcsupport_posts SET api_acknowledged = 1 WHERE discord_post_id = ?").run(postId);
}
export function pollTimestamp(): number {
  return (db.prepare("SELECT last_poll_timestamp AS value FROM rcsupport_poll_state WHERE singleton = 1").get() as { value: number }).value;
}
export function setPollTimestamp(value: number): void {
  db.prepare("UPDATE rcsupport_poll_state SET last_poll_timestamp = ? WHERE singleton = 1").run(value);
}


export interface ClosureNotice { event_key: string; post_id: string; actor: string; closed_at: number; message_id: string | null; attempted_at: number | null }
export function queueClosure(key: string, postId: string, actor: string, time: number): ClosureNotice {
  db.prepare("INSERT OR IGNORE INTO rcsupport_closure_notices (event_key, post_id, actor, closed_at) VALUES (?, ?, ?, ?)").run(key, postId, actor, time);
  return db.prepare("SELECT * FROM rcsupport_closure_notices WHERE event_key = ?").get(key) as ClosureNotice;
}
export function pendingClosures(): ClosureNotice[] {
  return db.prepare("SELECT * FROM rcsupport_closure_notices WHERE message_id IS NULL ORDER BY closed_at, event_key").all() as ClosureNotice[];
}
export function beginClosureAttempt(key: string): void {
  db.prepare("UPDATE rcsupport_closure_notices SET attempted_at = COALESCE(attempted_at, ?) WHERE event_key = ?").run(Math.floor(Date.now() / 1000), key);
}
export function completeClosure(key: string, messageId: string): void {
  db.prepare("UPDATE rcsupport_closure_notices SET message_id = ? WHERE event_key = ?").run(messageId, key);
}
export function usedClosureMessage(id: string): boolean {
  return !!db.prepare("SELECT 1 FROM rcsupport_closure_notices WHERE message_id = ?").get(id);
}
export function threadDeleted(id: string): boolean { return !!db.prepare("SELECT 1 FROM rcsupport_deleted_threads WHERE post_id = ?").get(id); }
export function recordThreadDeleted(id: string, actor: string): void {
  db.prepare("INSERT OR REPLACE INTO rcsupport_deleted_threads VALUES (?, ?, ?)").run(id, actor, Math.floor(Date.now() / 1000));
  db.prepare("UPDATE rcsupport_closure_notices SET message_id = 'thread-deleted' WHERE post_id = ? AND message_id IS NULL").run(id);
}

export function closureNotice(key: string): ClosureNotice | undefined {
  return db.prepare("SELECT * FROM rcsupport_closure_notices WHERE event_key = ?").get(key) as ClosureNotice | undefined;
}

export interface HistoryCursor { last_seen: string; before_id: string | null; sweep_high: string | null }
export function historyCursor(postId: string): HistoryCursor {
  return (db.prepare("SELECT * FROM rcsupport_history_sync WHERE post_id = ?").get(postId) as HistoryCursor | undefined)
    ?? {last_seen: "0", before_id: null, sweep_high: null};
}
export function saveHistoryCursor(postId: string, cursor: HistoryCursor): void {
  db.prepare("INSERT INTO rcsupport_history_sync(post_id, last_seen, before_id, sweep_high, checked_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(post_id) DO UPDATE SET last_seen=excluded.last_seen, before_id=excluded.before_id, sweep_high=excluded.sweep_high, checked_at=excluded.checked_at")
    .run(postId, cursor.last_seen, cursor.before_id, cursor.sweep_high, Date.now());
}
export function historyCandidates(): PostMapping[] {
  return (db.prepare("SELECT p.* FROM rcsupport_posts p LEFT JOIN rcsupport_history_sync h ON h.post_id = p.discord_post_id LEFT JOIN rcsupport_deleted_threads d ON d.post_id = p.discord_post_id WHERE p.plugin_ticket_id IS NOT NULL AND p.api_acknowledged = 1 AND d.post_id IS NULL ORDER BY COALESCE(h.checked_at, 0), p.discord_post_id LIMIT 5").all() as any[]).map(row => mapping(row)!);
}
