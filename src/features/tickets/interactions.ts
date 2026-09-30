import { APPLICATION_ROLE_SELECT_PREFIX } from "./ticketModal";
import { Interaction, PermissionFlagsBits } from "discord.js";
import { CONFIG_EDIT_MODAL_PREFIX, PANEL_EDIT_MODAL_ID, handleConfigEditModalSubmit, handlePanelEditModalSubmit } from "./configHandler";
import { TICKET_RELEASE_PREFIX, TICKET_CLAIM_PREFIX, TICKET_CLOSE_CANCEL_PREFIX, TICKET_CLOSE_CONFIRM_PREFIX, TICKET_CLOSE_PREFIX, TICKET_CREATE_MODAL_PREFIX, TICKET_PANEL_SELECT_ID } from "./ticketConstants";
import { handleTicketRelease, handleApplicationRoleSelect, handleTicketClaim, handleTicketCloseCancel, handleTicketCloseConfirm, handleTicketCloseRequest, handleTicketCreateModal, handleTicketPanelSelect } from "./ticketHandler";

import { ticketModule } from "../../modules/catalog";
import { dispatchComponent, exact, prefix, route } from "../../interactions/router";

const policy = { module: ticketModule };
const manage = { ...policy, requiredPermissions: PermissionFlagsBits.ManageGuild };
export const ticketRoutes = [
  route("modal", prefix(TICKET_CREATE_MODAL_PREFIX + ":"), handleTicketCreateModal, policy),
  route("modal", prefix(CONFIG_EDIT_MODAL_PREFIX), handleConfigEditModalSubmit, manage),
  route("modal", exact(PANEL_EDIT_MODAL_ID), handlePanelEditModalSubmit, manage),
  route("stringSelect", prefix(APPLICATION_ROLE_SELECT_PREFIX), handleApplicationRoleSelect, policy),
  route("stringSelect", exact(TICKET_PANEL_SELECT_ID), handleTicketPanelSelect, policy),
  route("button", prefix(TICKET_CLOSE_CONFIRM_PREFIX), handleTicketCloseConfirm, policy),
  route("button", prefix(TICKET_CLOSE_CANCEL_PREFIX), handleTicketCloseCancel, policy),
  route("button", prefix(TICKET_CLOSE_PREFIX), handleTicketCloseRequest, policy),
  route("button", prefix(TICKET_RELEASE_PREFIX), handleTicketRelease, policy),
  route("button", prefix(TICKET_CLAIM_PREFIX), handleTicketClaim, policy),
];

export function handleTicketsInteraction(interaction: Interaction): Promise<boolean> {
  return dispatchComponent(interaction, ticketRoutes);
}
