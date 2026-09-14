import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { TICKET_CREATE_MODAL_PREFIX } from "./ticketConstants";
import { TicketTypeConfig } from "./ticket";

export function buildTicketDetailsModal(ticketType: TicketTypeConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_CREATE_MODAL_PREFIX}:${ticketType.typeKey}`)
    .setTitle(ticketType.displayName.slice(0, 45));

  const details = new TextInputBuilder()
    .setCustomId("details")
    .setLabel("What's this about?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(details));
  return modal;
}
