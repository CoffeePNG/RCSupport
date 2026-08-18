import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextChannel,
} from "discord.js";
import { getGuildSettings, setTodoPanelInfo } from "../../db/guildSettingsRepo";
import { buildTodoPanelContent } from "../../utils/todoPanel";
import { Command } from "../types";

export const todoPanelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("todo-panel")
    .setDescription("Post or move the shared to-do list panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("post")
        .setDescription("Post (or move/refresh) the to-do panel in a channel.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("Channel to post the panel in")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
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

    const content = buildTodoPanelContent(guildId);
    const settings = getGuildSettings(guildId);
    let posted = null;
    if (settings.todoPanelChannelId === channelOption.id && settings.todoPanelMessageId) {
      const existing = await targetChannel.messages
        .fetch(settings.todoPanelMessageId)
        .catch(() => null);
      if (existing) {
        posted = await existing.edit({ embeds: [content.embed], components: [content.row] });
      }
    }
    if (!posted) {
      posted = await targetChannel.send({ embeds: [content.embed], components: [content.row] });
    }

    setTodoPanelInfo(guildId, channelOption.id, posted.id);

    await interaction.reply({
      content: `To-do panel posted in <#${channelOption.id}>. Re-run this any time (e.g. after moving channels) to refresh it in place.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
