import { ticketModule } from "../../../modules/catalog";
import {
  ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { getLeads, getTicketTypes } from "../ticketConfigRepo";
import { getCounts } from "../ticketRepo";
import { Command } from "../../../commands/types";

export const staffStatusCommand: Command = {
  module: ticketModule,
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName("staff-status")
    .setDescription("View all ticket types, their leads, and live ticket counts.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const types = getTicketTypes(guildId);
    if (types.length === 0) {
      await interaction.reply({
        content: "No ticket types are configured yet.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embeds: EmbedBuilder[] = [];
    let embed = new EmbedBuilder().setTitle("Ticket System Status").setColor(0x5865f2);

    for (const type of types) {
      const leads = getLeads(type.id);
      const counts = getCounts(guildId, type.typeKey);
      if ((embed.data.fields?.length ?? 0) >= 5) {
        embeds.push(embed);
        embed = new EmbedBuilder().setTitle("Ticket System Status — continued").setColor(0x5865f2);
      }
      embed.addFields({
        name: `${type.displayName} — ${type.department}`.slice(0,160),
        value: [
          `New tickets: **${type.enabled === false ? "Locked" : "Accepting"}**`,
          `Leads: ${leads.length > 0 ? leads.map((id) => `<@${id}>`).join(", ") : "*none assigned*"}`,
          `Open: **${counts.open}** · Claimed: **${counts.claimed}** · Closed: **${counts.closed}**`,
          `Review channel: ${type.reviewChannelId ? `<#${type.reviewChannelId}>` : "*not set*"}`,
        ].join("\n").slice(0,1024),
      });
    }

    embeds.push(embed);
    await interaction.reply({ embeds: [embeds[0]], flags: MessageFlags.Ephemeral, allowedMentions:{parse:[]} });
    for (const page of embeds.slice(1)) await interaction.followUp({embeds:[page],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}});
  },
};
