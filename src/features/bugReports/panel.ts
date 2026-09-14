import {
  ActionRowBuilder, ButtonInteraction, MessageFlags, ModalBuilder, ModalSubmitInteraction,
  PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { BUGTHREAD_MODAL_ID } from "./commands/bugreport";
import { RCSupportForum } from "./forum";

function canViewForum(interaction: ButtonInteraction | ModalSubmitInteraction, forum: RCSupportForum): boolean {
  if (!interaction.guildId || interaction.guildId !== forum.getForum().guildId) return false;
  return forum.getForum().permissionsFor(interaction.user)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

export async function openBugModal(interaction: ButtonInteraction, forum: RCSupportForum): Promise<void> {
  if (!canViewForum(interaction, forum)) {
    await interaction.reply({ content: "You cannot access the bug report Forum.", flags: MessageFlags.Ephemeral }); return;
  }
  const modal = new ModalBuilder().setCustomId(BUGTHREAD_MODAL_ID).setTitle("Open Bug Report");
  const input = new TextInputBuilder().setCustomId("description")
    .setLabel("Short description").setStyle(TextInputStyle.Paragraph)
    .setMinLength(3).setMaxLength(2000).setRequired(true);
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

export async function submitBugModal(interaction: ModalSubmitInteraction, forum: RCSupportForum): Promise<void> {
  if (!canViewForum(interaction, forum)) {
    await interaction.reply({ content: "You cannot access the bug report Forum.", flags: MessageFlags.Ephemeral }); return;
  }
  const description = interaction.fields.getTextInputValue("description").trim();
  if (!description) {
    await interaction.reply({ content: "Description cannot be empty.", flags: MessageFlags.Ephemeral }); return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const post = await forum.createNativePost(description, interaction.user.id);
  await interaction.editReply({ content: `Bug report created: <#${post.id}>` });
}
