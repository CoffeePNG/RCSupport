import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { Command } from "../../../commands/types";
import { parseDuration } from "../../../utils/duration";
import { getZen } from "../../../services/zen";

export const zenCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("zen")
    .setDescription("Put this channel in the chill zone for a required duration.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles)
    .addStringOption(option => option.setName("duration")
      .setDescription("How long to lock the channel, e.g. 10m, 1h, or 1h30m (maximum 7d)")
      .setRequired(true).setMaxLength(40)),
  async execute(interaction) {
    const channel = interaction.channel;
    if (!interaction.guild || channel?.type !== ChannelType.GuildText) {
      await interaction.reply({ content: "Use /zen in a server text channel.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels | PermissionFlagsBits.ManageRoles)) {
      await interaction.reply({ content: "You need Manage Channels and Manage Roles to use /zen.", flags: MessageFlags.Ephemeral });
      return;
    }
    const duration = parseDuration(interaction.options.getString("duration", true));
    if (!duration || !Number.isFinite(duration) || duration > 7 * 86400000) {
      await interaction.reply({ content: "Enter a duration between 1m and 7d, such as 10m or 1h30m.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles | PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages)) {
      await interaction.reply({ content: "I need Manage Roles, View Channel, and Send Messages here to start /zen.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const until = await getZen().lock(channel, duration);
      await interaction.editReply("Chill zone activated. Speaking permissions will be restored automatically.");
      // Interaction follow-ups work even when role overwrites prevent the bot from sending normally.
      await interaction.followUp({ content: `Everyone must enter...........the chill zone :snowflake:\nChannel unlocks <t:${Math.ceil(until / 1000)}:R>.`, allowedMentions: { parse: [] } });
    } catch (error) {
      await interaction.editReply(`Could not complete /zen: ${(error as Error).message}`);
    }
  },
};
