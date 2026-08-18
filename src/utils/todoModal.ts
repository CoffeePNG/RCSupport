import { ActionRowBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { TODO_ADD_MODAL_ID } from "../handlers/todoConstants";

export function buildTodoAddModal(): ModalBuilder {
  const input = new TextInputBuilder()
    .setCustomId("content")
    .setLabel("Task")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(500);

  return new ModalBuilder()
    .setCustomId(TODO_ADD_MODAL_ID)
    .setTitle("Add Task")
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}
