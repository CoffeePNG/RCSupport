import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { postModLog } from "../../../utils/logger";
import { Command } from "../../../commands/types";

export const banCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a user from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) => opt.setName("user").setDescription("The user to ban").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for the ban").setMaxLength(500)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("delete_message_days")
        .setDescription("Delete this many days of the user's recent messages (0-7)")
        .setMinValue(0)
        .setMaxValue(7)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guild = interaction.guild;
    if (!guild) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided";
    const days = interaction.options.getInteger("delete_message_days") ?? 0;

    try {
      await guild.members.ban(user.id, {
        reason: `${reason} (by ${interaction.user.tag})`,
        deleteMessageSeconds: days * 86400,
      });
    } catch (error) {
      await interaction.reply({
        content: `Failed to ban ${user.tag}: ${(error as Error).message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ content: `Banned ${user.tag}.`, flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
      .setTitle("Member Banned")
      .setColor(0xed4245)
      .addFields(
        { name: "User", value: `${user.tag} (<@${user.id}>)` },
        { name: "Moderator", value: `<@${interaction.user.id}>` },
        { name: "Reason", value: reason }
      )
      .setTimestamp();
    await postModLog(interaction.client, guild.id, embed);
  },
};
