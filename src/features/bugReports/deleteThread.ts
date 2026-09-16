import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ButtonInteraction, ChatInputCommandInteraction,
  ComponentType, EmbedBuilder, MessageFlags,
} from "discord.js";
import { RCSupportForum } from "./forum";

export async function confirmThreadDeletion(interaction: ChatInputCommandInteraction | ButtonInteraction, forum: RCSupportForum): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const fromButton = interaction.isButton();
  const postId = interaction.isChatInputCommand() ? interaction.options.getString("thread") ?? interaction.channelId : interaction.channelId;
  try {
    if (!/^\d{17,20}$/.test(postId)) throw new Error("Use a report thread ID, or run this command inside that report thread.");
    const target = await forum.deletionTarget(interaction.guildId!, postId, interaction.user.id, fromButton);
    if (interaction.isButton()) {
      const starter = await target.fetchStarterMessage();
      if (!starter || starter.id !== interaction.message.id || starter.author.id !== interaction.client.user?.id)
        throw new Error("Use Delete on the original report message.");
    }
    const confirmId = `rcsupport:delete:${interaction.id}`;
    const cancelId = `rcsupport:keep:${interaction.id}`;
    const message = await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(0xE06C75).setTitle("Delete report thread?")
        .setDescription(`Delete **${target.name.replace(/[\\*_`~|]/g, "")}** (<#${postId}>) and all its Discord messages?\n\nThis cannot be undone. The saved Minecraft report and history remain. This thread will not be recreated, and future report notifications to it will stop.`)],
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel("Delete thread").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel("Keep thread").setStyle(ButtonStyle.Primary),
      )], allowedMentions: { parse: [] },
    });
    let button;
    try {
      button = await message.awaitMessageComponent({ componentType: ComponentType.Button, time: 60000,
        filter: i => i.user.id === interaction.user.id && (i.customId === confirmId || i.customId === cancelId) });
    } catch {
      await interaction.editReply({ content: "Confirmation expired. Nothing was deleted.", embeds: [], components: [] }); return;
    }
    if (button.customId === cancelId) {
      await button.update({ content: "Thread kept. Nothing was deleted.", embeds: [], components: [] }); return;
    }
    // Consume this one-shot confirmation before deletion, then re-fetch permissions and the exact target.
    await button.update({ content: "Deleting the selected report thread…", embeds: [], components: [] });
    await forum.deleteReportThread(interaction.guildId!, postId, interaction.user.id, fromButton);
    // Discord may no longer allow editing an interaction whose originating thread was deleted.
    await interaction.editReply({ content: "Report thread deleted. The saved Minecraft report and history were retained.", embeds: [], components: [] }).catch(() => {});
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Could not delete this report thread.", embeds: [], components: [], allowedMentions: { parse: [] } });
  }
}
