import {
  ChannelType, ChatInputCommandInteraction,
  MessageFlags, PermissionFlagsBits, SlashCommandBuilder,
} from "discord.js";
import { openBugModal } from "../panel";
import { Command } from "../../../commands/types";
import { confirmThreadDeletion } from "../deleteThread";

export const BUGTHREAD_BUTTON_ID = "rcsupport:open";
export const BUGTHREAD_MODAL_ID = "rcsupport:submit";

function adminCommand(): Command {
  return {
  data: new SlashCommandBuilder()
    .setName("br")
    .setDescription("Manage bug reports and the report Forum.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("setup").setDescription("Assign the bug Forum and create missing status tags")
      .addChannelOption((option) => option.setName("channel").setDescription("Bug report Forum in this server")
        .addChannelTypes(ChannelType.GuildForum).setRequired(true)))
    .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a report thread after confirmation; retain the saved report")
      .addStringOption(option => option.setName("thread").setDescription("Report thread ID; defaults to the thread you are in")))
    .addSubcommand((sub) => sub.setName("mark-deleted").setDescription("Mark an already-missing report thread deleted; keep saved report data")
      .addStringOption(option => option.setName("thread").setDescription("Missing report thread ID").setRequired(true)))
    .addSubcommand((sub) => sub.setName("refresh").setDescription("Restore a Minecraft report's saved details in its existing post")
      .addIntegerOption((option) => option.setName("report").setDescription("Minecraft report number")
        .setMinValue(1).setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction, forum): Promise<void> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Manage Server is required.", flags: MessageFlags.Ephemeral }); return;
    }
    if (!forum) {
      await interaction.reply({ content: "The support bridge is unavailable.", flags: MessageFlags.Ephemeral }); return;
    }
    if (interaction.options.getSubcommand() === "delete") {
      await confirmThreadDeletion(interaction, forum); return;
    }
    if (interaction.options.getSubcommand() === "mark-deleted") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const id = interaction.options.getString("thread", true);
        await forum.markThreadDeleted(interaction.guildId, id, interaction.user.id);
        await interaction.editReply({ content: `Thread ${id} is marked deleted. Polling and recreation are disabled for it; report details are retained and saved history expires after 72 hours.` });
      } catch (error) {
        await interaction.editReply({ content: error instanceof Error ? error.message : "Could not mark the thread deleted.", allowedMentions: {parse:[]} });
      }
      return;
    }
    if (interaction.options.getSubcommand() === "refresh") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const id = interaction.options.getInteger("report", true);
        const postId = await forum.refreshReport(interaction.guildId, id);
        await interaction.editReply({ content: `Restored the saved details for report #${id} in <#${postId}>.` });
      } catch (error) {
        console.error("RCSupport report refresh failed:", error);
        await interaction.editReply({ content: "Could not refresh this report. Check the report number, Forum permissions, and bot logs." });
      }
      return;
    }
    const option = interaction.options.getChannel("channel", true);
    if (interaction.options.getSubcommand() === "setup") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try { await forum.setup(interaction.client, interaction.guildId, option.id); }
      catch (error) {
        await interaction.editReply({ content: error instanceof Error ? error.message : "Forum setup failed. Check the bot logs." });
        return;
      }
      const sync = forum.lastSyncError
        ? `Forum setup is saved, but report synchronization needs attention: ${forum.lastSyncError}`
        : "Report synchronization is running.";
      await interaction.editReply({ content: `Bug reports now use <#${option.id}>. Status tags and the Closed label are ready. ${sync}` });
      return;
    }

  },
  };
}

export const bugreportCommand: Command = {
  data: new SlashCommandBuilder().setName("bugreport")
    .setDescription("Report a bug using a short questionnaire.").setDMPermission(false),
  async execute(interaction, forum) {
    if (!forum) {
      await interaction.reply({ content: "The support bridge is unavailable.", flags: MessageFlags.Ephemeral });
      return;
    }
    await openBugModal(interaction, forum);
  },
};
export const brCommand = adminCommand();
