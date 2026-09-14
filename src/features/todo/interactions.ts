import { Interaction } from "discord.js";
import { TODO_ADD_BUTTON_ID, TODO_ADD_MODAL_ID, TODO_ASSIGN_BUTTON_ID, TODO_ASSIGN_SELECT_ID, TODO_ASSIGN_USER_PREFIX, TODO_COMPLETE_BUTTON_ID, TODO_COMPLETE_SELECT_ID, TODO_REMOVE_BUTTON_ID, TODO_REMOVE_SELECT_ID, TODO_UNASSIGN_PREFIX } from "./todoConstants";
import { handleTodoAddButton, handleTodoAddModalSubmit, handleTodoAssignButton, handleTodoAssignSelect, handleTodoAssignUserSelect, handleTodoCompleteButton, handleTodoCompleteSelect, handleTodoRemoveButton, handleTodoRemoveSelect, handleTodoUnassignButton } from "./todoHandler";

export async function handleTodoInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isModalSubmit() && interaction.customId === TODO_ADD_MODAL_ID) {
    await handleTodoAddModalSubmit(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === TODO_COMPLETE_SELECT_ID) {
    await handleTodoCompleteSelect(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === TODO_REMOVE_SELECT_ID) {
    await handleTodoRemoveSelect(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === TODO_ASSIGN_SELECT_ID) {
    await handleTodoAssignSelect(interaction);
    return true;
  }
  if (interaction.isUserSelectMenu() && interaction.customId.startsWith(TODO_ASSIGN_USER_PREFIX)) {
    await handleTodoAssignUserSelect(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === TODO_ADD_BUTTON_ID) {
    await handleTodoAddButton(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === TODO_COMPLETE_BUTTON_ID) {
    await handleTodoCompleteButton(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === TODO_REMOVE_BUTTON_ID) {
    await handleTodoRemoveButton(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === TODO_ASSIGN_BUTTON_ID) {
    await handleTodoAssignButton(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TODO_UNASSIGN_PREFIX)) {
    await handleTodoUnassignButton(interaction);
    return true;
  }
  return false;
}
