import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction,
  EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from "discord.js";
import { db } from "../../../db/connect";
import { Command } from "../../../commands/types";
import { confirmThreadDeletion } from "../deleteThread";

export const BUGTHREAD_BUTTON_ID = "rcsupport:open";
export const BUGTHREAD_MODAL_ID = "rcsupport:submit";

function panelCommand(name: "bugreport" | "br"): Command {
  return {
  data: new SlashCommandBuilder()
    .setName(name)
    .setDescription("Post the staff bug-report panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("setup").setDescription("Assign the bug Forum and create missing status tags")
      .addChannelOption((option) => option.setName("channel").setDescription("Bug report Forum in this server")
        .addChannelTypes(ChannelType.GuildForum).setRequired(true)))
    .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a report thread after confirmation; retain the saved report")
      .addStringOption(option => option.setName("thread").setDescription("Report thread ID; defaults to the thread you are in")))
    .addSubcommand((sub) => sub.setName("refresh").setDescription("Restore a Minecraft report's saved details in its existing post")
      .addIntegerOption((option) => option.setName("report").setDescription("Minecraft report number")
        .setMinValue(1).setRequired(true)))
    .addSubcommand((sub) => sub.setName("post").setDescription("Post or refresh the panel")
      .addChannelOption((option) => option.setName("channel").setDescription("Staff channel for the panel")
        .addChannelTypes(ChannelType.GuildText).setRequired(true))),
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
    if (forum.getForum().guildId !== interaction.guildId) {
      await interaction.reply({ content: "Post the panel in the server containing the configured bug Forum.", flags: MessageFlags.Ephemeral }); return;
    }
    const channel = await interaction.client.channels.fetch(option.id).catch(() => null);
    if (!(channel instanceof TextChannel) || channel.guildId !== interaction.guildId) {
      await interaction.reply({ content: "Choose a text channel in this server.", flags: MessageFlags.Ephemeral }); return;
    }
    const embed = new EmbedBuilder().setTitle("Staff Bug Reports")
      .setDescription("Open a bug report in the staff Forum channel.");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(BUGTHREAD_BUTTON_ID).setLabel("Open Bug Report").setStyle(ButtonStyle.Success));
    const previous = db.prepare("SELECT channel_id, message_id FROM rcsupport_panel WHERE guild_id = ?")
      .get(interaction.guildId) as { channel_id: string; message_id: string } | undefined;
    let posted;
    if (previous?.channel_id === channel.id) {
      const existing = await channel.messages.fetch(previous.message_id).catch(() => null);
      if (existing) posted = await existing.edit({ embeds: [embed], components: [row] });
    }
    if (!posted) posted = await channel.send({ embeds: [embed], components: [row] });
    db.prepare("INSERT INTO rcsupport_panel (guild_id, channel_id, message_id) VALUES (?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id")
      .run(interaction.guildId, channel.id, posted.id);
    await interaction.reply({ content: `Bug report panel posted in <#${channel.id}>.`, flags: MessageFlags.Ephemeral });
  },
  };
}

export const bugreportCommand = panelCommand("bugreport");
export const brCommand = panelCommand("br");
