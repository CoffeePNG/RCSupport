import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { addWarning } from "../warningsRepo";
import { postModLog } from "../../../utils/logger";
import { Command } from "../../../commands/types";

export const warnCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Issue a warning to a user.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) => opt.setName("user").setDescription("The user to warn").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Reason for the warning").setRequired(true).setMaxLength(500)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);

    const warning = addWarning(guildId, user.id, interaction.user.id, reason);

    await interaction.reply({
      content: `Warned ${user.tag} (warning #${warning.id}).`,
      flags: MessageFlags.Ephemeral,
    });

    const embed = new EmbedBuilder()
      .setTitle("Member Warned")
      .setColor(0xfee75c)
      .addFields(
        { name: "User", value: `${user.tag} (<@${user.id}>)` },
        { name: "Moderator", value: `<@${interaction.user.id}>` },
        { name: "Reason", value: reason },
        { name: "Warning ID", value: `#${warning.id}` }
      )
      .setTimestamp();
    await postModLog(interaction.client, guildId, embed);
  },
};
