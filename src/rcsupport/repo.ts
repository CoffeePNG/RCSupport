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
