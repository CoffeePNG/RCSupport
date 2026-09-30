import { db } from "../../db/connect";
import { getTicketById } from "./ticketRepo";

export function auditTicket(id: number, actor: string, action: string, details: string): void {
  db.prepare("INSERT INTO ticket_activity(ticket_id,actor_id,action,details,created_at) VALUES(?,?,?,?,?)")
    .run(id, actor, action, details, Date.now());
}
export function ticketHistory(filter: {guildId:string; userId:string; manager:boolean; creator?:string; type?:string; status?:string; page:number}) {
  const where=["t.guild_id=?", "t.channel_id<>''"], args:(string|number)[]=[filter.guildId];
  if (!filter.manager) {
    where.push(`EXISTS (SELECT 1 FROM ticket_configs c JOIN ticket_leads l ON l.ticket_config_id=c.id
      WHERE c.guild_id=t.guild_id AND c.type_key=t.type_key AND l.user_id=?)`); args.push(filter.userId);
  }
  if (filter.creator) { where.push("t.creator_id=?"); args.push(filter.creator); }
  if (filter.type) { where.push("t.type_key=?"); args.push(filter.type); }
  if (filter.status) { where.push("t.status=?"); args.push(filter.status); }
  const clause=where.join(" AND ");
  const total=(db.prepare(`SELECT COUNT(*) AS n FROM tickets t WHERE ${clause}`).get(...args) as {n:number}).n;
  const rows=db.prepare(`SELECT t.id FROM tickets t WHERE ${clause} ORDER BY t.created_at DESC,t.id DESC LIMIT 10 OFFSET ?`)
    .all(...args,(Math.max(1,filter.page)-1)*10) as {id:number}[];
  return {total,tickets:rows.map(row=>getTicketById(row.id)!)};
}
export function ticketActivity(id:number) {
  return db.prepare("SELECT actor_id,action,details,created_at FROM ticket_activity WHERE ticket_id=? ORDER BY id DESC LIMIT 15")
    .all(id) as {actor_id:string;action:string;details:string;created_at:number}[];
}
export interface Reassignment {ticket_id:number;target_type:string;assignee_id:string|null;actor_id:string;reason:string;created_at:number;last_error:string|null;managed_ids:string;}
export function pendingReassignment(id:number):Reassignment|undefined {
  return db.prepare("SELECT * FROM ticket_reassignments WHERE ticket_id=?").get(id) as Reassignment|undefined;
}
export function pendingReassignments():Reassignment[] {
  return db.prepare("SELECT * FROM ticket_reassignments ORDER BY created_at LIMIT 25").all() as Reassignment[];
}
export function queueReassignment(id:number,type:string,assignee:string|null,actor:string,reason:string,managedIds:string[]=[]):void {
  const previous=pendingReassignment(id);
  const ids=[...new Set([...JSON.parse(previous?.managed_ids??'[]'),...managedIds])];
  db.prepare(`INSERT INTO ticket_reassignments(ticket_id,target_type,assignee_id,actor_id,reason,created_at,managed_ids) VALUES(?,?,?,?,?,?,?)
    ON CONFLICT(ticket_id) DO UPDATE SET target_type=excluded.target_type,assignee_id=excluded.assignee_id,
    actor_id=excluded.actor_id,reason=excluded.reason,managed_ids=excluded.managed_ids,last_error=NULL`)
    .run(id,type,assignee,actor,reason,Date.now(),JSON.stringify(ids));
}
export function reassignmentError(id:number,error:string):void {
  db.prepare("UPDATE ticket_reassignments SET last_error=? WHERE ticket_id=?").run(error.slice(0,1000),id);
}
export function completeReassignment(job:Reassignment):void {
  db.transaction(()=>{
    const before=getTicketById(job.ticket_id);
    if (!before || before.status==='closed') throw Error("Ticket is no longer active.");
    db.prepare("UPDATE tickets SET type_key=?,claimed_by=?,claimed_at=?,status=? WHERE id=?")
      .run(job.target_type,job.assignee_id,job.assignee_id?Date.now():null,job.assignee_id?'claimed':'open',job.ticket_id);
    auditTicket(job.ticket_id,job.actor_id,"REASSIGN",JSON.stringify({fromType:before.typeKey,toType:job.target_type,fromStaff:before.claimedBy,toStaff:job.assignee_id,reason:job.reason}));
    db.prepare("DELETE FROM ticket_waiting WHERE ticket_id=?").run(job.ticket_id);
    db.prepare(`INSERT INTO ticket_unclaimed_reminders(ticket_id,since) VALUES(?,?) ON CONFLICT(ticket_id)
      DO UPDATE SET since=excluded.since,reminded_at=NULL,retry_after=0,last_error=NULL`).run(job.ticket_id,Date.now());
    db.prepare("DELETE FROM ticket_reassignments WHERE ticket_id=?").run(job.ticket_id);
  })();
}
export interface ReminderConfig {unclaimed_minutes:number;waiting_minutes:number;}
export function reminderConfig(guild:string,type:string):ReminderConfig {
  return db.prepare("SELECT unclaimed_minutes,waiting_minutes FROM ticket_reminder_config WHERE guild_id=? AND type_key=?").get(guild,type) as ReminderConfig
    ?? {unclaimed_minutes:0,waiting_minutes:0};
}
export function configureReminders(guild:string,type:string,actor:string,unclaimed:number,waiting:number):void {
  for (const n of [unclaimed,waiting]) if (!Number.isInteger(n)||n<0||n>10080) throw Error("Reminder minutes must be between 0 (off) and 10080 (7 days).");
  db.transaction(()=>{
    const before=reminderConfig(guild,type);
    db.prepare(`INSERT INTO ticket_reminder_config(guild_id,type_key,unclaimed_minutes,waiting_minutes) VALUES(?,?,?,?)
      ON CONFLICT(guild_id,type_key) DO UPDATE SET unclaimed_minutes=excluded.unclaimed_minutes,waiting_minutes=excluded.waiting_minutes`)
      .run(guild,type,unclaimed,waiting);
    db.prepare("INSERT INTO ticket_config_audit(guild_id,type_key,actor_id,action,before_json,after_json,created_at) VALUES(?,?,?,?,?,?,?)")
      .run(guild,type,actor,'REMINDERS',JSON.stringify(before),JSON.stringify(reminderConfig(guild,type)),Date.now());
  })();
}
export function setWaiting(id:number,party:'staff'|'requester'|'none',actor:string):void {
  db.transaction(()=>{
    if (party==='none') db.prepare("DELETE FROM ticket_waiting WHERE ticket_id=?").run(id);
    else db.prepare(`INSERT INTO ticket_waiting(ticket_id,party,since) VALUES(?,?,?) ON CONFLICT(ticket_id)
      DO UPDATE SET party=excluded.party,since=excluded.since,reminded_at=NULL,retry_after=0,last_error=NULL`).run(id,party,Date.now());
    auditTicket(id,actor,'WAITING',party);
  })();
}
export function getWaiting(id:number) {
  return db.prepare("SELECT * FROM ticket_waiting WHERE ticket_id=?").get(id) as {party:'staff'|'requester';since:number}|undefined;
}
export interface DueReminder {id:number;kind:'unclaimed'|'staff'|'requester';since:number;}
export function dueReminders(now=Date.now()):DueReminder[] {
  return db.prepare(`SELECT t.id, COALESCE(w.party,'unclaimed') AS kind, COALESCE(w.since,r.since,t.created_at) AS since
    FROM tickets t JOIN ticket_reminder_config c ON c.guild_id=t.guild_id AND c.type_key=t.type_key
    LEFT JOIN ticket_waiting w ON w.ticket_id=t.id LEFT JOIN ticket_unclaimed_reminders r ON r.ticket_id=t.id
    WHERE t.status<>'closed' AND t.channel_id<>'' AND NOT EXISTS(SELECT 1 FROM ticket_reassignments j WHERE j.ticket_id=t.id)
    AND ((w.ticket_id IS NOT NULL AND c.waiting_minutes>0 AND w.reminded_at IS NULL AND w.retry_after<=?
      AND w.since+c.waiting_minutes*60000<=?) OR
      (w.ticket_id IS NULL AND t.status='open' AND c.unclaimed_minutes>0 AND r.reminded_at IS NULL
        AND COALESCE(r.retry_after,0)<=? AND COALESCE(r.since,t.created_at)+c.unclaimed_minutes*60000<=?))
    ORDER BY since LIMIT 25`).all(now,now,now,now) as DueReminder[];
}
export function recordReminder(id:number,kind:DueReminder['kind'],error:string|null):void {
  const at=error?null:Date.now(), retry=error?Date.now()+300000:0;
  if(kind==='unclaimed') db.prepare(`INSERT INTO ticket_unclaimed_reminders(ticket_id,reminded_at,retry_after,last_error) VALUES(?,?,?,?)
    ON CONFLICT(ticket_id) DO UPDATE SET reminded_at=excluded.reminded_at,retry_after=excluded.retry_after,last_error=excluded.last_error`)
    .run(id,at,retry,error?.slice(0,1000)??null);
  else db.prepare("UPDATE ticket_waiting SET reminded_at=?,retry_after=?,last_error=? WHERE ticket_id=?")
    .run(at,retry,error?.slice(0,1000)??null,id);
}
