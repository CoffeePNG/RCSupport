import { notificationCommand, remindersSubcommand } from "../workflowCommands";
import { refreshPostedPanel } from "../ticketPanel";
import { getTicketByChannel } from "../ticketRepo";
import { ticketConfigSummary, checkTicketConfiguration } from "../configInspection";
import { ticketModule } from "../../../modules/catalog";
import {
  AutocompleteInteraction,
  ChannelType,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  MessageFlags,
} from "discord.js";
import { createCustomTicketType, setTicketTypeEnabled, getTicketType, setReviewChannel, setTicketCategory, removeApplicationRole } from "../ticketConfigRepo";
import { buildConfigEditModal, ConfigField } from "../configHandler";
import { respondTicketTypeAutocomplete } from "../ticketTypeAutocomplete";
import { Command } from "../../../commands/types";

const TYPE_OPTION_DESCRIPTION = "The ticket type to configure";

export const ticketConfigCommand: Command = {
  module: ticketModule,
  requiredPermissions: PermissionFlagsBits.ManageGuild,
  data: new SlashCommandBuilder()
    .setName("ticket-config")
    .setDescription("Configure per-ticket-type settings.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(remindersSubcommand)
    .addSubcommand(sub => sub.setName("create").setDescription("Create a locked ticket type, ready to configure.")
      .addStringOption(option => option.setName("key").setDescription("Stable key: letters, numbers, underscores or hyphens").setRequired(true).setMaxLength(32))
      .addStringOption(option => option.setName("name").setDescription("Displayed ticket type name").setRequired(true).setMaxLength(45))
      .addStringOption(option => option.setName("department").setDescription("Department or team handling these tickets").setRequired(true).setMaxLength(100))
      .addStringOption(option => option.setName("prefix").setDescription("Channel name prefix (defaults to key, with underscores changed to hyphens)").setMaxLength(32)))
    .addSubcommand(sub => sub.setName("lock").setDescription("Stop new submissions without affecting existing tickets.")
      .addStringOption(option => option.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("unlock").setDescription("Allow new submissions for this ticket type.")
      .addStringOption(option => option.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("view").setDescription("View this ticket type's current configuration.")
      .addStringOption(option => option.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub => sub.setName("check").setDescription("Check configured ticket channels and bot permissions.")
      .addStringOption(option => option.setName("type").setDescription(TYPE_OPTION_DESCRIPTION).setRequired(true).setAutocomplete(true)))
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
    const sub = interaction.options.getSubcommand();
    if (sub === "notifications") { await notificationCommand(interaction); return; }
    if (sub === "create" || sub === "lock" || sub === "unlock") {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      try {
        let saved;
        if (sub === "create") {
          const key = interaction.options.getString("key",true);
          saved = createCustomTicketType(guildId,interaction.user.id,{
            key,name:interaction.options.getString("name",true),department:interaction.options.getString("department",true),
            prefix:interaction.options.getString("prefix") ?? key.replace(/_/g,"-"),
          });
        } else saved = setTicketTypeEnabled(guildId,interaction.options.getString("type",true),sub === "unlock",interaction.user.id);
        let refreshed = false;
        try {refreshed = await refreshPostedPanel(interaction.client,guildId);}
        catch(error) {console.error("Ticket settings saved, but panel refresh failed:",error);}
        const result = sub === "create"
          ? `Created **${saved.displayName}** with key \`${saved.typeKey}\`. It starts locked. Configure its category, questions, leads and review channel, then use /ticket-config unlock.`
          : `**${saved.displayName}** is ${saved.enabled ? "accepting new tickets" : "locked for new tickets"}. Existing tickets are unchanged.`;
        await interaction.editReply({content:result + (refreshed ? " The published panel was refreshed." : " No published panel was refreshed; use /ticket-panel post if needed."),allowedMentions:{parse:[]}});
      } catch(error) {
        await interaction.editReply({content:(error as Error).message.slice(0,1800),allowedMentions:{parse:[]}});
      }
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

    if (sub === "view") {
      await interaction.reply({embeds:[ticketConfigSummary(ticketType)],flags:MessageFlags.Ephemeral,allowedMentions:{parse:[]}}); return;
    }
    if (sub === "check") {
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      try {
        if (!interaction.guild) throw new Error("Server is unavailable.");
        const lines = await checkTicketConfiguration(interaction.guild,ticketType);
        await interaction.editReply({content:lines.join("\n"),allowedMentions:{parse:[]}});
      } catch(error) {
        console.error("Ticket configuration check failed:",error);
        await interaction.editReply("Could not inspect this configuration. Check that I can access the server and its channels.");
      }
      return;
    }
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
      await interaction.deferReply({flags:MessageFlags.Ephemeral});
      const selected = interaction.options.getChannel("channel", true);
      const channel = await interaction.guild?.channels.fetch(selected.id).catch(()=>null);
      if (!channel || channel.type !== ChannelType.GuildText || getTicketByChannel(channel.id)) {
        await interaction.editReply("Choose a permanent text channel in this server, outside ticket channels."); return;
      }
      const me = await interaction.guild!.members.fetchMe();
      if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles,PermissionFlagsBits.EmbedLinks])) {
        await interaction.editReply("I need View Channel, Send Messages, Read Message History, Attach Files and Embed Links there."); return;
      }
      setReviewChannel(guildId, typeKey, channel.id);
      await interaction.editReply(`Review/archive channel for **${ticketType.displayName}** set to <#${channel.id}>.`);
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
