import {
  AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { getTicketType, setReviewChannel } from "../ticketConfigRepo";
import { buildConfigEditModal, ConfigField } from "../configHandler";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { Command } from "../../../commands/types";

const TYPE_OPTION_DESCRIPTION = "The ticket type to configure";

export const ticketConfigCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ticket-config")
    .setDescription("Configure per-ticket-type settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub
        .setName("review-channel")
        .setDescription("Set the channel a ticket type's new-ticket notices and transcripts go to.")
        .addStringOption((opt) =>
          opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)
        )
        .addChannelOption((opt) =>
          opt
            .setName("channel")
            .setDescription("The review/archive channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("open-message")
        .setDescription("Edit the message posted when a ticket of this type opens.")
        .addStringOption((opt) =>
          opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("claim-message")
        .setDescription("Edit the message posted when a ticket of this type is claimed.")
        .addStringOption((opt) =>
          opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("option-description")
        .setDescription("Edit the blurb shown under this type in the ticket panel dropdown.")
        .addStringOption((opt) =>
          opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)
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

    const sub = interaction.options.getSubcommand();

    if (sub === "review-channel") {
      const channel = interaction.options.getChannel("channel", true);
      setReviewChannel(guildId, typeKey, channel.id);
      await interaction.reply({
        content: `Review/archive channel for **${ticketType.displayName}** set to <#${channel.id}>.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // open-message, claim-message, and option-description all edit multi-line/long text,
    // so they're edited via a pre-filled modal rather than a slash-command option.
    const fieldBySubcommand: Record<string, ConfigField> = {
      "open-message": "open",
      "claim-message": "claim",
      "option-description": "optdesc",
    };
    const field = fieldBySubcommand[sub];
    if (field) {
      await interaction.showModal(buildConfigEditModal(field, ticketType));
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    await respondTicketTypeAutocomplete(interaction);
  },
};
