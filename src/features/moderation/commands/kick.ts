import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { postModLog } from "../../../utils/logger";
import { Command } from "../../../commands/types";

export const kickCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a user from the server.")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) => opt.setName("user").setDescription("The user to kick").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for the kick").setMaxLength(500)
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

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: `${user.tag} isn't in this server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await member.kick(`${reason} (by ${interaction.user.tag})`);
    } catch (error) {
      await interaction.reply({
        content: `Failed to kick ${user.tag}: ${(error as Error).message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ content: `Kicked ${user.tag}.`, flags: MessageFlags.Ephemeral });

    const embed = new EmbedBuilder()
      .setTitle("Member Kicked")
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
