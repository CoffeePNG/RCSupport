import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { addLead, getTicketType, removeLead } from "../ticketConfigRepo";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { Command } from "../../../commands/types";

export const staffAssignCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("staff-assign")
    .setDescription("Add or remove a lead for a ticket type.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((opt) =>
      opt
        .setName("type")
        .setDescription("The ticket type to manage leads for")
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption((opt) =>
      opt
        .setName("action")
        .setDescription("Add or remove")
        .setRequired(true)
        .addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" })
    )
    .addUserOption((opt) =>
      opt.setName("user").setDescription("The user to add/remove as a lead").setRequired(true)
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

    const typeKey = interaction.options.getString("type", true);
    const action = interaction.options.getString("action", true);
    const user = interaction.options.getUser("user", true);

    const ticketType = getTicketType(guildId, typeKey);
    if (!ticketType) {
      await interaction.reply({
        content: "Unknown ticket type. Pick one from the autocomplete list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (action === "add") {
      const added = addLead(ticketType.id, user.id);
      await interaction.reply({
        content: added
          ? `${user.tag} is now a lead for **${ticketType.displayName}**.`
          : `${user.tag} is already a lead for **${ticketType.displayName}**.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const removed = removeLead(ticketType.id, user.id);
    await interaction.reply({
      content: removed
        ? `${user.tag} is no longer a lead for **${ticketType.displayName}**.`
        : `${user.tag} wasn't a lead for **${ticketType.displayName}**.`,
      flags: MessageFlags.Ephemeral,
    });
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    await respondTicketTypeAutocomplete(interaction);
  },
};
