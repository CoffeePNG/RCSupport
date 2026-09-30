import { Interaction } from "discord.js";
import { TODO_ADD_BUTTON_ID, TODO_ADD_MODAL_ID, TODO_ASSIGN_BUTTON_ID, TODO_ASSIGN_SELECT_ID, TODO_ASSIGN_USER_PREFIX, TODO_COMPLETE_BUTTON_ID, TODO_COMPLETE_SELECT_ID, TODO_REMOVE_BUTTON_ID, TODO_REMOVE_SELECT_ID, TODO_UNASSIGN_PREFIX } from "./todoConstants";
import { handleTodoAddButton, handleTodoAddModalSubmit, handleTodoAssignButton, handleTodoAssignSelect, handleTodoAssignUserSelect, handleTodoCompleteButton, handleTodoCompleteSelect, handleTodoRemoveButton, handleTodoRemoveSelect, handleTodoUnassignButton } from "./todoHandler";

import { todoModule } from "../../modules/catalog";
import { dispatchComponent, exact, prefix, route } from "../../interactions/router";

const policy = { module: todoModule };
export const todoRoutes = [
  route("modal", exact(TODO_ADD_MODAL_ID), handleTodoAddModalSubmit, policy),
  route("stringSelect", exact(TODO_COMPLETE_SELECT_ID), handleTodoCompleteSelect, policy),
  route("stringSelect", exact(TODO_REMOVE_SELECT_ID), handleTodoRemoveSelect, policy),
  route("stringSelect", exact(TODO_ASSIGN_SELECT_ID), handleTodoAssignSelect, policy),
  route("userSelect", prefix(TODO_ASSIGN_USER_PREFIX), handleTodoAssignUserSelect, policy),
  route("button", exact(TODO_ADD_BUTTON_ID), handleTodoAddButton, policy),
  route("button", exact(TODO_COMPLETE_BUTTON_ID), handleTodoCompleteButton, policy),
  route("button", exact(TODO_REMOVE_BUTTON_ID), handleTodoRemoveButton, policy),
  route("button", exact(TODO_ASSIGN_BUTTON_ID), handleTodoAssignButton, policy),
  route("button", prefix(TODO_UNASSIGN_PREFIX), handleTodoUnassignButton, policy),
];

export function handleTodoInteraction(interaction: Interaction): Promise<boolean> {
  return dispatchComponent(interaction, todoRoutes);
}
