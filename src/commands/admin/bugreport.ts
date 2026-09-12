import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, ChatInputCommandInteraction,
  EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder, TextChannel,
} from "discord.js";
import { db } from "../../db/connect";
import { Command } from "../types";

export const BUGTHREAD_BUTTON_ID = "rcsupport:open";
export const BUGTHREAD_MODAL_ID = "rcsupport:submit";

function panelCommand(name: "bugreport" | "br"): Command {
  return {
  data: new SlashCommandBuilder()
    .setName(name)
    .setDescription("Post the staff bug-report panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) => sub.setName("post").setDescription("Post or refresh the panel")
      .addChannelOption((option) => option.setName("channel").setDescription("Staff channel for the panel")
        .addChannelTypes(ChannelType.GuildText).setRequired(true))),
  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "Manage Server is required.", flags: MessageFlags.Ephemeral }); return;
    }
    const option = interaction.options.getChannel("channel", true);
    const channel = await interaction.client.channels.fetch(option.id).catch(() => null);
    if (!(channel instanceof TextChannel) || channel.guildId !== interaction.guildId) {
      await interaction.reply({ content: "Choose a text channel in this server.", flags: MessageFlags.Ephemeral }); return;
    }
    const embed = new EmbedBuilder().setTitle("Staff Bug Reports")
      .setDescription("Open a bug report in the staff Forum channel.");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(BUGTHREAD_BUTTON_ID).setLabel("Open Bug Report").setStyle(ButtonStyle.Primary));
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
