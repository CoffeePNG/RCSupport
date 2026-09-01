import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";
import {
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
} from "../handlers/ticketConstants";
import { Ticket } from "../types/ticket";
import { TicketTypeConfig } from "../types/ticket";
import { buildTranscriptPreview } from "./transcript";

function statusColor(status: Ticket["status"]): number {
  if (status === "claimed") return 0xfee75c;
  if (status === "closed") return 0x99aab5;
  return 0x5865f2;
}

/** Sets an embed's color and adds Claimed/Closed fields to match a ticket's current status. */
export function applyTicketStatus(embed: EmbedBuilder, ticket: Ticket): EmbedBuilder {
  embed.setColor(statusColor(ticket.status));
  if (ticket.status === "claimed" && ticket.claimedBy) {
    embed.addFields({ name: "Claimed by", value: `<@${ticket.claimedBy}>` });
  }
  if (ticket.status === "closed") {
    embed.addFields({
      name: "Closed",
      value: ticket.closedBy ? `by <@${ticket.closedBy}>` : "closed",
    });
  }
  return embed;
}

/** Builds the embed posted on ticket creation (status is always "open" at this point). */
export function buildTicketEmbed(
  ticket: Ticket,
  ticketType: TicketTypeConfig,
  details: string,
  creatorTag: string
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(ticketType.displayName)
    .setDescription(details.slice(0, 4000))
    .addFields({ name: "Opened by", value: `${creatorTag} (<@${ticket.creatorId}>)` })
    .setFooter({ text: `Ticket #${ticket.id} • ${ticketType.department}` })
    .setTimestamp(ticket.createdAt);

  return applyTicketStatus(embed, ticket);
}

/** Claim/Close buttons shown on a ticket's message; each disables once it no longer applies. */
export function buildTicketButtons(
  ticketId: number,
  claimDisabled: boolean,
  closeDisabled: boolean
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLAIM_PREFIX}${ticketId}`)
      .setLabel("Claim")
      .setStyle(ButtonStyle.Primary)
      .setDisabled(claimDisabled),
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLOSE_PREFIX}${ticketId}`)
      .setLabel("Close")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(closeDisabled)
  );
}

/** Confirm/Cancel buttons shown on the ephemeral "are you sure?" close prompt. */
export function buildCloseConfirmRow(ticketId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLOSE_CONFIRM_PREFIX}${ticketId}`)
      .setLabel("Confirm Close")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${TICKET_CLOSE_CANCEL_PREFIX}${ticketId}`)
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Secondary)
  );
}

function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Builds one archive-channel embed per closed ticket; transcript is plain text (not a code block) so mentions still resolve. */
export function buildTranscriptLogEmbed(
  ticket: Ticket,
  ticketType: TicketTypeConfig,
  transcriptText: string
): EmbedBuilder {
  const preview = buildTranscriptPreview(transcriptText);

  return new EmbedBuilder()
    .setTitle(`${ticketType.displayName} — Ticket #${ticket.id}`)
    .setColor(0x99aab5)
    .setDescription(preview)
    .addFields(
      { name: "Opened by", value: `<@${ticket.creatorId}>`, inline: true },
      {
        name: "Claimed by",
        value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : "*nobody*",
        inline: true,
      },
      {
        name: "Closed by",
        value: ticket.closedBy ? `<@${ticket.closedBy}>` : "*unknown*",
        inline: true,
      },
      {
        name: "Duration",
        value: ticket.closedAt != null ? formatDuration(ticket.closedAt - ticket.createdAt) : "unknown",
      }
    )
    .setFooter({ text: `${ticketType.typeKey} • ticket #${ticket.id}` })
    .setTimestamp(ticket.closedAt ?? Date.now());
}
