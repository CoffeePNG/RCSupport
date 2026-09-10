import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  GuildMember,
  GuildTextBasedChannel,
  MessageFlags,
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
} from "discord.js";
import { postModLog } from "../../utils/logger";
import { Command } from "../types";

const MAX_PURGE = 5000;
/** Discord's bulk-delete endpoint takes 2-100 messages per call. */
const BATCH_SIZE = 100;

export const purgeCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Bulk-delete recent messages in this channel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addIntegerOption((opt) =>
      opt
        .setName("amount")
        .setDescription(`How many messages to delete (max ${MAX_PURGE})`)
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_PURGE)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    const target = interaction.channel;
    if (!guild || !target || !target.isTextBased() || target.isDMBased()) {
      await interaction.reply({
        content: "This command can only be used in a server text channel.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    const channel = target as GuildTextBasedChannel;

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

    const amount = interaction.options.getInteger("amount", true);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let deletedTotal = 0;
    let remaining = amount;
    let stoppedEarly = false;

    try {
      while (remaining > 0) {
        const batchSize = Math.min(remaining, BATCH_SIZE);
        // Discord auto-filters messages older than 14 days when filterOld is
        // true, and falls back to a single delete when only one is left.
        const deleted = await channel.bulkDelete(batchSize, true);
        deletedTotal += deleted.size;
        remaining -= deleted.size;

        // Fewer than requested means we hit the 14-day bulk-delete ceiling or
        // ran out of channel history. Either way, more attempts won't help.
        if (deleted.size < batchSize) {
          stoppedEarly = true;
          break;
        }
      }
    } catch (error) {
      if (deletedTotal === 0) {
        await interaction.editReply({
          content: `Failed to purge messages: ${(error as Error).message}`,
        });
        return;
      }
      stoppedEarly = true;
    }

    const summary =
      deletedTotal === 0
        ? "No messages were deleted (nothing recent enough to bulk-delete)."
        : `Deleted ${deletedTotal} message${deletedTotal === 1 ? "" : "s"}.`;
    const note = stoppedEarly
      ? " Stopped early — either the channel ran out of messages, or the rest are older than 14 days, which Discord's bulk-delete can't touch."
      : "";

    await interaction.editReply({ content: `${summary}${note}` });

    if (deletedTotal > 0) {
      const embed = new EmbedBuilder()
        .setTitle("Messages Purged")
        .setColor(0xed4245)
        .addFields(
          { name: "Channel", value: `<#${channel.id}>`, inline: true },
          { name: "Moderator", value: `<@${interaction.user.id}>`, inline: true },
          { name: "Requested", value: String(amount), inline: true },
          { name: "Deleted", value: String(deletedTotal), inline: true }
        )
        .setTimestamp();
      if (stoppedEarly) {
        embed.addFields({
          name: "Notes",
          value: "Stopped early (ran out of messages, or hit the 14-day bulk-delete limit).",
        });
      }
      await postModLog(interaction.client, guild.id, embed);
    }
  },
};
