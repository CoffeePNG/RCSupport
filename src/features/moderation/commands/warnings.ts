import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { getWarnings } from "../warningsRepo";
import { Command } from "../../../commands/types";

export const warningsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a user's active warnings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to look up").setRequired(true)
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
    const warnings = getWarnings(guildId, user.id);

    if (warnings.length === 0) {
      await interaction.reply({
        content: `${user.tag} has no active warnings.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle(`Active warnings: ${user.tag}`)
      .setColor(0xfee75c)
      .setDescription(
        warnings
          .map(
            (w) =>
              `**#${w.id}** — ${w.reason}\nby <@${w.moderatorId}> on ${new Date(
                w.createdAt
              ).toLocaleDateString()}`
          )
          .join("\n\n")
      );

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
