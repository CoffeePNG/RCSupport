import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { getGuildSettings } from "../db/guildSettingsRepo";

async function postTo(client: Client, channelId: string, embed: EmbedBuilder): Promise<void> {
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (channel instanceof TextChannel) {
    await channel.send({ embeds: [embed] });
  }
}

export async function postModLog(
  client: Client,
  guildId: string,
  embed: EmbedBuilder
): Promise<void> {
  const settings = getGuildSettings(guildId);
  if (!settings.modLogChannelId) return;

  await postTo(client, settings.modLogChannelId, embed);
}

/**
 * Logs a channel export to the archive-log channel, or the mod-log channel if
 * none is set. Bulk history exports are worth a paper trail by default, so an
 * unconfigured guild with a mod-log still gets one; only an explicit
 * `/mod-config archive-log disable:true` silences it.
 */
export async function postArchiveLog(
  client: Client,
  guildId: string,
  embed: EmbedBuilder
): Promise<void> {
  const settings = getGuildSettings(guildId);
  if (settings.archiveLogDisabled) return;

  const channelId = settings.archiveLogChannelId ?? settings.modLogChannelId;
  if (!channelId) return;

  await postTo(client, channelId, embed);
}
