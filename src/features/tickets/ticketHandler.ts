import {
  AttachmentBuilder,
  ButtonInteraction,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalSubmitInteraction,
  OverwriteResolvable,
  PermissionFlagsBits,
  StringSelectMenuInteraction,
  TextChannel,
} from "discord.js";
import { getLeads, getTicketType } from "./ticketConfigRepo";
import {
  claimTicket,
  closeTicket,
  createTicket,
  getTicketById,
  setChannelId,
  setMessageId,
} from "./ticketRepo";
import { buildChannelName, formatLeadsMention, resolveTemplate } from "./ticketFormatter";
import {
  applyTicketStatus,
  buildCloseConfirmRow,
  buildTicketButtons,
  buildTicketEmbed,
  buildTranscriptLogEmbed,
} from "./ticketEmbeds";
import { buildTicketDetailsModal } from "./ticketModal";
import { canManageTicket } from "../../utils/permissions";
import { generateTranscript } from "../../utils/transcript";
import {
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
  TICKET_CREATE_MODAL_PREFIX,
} from "./ticketConstants";

export {
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
  TICKET_CREATE_MODAL_PREFIX,
} from "./ticketConstants";

/** Looks up a ticket and its type config from a button/modal customId's numeric suffix. */
function resolveTicketAndType(ticketId: number) {
  const ticket = getTicketById(ticketId);
  if (!ticket) return null;
  const ticketType = getTicketType(ticket.guildId, ticket.typeKey);
  if (!ticketType) return null;
  return { ticket, ticketType };
}

/** Can this user claim/close a ticket: a configured lead, a Manage Server holder, or (for close) the creator. */
function canManage(interaction: ButtonInteraction, ticketConfigId: number): boolean {
  return canManageTicket(interaction.user.id, interaction.memberPermissions, ticketConfigId);
}

/** Modal submit for /ticket create and the panel select menu: creates the private channel and the ticket row. */
export async function handleTicketCreateModal(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild) return;

  const typeKey = interaction.customId.slice(TICKET_CREATE_MODAL_PREFIX.length + 1);
  const ticketType = getTicketType(guildId, typeKey);
  if (!ticketType) {
    await interaction.reply({
      content: "This ticket type is no longer configured. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const details = interaction.fields.getTextInputValue("details");
  const leads = getLeads(ticketType.id);

  // Reserve the ticket row first so its ID is known before the channel is
  // named (channel names use the ticket ID as their suffix for easy lookup).
  const ticket = createTicket(guildId, typeKey, interaction.user.id, "");

  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
    ...leads.map((leadId) => ({
      id: leadId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  const channel = await guild.channels.create({
    name: buildChannelName(ticketType.channelPrefix, interaction.user.username, ticket.id),
    type: ChannelType.GuildText,
    permissionOverwrites: overwrites,
  });
  setChannelId(ticket.id, channel.id);

  const openMessage = resolveTemplate(ticketType.openMessage, {
    department: ticketType.department,
    leads: formatLeadsMention(leads),
    creator: `<@${interaction.user.id}>`,
  });
  const pingLine = leads.length > 0 ? leads.map((id) => `<@${id}>`).join(" ") : null;

  const message = await channel.send({
    content: [pingLine, openMessage].filter(Boolean).join("\n"),
    embeds: [buildTicketEmbed(ticket, ticketType, details, interaction.user.tag)],
    components: [buildTicketButtons(ticket.id, false, false)],
  });
  setMessageId(ticket.id, message.id);

  if (ticketType.reviewChannelId) {
    const reviewChannel = await interaction.client.channels
      .fetch(ticketType.reviewChannelId)
      .catch(() => null);
    if (reviewChannel instanceof TextChannel) {
      await reviewChannel.send(
        `New **${ticketType.displayName}** ticket opened by <@${interaction.user.id}>: <#${channel.id}>`
      );
    }
  }

  await interaction.reply({
    content: `Your ticket has been created: <#${channel.id}>`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Ticket panel's select menu: same details modal as /ticket create, for whichever type was picked. */
export async function handleTicketPanelSelect(interaction: StringSelectMenuInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const ticketType = getTicketType(guildId, interaction.values[0]);
  if (!ticketType) {
    await interaction.reply({
      content: "This ticket type is no longer configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.showModal(buildTicketDetailsModal(ticketType));
}

/** Claim button: locks the ticket to one lead (or Manage Server holder) and pings the creator. */
export async function handleTicketClaim(interaction: ButtonInteraction) {
  const ticketId = Number(interaction.customId.slice(TICKET_CLAIM_PREFIX.length));
  const found = resolveTicketAndType(ticketId);
  if (!found) {
    await interaction.reply({
      content: "Ticket not found or its type is no longer configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { ticket, ticketType } = found;

  if (ticket.status !== "open") {
    await interaction.reply({
      content: `This ticket is already ${ticket.status}.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!canManage(interaction, ticketType.id)) {
    await interaction.reply({
      content: "Only assigned leads (or a server admin) can claim this ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const claimed = claimTicket(ticketId, interaction.user.id);
  if (!claimed) return;

  const baseEmbed = interaction.message.embeds[0]
    ? EmbedBuilder.from(interaction.message.embeds[0])
    : new EmbedBuilder();
  await interaction.update({
    embeds: [applyTicketStatus(baseEmbed, claimed)],
    components: [buildTicketButtons(ticketId, true, false)],
  });

  const claimMessage = resolveTemplate(ticketType.claimMessage, {
    claimant: `<@${interaction.user.id}>`,
    department: ticketType.department,
    creator: `<@${claimed.creatorId}>`,
  });
  // Explicit creator ping so they get a notification even if the template omits {creator}.
  await interaction.followUp({ content: `<@${claimed.creatorId}> ${claimMessage}` });
}

/** Close button, step 1: asks for confirmation before anything happens. */
export async function handleTicketCloseRequest(interaction: ButtonInteraction) {
  const ticketId = Number(interaction.customId.slice(TICKET_CLOSE_PREFIX.length));
  const found = resolveTicketAndType(ticketId);
  if (!found) {
    await interaction.reply({
      content: "Ticket not found or its type is no longer configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const { ticket, ticketType } = found;

  if (ticket.status === "closed") {
    await interaction.reply({ content: "This ticket is already closed.", flags: MessageFlags.Ephemeral });
    return;
  }

  const allowed = canManage(interaction, ticketType.id) || interaction.user.id === ticket.creatorId;
  if (!allowed) {
    await interaction.reply({
      content: "You don't have permission to close this ticket.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: "Are you sure you want to close this ticket? This can't be undone.",
    components: [buildCloseConfirmRow(ticketId)],
    flags: MessageFlags.Ephemeral,
  });
}

/** Close confirmation, "Cancel": dismisses the ephemeral prompt, ticket stays open. */
export async function handleTicketCloseCancel(interaction: ButtonInteraction) {
  await interaction.update({ content: "Close cancelled.", components: [] });
}

/** Close confirmation, "Confirm": archives the transcript, marks closed, deletes the channel. */
export async function handleTicketCloseConfirm(interaction: ButtonInteraction) {
  const ticketId = Number(interaction.customId.slice(TICKET_CLOSE_CONFIRM_PREFIX.length));
  const found = resolveTicketAndType(ticketId);
  if (!found) {
    await interaction.update({ content: "Ticket not found or its type is no longer configured.", components: [] });
    return;
  }
  const { ticket, ticketType } = found;

  if (ticket.status === "closed") {
    await interaction.update({ content: "This ticket is already closed.", components: [] });
    return;
  }

  const allowed = canManage(interaction, ticketType.id) || interaction.user.id === ticket.creatorId;
  if (!allowed) {
    await interaction.update({ content: "You don't have permission to close this ticket.", components: [] });
    return;
  }

  const channel = interaction.channel;
  if (!(channel instanceof TextChannel)) return;

  const transcriptText = await generateTranscript(channel);
  const closed = closeTicket(ticketId, interaction.user.id);
  if (!closed) return;

  if (ticketType.reviewChannelId) {
    const reviewChannel = await interaction.client.channels
      .fetch(ticketType.reviewChannelId)
      .catch(() => null);
    if (reviewChannel instanceof TextChannel) {
      const attachment = new AttachmentBuilder(Buffer.from(transcriptText, "utf-8"), {
        name: `ticket-${ticketId}-transcript.txt`,
      });
      await reviewChannel.send({
        embeds: [buildTranscriptLogEmbed(closed, ticketType, transcriptText)],
        files: [attachment],
      });
    }
  }

  if (closed.messageId) {
    const originalMessage = await channel.messages.fetch(closed.messageId).catch(() => null);
    if (originalMessage) {
      const baseEmbed = originalMessage.embeds[0]
        ? EmbedBuilder.from(originalMessage.embeds[0])
        : new EmbedBuilder();
      await originalMessage
        .edit({
          embeds: [applyTicketStatus(baseEmbed, closed)],
          components: [buildTicketButtons(ticketId, true, true)],
        })
        .catch(() => null);
    }
  }

  await interaction.update({
    content: "This ticket is now closed. The channel will be deleted in 5 seconds.",
    components: [],
  });

  setTimeout(() => channel.delete().catch(() => null), 5000);
}
