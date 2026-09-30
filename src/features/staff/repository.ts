import type Database from "better-sqlite3";
import type { AssignmentInput } from "./hierarchy";
export interface Assignment extends AssignmentInput { id: string; user_id: string; effective_at: number; }
export interface Vacancy extends AssignmentInput { id: string; created_at: number; }
export class StaffRepository {
  constructor(readonly db: Database.Database, readonly guildId: string) {}
  assignments(userId?: string): Assignment[] {
    const rows = this.db.prepare(`SELECT * FROM staff_assignments WHERE guild_id=? AND ended_at IS NULL ${userId ? "AND user_id=?" : ""} ORDER BY effective_at,id`)
      .all(...(userId ? [this.guildId,userId] : [this.guildId])) as (Omit<Assignment,"senior"> & {senior:number})[];
    return rows.map(row => ({ ...row, senior: !!row.senior }));
  }
  vacancies(): Vacancy[] {
    return (this.db.prepare("SELECT * FROM staff_vacancies WHERE guild_id=? AND ended_at IS NULL ORDER BY created_at,id").all(this.guildId) as (Omit<Vacancy,"senior"> & {senior:number})[])
      .map(row => ({ ...row, senior: !!row.senior }));
  }
  member(userId: string) { return this.db.prepare("SELECT * FROM staff_members WHERE guild_id=? AND user_id=?").get(this.guildId,userId) as {status:string} | undefined; }
  members(): {user_id:string;status:string}[] { return this.db.prepare("SELECT user_id,status FROM staff_members WHERE guild_id=?").all(this.guildId) as {user_id:string;status:string}[]; }
  audit(actor: string, target: string | null, action: string, before: unknown, after: unknown, source: string) {
    this.db.prepare("INSERT INTO staff_audit(guild_id,actor_id,target_id,action,before_json,after_json,created_at,source) VALUES(?,?,?,?,?,?,?,?)")
      .run(this.guildId,actor,target,action,JSON.stringify(before),JSON.stringify(after),Date.now(),source);
    this.queue();
  }
  queue() {
    this.db.prepare(`INSERT INTO staff_sync(guild_id,revision,pending,updated_at) VALUES(?,1,1,?)
      ON CONFLICT(guild_id) DO UPDATE SET revision=revision+1,pending=1,updated_at=excluded.updated_at`).run(this.guildId,Date.now());
  }
  syncState() { return this.db.prepare("SELECT * FROM staff_sync WHERE guild_id=?").get(this.guildId) as {revision:number;pending:number;last_error:string|null} | undefined; }
  roster() { const row=this.db.prepare("SELECT * FROM staff_rosters WHERE guild_id=?").get(this.guildId) as {channel_id:string;message_ids:string} | undefined;
    return row ? {channelId:row.channel_id,messageIds:JSON.parse(row.message_ids) as string[]} : undefined; }
  saveMessages(ids: string[]) { this.db.prepare("UPDATE staff_rosters SET message_ids=? WHERE guild_id=?").run(JSON.stringify(ids),this.guildId); }
}
