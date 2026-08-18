import { Interaction, MessageFlags } from "discord.js";
import { Command } from "../commands/types";
import {
  CONFIG_EDIT_MODAL_PREFIX,
  PANEL_EDIT_MODAL_ID,
  handleConfigEditModalSubmit,
  handlePanelEditModalSubmit,
} from "../handlers/configHandler";
import {
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
  TICKET_CREATE_MODAL_PREFIX,
  TICKET_PANEL_SELECT_ID,
} from "../handlers/ticketConstants";
import {
  handleTicketClaim,
  handleTicketCloseCancel,
  handleTicketCloseConfirm,
  handleTicketCloseRequest,
  handleTicketCreateModal,
  handleTicketPanelSelect,
} from "../handlers/ticketHandler";
import {
  TODO_ADD_BUTTON_ID,
  TODO_ADD_MODAL_ID,
  TODO_ASSIGN_BUTTON_ID,
  TODO_ASSIGN_SELECT_ID,
  TODO_ASSIGN_USER_PREFIX,
  TODO_COMPLETE_BUTTON_ID,
  TODO_COMPLETE_SELECT_ID,
  TODO_REMOVE_BUTTON_ID,
  TODO_REMOVE_SELECT_ID,
  TODO_UNASSIGN_PREFIX,
} from "../handlers/todoConstants";
import {
  handleTodoAddButton,
  handleTodoAddModalSubmit,
  handleTodoAssignButton,
  handleTodoAssignSelect,
  handleTodoAssignUserSelect,
  handleTodoCompleteButton,
  handleTodoCompleteSelect,
  handleTodoRemoveButton,
  handleTodoRemoveSelect,
  handleTodoUnassignButton,
} from "../handlers/todoHandler";

export async function handleInteraction(
  interaction: Interaction,
  commandsByName: Map<string, Command>
) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
      return;
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith(TICKET_CREATE_MODAL_PREFIX)) {
        await handleTicketCreateModal(interaction);
      } else if (interaction.customId.startsWith(CONFIG_EDIT_MODAL_PREFIX)) {
        await handleConfigEditModalSubmit(interaction);
      } else if (interaction.customId === PANEL_EDIT_MODAL_ID) {
        await handlePanelEditModalSubmit(interaction);
      } else if (interaction.customId === TODO_ADD_MODAL_ID) {
        await handleTodoAddModalSubmit(interaction);
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId === TICKET_PANEL_SELECT_ID) {
        await handleTicketPanelSelect(interaction);
      } else if (interaction.customId === TODO_COMPLETE_SELECT_ID) {
        await handleTodoCompleteSelect(interaction);
      } else if (interaction.customId === TODO_REMOVE_SELECT_ID) {
        await handleTodoRemoveSelect(interaction);
      } else if (interaction.customId === TODO_ASSIGN_SELECT_ID) {
        await handleTodoAssignSelect(interaction);
      }
      return;
    }

    if (interaction.isUserSelectMenu()) {
      if (interaction.customId.startsWith(TODO_ASSIGN_USER_PREFIX)) {
        await handleTodoAssignUserSelect(interaction);
      }
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId.startsWith(TICKET_CLOSE_CONFIRM_PREFIX)) {
        await handleTicketCloseConfirm(interaction);
      } else if (interaction.customId.startsWith(TICKET_CLOSE_CANCEL_PREFIX)) {
        await handleTicketCloseCancel(interaction);
      } else if (interaction.customId.startsWith(TICKET_CLOSE_PREFIX)) {
        await handleTicketCloseRequest(interaction);
      } else if (interaction.customId.startsWith(TICKET_CLAIM_PREFIX)) {
        await handleTicketClaim(interaction);
      } else if (interaction.customId === TODO_ADD_BUTTON_ID) {
        await handleTodoAddButton(interaction);
      } else if (interaction.customId === TODO_COMPLETE_BUTTON_ID) {
        await handleTodoCompleteButton(interaction);
      } else if (interaction.customId === TODO_REMOVE_BUTTON_ID) {
        await handleTodoRemoveButton(interaction);
      } else if (interaction.customId === TODO_ASSIGN_BUTTON_ID) {
        await handleTodoAssignButton(interaction);
      } else if (interaction.customId.startsWith(TODO_UNASSIGN_PREFIX)) {
        await handleTodoUnassignButton(interaction);
      }
      return;
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong handling that action.", flags: MessageFlags.Ephemeral })
        .catch(() => null);
    }
  }
}
