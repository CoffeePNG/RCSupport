import { AttachmentBuilder, ChannelType, TextChannel, Message, OverwriteType, PermissionFlagsBits, ThreadChannel } from "discord.js";
import { db } from "../../db/connect";

const active = new Set<string>();
const privateOverwrites = (guildId: string) => [{ id: guildId, type: OverwriteType.Role,
  allow: [], deny: [PermissionFlagsBits.ViewChannel] }];

/** A transcript preserves attribution; Discord cannot move posts or recreate their original authors. */
export async function vaultForumPost(source: ThreadChannel, categoryId: string): Promise<string> {
  const key = `${source.guild.id}:${categoryId}`;
  if (active.has(key)) throw new Error("Another forum post is being vaulted here. Try again when it finishes.");
  active.add(key);
  try {
    const parent = await source.guild.channels.fetch(source.parentId!);
    if (parent?.type !== ChannelType.GuildForum) throw new Error("Only posts inside a forum channel can be vaulted as threads.");
    if (parent.parentId === categoryId) throw new Error("This post is already inside the vault category.");
    const marker = "RCSupport vaulted thread transcripts";
    const channels = await source.guild.channels.fetch();
    let destination = channels.find(channel => channel?.type === ChannelType.GuildText &&
      channel.parentId === categoryId && (channel.topic === marker || channel.name === "vaulted-threads")) as TextChannel | undefined;
    if (!destination) {
      destination = await source.guild.channels.create({
        name: "vaulted-threads",
        type: ChannelType.GuildText,
        parent: categoryId,
        topic: marker,
        permissionOverwrites: privateOverwrites(source.guild.id),
        reason: "Create administrator-only transcript channel",
      });
    } else {
      // Reassert isolation even if someone has subsequently changed its overwrites.
      await destination.permissionOverwrites.set(privateOverwrites(source.guild.id), "Keep vaulted posts administrator-only");
    }
    const saved = db.prepare("SELECT channel_id, message_id FROM vault_thread_transcripts WHERE source_id = ?").get(source.id) as { channel_id: string; message_id: string } | undefined;
    if (saved) {
      if (saved.channel_id !== destination.id) throw new Error("This thread already has a transcript in another vault channel.");
      const existing = await destination.messages.fetch(saved.message_id);
      await source.edit({ locked: true, archived: true, reason: "Thread transcript saved in vault" });
      return existing.url;
    }

    // Freeze before pagination so ordinary members cannot add messages beyond the snapshot.
    const original = { locked: source.locked ?? false, archived: source.archived ?? false };
    await source.edit({ locked: true, archived: true, reason: "Snapshot forum post for vault" });
    let copyRecorded = false;
    try {
      const messages: Message<true>[] = [];
      let before: string | undefined;
      for (;;) {
        const page = await source.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
        if (!page.size) break;
        messages.push(...page.values());
        before = page.last()!.id;
      }
      messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp || (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
      const transcript = messages.map(message => ({
        id: message.id, authorId: message.author.id, author: message.author.tag,
        createdAt: message.createdAt.toISOString(), editedAt: message.editedAt?.toISOString() ?? null,
        content: message.content, embeds: message.embeds.map(embed => embed.toJSON()),
        attachments: [...message.attachments.values()].map(file => ({ id: file.id, name: file.name, url: file.url })),
        stickers: [...message.stickers.values()].map(sticker => ({ id: sticker.id, name: sticker.name })),
        replyTo: message.reference?.messageId ?? null,
      }));
      const text = `Thread: ${source.name}\nForum: ${parent.name}\nSource: ${source.url}\n\n` + transcript.map(message => `[${message.createdAt}] ${message.author} (${message.authorId})\n${message.content}\n` +
        message.attachments.map(file => `Attachment: ${file.name} (${file.url})`).join("\n") +
        (message.embeds.length ? `\nEmbeds: ${JSON.stringify(message.embeds)}` : "") +
        (message.stickers.length ? `\nStickers: ${JSON.stringify(message.stickers)}` : "")).join("\n\n");
      const files = [
        new AttachmentBuilder(Buffer.from(text || "No messages found."), { name: `thread-${source.id}.txt` }),
        new AttachmentBuilder(Buffer.from(JSON.stringify(transcript, null, 2)), { name: `thread-${source.id}.json` }),
      ];
      const summary = `**${source.name.replace(/([\\*_~`|>])/g, "\\$1")}**\nForum: <#${parent.id}> • [Original post](${source.url})\n${messages.length} messages. Authors, timestamps, and message text are in the transcripts.`;
      const copy = await destination.send({ content: `Copying transcript…\n${summary}`,
        files, allowedMentions: { parse: [] } });
      // Upload actual attachment bytes through Discord, rather than relying on expiring source links.
      // Keep the source on any error; never report a partial attachment copy as complete.
      try {
        for (const message of messages) {
          const attachments = [...message.attachments.values()];
          for (let offset = 0; offset < attachments.length; offset += 10) {
            await destination.send({ content: `[Transcript](${copy.url}) — attachments from message ${message.id} by ${message.author.id}`,
              files: attachments.slice(offset, offset + 10).map(file => new AttachmentBuilder(file.url, { name: file.name })),
              allowedMentions: { parse: [] } });
          }
        }
        await copy.edit({ content: `Transcript saved.\n${summary}`, allowedMentions: { parse: [] } });
        db.prepare("INSERT INTO vault_thread_transcripts (source_id, channel_id, message_id) VALUES (?, ?, ?)").run(source.id, destination.id, copy.id);
        copyRecorded = true;
      } catch (error) {
        // The original remains authoritative. A visibly marked partial copy is safe to inspect.
        await copy.edit({ content: `INCOMPLETE — vault copy failed; the original was retained.\n${summary}`, allowedMentions: { parse: [] } }).catch(() => {});
        throw error;
      }
      return copy.url;
    } catch (error) {
      if (!copyRecorded) await source.edit({ ...original, reason: "Restore source after failed vault copy" });
      throw error;
    }
  } finally { active.delete(key); }
}
