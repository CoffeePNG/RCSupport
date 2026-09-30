import { Client } from "discord.js";
import { StaffRepository } from "./repository";
import { StaffSettings } from "./settings";
import { renderRoster } from "./renderer";
export interface StaffDiscord {
  role(guildId:string,userId:string,roleId:string,present:boolean): Promise<void>;
  message(channelId:string,id:string|undefined,content:string):Promise<string>;
  deleteMessage(channelId:string,id:string):Promise<void>;
}
const discordCode=(error:unknown) => (error as {code?:number})?.code;
export function discordAdapter(client: Client): StaffDiscord {
  return {
    async role(guildId,userId,roleId,present) {
      const guild=await client.guilds.fetch(guildId);
      let member;
      try {member=await guild.members.fetch({user:userId,force:true});}
      catch(error) {if (!present && discordCode(error) === 10007) return;throw error;}
      if (member.roles.cache.has(roleId) === present) return;
      if (present) await member.roles.add(roleId,"RCSupport staff assignment synchronization");
      else await member.roles.remove(roleId,"RCSupport staff assignment synchronization");
    },
    async message(channelId,id,content) {
      const channel=await client.channels.fetch(channelId);
      if (!channel?.isTextBased() || !("send" in channel)) throw new Error("Roster channel is unavailable or cannot receive messages.");
      const payload={content,allowedMentions:{parse:[] as never[]}};
      if (id) {
        try {const message=await channel.messages.fetch(id);await message.edit(payload);return message.id;}
        catch(error) {if (discordCode(error) !== 10008) throw error;}
      }
      return (await channel.send(payload)).id;
    },
    async deleteMessage(channelId,id) {
      const channel=await client.channels.fetch(channelId);
      if (!channel?.isTextBased()) throw new Error("Roster channel is unavailable.");
      try {await channel.messages.delete(id);} catch(error) {if (discordCode(error) !== 10008) throw error;}
    }
  };
}
export class StaffSynchronizer {
  private running?:Promise<void>;
  constructor(readonly repo: StaffRepository, readonly settings: StaffSettings, readonly discord: StaffDiscord) {}
  sync():Promise<void> {
    if (this.running) return this.running;
    this.running=this.run().finally(() => {this.running=undefined;});return this.running;
  }
  private async run() {
    const state=this.repo.syncState();if (!state?.pending) return;
    const errors:string[]=[];
    for (const member of this.repo.members()) {
      const assignments=this.repo.assignments(member.user_id);
      const desired=this.settings.roleBindings.filter(binding => assignments.some(row => row.position === binding.position && (binding.senior === undefined || binding.senior === row.senior)));
      const known=this.repo.db.prepare("SELECT guild_id AS guildId,role_id AS roleId FROM staff_role_grants WHERE org_id=? AND user_id=?").all(this.repo.guildId,member.user_id) as {guildId:string;roleId:string}[];
      const all=new Map([...this.settings.roleBindings,...known].map(binding => [`${binding.guildId}:${binding.roleId}`,binding]));
      for (const binding of all.values()) {
        const present=desired.some(value => value.guildId === binding.guildId && value.roleId === binding.roleId);
        try {
          // Record desired grants before Discord I/O so an ambiguous success can be undone after a later fire.
          if (present) this.repo.db.prepare("INSERT OR IGNORE INTO staff_role_grants(org_id,user_id,guild_id,role_id) VALUES(?,?,?,?)").run(this.repo.guildId,member.user_id,binding.guildId,binding.roleId);
          await this.discord.role(binding.guildId,member.user_id,binding.roleId,present);
          if (!present) this.repo.db.prepare("DELETE FROM staff_role_grants WHERE org_id=? AND user_id=? AND guild_id=? AND role_id=?").run(this.repo.guildId,member.user_id,binding.guildId,binding.roleId);
        } catch(error) {errors.push(`Role sync for ${member.user_id}: ${(error as Error).message}`);}
      }
    }
    const roster=this.repo.roster();
    if (roster) {
      try {
        const pages=renderRoster(this.repo.assignments(),this.repo.vacancies());
        for (let i=0;i<pages.length;i++) {
          roster.messageIds[i]=await this.discord.message(roster.channelId,roster.messageIds[i],pages[i]);
          this.repo.saveMessages(roster.messageIds);
        }
        while (roster.messageIds.length>pages.length) {
          await this.discord.deleteMessage(roster.channelId,roster.messageIds[roster.messageIds.length-1]);
          roster.messageIds.pop();this.repo.saveMessages(roster.messageIds);
        }
      } catch(error) {errors.push(`Roster sync: ${(error as Error).message}`);}
    }
    this.repo.db.prepare("UPDATE staff_sync SET pending=?,last_error=? WHERE guild_id=? AND revision=?")
      .run(errors.length ? 1 : 0,errors.length ? errors.join("\n").slice(0,1500) : null,this.repo.guildId,state.revision);
  }
}
