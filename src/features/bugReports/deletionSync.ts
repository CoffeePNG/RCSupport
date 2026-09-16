import type { ThreadChannel } from "discord.js";
import type { ForumContext } from "./forumContext";
import * as repo from "./repo";

export function unknownChannel(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && String(error.code) === "10003";
}
export async function onThreadDelete(ctx: ForumContext, thread: ThreadChannel): Promise<void> {
  if (thread.parentId !== ctx.config.forumChannelId || !repo.byPost(thread.id)) return;
  await ctx.serial(thread.id, async () => { repo.recordThreadDeleted(thread.id, "Discord"); });
  await ctx.poll();
}
const cursors = new WeakMap<ForumContext, number>();
export async function reconcileDeletions(ctx: ForumContext): Promise<void> {
  repo.purgeDeletedHistory();
  for (const row of repo.pendingDeletions()) {
    try {
      await ctx.api.confirmThreadDeleted(row.ticket_id, row.post_id);
      repo.deletionSyncAttempt(row.post_id, true);
    } catch (error) {
      repo.deletionSyncAttempt(row.post_id, false);
      ctx.reportSyncError(row.ticket_id, "synchronize report deletion", error);
    }
  }
  try {
    const pending = await ctx.api.pendingDeletions(cursors.get(ctx) ?? 0);
    for (const ticket of pending) {
      const post = ticket.discord_post_id;
      if (!post) continue;
      try {
        await ctx.serial(post, async () => {
          const mapping = repo.byPost(post);
          if (mapping && mapping.pluginTicketId !== ticket.id) throw new Error("Deletion mapping does not match this report");
          let thread;
          try { thread = await ctx.getForum().threads.fetch(post, {force: true}); }
          catch (error) { if (!unknownChannel(error)) throw error; }
          if (thread) {
            if (thread.parentId !== ctx.getForum().id || thread.ownerId !== ctx.getForum().client.user?.id)
              throw new Error("Deletion target is not a bot-owned report in the configured Forum");
            await thread.delete("RCSupport administrator requested deletion in Minecraft");
          }
          if (!mapping) repo.storePluginPost(ticket.id, post, ticket.discord_id);
          repo.recordThreadDeleted(post, "Minecraft admin");
          await ctx.api.confirmThreadDeleted(ticket.id, post);
          repo.deletionSyncAttempt(post, true);
        });
      } catch (error) { ctx.reportSyncError(ticket.id, "delete Discord thread", error); }
    }
    cursors.set(ctx, pending.length < 50 ? 0 : pending[pending.length-1].id);
  } catch (error) {
    // An older JAR can continue ordinary report sync during the rolling upgrade.
    if (!(error instanceof Error && /Bridge GET \/api\/v1\/deletions.*: 404/.test(error.message)))
      ctx.reportSyncError(0, "read pending deletions", error);
  }
}
