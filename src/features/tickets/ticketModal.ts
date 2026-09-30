import { createHash } from "node:crypto";
import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  StringSelectMenuBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { TICKET_CREATE_MODAL_PREFIX } from "./ticketConstants";
import { ApplicationRole, TicketTypeConfig } from "./ticket";

export function ticketQuestionId(questions: string[], index: number): string {
  // Detect edits while an applicant has the form open; never relabel old answers.
  const revision = createHash("sha256").update(JSON.stringify(questions)).digest("hex").slice(0, 16);
  return `question_${revision}_${index}`;
}

export function buildTicketDetailsModal(ticketType: TicketTypeConfig, role?: ApplicationRole): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${TICKET_CREATE_MODAL_PREFIX}:${ticketType.typeKey}${role ? `:${role.id}` : ""}`)
    .setTitle((role ? `Apply: ${role.name}` : ticketType.displayName).slice(0, 45));

  const questions = role?.questions ?? ticketType.questions;
  if (questions.length) {
    questions.forEach((question, index) => {
      modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId(ticketQuestionId(questions, index))
          .setLabel(question).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000)
      ));
    });
    return modal;
  }

  const details = new TextInputBuilder()
    .setCustomId("details")
    .setLabel("What's this about?")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(details));
  return modal;
}

export const APPLICATION_ROLE_SELECT_PREFIX = "ticket_application_role:";

export async function openTicketForm(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  ticketType: TicketTypeConfig
): Promise<void> {
  if (ticketType.enabled === false) {
    await interaction.reply({content:"This ticket type is locked and is not accepting new tickets.",flags:MessageFlags.Ephemeral});
    return;
  }
  if (!ticketType.applicationRoles.length) {
    await interaction.showModal(buildTicketDetailsModal(ticketType));
    return;
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(`${APPLICATION_ROLE_SELECT_PREFIX}${ticketType.typeKey}`)
    .setPlaceholder("Which role are you applying for?")
    .addOptions(ticketType.applicationRoles.map(role => ({ label: role.name, value: role.id })));
  await interaction.reply({
    content: "Choose the role you want to apply for to see its questions.",
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
    flags: MessageFlags.Ephemeral,
  });
}
