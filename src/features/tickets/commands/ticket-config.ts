import {
  AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { getTicketType, setReviewChannel, setTicketCategory, removeApplicationRole } from "../ticketConfigRepo";
import { buildConfigEditModal, ConfigField } from "../configHandler";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { Command } from "../../../commands/types";

const TYPE_OPTION_DESCRIPTION = "The ticket type to configure";

export const ticketConfigCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ticket-config")
    .setDescription("Configure per-ticket-type settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub => sub.setName("category")
      .setDescription("Set the category where new tickets of this type open.")
      .addStringOption(opt => opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true))
      .addChannelOption(opt => opt.setName("category").setDescription("Destination category")
        .addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(sub => sub.setName("clear-category")
      .setDescription("Make new tickets of this type open without a category.")
      .addStringOption(opt => opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("questions")
      .setDescription("Edit up to five questions, optionally for a specific application role.")
      .addStringOption(opt => opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true))
      .addStringOption(opt => opt.setName("role").setDescription("Role to create or edit, such as Moderator, Developer, or Modeler").setMaxLength(45)))
    .addSubcommand(sub => sub.setName("remove-role")
      .setDescription("Remove a role from this ticket type's application choices.")
      .addStringOption(opt => opt.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true))
      .addStringOption(opt => opt.setName("role").setDescription("The configured role name").setRequired(true).setMaxLength(45)))
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

    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
      await interaction.reply({ content: "You need Manage Server to configure tickets.", flags: MessageFlags.Ephemeral });
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

    if (sub === "remove-role") {
      const removed = removeApplicationRole(guildId, typeKey, interaction.options.getString("role", true));
      await interaction.reply({ content: removed ? "Application role removed. Existing tickets are unchanged." : "No application role with that name was found.", flags: MessageFlags.Ephemeral });
      return;
    }
    if (sub === "category" || sub === "clear-category") {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      let categoryId: string | null = null;
      if (sub === "category") {
        const selected = interaction.options.getChannel("category", true);
        const category = await interaction.guild?.channels.fetch(selected.id).catch(() => null);
        if (!category || category.type !== ChannelType.GuildCategory) {
          await interaction.editReply("Choose an existing category in this server.");
          return;
        }
        const me = await interaction.guild!.members.fetchMe();
        if (!category.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels])) {
          await interaction.editReply("I need View Channel and Manage Channels in that category.");
          return;
        }
        categoryId = category.id;
      }
      setTicketCategory(guildId, typeKey, categoryId);
      await interaction.editReply(categoryId
        ? `New **${ticketType.displayName}** tickets will open in <#${categoryId}>. Existing tickets are unchanged.`
        : `New **${ticketType.displayName}** tickets will open without a category.`);
      return;
    }

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
      "questions": "questions",
      "open-message": "open",
      "claim-message": "claim",
      "option-description": "optdesc",
    };
    const field = fieldBySubcommand[sub];
    if (field) {
      const role = field === "questions" ? interaction.options.getString("role")?.trim() : undefined;
      await interaction.showModal(buildConfigEditModal(field, ticketType, role || undefined));
    }
  },

  async autocomplete(interaction: AutocompleteInteraction) {
    await respondTicketTypeAutocomplete(interaction);
  },
};
