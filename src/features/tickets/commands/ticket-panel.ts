import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { getGuildSettings, setPanelInfo } from "../../../db/guildSettingsRepo";
import { buildPanelEditModal } from "../configHandler";
import { buildPanelContent } from "../ticketPanel";
import { Command } from "../../../commands/types";

export const ticketPanelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Post or customize the ticket creation panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("post")
        .setDescription("Post (or move/refresh) the ticket panel in a channel.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post the panel in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("customize").setDescription("Edit the panel's title and description.")
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();

    if (sub === "customize") {
      await interaction.showModal(buildPanelEditModal(guildId));
      return;
    }

    // sub === "post"
    const content = buildPanelContent(guildId);
    if (!content) {
      await interaction.reply({
        content: "No ticket types are configured yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const channelOption = interaction.options.getChannel("channel", true);
    const targetChannel = await interaction.client.channels
      .fetch(channelOption.id)
      .catch(() => null);
    if (!(targetChannel instanceof TextChannel)) {
      await interaction.reply({
        content: "That channel isn't usable.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const settings = getGuildSettings(guildId);
    let posted = null;
    if (settings.panelChannelId === channelOption.id && settings.panelMessageId) {
      const existing = await targetChannel.messages
        .fetch(settings.panelMessageId)
        .catch(() => null);
      if (existing) {
        posted = await existing.edit({ embeds: [content.embed], components: [content.row] });
      }
    }
    if (!posted) {
      posted = await targetChannel.send({ embeds: [content.embed], components: [content.row] });
    }

    setPanelInfo(guildId, channelOption.id, posted.id);

    await interaction.reply({
      content: `Ticket panel posted in <#${channelOption.id}>. Re-run this any time (e.g. after adding a ticket type) to refresh it in place.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
