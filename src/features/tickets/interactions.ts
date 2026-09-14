import { Interaction } from "discord.js";
import { CONFIG_EDIT_MODAL_PREFIX, PANEL_EDIT_MODAL_ID, handleConfigEditModalSubmit, handlePanelEditModalSubmit } from "./configHandler";
import { TICKET_CLAIM_PREFIX, TICKET_CLOSE_CANCEL_PREFIX, TICKET_CLOSE_CONFIRM_PREFIX, TICKET_CLOSE_PREFIX, TICKET_CREATE_MODAL_PREFIX, TICKET_PANEL_SELECT_ID } from "./ticketConstants";
import { handleTicketClaim, handleTicketCloseCancel, handleTicketCloseConfirm, handleTicketCloseRequest, handleTicketCreateModal, handleTicketPanelSelect } from "./ticketHandler";

export async function handleTicketsInteraction(interaction: Interaction): Promise<boolean> {
  if (interaction.isModalSubmit() && interaction.customId.startsWith(TICKET_CREATE_MODAL_PREFIX)) {
    await handleTicketCreateModal(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId.startsWith(CONFIG_EDIT_MODAL_PREFIX)) {
    await handleConfigEditModalSubmit(interaction);
    return true;
  }
  if (interaction.isModalSubmit() && interaction.customId === PANEL_EDIT_MODAL_ID) {
    await handlePanelEditModalSubmit(interaction);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId === TICKET_PANEL_SELECT_ID) {
    await handleTicketPanelSelect(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TICKET_CLOSE_CONFIRM_PREFIX)) {
    await handleTicketCloseConfirm(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TICKET_CLOSE_CANCEL_PREFIX)) {
    await handleTicketCloseCancel(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TICKET_CLOSE_PREFIX)) {
    await handleTicketCloseRequest(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith(TICKET_CLAIM_PREFIX)) {
    await handleTicketClaim(interaction);
    return true;
  }
  return false;
}
