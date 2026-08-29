import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from "discord.js";
import { assignTodo, createTodo } from "../../db/todoRepo";
import { refreshPostedTodoPanel } from "../../utils/todoPanel";
import { Command } from "../types";

export const taskCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("task")
    .setDescription("Manage the shared to-do list.")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Add a task to the to-do list.")
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Short task title").setRequired(true).setMaxLength(100)
        )
        .addStringOption((opt) =>
          opt
            .setName("description")
            .setDescription("Additional details (optional)")
            .setRequired(false)
            .setMaxLength(500)
        )
        .addUserOption((opt) =>
          opt.setName("assignee").setDescription("Who to assign this to").setRequired(false)
        )
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

    // Only one subcommand exists today; this guards cleanly once more are added.
    if (interaction.options.getSubcommand() !== "create") return;

    const title = interaction.options.getString("title", true).trim();
    if (!title) {
      await interaction.reply({ content: "Task title can't be empty.", flags: MessageFlags.Ephemeral });
      return;
    }
    const description = interaction.options.getString("description")?.trim() || null;

    const assignee = interaction.options.getUser("assignee");
    const todo = createTodo(guildId, title, description, interaction.user.id);
    if (assignee) {
      assignTodo(todo.id, assignee.id);
    }

    await refreshPostedTodoPanel(interaction.client, guildId);

    await interaction.reply({
      content: assignee
        ? `Task **#${todo.id}** added and assigned to <@${assignee.id}>.`
        : `Task **#${todo.id}** added.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
