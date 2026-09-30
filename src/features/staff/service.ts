import { randomUUID } from "node:crypto";
import { PermissionFlagsBits } from "discord.js";
import { AssignmentInput, validateAssignment } from "./hierarchy";
import { StaffRepository } from "./repository";
import { Capability, StaffSettings } from "./settings";
export interface StaffActor { userId:string; guildId:string|null; permissions:bigint; roleIds:readonly string[]; source:string; }
export class StaffService {
  constructor(readonly repo: StaffRepository, readonly settings: StaffSettings) {}
  allowed(actor: StaffActor, capability: Capability): boolean {
    return actor.guildId === this.repo.guildId && (
      (actor.permissions & PermissionFlagsBits.Administrator) !== 0n ||
      actor.roleIds.some(id => this.settings.adminRoleIds.includes(id) || this.settings.permissions[capability]?.includes(id))
    );
  }
  authorize(actor: StaffActor, capability: Capability) {
    if (!this.allowed(actor,capability)) throw new Error(`You don't have staff ${capability} permission in this server.`);
  }
  private insert(user: string, input: AssignmentInput) {
    if (this.repo.assignments(user).some(row => row.position === input.position && row.senior === input.senior && row.designation === input.designation))
      throw new Error("That assignment already exists.");
    const id=randomUUID();
    this.repo.db.prepare("INSERT INTO staff_assignments(id,guild_id,user_id,position,senior,designation,effective_at) VALUES(?,?,?,?,?,?,?)")
      .run(id,this.repo.guildId,user,input.position,Number(input.senior),input.designation,Date.now());
    return id;
  }
  private activate(user: string) {
    this.repo.db.prepare(`INSERT INTO staff_members(guild_id,user_id,joined_at,status) VALUES(?,?,?,'active')
      ON CONFLICT(guild_id,user_id) DO UPDATE SET status='active'`).run(this.repo.guildId,user,Date.now());
  }
  add(actor: StaffActor, action: "hire"|"assign", user: string, value: AssignmentInput) {
    this.authorize(actor,action); const input=validateAssignment(value);
    return this.repo.db.transaction(() => {
      const member=this.repo.member(user);
      if (action === "hire" && member?.status === "active") throw new Error("This person is already staff. Use /staff assign.");
      if (action === "assign" && member?.status !== "active") throw new Error("Hire this person before assigning another position.");
      const before=this.repo.assignments(user);
      if (action === "hire") this.activate(user);
      const id=this.insert(user,input);
      this.repo.audit(actor.userId,user,`STAFF_${action.toUpperCase()}`,before,this.repo.assignments(user),actor.source);
      return id;
    })();
  }
  remove(actor: StaffActor, user: string, id: string) {
    this.authorize(actor,"remove");
    this.repo.db.transaction(() => {
      const assignment=this.repo.assignments(user).find(row => row.id === id);
      if (!assignment) throw new Error("That assignment is no longer active for this person.");
      this.repo.db.prepare("UPDATE staff_assignments SET ended_at=? WHERE id=? AND guild_id=?").run(Date.now(),id,this.repo.guildId);
      this.repo.audit(actor.userId,user,"STAFF_REMOVE",assignment,null,actor.source);
    })();
  }
  vacancy(actor: StaffActor, action: "create"|"remove"|"fill", input?: AssignmentInput, id?: string, user?: string) {
    this.authorize(actor,"vacancy");
    return this.repo.db.transaction(() => {
      if (action === "create") {
        const value=validateAssignment(input!);const vacancyId=randomUUID();
        this.repo.db.prepare("INSERT INTO staff_vacancies(id,guild_id,position,senior,designation,created_at) VALUES(?,?,?,?,?,?)")
          .run(vacancyId,this.repo.guildId,value.position,Number(value.senior),value.designation,Date.now());
        this.repo.audit(actor.userId,null,"STAFF_VACANCY_CREATE",null,{id:vacancyId,...value},actor.source);
        return vacancyId;
      }
      const vacancy=this.repo.vacancies().find(row => row.id === id);
      if (!vacancy) throw new Error("That vacancy is no longer open.");
      if (action === "fill") {
        if (!user) throw new Error("Choose a person to fill this vacancy.");
        const hiring=this.repo.member(user)?.status !== "active";
        // Vacancy access alone cannot grant positions or hire new staff.
        this.authorize(actor,hiring ? "hire" : "assign");
        if (hiring) this.activate(user);
        this.insert(user,validateAssignment(vacancy));
        if (hiring) this.repo.audit(actor.userId,user,"STAFF_HIRE",[],this.repo.assignments(user),actor.source);
      }
      this.repo.db.prepare("UPDATE staff_vacancies SET ended_at=? WHERE id=? AND guild_id=?").run(Date.now(),id,this.repo.guildId);
      this.repo.audit(actor.userId,user ?? null,`STAFF_VACANCY_${action.toUpperCase()}`,vacancy,action === "fill" ? this.repo.assignments(user!) : null,actor.source);
      return id!;
    })();
  }
  requestFire(actor: StaffActor, user: string) {
    this.authorize(actor,"fire");
    if (this.repo.member(user)?.status !== "active") throw new Error("This person is not active staff.");
    const assignments=this.repo.assignments(user),id=randomUUID();
    this.repo.db.prepare("DELETE FROM staff_confirmations WHERE expires_at<?").run(Date.now());
    this.repo.db.prepare("INSERT INTO staff_confirmations(id,guild_id,actor_id,target_id,snapshot,expires_at) VALUES(?,?,?,?,?,?)")
      .run(id,this.repo.guildId,actor.userId,user,JSON.stringify(assignments.map(row => row.id).sort()),Date.now()+300_000);
    return {id,assignments};
  }
  confirmFire(actor: StaffActor, id: string, cancel=false) {
    this.authorize(actor,"fire");
    return this.repo.db.transaction(() => {
      const request=this.repo.db.prepare("SELECT * FROM staff_confirmations WHERE id=? AND guild_id=?").get(id,this.repo.guildId) as {actor_id:string;target_id:string;snapshot:string;expires_at:number}|undefined;
      if (!request || request.actor_id !== actor.userId || request.expires_at < Date.now()) throw new Error("This confirmation expired or belongs to another staff member. Run /staff fire again.");
      if (!cancel) {
        const before=this.repo.assignments(request.target_id);
        if (this.repo.member(request.target_id)?.status !== "active" || JSON.stringify(before.map(row => row.id).sort()) !== request.snapshot)
          throw new Error("The assignments changed. Run /staff fire again to review them.");
        this.repo.db.prepare("UPDATE staff_assignments SET ended_at=? WHERE guild_id=? AND user_id=? AND ended_at IS NULL").run(Date.now(),this.repo.guildId,request.target_id);
        this.repo.db.prepare("UPDATE staff_members SET status='inactive' WHERE guild_id=? AND user_id=?").run(this.repo.guildId,request.target_id);
        this.repo.audit(actor.userId,request.target_id,"STAFF_FIRE",before,[],actor.source);
      }
      this.repo.db.prepare("DELETE FROM staff_confirmations WHERE id=? AND guild_id=?").run(id,this.repo.guildId);
      return request.target_id;
    })();
  }
  publish(actor: StaffActor, channelId: string) {
    this.authorize(actor,"roster");
    this.repo.db.transaction(() => {
      const before=this.repo.roster();
      if (before && before.channelId !== channelId) throw new Error("A roster is already published in another channel. Refresh that roster instead.");
      this.repo.db.prepare("INSERT OR IGNORE INTO staff_rosters(guild_id,channel_id) VALUES(?,?)").run(this.repo.guildId,channelId);
      this.repo.audit(actor.userId,null,"STAFF_ROSTER_PUBLISH",before ?? null,{channelId},actor.source);
    })();
  }
}
