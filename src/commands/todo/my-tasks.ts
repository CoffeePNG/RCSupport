import { ChatInputCommandInteraction, EmbedBuilder, MessageFlags, SlashCommandBuilder } from "discord.js";
import { listAssignedTodos } from "../../db/todoRepo";
import { Command } from "../types";

export const myTasksCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("my-tasks")
    .setDescription("View the open to-do items assigned to you."),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const todos = listAssignedTodos(guildId, interaction.user.id);
    if (todos.length === 0) {
      await interaction.reply({
        content: "You have no open tasks assigned to you.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle("Your tasks")
      .setColor(0x5865f2)
      .setDescription(
        todos
          .map((t) => (t.content ? `\`#${t.id}\` **${t.title}**\n${t.content}` : `\`#${t.id}\` **${t.title}**`))
          .join("\n")
          .slice(0, 4000)
      )
      .setFooter({ text: `${todos.length} open task${todos.length === 1 ? "" : "s"}` });

    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
