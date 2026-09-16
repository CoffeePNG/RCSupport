import { repairNativeReportTitle } from "./nativeReportTitles";
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, MessageFlags, ThreadChannel, PermissionFlagsBits } from "discord.js";
import type { ForumContext } from "./forumContext";
import { STATUSES, TicketStatus } from "./types";
import { isClosed, replaceStatusTag, STATUS_PRESENTATION } from "./statusTags";
import * as repo from "./repo";
import * as state from "./caseControlRepo";
import { deliverClosure } from "./closureNotice";

export const CONTROL_PREFIX = "rcsupport:case:";
type Action = "claim" | "release" | "close" | "reopen" | "resolved" | "wontfix";
interface Confirmation { post: string; revision: number; user: string; expires: number; choice?: "resolved" | "wontfix" }
const confirmations = new Map<string, Confirmation>();

export function controlRows(status: TicketStatus, claimant: string | null = null, revision = 0, pending = false) {
  const button = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(CONTROL_PREFIX + action + ":" + revision).setLabel(label).setStyle(style).setDisabled(pending);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...(isClosed(status)
    ? [button("reopen", "Reopen", ButtonStyle.Success), button("delete", "Delete", ButtonStyle.Danger)]
    : [claimant ? button("release", "Release", ButtonStyle.Secondary) : button("claim", "Claim", ButtonStyle.Primary),
       button("close", "Close", ButtonStyle.Danger)]))];
}
function tagStatus(ctx: ForumContext, thread: ThreadChannel): TicketStatus {
  const statuses = STATUSES.filter(s => thread.appliedTags.includes(ctx.tag(s)));
  if (statuses.length !== 1) throw new Error("This report needs exactly one status tag. Ask an admin to correct its tags.");
  return statuses[0];
}
async function current(ctx: ForumContext, thread: ThreadChannel) {
  const mapping = repo.byPost(thread.id);
  if (!mapping || repo.threadDeleted(thread.id)) throw new Error("This report is unavailable.");
  if (mapping.pluginTicketId !== null) {
    const snapshot = await ctx.api.ticket(mapping.pluginTicketId);
    if (snapshot.ticket.discord_post_id && snapshot.ticket.discord_post_id !== thread.id)
      throw new Error("This report is now linked to a different Discord thread.");
    return {status:snapshot.ticket.status, revision:snapshot.revision, ticketId:mapping.pluginTicketId};
  }
  return {status:tagStatus(ctx,thread), revision:null, ticketId:null};
}
async function target(ctx: ForumContext, post: string): Promise<ThreadChannel> {
  const thread = await ctx.getForum().threads.fetch(post);
  if (!thread || thread.parentId !== ctx.getForum().id || !repo.byPost(post) || repo.threadDeleted(post))
    throw new Error("Choose a tracked report in the configured bug Forum.");
  return thread;
}
async function authorize(ctx: ForumContext, thread: ThreadChannel, user: string): Promise<boolean> {
  const member = await thread.guild.members.fetch({user,force:true});
  const admin = member.permissions.has(PermissionFlagsBits.ManageGuild);
  if (!thread.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel) || (!admin && !ctx.leads().includes(user)))
    throw new Error("Only bug-report leads or members with Manage Server can use these controls.");
  return admin;
}
async function setTags(ctx: ForumContext, thread: ThreadChannel, status: TicketStatus) {
  const tags = replaceStatusTag(ctx.getForum().availableTags,thread.appliedTags,status);
  if (ctx.tagSignature(thread.id,tags) !== ctx.tagSignature(thread.id,thread.appliedTags)) {
    ctx.ownTagUpdates.set(ctx.tagSignature(thread.id,tags),Date.now()+300000);
    await thread.setAppliedTags(tags,"Update RCSupport case controls");
  }
}
export async function renderControls(ctx: ForumContext, thread: ThreadChannel, status?: TicketStatus): Promise<void> {
  const saved = status ? state.observe(thread.id,status) : state.ensure(thread.id,tagStatus(ctx,thread));
  const starter = await thread.fetchStarterMessage();
  if (!starter || starter.author.id !== thread.client.user?.id || !starter.editable)
    throw new Error("The bot must own the original report message to attach controls.");
  // Preserve embeds and attachments; reserve one line outside the embed budget.
  const original = starter.content.replace(/\n?\*\*Case status:\*\*[^\n]*/g,"");
  const claim = saved.claimant ? "<@" + saved.claimant + ">" : "Unclaimed";
  const content = original + (original ? "\n" : "") + "**Case status:** " + STATUS_PRESENTATION[saved.status].name + " | " + claim;
  if (content.length > 2000) throw new Error("The original message has no room for the assignment line.");
  const components = controlRows(saved.status,saved.claimant,saved.revision,!!saved.pending_status);
  const existing = starter.components.map(c=>c.toJSON());
  if (content !== starter.content || JSON.stringify(existing) !== JSON.stringify(components.map(c=>c.toJSON())))
    await starter.edit({content,components,allowedMentions:{parse:[]}});
}
/** Retry accepted operations without overwriting newer status. Called inside ctx.serial. */
async function flush(ctx: ForumContext, thread: ThreadChannel): Promise<void> {
  const saved = state.get(thread.id);
  if (!saved?.pending_status) return;
  const live = await current(ctx,thread);
  const desired = saved.pending_status;
  if (live.ticketId !== null) {
    if (live.status !== desired) {
      if (live.revision !== saved.expected_revision) { state.abandon(thread.id,live.status); return; }
      await ctx.api.status(live.ticketId,desired,saved.actor ?? undefined,saved.expected_revision ?? undefined);
    }
  } else if (live.status !== saved.status && live.status !== desired) {
    state.abandon(thread.id,live.status); return;
  }
  const closure = isClosed(desired) && !isClosed(saved.status) && live.ticketId === null
    ? repo.queueClosure("controls:"+thread.id+":"+saved.revision,thread.id,saved.actor ?? "Unknown staff member",Math.floor(Date.now()/1000)) : null;
  await setTags(ctx,thread,desired);
  state.finish(thread.id);
  if (closure) await deliverClosure(thread,closure);
}
export async function applyAction(ctx: ForumContext, post: string, user: string, action: Exclude<Action,"close">, revision: number): Promise<void> {
  await ctx.serial(post,async()=>{
    const thread = await target(ctx,post);
    const admin = await authorize(ctx,thread,user);
    const live = await current(ctx,thread);
    const saved = state.observe(post,live.status);
    if (saved.pending_status || saved.revision !== revision) throw new Error("This report changed. Use its updated buttons and try again.");
    let claimant = saved.claimant, status: TicketStatus;
    if (action === "claim") {
      if (isClosed(live.status) || claimant) throw new Error("This report is closed or already claimed.");
      claimant=user; status="in_progress";
    } else if (action === "release") {
      if (isClosed(live.status) || !claimant || (claimant !== user && !admin))
        throw new Error("Only the claimant or a member with Manage Server can release this claim.");
      claimant=null; status="open";
    } else if (action === "reopen") {
      if (!isClosed(live.status)) throw new Error("This report is already open.");
      claimant=null; status="open";
    } else {
      if (isClosed(live.status)) throw new Error("This report is already closed.");
      status=action;
    }
    const actor=(await thread.guild.members.fetch({user,force:true})).displayName;
    if (!state.reserve(saved,status,claimant,live.revision,actor)) throw new Error("Another person changed this report. Try its updated buttons.");
    try { await flush(ctx,thread); }
    catch(error) { ctx.reportSyncError(live.ticketId ?? 0,"apply report controls",error); throw new Error("Your action is saved for retry. Check the report status before trying again."); }
    await renderControls(ctx,thread);
    if (state.get(post)?.status !== status) throw new Error("A newer status change superseded this action. Review the updated report.");
  });
}
function confirmationRow(token: string, confirm?: "resolved" | "wontfix") {
  const button=(action:string,label:string,style:ButtonStyle)=>new ButtonBuilder().setCustomId(CONTROL_PREFIX+action+":"+token).setLabel(label).setStyle(style);
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(...(confirm
    ? [button("confirm","Close as "+STATUS_PRESENTATION[confirm].name,ButtonStyle.Danger),button("cancel","Cancel",ButtonStyle.Secondary)]
    : [button("choose_resolved","Resolved",ButtonStyle.Success),button("choose_wontfix",STATUS_PRESENTATION.wontfix.name,ButtonStyle.Secondary),button("cancel","Cancel",ButtonStyle.Secondary)]))];
}
export async function handleControl(ctx: ForumContext, interaction: ButtonInteraction): Promise<void> {
  try {
    if (interaction.guildId !== ctx.getForum().guildId) throw new Error("Use these controls in the configured bug Forum.");
    const [action,value] = interaction.customId.slice(CONTROL_PREFIX.length).split(":");
    if (["choose_resolved","choose_wontfix","confirm","cancel"].includes(action)) {
      const entry=confirmations.get(value);
      if (!entry || entry.user!==interaction.user.id || entry.post!==interaction.channelId || entry.expires<Date.now())
        throw new Error("Confirmation expired. Click Close on the report again.");
      if (action==="cancel") {
        confirmations.delete(value); await interaction.update({content:"Report kept open.",components:[]}); return;
      }
      if (action.startsWith("choose_")) {
        entry.choice=action==="choose_resolved" ? "resolved" : "wontfix";
        await interaction.update({content:"Close this report as "+STATUS_PRESENTATION[entry.choice].name+"?",components:confirmationRow(value,entry.choice)}); return;
      }
      if (!entry.choice) throw new Error("Choose a closing status first.");
      confirmations.delete(value);
      await interaction.deferUpdate();
      await applyAction(ctx,entry.post,entry.user,entry.choice,entry.revision);
      await interaction.editReply({content:"Report closed as "+STATUS_PRESENTATION[entry.choice].name+".",components:[]}); return;
    }
    if (!["claim","release","close","reopen"].includes(action) || !/^\d+$/.test(value)) throw new Error("Invalid report control.");
    await interaction.deferReply({flags:MessageFlags.Ephemeral});
    const thread=await target(ctx,interaction.channelId);
    const starter=await thread.fetchStarterMessage();
    if (!starter || starter.id!==interaction.message.id || starter.author.id!==interaction.client.user?.id)
      throw new Error("Use the buttons on the original report message.");
    await authorize(ctx,thread,interaction.user.id);
    if (action==="close") {
      const live=await current(ctx,thread);
      const saved=state.observe(thread.id,live.status);
      if (isClosed(live.status) || saved.pending_status || saved.revision!==Number(value)) throw new Error("This report changed. Try its updated buttons.");
      for (const [key,entry] of confirmations) if (entry.expires<Date.now()) confirmations.delete(key);
      const token=interaction.id;
      confirmations.set(token,{post:thread.id,revision:saved.revision,user:interaction.user.id,expires:Date.now()+60000});
      await interaction.editReply({content:"Choose how to close this report:",components:confirmationRow(token)}); return;
    }
    await applyAction(ctx,thread.id,interaction.user.id,action as Exclude<Action,"close">,Number(value));
    await interaction.editReply({content:action==="claim" ? "Report claimed." : action==="release" ? "Claim released." : "Report reopened."});
  } catch(error) {
    const content=error instanceof Error ? error.message : "Could not update this report.";
    if (interaction.deferred || interaction.replied) await interaction.editReply({content,components:[],allowedMentions:{parse:[]}});
    else await interaction.reply({content,flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  }
}
export async function reconcileControls(ctx: ForumContext): Promise<void> {
  for (const post of state.candidates()) {
    try {
      await ctx.serial(post,async()=>{
        const thread=await target(ctx,post);
        const live=await current(ctx,thread);
        state.ensure(post,live.status);
        await flush(ctx,thread);
        const fresh=await current(ctx,thread);
        await renderControls(ctx,thread,fresh.status);
        if (repo.byPost(post)?.pluginTicketId === null) await repairNativeReportTitle(ctx,thread);
      });
    } catch(error) { ctx.reportSyncError(0,"refresh controls for "+post,error); }
    finally { state.ensure(post,"open"); state.checked(post); }
  }
}
