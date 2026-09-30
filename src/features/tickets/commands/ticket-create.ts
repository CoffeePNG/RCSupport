import { executeWorkflowCommand, workflowSubcommands } from "../workflowCommands";
import { getTicketByChannel, listTicketQueue } from "../ticketRepo";
import { changeTicketClaim } from "../ticketHandler";
import { ticketModule } from "../../../modules/catalog";
import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  MessageFlags,
  PermissionFlagsBits,
  EmbedBuilder,
} from "discord.js";
import { getTicketType, getTicketTypes, isLead } from "../ticketConfigRepo";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { openTicketForm } from "../ticketModal";
import { Command } from "../../../commands/types";

export const ticketCreateCommand: Command = {
  module: ticketModule,
  data: new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a ticket (application, bug report, appeal, or help request).")
    .addSubcommand((sub) =>
      sub
        .setName("create")
        .setDescription("Open a new ticket.")
        .addStringOption((opt) =>
          opt
            .setName("type")
            .setDescription("The kind of ticket to open")
            .setRequired(true)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub => sub.setName("queue").setDescription("View the active tickets you manage, oldest first.")
      .addStringOption(option => option.setName("status").setDescription("Filter the queue").addChoices(
        {name:"All active",value:"all"},{name:"Unclaimed",value:"open"},{name:"Claimed",value:"claimed"},{name:"Claimed by me",value:"mine"}))
      .addStringOption(option => option.setName("type").setDescription("Filter by ticket type").setAutocomplete(true))
      .addIntegerOption(option => option.setName("page").setDescription("Queue page").setMinValue(1)))
    .addSubcommand(sub => sub.setName("claim").setDescription("Claim the ticket in this channel."))
    .addSubcommand(sub => sub.setName("release").setDescription("Release your claim on the ticket in this channel."))
    .addSubcommand(workflowSubcommands[0])
    .addSubcommand(workflowSubcommands[1])
    .addSubcommand(workflowSubcommands[2])
    .addSubcommand(workflowSubcommands[3])
    .addSubcommand(workflowSubcommands[4]),

  async execute(interaction: ChatInputCommandInteraction) {
    const guildId = interaction.guildId;
    if (!guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (await executeWorkflowCommand(interaction)) return;
    const sub = interaction.options.getSubcommand();
    if (sub === "claim" || sub === "release") {
      const ticket = interaction.channelId ? getTicketByChannel(interaction.channelId) : null;
      if (!ticket || ticket.guildId !== guildId) {
        await interaction.reply({content:"Run this command inside a ticket channel.",flags:MessageFlags.Ephemeral}); return;
      }
      await changeTicketClaim(interaction, sub === "release", ticket.id); return;
    }
    if (sub === "queue") {
      const manager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      if (!manager && !getTicketTypes(guildId).some(type => isLead(type.id,interaction.user.id))) {
        await interaction.reply({content:"Only ticket leads or server managers can view the queue.",flags:MessageFlags.Ephemeral}); return;
      }
      const status = (interaction.options.getString("status") ?? "all") as "all"|"open"|"claimed"|"mine";
      const page = interaction.options.getInteger("page") ?? 1;
      const result = listTicketQueue({guildId,userId:interaction.user.id,manager,status,page,typeKey:interaction.options.getString("type") ?? undefined});
      const embed = new EmbedBuilder().setTitle("Ticket Queue").setColor(0x5865f2)
        .setDescription(result.tickets.length ? result.tickets.map(ticket =>
          `**#${ticket.id}** · <#${ticket.channelId}> · ${ticket.claimedBy ? `Claimed by <@${ticket.claimedBy}>` : "Unclaimed"}\nOpened <t:${Math.floor(ticket.createdAt/1000)}:R> by <@${ticket.creatorId}>`).join("\n\n")
          : "No matching tickets on this page.")
        .setFooter({text:`Page ${page} of ${Math.max(1,Math.ceil(result.total/10))} • ${result.total} matching tickets`});
      await interaction.reply({embeds:[embed],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}}); return;
    }
    const typeKey = interaction.options.getString("type", true);
    const ticketType = getTicketType(guildId, typeKey);
    if (!ticketType) {
      await interaction.reply({
        content: "Unknown ticket type. Pick one from the autocomplete list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await openTicketForm(interaction, ticketType);
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    if (["queue", "history", "reassign"].includes(interaction.options.getSubcommand())) {
      const manager = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false;
      const query = interaction.options.getFocused().toLowerCase();
      const types = interaction.guildId ? getTicketTypes(interaction.guildId).filter(type =>
        (manager || isLead(type.id,interaction.user.id)) && `${type.displayName} ${type.typeKey}`.toLowerCase().includes(query)) : [];
      await interaction.respond(types.slice(0,25).map(type => ({name:type.displayName.slice(0,100),value:type.typeKey}))); return;
    }
    await respondTicketTypeAutocomplete(interaction, false);
  },
};
