import { createHash } from "node:crypto";
import { db } from "../../db/connect";
import { TicketTypeConfig } from "./ticket";

function rowToConfig(row: any): TicketTypeConfig {
  return {
    id: row.id,
    guildId: row.guild_id,
    typeKey: row.type_key,
    enabled: row.enabled !== 0,
    displayName: row.display_name,
    department: row.department,
    channelPrefix: row.channel_prefix,
    reviewChannelId: row.review_channel_id,
    categoryId: row.category_id ?? null,
    questions: row.questions_json ? JSON.parse(row.questions_json) : [],
    applicationRoles: row.application_roles_json ? JSON.parse(row.application_roles_json) : [],
    openMessage: row.open_message,
    claimMessage: row.claim_message,
    optionDescription: row.option_description,
  };
}

export function getTicketTypes(guildId: string): TicketTypeConfig[] {
  const rows = db
    .prepare(`SELECT * FROM ticket_configs WHERE guild_id = ? ORDER BY id ASC`)
    .all(guildId) as any[];
  return rows.map(rowToConfig);
}

export function getTicketType(guildId: string, typeKey: string): TicketTypeConfig | null {
  const row = db
    .prepare(`SELECT * FROM ticket_configs WHERE guild_id = ? AND type_key = ?`)
    .get(guildId, typeKey) as any;
  return row ? rowToConfig(row) : null;
}

export function getTicketTypeById(id: number): TicketTypeConfig | null {
  const row = db.prepare(`SELECT * FROM ticket_configs WHERE id = ?`).get(id) as any;
  return row ? rowToConfig(row) : null;
}

export function ensureTicketType(
  seed: Omit<TicketTypeConfig, "id" | "enabled" | "reviewChannelId" | "categoryId" | "questions" | "applicationRoles">
): TicketTypeConfig {
  const existing = getTicketType(seed.guildId, seed.typeKey);
  if (existing) return existing;

  const info = db
    .prepare(
      `INSERT INTO ticket_configs
         (guild_id, type_key, display_name, department, channel_prefix, open_message, claim_message, option_description)
       VALUES (@guildId, @typeKey, @displayName, @department, @channelPrefix, @openMessage, @claimMessage, @optionDescription)`
    )
    .run(seed);
  return getTicketTypeById(info.lastInsertRowid as number)!;
}

export function setReviewChannel(
  guildId: string,
  typeKey: string,
  channelId: string
): boolean {
  const info = db
    .prepare(
      `UPDATE ticket_configs SET review_channel_id = ? WHERE guild_id = ? AND type_key = ?`
    )
    .run(channelId, guildId, typeKey);
  return info.changes > 0;
}

export function setOpenMessage(guildId: string, typeKey: string, message: string): boolean {
  const info = db
    .prepare(`UPDATE ticket_configs SET open_message = ? WHERE guild_id = ? AND type_key = ?`)
    .run(message, guildId, typeKey);
  return info.changes > 0;
}

export function setClaimMessage(guildId: string, typeKey: string, message: string): boolean {
  const info = db
    .prepare(`UPDATE ticket_configs SET claim_message = ? WHERE guild_id = ? AND type_key = ?`)
    .run(message, guildId, typeKey);
  return info.changes > 0;
}

/** The blurb shown under a ticket type's label in the panel's dropdown. */
export function setOptionDescription(guildId: string, typeKey: string, description: string): boolean {
  const info = db
    .prepare(`UPDATE ticket_configs SET option_description = ? WHERE guild_id = ? AND type_key = ?`)
    .run(description, guildId, typeKey);
  return info.changes > 0;
}

export function getLeads(ticketConfigId: number): string[] {
  const rows = db
    .prepare(`SELECT user_id FROM ticket_leads WHERE ticket_config_id = ?`)
    .all(ticketConfigId) as any[];
  return rows.map((r) => r.user_id);
}

export function isLead(ticketConfigId: number, userId: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM ticket_leads WHERE ticket_config_id = ? AND user_id = ?`
    )
    .get(ticketConfigId, userId);
  return !!row;
}

export function addLead(ticketConfigId: number, userId: string): boolean {
  const already = isLead(ticketConfigId, userId);
  if (already) return false;
  db.prepare(
    `INSERT INTO ticket_leads (ticket_config_id, user_id) VALUES (?, ?)`
  ).run(ticketConfigId, userId);
  return true;
}

export function removeLead(ticketConfigId: number, userId: string): boolean {
  const info = db
    .prepare(
      `DELETE FROM ticket_leads WHERE ticket_config_id = ? AND user_id = ?`
    )
    .run(ticketConfigId, userId);
  return info.changes > 0;
}

export function setTicketCategory(guildId: string, typeKey: string, categoryId: string | null): void {
  db.prepare(`UPDATE ticket_configs SET category_id = ? WHERE guild_id = ? AND type_key = ?`)
    .run(categoryId, guildId, typeKey);
}

export function setTicketQuestions(guildId: string, typeKey: string, questions: string[]): void {
  if (questions.length > 5 || questions.some(q => !q.trim() || q.length > 45)) {
    throw new Error("Use up to five questions, each between 1 and 45 characters.");
  }
  db.prepare(`UPDATE ticket_configs SET questions_json = ? WHERE guild_id = ? AND type_key = ?`)
    .run(JSON.stringify(questions), guildId, typeKey);
}

/** A named role is offered only once it has a complete question set. */
export function setApplicationRole(guildId: string, typeKey: string, name: string, questions: string[]): void {
  name = name.trim();
  if (!name || name.length > 45 || !questions.length || questions.length > 5 ||
      questions.some(q => !q.trim() || q.length > 45)) {
    throw new Error("Use a role name and one to five questions, each at most 45 characters.");
  }
  const config = getTicketType(guildId, typeKey);
  if (!config) throw new Error("Ticket type no longer exists.");
  const roles = config.applicationRoles;
  const id = createHash("sha256").update(name.toLowerCase()).digest("hex").slice(0, 16);
  const existing = roles.findIndex(role => role.id === id);
  if (existing < 0 && roles.length >= 25) throw new Error("A ticket type supports up to 25 application roles.");
  const role = { id, name, questions };
  if (existing < 0) roles.push(role); else roles[existing] = role;
  db.prepare(`UPDATE ticket_configs SET application_roles_json = ? WHERE guild_id = ? AND type_key = ?`)
    .run(JSON.stringify(roles), guildId, typeKey);
}

export function removeApplicationRole(guildId: string, typeKey: string, name: string): boolean {
  const config = getTicketType(guildId, typeKey);
  if (!config) return false;
  const roles = config.applicationRoles.filter(role => role.name.toLowerCase() !== name.trim().toLowerCase());
  if (roles.length === config.applicationRoles.length) return false;
  db.prepare(`UPDATE ticket_configs SET application_roles_json = ? WHERE guild_id = ? AND type_key = ?`)
    .run(JSON.stringify(roles), guildId, typeKey);
  return true;
}


export interface NewTicketType { key: string; name: string; department: string; prefix: string; }
function auditType(guildId: string, key: string, actor: string, action: string, before: unknown, after: unknown): void {
  db.prepare(`INSERT INTO ticket_config_audit(guild_id,type_key,actor_id,action,before_json,after_json,created_at)
    VALUES(?,?,?,?,?,?,?)`).run(guildId,key,actor,action,JSON.stringify(before),JSON.stringify(after),Date.now());
}

/** New types are drafts until a manager explicitly unlocks intake. */
export function createCustomTicketType(guildId: string, actor: string, input: NewTicketType): TicketTypeConfig {
  const key = input.key.trim().toLowerCase();
  const name = input.name.trim();
  const department = input.department.trim();
  const prefix = input.prefix.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(key)) throw new Error("Use a type key of 1–32 lowercase letters, numbers, underscores or hyphens.");
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(prefix)) throw new Error("Use a channel prefix of 1–32 lowercase letters, numbers or hyphens.");
  if (!name || name.length > 45 || !department || department.length > 100) throw new Error("Use a name of 1–45 characters and a department of 1–100 characters.");
  return db.transaction(() => {
    if (getTicketType(guildId,key)) throw new Error("That type key already exists. Its configuration was not changed.");
    if (getTicketTypes(guildId).length >= 25) throw new Error("This server already has 25 ticket types, the supported panel limit.");
    const type = ensureTicketType({guildId,typeKey:key,displayName:name,department,channelPrefix:prefix,
      openMessage:"Thanks {creator}. Please describe anything else we should know; a ticket lead will help you here.",
      claimMessage:"{claimant} is now helping with this ticket.",optionDescription:null});
    db.prepare("UPDATE ticket_configs SET enabled=0 WHERE id=?").run(type.id);
    const created = getTicketType(guildId,key)!;
    auditType(guildId,key,actor,"TYPE_CREATE",null,created);
    return created;
  })();
}

/** Intake only: existing tickets, assignments and history are preserved. */
export function setTicketTypeEnabled(guildId: string, key: string, enabled: boolean, actor: string): TicketTypeConfig {
  return db.transaction(() => {
    const before = getTicketType(guildId,key);
    if (!before) throw new Error("This ticket type no longer exists.");
    if (before.enabled === enabled) return before;
    if (enabled && getTicketTypes(guildId).filter(type => type.enabled).length >= 25) throw new Error("Lock another type before enabling more than 25 panel choices.");
    db.prepare("UPDATE ticket_configs SET enabled=? WHERE guild_id=? AND type_key=?").run(Number(enabled),guildId,key);
    const after = getTicketType(guildId,key)!;
    auditType(guildId,key,actor,enabled ? "TYPE_UNLOCK" : "TYPE_LOCK",before,after);
    return after;
  })();
}
