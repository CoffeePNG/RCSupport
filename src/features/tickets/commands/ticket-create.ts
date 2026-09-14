import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { getTicketType } from "../ticketConfigRepo";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { buildTicketDetailsModal } from "../ticketModal";
import { Command } from "../../../commands/types";

export const ticketCreateCommand: Command = {
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
    const ticketType = getTicketType(guildId, typeKey);
    if (!ticketType) {
      await interaction.reply({
        content: "Unknown ticket type. Pick one from the autocomplete list.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.showModal(buildTicketDetailsModal(ticketType));
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    await respondTicketTypeAutocomplete(interaction);
  },
};
