import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { deactivateWarning } from "../warningsRepo";
import { postModLog } from "../../../utils/logger";
import { Command } from "../../../commands/types";

export const unwarnCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("unwarn")
    .setDescription("Clear a previously issued warning by its ID.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addIntegerOption((opt) =>
      opt
        .setName("warning_id")
        .setDescription("The warning ID (shown by /warnings)")
        .setRequired(true)
        .setMinValue(1)
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

    const warningId = interaction.options.getInteger("warning_id", true);
    const cleared = deactivateWarning(guildId, warningId);

    await interaction.reply({
      content: cleared
        ? `Warning #${warningId} has been cleared.`
        : `No active warning #${warningId} found.`,
      flags: MessageFlags.Ephemeral,
    });

    if (cleared) {
      const embed = new EmbedBuilder()
        .setTitle("Warning Cleared")
        .setColor(0x57f287)
        .addFields(
          { name: "Warning ID", value: `#${warningId}` },
          { name: "Cleared by", value: `<@${interaction.user.id}>` }
        )
        .setTimestamp();
      await postModLog(interaction.client, guildId, embed);
    }
  },
};
