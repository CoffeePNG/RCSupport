import { Message, MessageType, PermissionFlagsBits, ThreadChannel } from "discord.js";
import { BridgeClient } from "./api";
import { PostMapping } from "./types";
import { shouldNotifyReporter } from "./policy";
import * as repo from "./repo";

export async function importHistoryMessage(api: BridgeClient, mapping: PostMapping, message: Message, live: boolean): Promise<void> {
  if (mapping.pluginTicketId === null || message.author.bot || message.webhookId ||
      ![MessageType.Default, MessageType.Reply].includes(message.type)) return;
  const parts = [message.content.trim()];
  for (const attachment of message.attachments.values()) parts.push(`[Attachment: ${attachment.name}] ${attachment.url}`);
  for (const sticker of message.stickers.values()) parts.push(`[Sticker: ${sticker.name}]`);
  const body = parts.filter(Boolean).join("\n");
  if (!body) return;
  await api.importHistory(mapping.pluginTicketId, {
    post_id: mapping.discordPostId, message_id: message.id,
    author: message.member?.displayName ?? message.author.username, body,
    created_at: Math.floor(message.createdTimestamp / 1000),
    notify_subscribers: live,
    notify: live && shouldNotifyReporter(mapping, message.author.id, message.author.bot),
  });
}

/** One persisted page per visit, so large histories cannot starve status synchronization. */
export async function importHistoryPage(api: BridgeClient, mapping: PostMapping, thread: ThreadChannel): Promise<void> {
  const bot = thread.client.user;
  if (!bot || !thread.permissionsFor(bot)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]))
    throw new Error("The bot needs View Channel and Read Message History to import case history");
  const cursor = repo.historyCursor(mapping.discordPostId);
  const batch = await thread.messages.fetch({ limit: 100, cache: false, ...(cursor.before_id ? {before: cursor.before_id} : {}) });
  const ordered = [...batch.values()].sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
  for (const message of ordered) if (BigInt(message.id) > BigInt(cursor.last_seen))
    await importHistoryMessage(api, mapping, message, false);
  const oldest = ordered[0]?.id;
  const newest = cursor.sweep_high ?? ordered.at(-1)?.id ?? cursor.last_seen;
  const high = BigInt(newest) > BigInt(cursor.last_seen) ? newest : cursor.last_seen;
  if (ordered.length < 100 || (oldest && BigInt(oldest) <= BigInt(cursor.last_seen))) {
    repo.saveHistoryCursor(mapping.discordPostId, {last_seen: high, before_id: null, sweep_high: null});
  } else {
    if (!oldest || (cursor.before_id && BigInt(oldest) >= BigInt(cursor.before_id))) throw new Error("History cursor did not advance");
    repo.saveHistoryCursor(mapping.discordPostId, {...cursor, before_id: oldest, sweep_high: high});
  }
}
