import { ChannelType, Client, EmbedBuilder, Message, OverwriteResolvable, PermissionFlagsBits } from 'discord.js';
import { ticketModule } from '../../modules/catalog';
import { isGuildAllowed } from '../../security/access';
import { getLeads, getTicketType, isLead } from './ticketConfigRepo';
import { getTicketByChannel, getTicketById } from './ticketRepo';
import { applyTicketStatus, buildTicketButtons } from './ticketEmbeds';
import { withTicketLock } from './ticketLifecycle';
import { completeReassignment, dueReminders, getWaiting, pendingReassignment, pendingReassignments, reassignmentError, recordReminder, setWaiting } from './workflowRepo';

/** Must run under the ticket lock. Pending intent survives a restart and Discord edits are idempotent. */
export async function applyReassignment(client:Client,id:number):Promise<void> {
  const job=pendingReassignment(id),ticket=getTicketById(id);
  if(!job||!ticket) return;
  if(ticket.status==='closed') throw Error('Ticket is closed.');
  if(!isGuildAllowed({module:ticketModule},ticket.guildId)) throw Error('Tickets are disabled in this guild.');
  const type=getTicketType(ticket.guildId,job.target_type),oldType=getTicketType(ticket.guildId,ticket.typeKey);
  if(!type||!oldType) throw Error('Ticket type is no longer configured.');
  const channel=await client.channels.fetch(ticket.channelId);
  if(!channel||channel.type!==ChannelType.GuildText||channel.guildId!==ticket.guildId) throw Error('Ticket channel is unavailable.');
  const me=await channel.guild.members.fetchMe();
  if(!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageRoles]))
    throw Error('I need View Channel, Manage Channels and Manage Roles on this ticket.');
  if(type.categoryId) {
    const category=await channel.guild.channels.fetch(type.categoryId);
    if(!category||category.type!==ChannelType.GuildCategory||!category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels]))
      throw Error('Destination category is unavailable or inaccessible.');
  }
  if(job.assignee_id) {
    const member=await channel.guild.members.fetch(job.assignee_id);
    if(member.user.bot||(!isLead(type.id,member.id)&&!member.permissions.has(PermissionFlagsBits.ManageGuild)))
      throw Error('The assignee must still be a destination ticket lead or server manager.');
  }
  const oldStaff=new Set<string>([...JSON.parse(job.managed_ids),...getLeads(oldType.id),...(ticket.claimedBy?[ticket.claimedBy]:[])]);
  const overwrites:OverwriteResolvable[]=channel.permissionOverwrites.cache
    .filter(overwrite=>!oldStaff.has(overwrite.id)||overwrite.id===ticket.creatorId||overwrite.id===me.id)
    .map(overwrite=>({id:overwrite.id,type:overwrite.type,allow:overwrite.allow.bitfield,deny:overwrite.deny.bitfield}));
  const staff=[...new Set([...getLeads(type.id),...(job.assignee_id?[job.assignee_id]:[])])];
  for(const user of staff) {
    if(user===ticket.creatorId||user===me.id) continue;
    const existing=overwrites.findIndex(overwrite=>overwrite.id===user);
    if(existing!==-1) overwrites.splice(existing,1);
    overwrites.push({id:user,type:1,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]});
  }
  await channel.edit({parent:type.categoryId,permissionOverwrites:overwrites,reason:`Ticket #${id} reassigned by ${job.actor_id}`});
  completeReassignment(job);
  const updated=getTicketById(id)!;
  if(ticket.messageId) {
    try {
      const message=await channel.messages.fetch(ticket.messageId);
      const embed=message.embeds[0]?EmbedBuilder.from(message.embeds[0]):new EmbedBuilder();
      embed.setTitle(type.displayName).setFooter({text:`Ticket #${id} • ${type.department}`});
      await message.edit({embeds:[applyTicketStatus(embed,updated)],components:[buildTicketButtons(id,updated.status!=='open',false)]});
    } catch(error) { console.error(`Ticket #${id} reassigned; display refresh failed:`,error); }
  }
}

export async function observeTicketReply(message:Message):Promise<void> {
  if(!message.guildId||message.author.bot||message.webhookId||!isGuildAllowed({module:ticketModule},message.guildId)) return;
  const ticket=getTicketByChannel(message.channelId);
  if(!ticket||ticket.guildId!==message.guildId) return;
  await withTicketLock(ticket.id,async()=>{
    const current=getTicketById(ticket.id),waiting=getWaiting(ticket.id);
    if(!current||current.status==='closed'||!waiting||pendingReassignment(ticket.id)||message.createdTimestamp<waiting.since) return;
    const type=getTicketType(current.guildId,current.typeKey);
    const expected=waiting.party==='requester'?message.author.id===current.creatorId:
      !!type&&(isLead(type.id,message.author.id)||!!message.member?.permissions.has(PermissionFlagsBits.ManageGuild));
    if(expected) setWaiting(ticket.id,'none',message.author.id);
  });
}
let running=false;
export async function runTicketWorkflows(client:Client):Promise<void> {
  if(running) return; running=true;
  try {
    for(const job of pendingReassignments()) {
      await withTicketLock(job.ticket_id,async()=>{
        try { await applyReassignment(client,job.ticket_id); }
        catch(error) { reassignmentError(job.ticket_id,(error as Error).message); }
      });
    }
    for(const due of dueReminders()) {
      await withTicketLock(due.id,async()=>{
        // Recheck after waiting for another operation; never notify a closed or transferred ticket.
        if(!dueReminders().some(row=>row.id===due.id&&row.kind===due.kind&&row.since===due.since)) return;
        const ticket=getTicketById(due.id)!;
        if(!isGuildAllowed({module:ticketModule},ticket.guildId)) return;
        try {
          const channel=await client.channels.fetch(ticket.channelId);
          if(!channel||channel.type!==ChannelType.GuildText||channel.guildId!==ticket.guildId) throw Error('Ticket channel unavailable.');
          const type=getTicketType(ticket.guildId,ticket.typeKey);
          const users=due.kind==='requester'?[ticket.creatorId]:ticket.claimedBy?[ticket.claimedBy]:type?getLeads(type.id).slice(0,20):[];
          const label=due.kind==='unclaimed'?'This ticket is still unclaimed.':due.kind==='staff'?'This ticket is waiting on staff.':'This ticket is waiting on the requester.';
          await channel.send({content:`${users.map(id=>`<@${id}>`).join(' ')} ${label} Waiting since <t:${Math.floor(due.since/1000)}:R>.`,allowedMentions:{parse:[],users}});
          recordReminder(due.id,due.kind,null);
        } catch(error) { recordReminder(due.id,due.kind,(error as Error).message); }
      });
    }
  } finally { running=false; }
}
let timer:ReturnType<typeof setInterval>|undefined;
export function startTicketWorkflows(client:Client):void {
  if(timer) return;
  const tick=()=>runTicketWorkflows(client).catch(error=>console.error('Ticket workflow retry failed:',error));
  timer=setInterval(()=>{void tick();},60000);timer.unref();void tick();
}
