import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { postModLog } from "../../../utils/logger";
import { Command } from "../../../commands/types";

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60;

export const timeoutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Time out a user (mute them for a set duration).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to time out").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("minutes")
        .setDescription("Timeout duration in minutes (max 40320 = 28 days)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(MAX_TIMEOUT_MINUTES)
    )
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for the timeout").setMaxLength(500)
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
    const minutes = interaction.options.getInteger("minutes", true);
    const reason = interaction.options.getString("reason") ?? "No reason provided";

    const member = await guild.members.fetch(user.id).catch(() => null);
    if (!member) {
      await interaction.reply({ content: `${user.tag} isn't in this server.`, flags: MessageFlags.Ephemeral });
      return;
    }

    try {
      await member.timeout(minutes * 60 * 1000, `${reason} (by ${interaction.user.tag})`);
    } catch (error) {
      await interaction.reply({
        content: `Failed to time out ${user.tag}: ${(error as Error).message}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      content: `Timed out ${user.tag} for ${minutes} minute(s).`,
      flags: MessageFlags.Ephemeral,
    });

    const embed = new EmbedBuilder()
      .setTitle("Member Timed Out")
      .setColor(0xfee75c)
      .addFields(
        { name: "User", value: `${user.tag} (<@${user.id}>)` },
        { name: "Moderator", value: `<@${interaction.user.id}>` },
        { name: "Duration", value: `${minutes} minute(s)` },
        { name: "Reason", value: reason }
      )
      .setTimestamp();
    await postModLog(interaction.client, guild.id, embed);
  },
};
