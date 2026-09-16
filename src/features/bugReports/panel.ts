import {
  LabelBuilder, StringSelectMenuBuilder, ButtonInteraction, ChatInputCommandInteraction, MessageFlags, ModalBuilder, ModalSubmitInteraction,
  PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from "discord.js";
import { BUGTHREAD_MODAL_ID } from "./commands/bugreport";
import { RCSupportForum } from "./forum";

// Mirrors RCSupportBridge/src/main/resources/wizard.yml. Keep labels and order aligned.
export const BUG_REPORT_CATEGORIES = ["Gameplay", "World / Building", "Permissions", "Other"] as const;

function canViewForum(interaction: ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction, forum: RCSupportForum): boolean {
  if (!interaction.guildId || interaction.guildId !== forum.getForum().guildId) return false;
  return forum.getForum().permissionsFor(interaction.user)?.has(PermissionFlagsBits.ViewChannel) ?? false;
}

export async function openBugModal(interaction: ButtonInteraction | ChatInputCommandInteraction, forum: RCSupportForum): Promise<void> {
  if (!canViewForum(interaction, forum)) {
    await interaction.reply({ content: "You cannot access the bug report Forum.", flags: MessageFlags.Ephemeral }); return;
  }
  const modal = new ModalBuilder().setCustomId(BUGTHREAD_MODAL_ID).setTitle("Open Bug Report");
  modal.addLabelComponents(new LabelBuilder().setLabel("Category")
    .setStringSelectMenuComponent(new StringSelectMenuBuilder().setCustomId("category")
      .setPlaceholder("Choose a category").setRequired(true).setMinValues(1).setMaxValues(1)
      .addOptions(BUG_REPORT_CATEGORIES.map(category => ({ label: category, value: category })))));
  for (const [id, label, max, required] of [
    ["summary", "Title", 100, true],
    ["description", "Description", 2000, true],
    ["steps", "Reproduction steps (optional)", 1000, false],
    ["evidence", "Evidence (optional)", 500, false],
  ] as const) {
    const input = new TextInputBuilder().setCustomId(id)
      .setStyle(id === "summary" ? TextInputStyle.Short : TextInputStyle.Paragraph)
      .setMaxLength(max).setRequired(required);
    if (required) input.setMinLength(1);
    modal.addLabelComponents(new LabelBuilder().setLabel(label).setTextInputComponent(input));
  }
  await interaction.showModal(modal);
}

export async function submitBugModal(interaction: ModalSubmitInteraction, forum: RCSupportForum): Promise<void> {
  if (!canViewForum(interaction, forum)) {
    await interaction.reply({ content: "You cannot access the bug report Forum.", flags: MessageFlags.Ephemeral }); return;
  }
  // Accept a description-only modal opened before a bot restart as well.
  const read = (id: string) => interaction.fields.fields.has(id)
    ? interaction.fields.getTextInputValue(id).trim() : "";
  const summary = read("summary"), details = read("description");
  const steps = read("steps"), expected = read("expected"), evidence = read("evidence");
  const categorized = interaction.fields.fields.has("category");
  const category = categorized ? interaction.fields.getStringSelectValues("category")[0] : undefined;
  if (categorized && (!category || !BUG_REPORT_CATEGORIES.some(value => value === category))) {
    await interaction.reply({ content: "Choose a valid bug report category.", flags: MessageFlags.Ephemeral }); return;
  }
  if (categorized && evidence) {
    let valid = false;
    try {
      const url = new URL(evidence);
      valid = /^https?:$/.test(url.protocol) && !!url.hostname && !url.username && !url.password
        && evidence.length <= 500 && !/\s/.test(evidence);
    } catch { /* Show an actionable validation message below. */ }
    if (!valid) {
      await interaction.reply({ content: "Use a single HTTP or HTTPS screenshot/video link.", flags: MessageFlags.Ephemeral }); return;
    }
  }
  const questionnaire = interaction.fields.fields.has("summary");
  if (!details || (questionnaire && !summary) || (!categorized && questionnaire && [summary, details, steps, expected].some(value => value.length < 3))) {
    await interaction.reply({ content: "Please complete every required field.", flags: MessageFlags.Ephemeral }); return;
  }
  const description = categorized ? [summary, `**Category**\n${category}`, `**Description**\n${details}`,
    ...(steps ? [`**Reproduction steps**\n${steps}`] : []),
    ...(evidence ? [`**Screenshot / video link**\n${evidence}`] : [])].join("\n\n") : questionnaire ? [summary, `**What happened**\n${details}`,
    `**Steps to reproduce**\n${steps}`, `**Expected behavior**\n${expected}`,
    ...(evidence ? [`**Evidence**\n${evidence}`] : [])].join("\n\n") : details;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let post;
  try {
    post = await forum.createNativePost(description, interaction.user.id);
  } catch (error) {
    // Do not leave a deferred submission stuck at “thinking” after Discord/API failures.
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : undefined;
    console.error("RCSupport Discord report submission failed:", error);
    const detail = code === "50013" || code === "50001"
      ? "The bot cannot access or post in the bug-report Forum. An admin needs to check its channel permissions."
      : code === "10003"
        ? "The configured bug-report Forum no longer exists. An admin needs to run /br setup."
        : "An admin needs to check the bot logs and the configured bug-report Forum.";
    await interaction.editReply({ content: `Could not finish creating your report. ${detail}${code && /^\d+$/.test(code) ? ` (Error ${code})` : ""} Check the Forum before retrying in case the post was created before the error.` });
    return;
  }
  await interaction.editReply({ content: `Report made at <#${post.id}>` });
}
