import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  MessageFlags,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  UserSelectMenuBuilder,
  UserSelectMenuInteraction,
} from "discord.js";
import { assignTodo, completeTodo, createTodo, getTodoById, listOpenTodos, removeTodo } from "../db/todoRepo";
import { canManageTodo } from "../utils/permissions";
import { buildTodoAddModal } from "../utils/todoModal";
import { refreshPostedTodoPanel } from "../utils/todoPanel";
import {
  TODO_ASSIGN_SELECT_ID,
  TODO_ASSIGN_USER_PREFIX,
  TODO_COMPLETE_SELECT_ID,
  TODO_REMOVE_SELECT_ID,
  TODO_UNASSIGN_PREFIX,
} from "./todoConstants";

export {
  TODO_ADD_BUTTON_ID,
  TODO_ASSIGN_BUTTON_ID,
  TODO_COMPLETE_BUTTON_ID,
  TODO_REMOVE_BUTTON_ID,
  TODO_ADD_MODAL_ID,
  TODO_ASSIGN_SELECT_ID,
  TODO_ASSIGN_USER_PREFIX,
  TODO_COMPLETE_SELECT_ID,
  TODO_REMOVE_SELECT_ID,
  TODO_UNASSIGN_PREFIX,
} from "./todoConstants";

const SELECT_LIMIT = 25;

function truncateLabel(content: string, max = 100): string {
  return content.length > max ? `${content.slice(0, max - 1)}…` : content;
}

/** Builds an ephemeral "pick a task" select from the guild's open todos, capped to Discord's 25-option limit. */
function buildTodoSelect(
  customId: string,
  placeholder: string,
  guildId: string
): StringSelectMenuBuilder | null {
  const todos = listOpenTodos(guildId).slice(0, SELECT_LIMIT);
  if (todos.length === 0) return null;

  return new StringSelectMenuBuilder()
    .setCustomId(customId)
    .setPlaceholder(placeholder)
    .addOptions(
      todos.map((t) => ({
        label: truncateLabel(`#${t.id} ${t.title}`),
        value: String(t.id),
      }))
    );
}

/** Add button: just opens the modal, no permission gate. */
export async function handleTodoAddButton(interaction: ButtonInteraction) {
  await interaction.showModal(buildTodoAddModal());
}

export async function handleTodoAddModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();
  if (!title) {
    await interaction.reply({ content: "Task title can't be empty.", flags: MessageFlags.Ephemeral });
    return;
  }

  createTodo(guildId, title, description || null, interaction.user.id);
  await refreshPostedTodoPanel(interaction.client, guildId);

  await interaction.reply({ content: "Task added.", flags: MessageFlags.Ephemeral });
}

export async function handleTodoCompleteButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const select = buildTodoSelect(TODO_COMPLETE_SELECT_ID, "Select a task to complete...", guildId);
  if (!select) {
    await interaction.reply({ content: "There's nothing open to complete.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Which task did you finish?",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleTodoRemoveButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const select = buildTodoSelect(TODO_REMOVE_SELECT_ID, "Select a task to remove...", guildId);
  if (!select) {
    await interaction.reply({ content: "There's nothing to remove.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Which task should be removed?",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Assign button: same task picker as complete/remove, no permission gate — anyone can hand a task off. */
export async function handleTodoAssignButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const select = buildTodoSelect(TODO_ASSIGN_SELECT_ID, "Select a task to assign...", guildId);
  if (!select) {
    await interaction.reply({ content: "There's nothing open to assign.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.reply({
    content: "Which task do you want to assign?",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleTodoCompleteSelect(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const todo = getTodoById(Number(interaction.values[0]));
  if (!todo || todo.guildId !== guildId || todo.status !== "open") {
    await interaction.update({ content: "That task is no longer open.", components: [] });
    return;
  }

  if (!canManageTodo(interaction.user.id, interaction.memberPermissions, todo)) {
    await interaction.update({
      content: "Only the assignee, the person who added it, or a server admin can complete this task.",
      components: [],
    });
    return;
  }

  completeTodo(todo.id, interaction.user.id);
  await refreshPostedTodoPanel(interaction.client, guildId);

  await interaction.update({ content: `Marked **#${todo.id}** complete.`, components: [] });
}

export async function handleTodoRemoveSelect(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const todo = getTodoById(Number(interaction.values[0]));
  if (!todo || todo.guildId !== guildId) {
    await interaction.update({ content: "That task no longer exists.", components: [] });
    return;
  }

  if (!canManageTodo(interaction.user.id, interaction.memberPermissions, todo)) {
    await interaction.update({
      content: "Only the assignee, the person who added it, or a server admin can remove this task.",
      components: [],
    });
    return;
  }

  removeTodo(todo.id);
  await refreshPostedTodoPanel(interaction.client, guildId);

  await interaction.update({ content: `Removed **#${todo.id}**.`, components: [] });
}

export async function handleTodoAssignSelect(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const todo = getTodoById(Number(interaction.values[0]));
  if (!todo || todo.guildId !== guildId || todo.status !== "open") {
    await interaction.update({ content: "That task is no longer open.", components: [] });
    return;
  }

  const userSelect = new UserSelectMenuBuilder()
    .setCustomId(`${TODO_ASSIGN_USER_PREFIX}${todo.id}`)
    .setPlaceholder("Select who to assign this to...");

  const unassignButton = new ButtonBuilder()
    .setCustomId(`${TODO_UNASSIGN_PREFIX}${todo.id}`)
    .setLabel("Unassign")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(!todo.assigneeId);

  await interaction.update({
    content: `Assign **#${todo.id} — ${todo.title}**`,
    components: [
      new ActionRowBuilder<UserSelectMenuBuilder>().addComponents(userSelect),
      new ActionRowBuilder<ButtonBuilder>().addComponents(unassignButton),
    ],
  });
}

export async function handleTodoAssignUserSelect(interaction: UserSelectMenuInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const todoId = Number(interaction.customId.slice(TODO_ASSIGN_USER_PREFIX.length));
  const todo = getTodoById(todoId);
  if (!todo || todo.guildId !== guildId || todo.status !== "open") {
    await interaction.update({ content: "That task is no longer open.", components: [] });
    return;
  }

  const assigneeId = interaction.values[0];
  assignTodo(todo.id, assigneeId);
  await refreshPostedTodoPanel(interaction.client, guildId);

  await interaction.update({ content: `Assigned **#${todo.id}** to <@${assigneeId}>.`, components: [] });
}

export async function handleTodoUnassignButton(interaction: ButtonInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const todoId = Number(interaction.customId.slice(TODO_UNASSIGN_PREFIX.length));
  const todo = getTodoById(todoId);
  if (!todo || todo.guildId !== guildId || todo.status !== "open") {
    await interaction.update({ content: "That task is no longer open.", components: [] });
    return;
  }

  assignTodo(todo.id, null);
  await refreshPostedTodoPanel(interaction.client, guildId);

  await interaction.update({ content: `Unassigned **#${todo.id}**.`, components: [] });
}
