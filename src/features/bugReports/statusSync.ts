import { AuditLogEvent, ThreadChannel } from "discord.js";
import { setTimeout as delay } from "node:timers/promises";
import { deliverClosure } from "./closureNotice";
import { shouldSyncStatus } from "./policy";
import * as repo from "./repo";
import { isClosed, replaceStatusTag } from "./statusTags";
import { STATUSES, StatusUpdate } from "./types";

import type { ForumContext } from "./forumContext";

export async function syncStatusUpdate(ctx: ForumContext, update: StatusUpdate): Promise<void> {
  const ticket = update.ticket;
  if (!repo.byPluginTicket(ticket.id) && ticket.discord_post_id) {
    repo.storePluginPost(ticket.id, ticket.discord_post_id, ticket.discord_id);
    repo.acknowledge(ticket.discord_post_id);
  }
  let postId = repo.byPluginTicket(ticket.id)?.discordPostId ?? ticket.discord_post_id;
  if (!postId) {
    await ctx.createPluginPost(ticket);
    postId = repo.byPluginTicket(ticket.id)!.discordPostId;
  }
  if (repo.threadDeleted(postId)) { await ctx.api.acknowledgeStatus(ticket.id, update.revision); return; }
  await ctx.serial(postId, async () => {
    if (repo.threadDeleted(postId!)) { await ctx.api.acknowledgeStatus(ticket.id, update.revision); return; }
    // A newer in-game transition supersedes this snapshot; never acknowledge that newer revision.
    const current = await ctx.api.ticket(ticket.id);
    if (current.revision !== update.revision) { ctx.requestPoll(); return; }
    const forum = ctx.getForum();
    const thread = await forum.threads.fetch(postId!);
    if (!thread || thread.parentId !== forum.id) throw new Error("The mapped report post is missing or belongs to an earlier Forum. Its mapping was preserved.");
    const tags = replaceStatusTag(forum.availableTags, thread.appliedTags, current.ticket.status);
    if (ctx.tagSignature(postId!, tags) !== ctx.tagSignature(postId!, thread.appliedTags)) {
      // Retain until the gateway echo arrives, including echoes delayed until after another transition.
      ctx.ownTagUpdates.set(ctx.tagSignature(postId!, tags), Date.now() + 300000);
      await thread.setAppliedTags(tags, "Synchronize saved RCSupport report status");
    }
    for (const closure of update.closures ?? []) {
      const notice = repo.queueClosure(`plugin:${ticket.id}:${closure.id}`, postId!, closure.actor || "Unknown staff member", closure.closed_at);
      await deliverClosure(thread, notice);
    }
    const ack = await ctx.api.acknowledgeStatus(ticket.id, update.revision);
    if (!ack.acknowledged) ctx.requestPoll();
  });
}

export async function closingActor(ctx: ForumContext, thread: ThreadChannel, newTags: readonly string[]): Promise<{ name: string; time: number; key: string }> {
  const now = Date.now();
  try {
    for (const wait of [0, 350, 850]) {
      if (wait) await delay(wait);
      const logs = await thread.guild.fetchAuditLogs({ type: AuditLogEvent.ThreadUpdate, limit: 10 });
      const candidates = logs.entries.filter(entry => entry.target?.id === thread.id && Math.abs(now - entry.createdTimestamp) < 30000 &&
        (entry.changes as ReadonlyArray<{key: string; new?: unknown}>).some(change => change.key === "applied_tags" && Array.isArray(change.new) &&
          [...change.new].map((tag: any) => typeof tag === "string" ? tag : tag.id).sort().join(",") === [...newTags].sort().join(",")));
      if (candidates.size === 1) {
        const entry = candidates.first()!;
        if (entry.executor?.username) return { name: entry.executor.username, time: Math.floor(entry.createdTimestamp / 1000), key: entry.id };
      }
    }
  } catch { /* No audit-log permission or entry yet: do not invent an actor. */ }
  console.warn(`RCSupport could not identify the closer of thread ${thread.id}; View Audit Log is needed for Discord-side attribution.`);
  return { name: "Unknown staff member", time: Math.floor(now / 1000), key: `${thread.id}:${now}` };
}

export async function onThreadUpdate(ctx: ForumContext, oldThread: ThreadChannel, newThread: ThreadChannel): Promise<void> {
  if (newThread.parentId !== ctx.config.forumChannelId) return;
  if (oldThread.appliedTags.join(",") === newThread.appliedTags.join(",")) return;
  const mapped = repo.byPost(newThread.id);
  if (!mapped || repo.threadDeleted(newThread.id)) return;
  const selected = STATUSES.filter((status) => newThread.appliedTags.includes(ctx.tag(status)));
  if (selected.length !== 1) { console.warn(`RCSupport post ${newThread.id} must have exactly one status tag`); return; }
  const previous = STATUSES.filter((status) => oldThread.appliedTags.includes(ctx.tag(status)));
  if (previous.length === 1 && previous[0] === selected[0]) return;
  const echo = ctx.tagSignature(newThread.id, newThread.appliedTags);
  if ((ctx.ownTagUpdates.get(echo) ?? 0) >= Date.now()) { ctx.ownTagUpdates.delete(echo); return; }
  await ctx.serial(newThread.id, async () => {
    const closes = previous.length === 1 && !isClosed(previous[0]) && isClosed(selected[0]);
    const actor = closes ? await ctx.closingActor(newThread, newThread.appliedTags) : null;
    if (!shouldSyncStatus(mapped)) {
      if (actor) repo.queueClosure(`native:${actor.key}`, newThread.id, actor.name, actor.time);
      const tags = replaceStatusTag(ctx.getForum().availableTags, newThread.appliedTags, selected[0]);
      if (ctx.tagSignature(newThread.id, tags) !== ctx.tagSignature(newThread.id, newThread.appliedTags)) {
        ctx.ownTagUpdates.set(ctx.tagSignature(newThread.id, tags), Date.now() + 300000);
        await newThread.setAppliedTags(tags, "Update RCSupport Closed label");
      }
      if (actor) await deliverClosure(newThread, repo.queueClosure(`native:${actor.key}`, newThread.id, actor.name, actor.time));
      return;
    }
    const current = await ctx.api.ticket(mapped!.pluginTicketId!);
    if (current.ticket.status === selected[0]) return;
    if (previous.length !== 1 || previous[0] !== current.ticket.status) {
      void ctx.poll().catch(e => console.error("RCSupport concurrent status reconciliation failed:", e)); return;
    }
    // Compare-and-set prevents a delayed Discord change overwriting a newer in-game decision.
    await ctx.api.status(mapped!.pluginTicketId!, selected[0], actor?.name, current.revision);
  });
}

export async function reconcileStatuses(ctx: ForumContext): Promise<void> {
  try {
    let after = 0;
    while (true) {
      const updates = await ctx.api.statusUpdates(after);
      for (const update of updates) {
        try { await ctx.syncStatusUpdate(update); }
        catch (error) { ctx.reportSyncError(update.ticket.id, "synchronize Discord status", error); }
      }
      if (updates.length < 50) break;
      const next = updates[updates.length - 1].ticket.id;
      if (next <= after) throw new Error("Status update cursor did not advance");
      after = next;
    }
  } catch (error) { ctx.reportSyncError(0, "read pending status updates (update the plugin as well as the bot)", error); }
  for (const [key, expiry] of ctx.ownTagUpdates) if (expiry < Date.now()) ctx.ownTagUpdates.delete(key);
  for (const notice of repo.pendingClosures()) {
    try {
      if (repo.threadDeleted(notice.post_id)) { repo.completeClosure(notice.event_key, "thread-deleted"); continue; }
      await ctx.serial(notice.post_id, async () => {
        if (repo.threadDeleted(notice.post_id)) return;
        const thread = await ctx.getForum().threads.fetch(notice.post_id);
        if (!thread || thread.parentId !== ctx.getForum().id) throw new Error("Closure thread is unavailable");
        // Native reports have no plugin outbox to retry a failed Closed-label edit.
        if (repo.byPost(notice.post_id)?.pluginTicketId === null) {
          const selected = STATUSES.filter(status => thread.appliedTags.includes(ctx.tag(status)));
          if (selected.length === 1) {
            const tags = replaceStatusTag(ctx.getForum().availableTags, thread.appliedTags, selected[0]);
            if (ctx.tagSignature(thread.id, tags) !== ctx.tagSignature(thread.id, thread.appliedTags)) {
              ctx.ownTagUpdates.set(ctx.tagSignature(thread.id, tags), Date.now() + 300000);
              await thread.setAppliedTags(tags, "Retry RCSupport Closed label");
            }
          }
        }
        await deliverClosure(thread, notice);
      });
    } catch (error) { ctx.reportSyncError(0, "deliver closure message for thread " + notice.post_id, error); }
  }
}
