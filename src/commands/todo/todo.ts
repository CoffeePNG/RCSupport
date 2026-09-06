import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { buildTodoPanelContent } from "../../utils/todoPanel";
import { Command } from "../types";

export const todoCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("todo")
    .setDescription("View the shared to-do board, just for you."),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const content = buildTodoPanelContent(guildId);
    await interaction.reply({
      embeds: [content.embed],
      components: [content.row],
      flags: MessageFlags.Ephemeral,
    });
  },
};
