import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, EmbedBuilder, TextChannel } from "discord.js";
import { getGuildSettings } from "../db/guildSettingsRepo";
import { listOpenTodos } from "../db/todoRepo";
import { Todo } from "../types/ticket";
import {
  TODO_ADD_BUTTON_ID,
  TODO_ASSIGN_BUTTON_ID,
  TODO_COMPLETE_BUTTON_ID,
  TODO_REMOVE_BUTTON_ID,
} from "../handlers/todoConstants";

const MAX_FIELDS = 25;
const FIELD_VALUE_LIMIT = 1024;

export interface TodoPanelContent {
  embed: EmbedBuilder;
  row: ActionRowBuilder<ButtonBuilder>;
}

function formatTodoLine(todo: Todo): string {
  return `\`#${todo.id}\` ${todo.content}`;
}

/** Builds the shared to-do panel: an embed grouping open tasks by assignee, plus action buttons. */
export function buildTodoPanelContent(guildId: string): TodoPanelContent {
  const todos = listOpenTodos(guildId);

  const embed = new EmbedBuilder().setTitle("To-Do List").setColor(0x5865f2);

  if (todos.length === 0) {
    embed.setDescription("Nothing on the list yet. Use **Add Task** to get started.");
  } else {
    const unassigned = todos.filter((t) => !t.assigneeId);
    const byAssignee = new Map<string, Todo[]>();
    for (const todo of todos) {
      if (!todo.assigneeId) continue;
      const list = byAssignee.get(todo.assigneeId) ?? [];
      list.push(todo);
      byAssignee.set(todo.assigneeId, list);
    }

    const fields: { name: string; value: string }[] = [];
    if (unassigned.length > 0) {
      fields.push({
        name: "Unassigned",
        value: unassigned.map(formatTodoLine).join("\n").slice(0, FIELD_VALUE_LIMIT),
      });
    }
    for (const [assigneeId, list] of byAssignee) {
      fields.push({
        name: `<@${assigneeId}>`,
        value: list.map(formatTodoLine).join("\n").slice(0, FIELD_VALUE_LIMIT),
      });
    }

    embed.addFields(fields.slice(0, MAX_FIELDS));
    if (fields.length > MAX_FIELDS) {
      embed.setDescription("*Showing the first 25 groups — remove or complete some tasks to see the rest.*");
    }
  }

  embed.setFooter({ text: `${todos.length} open task${todos.length === 1 ? "" : "s"}` });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(TODO_ADD_BUTTON_ID).setLabel("Add Task").setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(TODO_ASSIGN_BUTTON_ID)
      .setLabel("Assign")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(todos.length === 0),
    new ButtonBuilder()
      .setCustomId(TODO_COMPLETE_BUTTON_ID)
      .setLabel("Complete")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(todos.length === 0),
    new ButtonBuilder()
      .setCustomId(TODO_REMOVE_BUTTON_ID)
      .setLabel("Remove")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(todos.length === 0)
  );

  return { embed, row };
}

/** Re-renders the posted to-do panel in place; returns false if nothing has been posted yet. */
export async function refreshPostedTodoPanel(client: Client, guildId: string): Promise<boolean> {
  const settings = getGuildSettings(guildId);
  if (!settings.todoPanelChannelId || !settings.todoPanelMessageId) return false;

  const channel = await client.channels.fetch(settings.todoPanelChannelId).catch(() => null);
  if (!(channel instanceof TextChannel)) return false;

  const message = await channel.messages.fetch(settings.todoPanelMessageId).catch(() => null);
  if (!message) return false;

  const content = buildTodoPanelContent(guildId);
  await message.edit({ embeds: [content.embed], components: [content.row] });
  return true;
}
