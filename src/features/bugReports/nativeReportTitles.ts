import { EmbedBuilder, ThreadChannel } from "discord.js";
import type { ForumContext } from "./forumContext";

/** Repair titles produced by the old questionnaire-body naming bug during normal polling. */
export async function repairNativeReportTitle(ctx: ForumContext, thread: ThreadChannel): Promise<void> {
  if (!thread.name?.includes("**Category**")) return;
  const starter = await thread.fetchStarterMessage();
  if (!starter?.editable) return;
  const description = starter.embeds[0]?.description;
  if (!description?.includes("\n\n**Category**\n")) return;
  const title = description.split(/\r?\n/)[0].trim();
  if (!title) return;
  // A retry after either Discord write fails must reuse the same reservation.
  const { id } = await ctx.api.reserveReportNumber(`thread:${thread.id}`);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error("Bridge returned an invalid report number");
  await starter.edit({ embeds: [EmbedBuilder.from(starter.embeds[0]).setTitle(`RCSupport • Bug #${id}`), ...starter.embeds.slice(1)], allowedMentions: {parse:[]} });
  await thread.setName(`#${id} ${title}`.replace(/\s+/g, " ").slice(0, 100));
}
