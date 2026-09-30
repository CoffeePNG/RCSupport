export { workflowSubcommands, remindersSubcommand } from './workflowDefinitions';
import { AttachmentBuilder, ChatInputCommandInteraction, EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { getLeads, getTicketType, getTicketTypes, isLead } from './ticketConfigRepo';
import { getCloseExport, getTicketByChannel, getTicketById } from './ticketRepo';
import { withTicketLock } from './ticketLifecycle';
import { applyReassignment } from './workflowRuntime';
import { configureReminders, getWaiting, pendingReassignment, queueReassignment, reassignmentError, reminderConfig, setWaiting, ticketActivity, ticketHistory } from './workflowRepo';

export async function notificationCommand(i:ChatInputCommandInteraction):Promise<void> {
  const type=getTicketType(i.guildId!,i.options.getString('type',true));
  if(!type) { await i.reply({content:'Unknown ticket type.',flags:MessageFlags.Ephemeral});return; }
  const current=reminderConfig(i.guildId!,type.typeKey);
  const unclaimed=i.options.getInteger('unclaimed-minutes'),waiting=i.options.getInteger('waiting-minutes');
  if(unclaimed!==null||waiting!==null) configureReminders(i.guildId!,type.typeKey,i.user.id,unclaimed??current.unclaimed_minutes,waiting??current.waiting_minutes);
  const saved=reminderConfig(i.guildId!,type.typeKey),format=(n:number)=>n?`${n} minutes`:'off';
  await i.reply({content:`In-ticket reminders: unclaimed **${format(saved.unclaimed_minutes)}**, waiting **${format(saved.waiting_minutes)}**. Each sends once per state; no DMs or queue-channel alerts.`,flags:MessageFlags.Ephemeral});
}
export async function executeWorkflowCommand(i:ChatInputCommandInteraction):Promise<boolean> {
  const sub=i.options.getSubcommand();
  if(!['reassign','history','details','transcript','waiting'].includes(sub)) return false;
  const guild=i.guildId!;
  const manager=i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)??false;
  const allowed=(type:string)=>{const config=getTicketType(guild,type);return manager||!!config&&isLead(config.id,i.user.id);};
  await i.deferReply({flags:MessageFlags.Ephemeral});
  if(sub==='history') {
    if(!manager&&!getTicketTypes(guild).some(type=>isLead(type.id,i.user.id))) {await i.editReply('Only ticket leads or server managers can view history.');return true;}
    const page=i.options.getInteger('page')??1;
    const result=ticketHistory({guildId:guild,userId:i.user.id,manager,page,type:i.options.getString('type')??undefined,creator:i.options.getUser('requester')?.id,status:i.options.getString('status')??undefined});
    const embed=new EmbedBuilder().setTitle('Ticket History').setColor(0x5865f2)
      .setDescription(result.tickets.map(t=>`**#${t.id}** · ${t.typeKey} · ${t.status}\n<@${t.creatorId}> · <t:${Math.floor(t.createdAt/1000)}:d>${t.status!=='closed'?` · <#${t.channelId}>`:''}`).join('\n\n')||'No matching tickets.')
      .setFooter({text:`Page ${page} of ${Math.max(1,Math.ceil(result.total/10))} • ${result.total} tickets • /ticket details or transcript id:<number>`});
    await i.editReply({embeds:[embed],allowedMentions:{parse:[]}});return true;
  }
  const ticket=(sub==='details'||sub==='transcript')?getTicketById(i.options.getInteger('id',true)):getTicketByChannel(i.channelId);
  if(!ticket||ticket.guildId!==guild||!allowed(ticket.typeKey)) {await i.editReply('Ticket not found or you do not have access to its current type.');return true;}
  if(sub==='transcript') {
    const saved=ticket.status==='closed'?getCloseExport(ticket.id):undefined;
    if(!saved) {await i.editReply('No closed-ticket transcript is available. Older tickets may not have a saved transcript.');return true;}
    const data=Buffer.from(saved.transcript,'utf8');
    if(data.length>7_500_000) {await i.editReply('This transcript is too large to attach. Ask a server manager to retrieve it from the bot database.');return true;}
    await i.editReply({files:[new AttachmentBuilder(data,{name:`ticket-${ticket.id}.txt`})],allowedMentions:{parse:[]}});return true;
  }
  if(sub==='details') {
    const waiting=getWaiting(ticket.id),pending=pendingReassignment(ticket.id);
    const activity=ticketActivity(ticket.id).map(a=>`<t:${Math.floor(a.created_at/1000)}:f> · ${a.action} · <@${a.actor_id}>\n${a.details.slice(0,500)}`).join('\n\n');
    const embed=new EmbedBuilder().setTitle(`Ticket #${ticket.id}`).setDescription(`Type: **${ticket.typeKey}**\nStatus: **${ticket.status}**\nRequester: <@${ticket.creatorId}>\nAssigned: ${ticket.claimedBy?`<@${ticket.claimedBy}>`:'Unclaimed'}\nWaiting on: ${ticket.status==='closed'?'Nobody':waiting?.party??'Nobody'}\n${pending?`Transfer pending to **${pending.target_type}**; retries automatically. ${pending.last_error??''}`:''}`)
      .addFields({name:'Recent workflow activity',value:activity.slice(0,1024)||'No workflow events recorded.'});
    await i.editReply({embeds:[embed],allowedMentions:{parse:[]}});return true;
  }
  await withTicketLock(ticket.id,async()=>{
    const current=getTicketById(ticket.id)!;
    if(current.status==='closed'||!allowed(current.typeKey)) {await i.editReply('This ticket is closed or your access has changed.');return;}
    if(pendingReassignment(ticket.id)&&!(sub==='reassign'&&manager)) {await i.editReply('A transfer is pending. Use /ticket details to inspect it; the bot retries automatically.');return;}
    if(sub==='waiting') {
      const on=i.options.getString('on',true) as 'staff'|'requester'|'none';
      setWaiting(current.id,on,i.user.id);
      await i.editReply(on==='none'?'Waiting state cleared.':`Waiting on ${on}. Their next message will clear this state.`);return;
    }
    const target=i.options.getString('type'),staff=i.options.getUser('staff');
    if(!target&&!staff) {await i.editReply('Choose a destination type, a staff member, or both.');return;}
    const type=getTicketType(guild,target??current.typeKey);
    if(!type||!allowed(type.typeKey)) {await i.editReply('You must manage both the current and destination ticket types.');return;}
    if(staff) {
      const member=await i.guild!.members.fetch(staff.id).catch(()=>null);
      if(!member||member.user.bot||(!isLead(type.id,staff.id)&&!member.permissions.has(PermissionFlagsBits.ManageGuild))) {await i.editReply('Choose a destination ticket lead or server manager who is in this server.');return;}
    }
    // Changing teams clears the old claim unless an explicit destination assignee is supplied.
    const assignee=staff?.id??(type.typeKey===current.typeKey?current.claimedBy:null);
    queueReassignment(current.id,type.typeKey,assignee,i.user.id,i.options.getString('reason')??'',[...getLeads(getTicketType(guild,current.typeKey)!.id),...getLeads(type.id),...(current.claimedBy?[current.claimedBy]:[]),...(assignee?[assignee]:[])]);
    try {
      await applyReassignment(i.client,current.id);
      await i.editReply({content:`Ticket #${current.id} moved to **${type.displayName}**${assignee?` and assigned to <@${assignee}>`:', unclaimed'}. The original channel and submission are preserved.`,allowedMentions:{parse:[]}});
    } catch(error) {
      reassignmentError(current.id,(error as Error).message);
      await i.editReply('Transfer saved but not yet completed. It will retry automatically. Use /ticket details to inspect the error; fix the destination or bot permissions.');
    }
  });return true;
}
