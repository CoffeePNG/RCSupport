import { TicketTypeLockedError } from "./ticket";
import { withTicketLock } from "./ticketLifecycle";
import { retryTicketCleanup } from "./cleanup";
import {
  AttachmentBuilder,
  ButtonInteraction,
  ChatInputCommandInteraction,
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
  hasPendingReassignment,
  claimTicket,
  releaseTicket,
  getCloseExport,
  saveCloseExport,
  recordExportMessage,
  finishTicketClose,
  createTicket,
  discardUncreatedTicket,
  getTicketById,
  getTicketByChannel,
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
import { APPLICATION_ROLE_SELECT_PREFIX, buildTicketDetailsModal, openTicketForm, ticketQuestionId } from "./ticketModal";
import { canManageTicket } from "../../utils/permissions";
import { collectTranscript } from "../../utils/transcript";
import {
  TICKET_RELEASE_PREFIX,
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
  TICKET_CREATE_MODAL_PREFIX,
} from "./ticketConstants";

export {
  TICKET_RELEASE_PREFIX,
  TICKET_CLAIM_PREFIX,
  TICKET_CLOSE_CANCEL_PREFIX,
  TICKET_CLOSE_CONFIRM_PREFIX,
  TICKET_CLOSE_PREFIX,
  TICKET_CREATE_MODAL_PREFIX,
} from "./ticketConstants";

/** Looks up a ticket and its type config from a button/modal customId's numeric suffix. */
function resolveTicketAndType(ticketId: number, interaction: Pick<ButtonInteraction, "guildId" | "channelId">) {
  if (!Number.isSafeInteger(ticketId) || ticketId <= 0) return null;
  const ticket = getTicketById(ticketId);
  if (hasPendingReassignment(ticketId)) return null;
  if (!ticket || ticket.guildId !== interaction.guildId || ticket.channelId !== interaction.channelId) return null;
  const ticketType = getTicketType(ticket.guildId, ticket.typeKey);
  if (!ticketType) return null;
  return { ticket, ticketType };
}

/** Can this user claim/close a ticket: a configured lead, a Manage Server holder, or (for close) the creator. */
function canManage(interaction: ButtonInteraction | ChatInputCommandInteraction, ticketConfigId: number): boolean {
  return canManageTicket(interaction.user.id, interaction.memberPermissions, ticketConfigId);
}

/** Modal submit for /ticket create and the panel select menu: creates the private channel and the ticket row. */
export async function handleTicketCreateModal(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guildId || !guild) return;

  const [typeKey, roleId] = interaction.customId.slice(TICKET_CREATE_MODAL_PREFIX.length + 1).split(":");
  const ticketType = getTicketType(guildId, typeKey);
  if (!ticketType) {
    await interaction.reply({
      content: "This ticket type is no longer configured. Please try again.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (ticketType.enabled === false) {
    await interaction.reply({content:"This ticket type is locked and is not accepting new tickets.",flags:MessageFlags.Ephemeral});
    return;
  }

  const role = ticketType.applicationRoles.find(role => role.id === roleId);
  if ((roleId && !role) || (!roleId && ticketType.applicationRoles.length)) {
    await interaction.reply({ content: "Application roles have changed. Please open a new application and choose your role.", flags: MessageFlags.Ephemeral });
    return;
  }
  const questions = role?.questions ?? ticketType.questions;
  const answers: { name: string; value: string }[] = [];
  let details = "";
  try {
    if (questions.length) {
      questions.forEach((question, index) => {
        const value = interaction.fields.getTextInputValue(ticketQuestionId(questions, index)).trim();
        if (!value || value.length > 1000) throw new Error("Invalid answer");
        answers.push({ name: question, value });
      });
    } else {
      details = interaction.fields.getTextInputValue("details").trim();
      if (!details || details.length > 1000) throw new Error("Invalid answer");
    }
  } catch {
    await interaction.reply({ content: "Please answer every question. If the questions changed while your form was open, open a new application and try again.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (ticketType.categoryId) {
    const category = await guild.channels.fetch(ticketType.categoryId).catch(() => null);
    const me = await guild.members.fetchMe();
    if (!category || category.type !== ChannelType.GuildCategory ||
        !category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
      await interaction.editReply("The configured ticket category is unavailable. Please ask staff to update /ticket-config category.");
      return;
    }
  }
  const leads = getLeads(ticketType.id);

  // Reserve the ticket row first so its ID is known before the channel is
  // named (channel names use the ticket ID as their suffix for easy lookup).
  const submissionText = [
    role ? `Application role: ${role.name}` : null,
    ...answers.map(answer => `${answer.name}\n${answer.value}`),
    details || null,
  ].filter(Boolean).join("\n\n");
  let ticket;
  try {
    ticket = createTicket(guildId, typeKey, interaction.user.id, "", submissionText);
  } catch (error) {
    console.error("Could not reserve ticket:", error);
    await interaction.editReply(error instanceof TicketTypeLockedError ? error.message : "Could not reserve your ticket. Please try again or contact staff.");
    return;
  }

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

  let channel: TextChannel;
  try {
    channel = await guild.channels.create({
      name: buildChannelName(ticketType.channelPrefix, interaction.user.username, ticket.id),
      type: ChannelType.GuildText,
      parent: ticketType.categoryId ?? undefined,
      permissionOverwrites: overwrites,
    });
  } catch (error) {
    discardUncreatedTicket(ticket.id);
    console.error("Could not create ticket channel:", error);
    await interaction.editReply("Could not create your ticket. Ask staff to check the category capacity and my channel permissions, then try again.");
    return;
  }
  setChannelId(ticket.id, channel.id);

  const openMessage = resolveTemplate(ticketType.openMessage, {
    department: ticketType.department,
    leads: formatLeadsMention(leads),
    creator: `<@${interaction.user.id}>`,
  });
  const pingLine = leads.length > 0 ? leads.map((id) => `<@${id}>`).join(" ") : null;

  let message;
  try {
    message = await channel.send({
      content: [pingLine, openMessage].filter(Boolean).join("\n"),
      embeds: [buildTicketEmbed(ticket, ticketType, answers.length ? answers : details, interaction.user.tag, role?.name)],
      components: [buildTicketButtons(ticket.id, false, false)],
    });
  } catch (error) {
    console.error("Could not post ticket questionnaire:", error);
    await interaction.editReply(`Your ticket channel was created at <#${channel.id}>, but I could not post your answers. Please contact staff there and resend your answers.`);
    return;
  }
  setMessageId(ticket.id, message.id);

  if (ticketType.reviewChannelId) {
    const reviewChannel = await interaction.client.channels
      .fetch(ticketType.reviewChannelId)
      .catch(() => null);
    if (reviewChannel instanceof TextChannel) {
      await reviewChannel.send(
        `New **${ticketType.displayName}** ticket opened by <@${interaction.user.id}>: <#${channel.id}>`
      ).catch(error => console.error("Could not post ticket review notice:", error));
    }
  }

  await interaction.editReply({ content: `Your ticket has been created: <#${channel.id}>` });
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

  await openTicketForm(interaction, ticketType);
}

/** The private role selector opens exactly that role's configured questionnaire. */
export async function handleApplicationRoleSelect(interaction: StringSelectMenuInteraction) {
  if (!interaction.guildId) return;
  const typeKey = interaction.customId.slice(APPLICATION_ROLE_SELECT_PREFIX.length);
  const ticketType = getTicketType(interaction.guildId, typeKey);
  const role = ticketType?.applicationRoles.find(role => role.id === interaction.values[0]);
  if (ticketType?.enabled === false) {
    await interaction.reply({content:"This ticket type is locked and is not accepting new tickets.",flags:MessageFlags.Ephemeral});
    return;
  }
  if (!ticketType || !role) {
    await interaction.reply({ content: "That application role is no longer available. Please open a new application.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.showModal(buildTicketDetailsModal(ticketType, role));
}

/** Persisted status is authoritative even if updating the Discord controls fails. */
async function updateTicketControls(interaction: ButtonInteraction | ChatInputCommandInteraction, ticket: import("./ticket").Ticket): Promise<void> {
  const channel = interaction.channel;
  if (!(channel instanceof TextChannel) || !ticket.messageId) return;
  const message = await channel.messages.fetch(ticket.messageId);
  const embed = message.embeds[0] ? EmbedBuilder.from(message.embeds[0]) : new EmbedBuilder();
  await message.edit({
    embeds: [applyTicketStatus(embed, ticket)],
    components: [buildTicketButtons(ticket.id, ticket.status !== "open", ticket.status === "closed")],
  });
}

export async function changeTicketClaim(interaction: ButtonInteraction | ChatInputCommandInteraction, release: boolean, id?: number): Promise<void> {
  const prefix = release ? TICKET_RELEASE_PREFIX : TICKET_CLAIM_PREFIX;
  const ticketId = id ?? Number("customId" in interaction ? interaction.customId.slice(prefix.length) : NaN);
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await withTicketLock(ticketId, async () => {
    const found = resolveTicketAndType(ticketId, interaction);
    if (!found) { await interaction.editReply("Ticket not found in this channel."); return; }
    const { ticket, ticketType } = found;
    const manager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
    const authorized = release ? manager || (ticket.claimedBy === interaction.user.id && canManage(interaction, ticketType.id))
      : canManage(interaction, ticketType.id);
    if (!authorized) {
      await interaction.editReply(release ? "Only the current lead or a server manager can release this claim." : "Only assigned leads or a server manager can claim this ticket.");
      return;
    }
    const changed = release
      ? ticket.status === "claimed" && ticket.claimedBy ? releaseTicket(ticket.id, ticket.claimedBy) : null
      : claimTicket(ticket.id, interaction.user.id);
    if (!changed) {
      await updateTicketControls(interaction, ticket).catch(error => console.error("Could not refresh stale ticket controls:", error));
      await interaction.editReply(`This ticket is already ${ticket.status}. Use /ticket claim or /ticket release in this channel if its buttons are out of date.`);
      return;
    }
    let controlsUpdated = true;
    try { await updateTicketControls(interaction, changed); }
    catch (error) { controlsUpdated = false; console.error("Could not refresh ticket ownership controls:", error); }
    await interaction.editReply((release ? "Claim released. Another lead can claim this ticket." : "You claimed this ticket.") +
      (controlsUpdated ? "" : " The saved ownership changed, but the controls could not be refreshed. Use /ticket claim or /ticket release in this channel."));
    if (!release) {
      const content = resolveTemplate(ticketType.claimMessage, {
        claimant: `<@${interaction.user.id}>`, department: ticketType.department, creator: `<@${changed.creatorId}>`,
      });
      await interaction.followUp({ content: `<@${changed.creatorId}> ${content}`, allowedMentions: { users: [changed.creatorId], parse: [] } })
        .catch(error => console.error("Could not post claim notice:", error));
    }
  });
}

export function handleTicketClaim(interaction: ButtonInteraction): Promise<void> { return changeTicketClaim(interaction, false); }
export function handleTicketRelease(interaction: ButtonInteraction): Promise<void> { return changeTicketClaim(interaction, true); }

/** Close request never changes the ticket; authorization is checked again on confirmation. */
export async function handleTicketCloseRequest(interaction: ButtonInteraction) {
  const ticketId = Number(interaction.customId.slice(TICKET_CLOSE_PREFIX.length));
  const found = resolveTicketAndType(ticketId, interaction);
  if (!found) { await interaction.reply({ content: "Ticket not found in this channel.", flags: MessageFlags.Ephemeral }); return; }
  const { ticket, ticketType } = found;
  if (ticket.status === "closed") {
    await interaction.reply({ content: "This ticket is closed. Pending channel cleanup retries automatically.", flags: MessageFlags.Ephemeral }); return;
  }
  if (!canManage(interaction, ticketType.id) && interaction.user.id !== ticket.creatorId) {
    await interaction.reply({ content: "You don't have permission to close this ticket.", flags: MessageFlags.Ephemeral }); return;
  }
  await interaction.reply({
    content: "Close this ticket? Its transcript will be saved before the channel is deleted. This can't be undone.",
    components: [buildCloseConfirmRow(ticketId)], flags: MessageFlags.Ephemeral,
  });
}
export async function handleTicketCloseCancel(interaction: ButtonInteraction) {
  await interaction.update({ content: "Close cancelled.", components: [] });
}

/** Export before closing; failure leaves the ticket active and its channel intact. */
export async function handleTicketCloseConfirm(interaction: ButtonInteraction) {
  const ticketId = Number(interaction.customId.slice(TICKET_CLOSE_CONFIRM_PREFIX.length));
  await interaction.deferUpdate();
  await withTicketLock(ticketId, async () => {
    const found = resolveTicketAndType(ticketId, interaction);
    if (!found) { await interaction.editReply({ content: "Ticket not found in this channel.", components: [] }); return; }
    const { ticket, ticketType } = found;
    if (ticket.status === "closed") {
      await interaction.editReply({ content: "This ticket is already closed. Pending channel cleanup retries automatically.", components: [] }); return;
    }
    if (!canManage(interaction, ticketType.id) && interaction.user.id !== ticket.creatorId) {
      await interaction.editReply({ content: "You don't have permission to close this ticket.", components: [] }); return;
    }
    const channel = interaction.channel;
    if (!(channel instanceof TextChannel)) { await interaction.editReply("Ticket channel is unavailable."); return; }
    let finalized = false;
    try {
      // Re-capture on a failed attempt so messages added since then are not omitted.
      const conversation = await collectTranscript(channel, { limit: 10_000 });
      if (conversation.truncated) throw new Error("This ticket exceeds the 10,000-message automatic archive limit. Staff must archive it manually; the channel has been left open.");
      const transcript = ticket.submissionText
        ? `Original submission\n\n${ticket.submissionText}\n\nConversation\n\n${conversation.text}` : conversation.text;
      const previous = getCloseExport(ticketId);
      // Reuse a confirmed export only when both its contents and destination still match.
      const reuse = previous?.transcript === transcript && previous.review_channel_id === ticketType.reviewChannelId && previous.review_message_id;
      if (!reuse) saveCloseExport(ticketId, transcript, ticketType.reviewChannelId, interaction.user.id);
      if (ticketType.reviewChannelId) {
        if (getTicketByChannel(ticketType.reviewChannelId)) throw new Error("The archive destination cannot be a ticket channel. Staff must update /ticket-config review-channel.");
        const review = await interaction.client.channels.fetch(ticketType.reviewChannelId);
        if (!(review instanceof TextChannel) || review.guildId !== ticket.guildId) throw new Error("The configured review channel is unavailable in this server. Staff must update /ticket-config review-channel.");
        let delivered = false;
        if (reuse) {
          try { delivered = !!(await review.messages.fetch(reuse)); }
          catch (error) { if ((error as {code?:number}).code !== 10008) throw error; }
        }
        if (!delivered) {
          if (Buffer.byteLength(transcript, "utf8") > 7_500_000) throw new Error("The saved transcript is too large to attach. Staff must archive it manually; the channel has been left open.");
          const closing = { ...ticket, status: "closed" as const, closedBy: interaction.user.id, closedAt: Date.now() };
          const message = await review.send({
            embeds: [buildTranscriptLogEmbed(closing, ticketType, transcript)],
            files: [new AttachmentBuilder(Buffer.from(transcript, "utf8"), { name: `ticket-${ticketId}-transcript.txt` })],
            allowedMentions: { parse: [] },
          });
          recordExportMessage(ticketId, message.id);
        }
      }
      const closed = finishTicketClose(ticketId, interaction.user.id);
      finalized = true;
      await updateTicketControls(interaction, closed).catch(error => console.error("Could not refresh closed ticket controls:", error));
      await interaction.editReply({ content: "Transcript saved. This ticket is closed; channel deletion starts in 5 seconds and retries automatically if needed.", components: [] });
      const timer = setTimeout(() => { void retryTicketCleanup(interaction.client).catch(error => console.error("Ticket cleanup failed:", error)); }, 5000);
      timer.unref();
    } catch (error) {
      console.error("Ticket closure failed:", error);
      if (finalized) {
        await interaction.editReply({ content: "The transcript was saved and the ticket is closed. Channel cleanup will retry automatically.", components: [] });
        return;
      }
      const message = (error as Error).message;
      await interaction.editReply({ content: `Could not complete closure: ${message.slice(0,1400)}\nNo channel was deleted by this attempt. Fix the issue and press Confirm Close again.`, components: [buildCloseConfirmRow(ticketId)], allowedMentions: { parse: [] } });
    }
  });
}
