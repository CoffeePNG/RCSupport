import { ChannelType, EmbedBuilder, Guild, PermissionFlagsBits } from "discord.js";
import { TicketTypeConfig } from "./ticket";
import { getLeads } from "./ticketConfigRepo";
import { getGuildSettings } from "../../db/guildSettingsRepo";
import { getCounts } from "./ticketRepo";

export function ticketConfigSummary(type: TicketTypeConfig): EmbedBuilder {
  const leads = getLeads(type.id);
  const counts = getCounts(type.guildId,type.typeKey);
  return new EmbedBuilder().setTitle(`${type.displayName} — Configuration`.slice(0,256)).setColor(0x5865f2)
    .addFields(
      {name:"New tickets",value:type.enabled === false ? "Locked" : "Accepting",inline:true},
      {name:"Department",value:type.department.slice(0,1024) || "Not set",inline:true},
      {name:"Channel prefix",value:type.channelPrefix.slice(0,1024) || "Not set",inline:true},
      {name:"New ticket category",value:type.categoryId ? `<#${type.categoryId}>` : "No category",inline:true},
      {name:"Review / archive channel",value:type.reviewChannelId ? `<#${type.reviewChannelId}>` : "Not set; closed transcripts are retained in the bot database",inline:true},
      {name:"Ticket leads",value:(leads.map(id=>`<@${id}>`).join(", ") || "None assigned").slice(0,1024)},
      {name:"Questions",value:(type.questions.map((question,i)=>`${i+1}. ${question}`).join("\n") || "Default details question").slice(0,1024)},
      {name:"Application roles",value:(type.applicationRoles.map(role=>`${role.name} (${role.questions.length} questions)`).join("\n") || "No role selection").slice(0,1024)},
      {name:"Active tickets",value:`${counts.open} unclaimed • ${counts.claimed} claimed`},
    ).setFooter({text:`Type: ${type.typeKey} • Use /ticket-config check to inspect channels and permissions.`});
}

/** Read-only checks against the actual configured guild channels. */
export async function checkTicketConfiguration(guild: Guild, type: TicketTypeConfig): Promise<string[]> {
  const lines: string[] = [];
  if (type.enabled === false) lines.push("Info: this ticket type is locked. Existing tickets remain available to staff.");
  const me = await guild.members.fetchMe();
  if (!getLeads(type.id).length) lines.push("Warning: no ticket leads are assigned. Use /staff-assign to add a lead.");
  if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) lines.push("Warning: I do not have Manage Channels at server level. A configured category must grant it.");
  if (type.categoryId) {
    const category = await guild.channels.fetch(type.categoryId).catch(()=>null);
    if (!category || category.type !== ChannelType.GuildCategory) lines.push("Problem: the configured ticket category no longer exists.");
    else if (!category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ManageChannels])) lines.push("Problem: I need View Channel and Manage Channels in the ticket category.");
    else lines.push("OK: ticket category is accessible.");
  } else lines.push("Info: new tickets open without a category.");
  if (type.reviewChannelId) {
    const review = await guild.channels.fetch(type.reviewChannelId).catch(()=>null);
    if (!review || review.type !== ChannelType.GuildText) lines.push("Problem: the review/archive channel is missing or is not a text channel.");
    else if (!review.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks]))
      lines.push("Problem: the review/archive channel needs View Channel, Send Messages, Read Message History, Attach Files and Embed Links.");
    else lines.push("OK: review/archive channel permissions are available.");
  } else lines.push("Warning: no review/archive channel is configured. Closed transcripts are retained in the bot database only.");
  const settings = getGuildSettings(guild.id);
  if (!settings.panelChannelId || !settings.panelMessageId) lines.push("Info: no ticket panel is published; /ticket create still works.");
  else {
    const panel = await guild.channels.fetch(settings.panelChannelId).catch(()=>null);
    if (!panel || !panel.isTextBased()) lines.push("Problem: the saved ticket panel channel is unavailable. Repost it with /ticket-panel post.");
    else {
      const message = await panel.messages.fetch(settings.panelMessageId).catch(()=>null);
      lines.push(message ? "OK: the published ticket panel is accessible." : "Problem: the saved ticket panel message is missing or inaccessible. Repost it with /ticket-panel post.");
    }
  }
  return lines;
}
