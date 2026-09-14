import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  Message,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import { postModLog } from "../../../utils/logger";
import { parseMessageReference } from "../../../utils/messageLink";
import { MessagePredicate, purgeMessages } from "../purge";
import { Command } from "../../../commands/types";

const MAX_PURGE = 5000;

export const purgeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName("any")
        .setDescription(`Delete the most recent messages, any type (max ${MAX_PURGE}).`)
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription(`How many messages to delete (max ${MAX_PURGE})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_PURGE)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("user")
        .setDescription("Delete recent messages sent by a specific user.")
        .addUserOption((opt) =>
          opt.setName("target").setDescription("The user whose messages to delete").setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription(`How many of their messages to delete (max ${MAX_PURGE})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_PURGE)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("bots")
        .setDescription("Delete recent messages sent by bots.")
        .addIntegerOption((opt) =>
          opt
            .setName("amount")
            .setDescription(`How many bot messages to delete (max ${MAX_PURGE})`)
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(MAX_PURGE)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("after")
        .setDescription("Delete every message after a specific one (link or ID).")
        .addStringOption((opt) =>
          opt
            .setName("message")
            .setDescription("Message link or ID to delete from (exclusive) onward")
            .setRequired(true)
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    const targetChannel = interaction.channel;
    if (!guild || !targetChannel || !targetChannel.isTextBased() || targetChannel.isDMBased()) {
      await interaction.reply({
        content: "This command can only be used in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channel = targetChannel as GuildTextBasedChannel;

    const required = new PermissionsBitField([
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ReadMessageHistory,
    ]);

    const member =
      interaction.member instanceof GuildMember
        ? interaction.member
        : await guild.members.fetch(interaction.user.id).catch(() => null);
    const memberPermissions = member && channel.permissionsFor(member);
    if (!memberPermissions?.has(required)) {
      await interaction.reply({
        content: "You need **Manage Messages** in this channel to purge it.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const botMember = guild.members.me;
    const botPermissions = channel.permissionsFor(botMember ?? interaction.client.user.id);
    if (!botPermissions?.has(required)) {
      await interaction.reply({
        content: `I need **Manage Messages** and **Read Message History** in ${channel} to purge it.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const subcommand = interaction.options.getSubcommand(true) as "any" | "user" | "bots" | "after";

    let limit: number;
    let filter: MessagePredicate | undefined;
    let after: string | undefined;
    let describeRequest: string;

    if (subcommand === "any") {
      limit = interaction.options.getInteger("amount", true);
      describeRequest = `${limit} message${limit === 1 ? "" : "s"}`;
    } else if (subcommand === "user") {
      const targetUser = interaction.options.getUser("target", true);
      limit = interaction.options.getInteger("amount", true);
      filter = (msg: Message) => msg.author.id === targetUser.id;
      describeRequest = `${limit} message${limit === 1 ? "" : "s"} from ${targetUser.tag}`;
    } else if (subcommand === "bots") {
      limit = interaction.options.getInteger("amount", true);
      filter = (msg: Message) => msg.author.bot;
      describeRequest = `${limit} bot message${limit === 1 ? "" : "s"}`;
    } else {
      const input = interaction.options.getString("message", true);
      const reference = parseMessageReference(input);
      if (!reference) {
        await interaction.reply({
          content:
            "That isn't a message link or ID. Right-click a message → **Copy Message Link**, or copy its ID with developer mode on.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (reference.guildId && reference.guildId !== guild.id) {
        await interaction.reply({
          content: "That message link is from a different server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (reference.channelId && reference.channelId !== channel.id) {
        await interaction.reply({
          content: `That message link points at <#${reference.channelId}>, not this channel. Run \`/purge after\` from the channel you want to purge.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const anchor = await channel.messages.fetch(reference.messageId).catch(() => null);
      if (!anchor) {
        await interaction.reply({
          content: "I couldn't find that message in this channel.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      limit = MAX_PURGE;
      after = anchor.id;
      describeRequest = `everything after [that message](${anchor.url})`;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let result;
    try {
      result = await purgeMessages(channel, { limit, filter, after });
    } catch (error) {
      await interaction.editReply({
        content: `Failed to purge messages: ${(error as Error).message}`,
      });
      return;
    }

    const shortOfTarget = subcommand !== "after" && result.deleted < limit;
    const summary =
      result.deleted === 0
        ? "No messages were deleted (nothing matched, or nothing recent enough to bulk-delete)."
        : `Deleted ${result.deleted} message${result.deleted === 1 ? "" : "s"}.`;
    const note = shortOfTarget
      ? ` Stopped early — either it ran out of matching messages, hit the ${MAX_PURGE}-message search cap, or hit Discord's 14-day bulk-delete limit.`
      : "";

    await interaction.editReply({ content: `${summary}${note}` });

    if (result.deleted > 0) {
      const embed = new EmbedBuilder()
        .setTitle("Messages Purged")
        .setColor(0xed4245)
        .addFields(
          { name: "Channel", value: `<#${channel.id}>`, inline: true },
          { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Mode", value: `/purge ${subcommand}`, inline: true },
          { name: "Requested", value: describeRequest, inline: true },
          { name: "Deleted", value: String(result.deleted), inline: true },
          { name: "Scanned", value: String(result.scanned), inline: true }
        )
        .setTimestamp();
      if (shortOfTarget) {
        embed.addFields({ name: "Notes", value: "Stopped before the requested amount (see above)." });
      }
      await postModLog(interaction.client, guild.id, embed);
    }
  },
};
