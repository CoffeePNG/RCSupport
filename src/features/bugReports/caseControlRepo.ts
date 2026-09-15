import { db } from "../../db/connect";
import type { TicketStatus } from "./types";

export interface CaseState {
  post_id: string; claimant: string | null; status: TicketStatus; revision: number;
  pending_status: TicketStatus | null; pending_claimant: string | null;
  expected_revision: number | null; actor: string | null; checked_at: number;
}
export function ensure(post: string, status: TicketStatus): CaseState {
  db.prepare("INSERT OR IGNORE INTO rcsupport_case_controls(post_id,status) VALUES (?,?)").run(post,status);
  return get(post)!;
}
export function get(post: string): CaseState | undefined {
  return db.prepare("SELECT * FROM rcsupport_case_controls WHERE post_id=?").get(post) as CaseState | undefined;
}
export function observe(post: string, status: TicketStatus): CaseState {
  const state=ensure(post,status);
  if (!state.pending_status && state.status!==status) {
    db.prepare("UPDATE rcsupport_case_controls SET status=?, claimant=CASE WHEN ?='open' THEN NULL ELSE claimant END, revision=revision+1 WHERE post_id=?")
      .run(status,status,post);
  }
  return get(post)!;
}
export function reserve(state: CaseState, status: TicketStatus, claimant: string | null, expected: number | null, actor: string): boolean {
  return db.prepare("UPDATE rcsupport_case_controls SET pending_status=?,pending_claimant=?,expected_revision=?,actor=?,revision=revision+1 WHERE post_id=? AND revision=? AND pending_status IS NULL")
    .run(status,claimant,expected,actor,state.post_id,state.revision).changes===1;
}
export function finish(post: string): void {
  db.prepare("UPDATE rcsupport_case_controls SET status=pending_status,claimant=pending_claimant,pending_status=NULL,pending_claimant=NULL,expected_revision=NULL,actor=NULL WHERE post_id=? AND pending_status IS NOT NULL").run(post);
}
export function abandon(post: string, status: TicketStatus): void {
  db.prepare("UPDATE rcsupport_case_controls SET status=?,pending_status=NULL,pending_claimant=NULL,expected_revision=NULL,actor=NULL,revision=revision+1 WHERE post_id=?")
    .run(status,post);
}
export function candidates(): string[] {
  return (db.prepare("SELECT p.discord_post_id AS id FROM rcsupport_posts p LEFT JOIN rcsupport_case_controls c ON c.post_id=p.discord_post_id LEFT JOIN rcsupport_deleted_threads d ON d.post_id=p.discord_post_id WHERE d.post_id IS NULL ORDER BY COALESCE(c.checked_at,0),p.discord_post_id LIMIT 5").all() as {id:string}[]).map(r=>r.id);
}
export function checked(post: string): void {
  db.prepare("UPDATE rcsupport_case_controls SET checked_at=? WHERE post_id=?").run(Date.now(),post);
}
