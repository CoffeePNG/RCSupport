import {
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  OverwriteType,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";
import { Command } from "../../commands/types";
import { getGuildSettings, setVaultCategory } from "../../db/guildSettingsRepo";

const channelTypes = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
] as const;

async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (!interaction.guild || !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: "Only server administrators can use this command, inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }
  return true;
}

export function vaultedName(name: string): string {
  // Discord may lowercase text-channel names. Re-running must not duplicate the tag.
  const base = name.replace(/(?:[ -]*\[vaulted\])+$/i, "");
  const suffix = "-[Vaulted]";
  return `${base.slice(0, 100 - suffix.length)}${suffix}`;
}

export const setVaultCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("set-vault")
    .setDescription("Set this server's destination category for vaulted channels.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option => option
      .setName("category")
      .setDescription("Category to move vaulted channels into")
      .addChannelTypes(ChannelType.GuildCategory)
      .setRequired(true)),
  async execute(interaction) {
    if (!await requireAdmin(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const category = await interaction.guild!.channels.fetch(interaction.options.getChannel("category", true).id);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply("Choose a category in this server.");
        return;
      }
      setVaultCategory(interaction.guild!.id, category.id);
      await interaction.editReply(`Vault category set to <#${category.id}>. Use /vault in a channel to vault it.`);
    } catch (error) {
      console.error("Failed to configure vault:", error);
      await interaction.editReply("Couldn't save that vault category. Check that it still exists and the bot can access it.");
    }
  },
};

export const vaultCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("vault")
    .setDescription("Move a channel to the vault and restrict visibility to administrators.")
    .setDMPermission(false)
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(option => option
      .setName("channel")
      .setDescription("Channel to vault (defaults to this channel)")
      .addChannelTypes(...channelTypes)),
  async execute(interaction) {
    if (!await requireAdmin(interaction)) return;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const guild = interaction.guild!;
      const categoryId = getGuildSettings(guild.id).vaultCategoryId;
      if (!categoryId) {
        await interaction.editReply("Set a vault category first with /set-vault category:<category>.");
        return;
      }
      const category = await guild.channels.fetch(categoryId);
      if (!category || category.type !== ChannelType.GuildCategory) {
        await interaction.editReply("The configured vault category no longer exists. Choose another with /set-vault.");
        return;
      }
      const channelId = interaction.options.getChannel("channel")?.id ?? interaction.channelId;
      const channel = await guild.channels.fetch(channelId);
      if (!channel || channel.isThread() || channel.type === ChannelType.GuildCategory ||
          !channelTypes.some(type => type === channel.type)) {
        await interaction.editReply("Vault a server channel, not a thread or category. For a forum post, vault its parent forum channel.");
        return;
      }
      const bot = await guild.members.fetchMe();
      if (!bot.permissions.has(PermissionFlagsBits.Administrator)) {
        await interaction.editReply("I need the Administrator permission to vault channels without retaining a non-admin access exception.");
        return;
      }
      // One PATCH replaces every role/member override alongside the move and rename.
      // Never sync the category's permissions: it may have public or staff access.
      await channel.edit({
        name: vaultedName(channel.name),
        parent: category.id,
        lockPermissions: false,
        permissionOverwrites: [{
          id: guild.id,
          type: OverwriteType.Role,
          allow: [],
          deny: [PermissionFlagsBits.ViewChannel],
        }],
        reason: `Vaulted by ${interaction.user.id}`,
      });
      await interaction.editReply(`Vaulted <#${channel.id}> in <#${category.id}>. Only server administrators and the server owner can view it.`);
    } catch (error) {
      console.error("Failed to vault channel:", error);
      await interaction.editReply("Couldn't confirm the channel was vaulted. Check its name, category, and permissions before retrying; the category may be full or a channel may have been deleted.");
    }
  },
};
