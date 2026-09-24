import { ChannelType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../commands/types";
import { getServerStatusPanel, serverEmbeds, validateSnapshot } from "./panel";

export const serverStatusCommand: Command = {
  data: new SlashCommandBuilder().setName("server-status").setDescription("Manage the Minecraft server status panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).setDMPermission(false)
    .addSubcommand(sub => sub.setName("setup").setDescription("Create or update the automatic status panel.")
      .addChannelOption(o => o.setName("channel").setDescription("Status panel channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
      .addIntegerOption(o => o.setName("interval").setDescription("Minutes between checks (default: 120)").setMinValue(1).setMaxValue(1440)))
    .addSubcommand(sub => sub.setName("refresh").setDescription("Check configured servers and update the panel now.")),
  async execute(interaction) {
    if (!interaction.guildId || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      await interaction.reply({ content: "Only server administrators can manage the status panel.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const panel = getServerStatusPanel();
      const sub = interaction.options.getSubcommand();
      if (sub === "setup") {
        const interval = interaction.options.getInteger("interval") ?? 120;
        await panel.setup(interaction.guildId, interaction.options.getChannel("channel", true).id, interval);
        await interaction.editReply(`Status panel configured; checks run every ${interval} minutes. The panel shows whether the bridge check succeeded.`);
      } else if (sub === "refresh") {
        await panel.refresh(interaction.guildId);
        await interaction.editReply("Status check attempted and panel updated. If the bridge was unavailable, the panel says so.");
      }
    } catch (error) {
      console.error("Server status command failed:", error);
      await interaction.editReply(error instanceof Error ? error.message : "Could not update the status panel.");
    }
  },
};

export const serversCommand: Command = {
  data: new SlashCommandBuilder().setName("servers").setDescription("Privately check the Minecraft servers.").setDMPermission(false),
  async execute(interaction, forum) {
    if (!interaction.guildId) {
      await interaction.reply({ content: "Use this command in a server.", flags: MessageFlags.Ephemeral });
      return;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    let snapshot = null;
    try {
      if (!forum) throw new Error("The support bridge is not ready.");
      snapshot = validateSnapshot(await forum.api.serverStatus());
    } catch (error) { console.error("Private server status check failed:", error); }
    await interaction.editReply({ embeds: serverEmbeds(snapshot), allowedMentions: { parse: [] } });
  },
};
