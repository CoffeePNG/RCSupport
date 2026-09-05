import {
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import {
  getGuildSettings,
  setArchiveLogChannel,
  setModLogChannel,
} from "../../db/guildSettingsRepo";
import { Command } from "../types";

export const modConfigCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("mod-config")
    .setDescription("Configure moderation settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("log-channel")
        .setDescription("Set the channel moderation actions are logged to.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The mod-log channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("archive-log")
        .setDescription("Set the channel /archive exports are logged to.")
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The archive-log channel (defaults to the mod-log channel)")
            .addChannelTypes(ChannelType.GuildText)
        )
        .addBooleanOption((opt) =>
          opt.setName("disable").setDescription("Stop logging /archive exports entirely")
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

    const sub = interaction.options.getSubcommand();
    if (sub === "log-channel") {
      const channel = interaction.options.getChannel("channel", true);
      setModLogChannel(guildId, channel.id);
      await interaction.reply({
        content: `Mod-log channel set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "archive-log") {
      const channel = interaction.options.getChannel("channel");
      const disable = interaction.options.getBoolean("disable");

      if (channel && disable) {
        await interaction.reply({
          content: "Pick one: a channel to log to, or `disable` to log nowhere.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (channel) {
        setArchiveLogChannel(guildId, channel.id);
        await interaction.reply({
          content: `\`/archive\` exports will be logged to <#${channel.id}>.`,
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (disable) {
        setArchiveLogChannel(guildId, null);
        await interaction.reply({
          content:
            "`/archive` exports will no longer be logged. Anyone who can read a channel can export its history with no record of it.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      // Neither option given: report where exports are going today.
      const settings = getGuildSettings(guildId);
      const content = settings.archiveLogDisabled
        ? "`/archive` logging is off. Pass `channel` to turn it back on."
        : settings.archiveLogChannelId
          ? `\`/archive\` exports are logged to <#${settings.archiveLogChannelId}>.`
          : settings.modLogChannelId
            ? `\`/archive\` exports are logged to the mod-log channel, <#${settings.modLogChannelId}>. Pass \`channel\` to send them somewhere else.`
            : "`/archive` exports aren't being logged: no archive-log or mod-log channel is set.";
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    }
  },
};
