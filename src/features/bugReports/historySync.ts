import { Message } from "discord.js";
import { importHistoryMessage, importHistoryPage } from "./history";
import * as repo from "./repo";

import type { ForumContext } from "./forumContext";

export async function reconcileHistories(ctx: ForumContext): Promise<void> {
  for (const mapping of repo.historyCandidates()) {
    try {
      await ctx.serial(mapping.discordPostId, async () => {
        if (repo.threadDeleted(mapping.discordPostId)) return;
        const thread = await ctx.getForum().threads.fetch(mapping.discordPostId);
        if (!thread) { await ctx.api.markThreadUnavailable(mapping.pluginTicketId!, mapping.discordPostId); return; }
        if (thread.parentId !== ctx.getForum().id) throw new Error("History thread is unavailable or belongs to an earlier Forum");
        await importHistoryPage(ctx.api, mapping, thread);
      });
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && String(error.code) === "10003")
        await ctx.api.markThreadUnavailable(mapping.pluginTicketId!, mapping.discordPostId);
      // Move failures to the back of the fair queue without advancing their page.
      repo.saveHistoryCursor(mapping.discordPostId, repo.historyCursor(mapping.discordPostId));
      ctx.reportSyncError(mapping.pluginTicketId!, "import Discord history", error);
    }
  }
}

export async function onMessage(ctx: ForumContext, message: Message): Promise<void> {
  if (!message.channel.isThread() || message.channel.parentId !== ctx.config.forumChannelId) return;
  const mapped = repo.byPost(message.channelId);
  if (!mapped || mapped.pluginTicketId === null || repo.threadDeleted(message.channelId)) return;
  await ctx.serial(message.channelId, async () => {
    if (!repo.threadDeleted(message.channelId)) await importHistoryMessage(ctx.api, mapped, message, true);
  });
}
