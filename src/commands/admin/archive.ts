import {
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import { MAX_DURATION_MS, formatDuration, parseDuration } from "../../utils/duration";
import { parseMessageReference } from "../../utils/messageLink";
import {
  buildTranscriptAttachment,
  buildTranscriptPreview,
  collectTranscript,
} from "../../utils/transcript";
import { Command } from "../types";

const DEFAULT_DURATION = "24h";
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 5000;
/** Stay under the 8 MB attachment ceiling on unboosted servers. */
const MAX_FILE_BYTES = 7_500_000;

const ARCHIVABLE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
] as const;

function slugify(name: string): string {
  return name.replace(/[^a-z0-9-_]/gi, "-").slice(0, 60) || "channel";
}

export const archiveCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("archive")
    .setDescription("Send yourself a transcript of a channel's recent messages.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((opt) =>
      opt
        .setName("duration")
        .setDescription(`How far back to go, e.g. 30m, 24h, 7d (default ${DEFAULT_DURATION})`)
    )
    .addStringOption((opt) =>
      opt
        .setName("from")
        .setDescription("Message link (or ID) to transcript from, that message onwards")
    )
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("Channel to archive (defaults to this one)")
        .addChannelTypes(...ARCHIVABLE_CHANNEL_TYPES)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("limit")
        .setDescription(`Maximum messages to include (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT})`)
        .setMinValue(1)
        .setMaxValue(MAX_LIMIT)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const fromInput = interaction.options.getString("from");
    const durationRaw = interaction.options.getString("duration");

    if (fromInput && durationRaw) {
      await interaction.reply({
        content:
          "Pick one: `from` starts at a specific message, `duration` looks back a set amount of time.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reference = fromInput ? parseMessageReference(fromInput) : null;
    if (fromInput && !reference) {
      await interaction.reply({
        content:
          "That isn't a message link or ID. Right-click a message → **Copy Message Link**, or copy its ID with developer mode on.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (reference?.guildId && reference.guildId !== interaction.guildId) {
      await interaction.reply({
        content: "That message link is from a different server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const durationInput = durationRaw ?? DEFAULT_DURATION;
    const durationMs = parseDuration(durationInput);
    if (durationMs === null) {
      await interaction.reply({
        content: "I couldn't read that duration. Use something like `30m`, `24h`, `7d` or `1w`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (durationMs > MAX_DURATION_MS) {
      await interaction.reply({
        content: `That window is too long. The maximum is ${formatDuration(MAX_DURATION_MS)}.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelOption = interaction.options.getChannel("channel");
    if (channelOption && reference?.channelId && channelOption.id !== reference.channelId) {
      await interaction.reply({
        content: `That message link points at <#${reference.channelId}>, not ${channelOption}. Drop the \`channel\` option to use the link's channel.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // A link carries its own channel; a bare ID is resolved against the target channel.
    const targetId = channelOption?.id ?? reference?.channelId;
    const target = targetId
      ? await interaction.client.channels.fetch(targetId).catch(() => null)
      : interaction.channel;

    if (
      !target ||
      !target.isTextBased() ||
      target.isDMBased() ||
      target.guildId !== interaction.guildId
    ) {
      await interaction.reply({
        content: "That channel can't be archived.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channel = target as GuildTextBasedChannel;
    const required = new PermissionsBitField([
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
    ]);

    // The requester must already be able to read the channel themselves.
    const memberPermissions = channel.permissionsFor(interaction.user.id);
    if (!memberPermissions?.has(required)) {
      await interaction.reply({
        content: "You don't have access to that channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = channel.guild.members.me;
    const botPermissions = channel.permissionsFor(botMember ?? interaction.client.user.id);
    if (!botPermissions?.has(required)) {
      await interaction.reply({
        content: `I need **View Channel** and **Read Message History** in ${channel} to archive it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const limit = interaction.options.getInteger("limit") ?? DEFAULT_LIMIT;

    // Permissions are settled, so it's safe to confirm the anchor message exists.
    const anchor = reference
      ? await channel.messages.fetch(reference.messageId).catch(() => null)
      : null;
    if (reference && !anchor) {
      await interaction.editReply({
        content: `I couldn't find that message in ${channel}. Check the link points at a message that still exists.`,
      });
      return;
    }

    let result;
    try {
      result = anchor
        ? await collectTranscript(channel, { limit, after: anchor.id, anchor })
        : await collectTranscript(channel, { limit, since: Date.now() - durationMs });
    } catch {
      await interaction.editReply({
        content: "I couldn't read that channel's history. Check my permissions and try again.",
      });
      return;
    }

    const windowLabel = anchor
      ? `since [that message](${anchor.url})`
      : `the last ${formatDuration(durationMs)}`;

    if (result.messageCount === 0) {
      await interaction.editReply({
        content: anchor
          ? `No messages in ${channel} from that message onwards.`
          : `No messages in ${channel} from the last ${formatDuration(durationMs)}.`,
      });
      return;
    }

    let text = result.text;
    let sizeTrimmed = false;
    if (Buffer.byteLength(text, "utf-8") > MAX_FILE_BYTES) {
      const buffer = Buffer.from(text, "utf-8").subarray(-MAX_FILE_BYTES);
      text = `(transcript trimmed to fit Discord's file size limit)\n${buffer.toString("utf-8")}`;
      sizeTrimmed = true;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `archive-${slugify(channel.name)}-${stamp}.txt`;
    const attachment = buildTranscriptAttachment(text, fileName);

    const notes: string[] = [];
    if (result.truncated) {
      notes.push(
        anchor
          ? `Stopped at the ${limit} message limit before reaching the newest message.`
          : `Stopped at the ${limit} message limit before reaching the full window.`
      );
    }
    if (sizeTrimmed) {
      notes.push("Oldest messages were dropped to fit Discord's file size limit.");
    }

    const embed = new EmbedBuilder()
      .setTitle(`#${channel.name} — Channel Transcript`)
      .setColor(0x99aab5)
      .setDescription(buildTranscriptPreview(text))
      .addFields(
        { name: "Server", value: channel.guild.name, inline: true },
        { name: "Channel", value: `<#${channel.id}>`, inline: true },
        { name: "Requested by", value: `<@${interaction.user.id}>`, inline: true },
        {
          name: "Window",
          value: anchor
            ? `[from this message](${anchor.url})`
            : `last ${formatDuration(durationMs)}`,
          inline: true,
        },
        { name: "Messages", value: String(result.messageCount), inline: true },
        {
          name: "Range",
          value:
            result.oldestTimestamp && result.newestTimestamp
              ? `<t:${Math.floor(result.oldestTimestamp / 1000)}:f> to <t:${Math.floor(
                  result.newestTimestamp / 1000
                )}:f>`
              : "unknown",
        }
      )
      .setFooter({ text: `#${channel.name} • ${channel.guild.name}` })
      .setTimestamp();

    if (notes.length > 0) {
      embed.addFields({ name: "Notes", value: notes.join("\n") });
    }

    try {
      await interaction.user.send({ embeds: [embed], files: [attachment] });
      await interaction.editReply({
        content: `Sent you a transcript of ${channel} covering ${windowLabel} (${result.messageCount} messages).`,
      });
    } catch {
      // DMs are closed: fall back to the ephemeral reply, which only the requester sees.
      await interaction.editReply({
        content:
          "I couldn't DM you (your direct messages are closed), so here's the transcript instead.",
        embeds: [embed],
        files: [buildTranscriptAttachment(text, fileName)],
      });
    }
  },
};
