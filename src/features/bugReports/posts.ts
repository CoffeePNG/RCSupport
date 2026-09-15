import { EmbedBuilder, PermissionFlagsBits, ThreadChannel } from "discord.js";
import { getLeads, getTicketType } from "../tickets/ticketConfigRepo";
import { controlRows, renderControls } from "./caseControls";
import * as repo from "./repo";
import { reportEmbedBatches } from "./reportEmbeds";
import { replaceStatusTag } from "./statusTags";
import { PluginTicket } from "./types";

import type { ForumContext } from "./forumContext";

export function leads(ctx: ForumContext): string[] {
  const forum = ctx.getForum();
  // The existing bot seeds the Bug Report ticket type as "bug_report".
  const ticketType = getTicketType(forum.guildId, "bug_report");
  if (!ticketType) { console.warn("RCSupport: bug_report ticket type is not configured"); return []; }
  const leads = getLeads(ticketType.id);
  if (leads.length === 0) console.warn("RCSupport: no current bug_report leads assigned");
  return leads;
}

export async function mentionLeads(ctx: ForumContext): Promise<string[]> {
  return (await ctx.alerts.get()) === "leads" ? ctx.leads() : [];
}

export async function acknowledgePending(ctx: ForumContext): Promise<void> {
  for (const pending of repo.unacknowledged()) {
    try {
      await ctx.api.setPost(pending.pluginTicketId!, pending.discordPostId);
      repo.acknowledge(pending.discordPostId);
    } catch (error) {
      ctx.reportSyncError(pending.pluginTicketId!, "acknowledge", error);
    }
  }
}

export async function refreshReport(ctx: ForumContext, guildId: string, id: number): Promise<string> {
  const forum = ctx.getForum();
  if (forum.guildId !== guildId) throw new Error("Refresh reports in the server containing the bug Forum.");
  const { ticket } = await ctx.api.ticket(id);
  const postId = repo.byPluginTicket(id)?.discordPostId ?? ticket.discord_post_id;
  if (!postId) throw new Error("This report has no Discord post yet. Wait for synchronization and retry.");
  const thread = await forum.threads.fetch(postId);
  if (!thread || thread.parentId !== forum.id) throw new Error("The saved post is not in the configured bug Forum.");
  const starter = await thread.fetchStarterMessage();
  if (!starter?.editable) throw new Error("The bot cannot edit this report's starter message.");
  const batches = reportEmbedBatches(ticket);
  if (batches.length !== 1)
    throw new Error("This legacy report is too large for a single starter. Its existing post has been preserved.");
  await starter.edit({ embeds: batches[0], allowedMentions: { parse: [] } });
  await renderControls(ctx, thread, ticket.status);
  await thread.setName(`#${ticket.id} ${ticket.title || ticket.description}`.replace(/\s+/g, " ").slice(0, 100));
  return postId;
}

export async function createPluginPost(ctx: ForumContext, ticket: PluginTicket): Promise<void> {
  const leads = await ctx.mentionLeads();
  const batches = reportEmbedBatches(ticket);
  const post = await ctx.getForum().threads.create({
    name: `#${ticket.id} ${ticket.title || ticket.description}`.replace(/\s+/g, " ").slice(0, 100),
    appliedTags: replaceStatusTag(ctx.getForum().availableTags, [], ticket.status ?? "open"),
    message: {
      content: leads.map((id) => `<@${id}>`).join(" ") || undefined,
      embeds: batches[0],
      components: controlRows(ticket.status ?? "open"),
      allowedMentions: { parse: [], users: leads },
    },
  });
  // Persist before the API acknowledgement so a retry cannot create another post.
  repo.storePluginPost(ticket.id, post.id, ticket.discord_id);
  // Wizard reports fit the starter. Preserve unusually long legacy reports as continuations.
  for (const embeds of batches.slice(1)) await post.send({ embeds, allowedMentions: { parse: [] } });
  await ctx.api.setPost(ticket.id, post.id);
  repo.acknowledge(post.id);
}

export async function createNativePost(ctx: ForumContext, description: string, reporterId: string): Promise<ThreadChannel> {
  const leads = await ctx.mentionLeads();
  const post = await ctx.getForum().threads.create({
    name: description.replace(/\s+/g, " ").slice(0, 100),
    appliedTags: [ctx.tag("open")],
    message: {
      content: [`Reporter: <@${reporterId}>`, ...leads.map((id) => `<@${id}>`)].join(" "),
      embeds: [new EmbedBuilder().setTitle("Bug Report").setDescription(description.slice(0, 4000))],
      components: controlRows("open"),
      allowedMentions: { parse: [], users: leads },
    },
  });
  repo.storeNativePost(post.id);
  return post;
}

export async function deletionTarget(ctx: ForumContext, guildId: string, postId: string, actorId: string): Promise<ThreadChannel> {
  const forum = ctx.getForum();
  if (guildId !== forum.guildId) throw new Error("Use this command in the configured bug Forum's server.");
  const member = await forum.guild.members.fetch({ user: actorId, force: true });
  if (!member.permissions.has(PermissionFlagsBits.ManageGuild) || !member.permissions.has(PermissionFlagsBits.ManageThreads))
    throw new Error("Manage Server and Manage Threads are required.");
  const thread = await forum.threads.fetch(postId);
  if (!thread || thread.parentId !== forum.id || !repo.byPost(postId)) throw new Error("Choose a tracked RCSupport report thread in the configured Forum.");
  if (!thread.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageThreads])) throw new Error("You need View Channel and Manage Threads in this report thread.");
  if (!thread.client.user || !thread.permissionsFor(thread.client.user)?.has(PermissionFlagsBits.ManageThreads)) throw new Error("The bot needs permission to delete this thread (Manage Threads).");
  return thread;
}

export async function deleteReportThread(ctx: ForumContext, guildId: string, postId: string, actorId: string): Promise<void> {
  await ctx.serial(postId, async () => {
    const thread = await ctx.deletionTarget(guildId, postId, actorId);
    await thread.delete(`RCSupport thread deletion confirmed by ${actorId}`);
    repo.recordThreadDeleted(postId, actorId);
  });
}
