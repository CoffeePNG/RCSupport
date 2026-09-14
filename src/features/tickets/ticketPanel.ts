import {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  StringSelectMenuBuilder,
  TextChannel,
} from "discord.js";
import { getGuildSettings } from "../../db/guildSettingsRepo";
import { getTicketTypes } from "./ticketConfigRepo";
import { TICKET_PANEL_SELECT_ID } from "./ticketConstants";
import { resolveTemplate } from "./ticketFormatter";

const DEFAULT_TITLE = "Open a Ticket";

export interface PanelContent {
  embed: EmbedBuilder;
  row: ActionRowBuilder<StringSelectMenuBuilder>;
}

/** Builds the panel embed + ticket-type select menu; null if the guild has no ticket types yet. */
export function buildPanelContent(guildId: string): PanelContent | null {
  const types = getTicketTypes(guildId);
  if (types.length === 0) return null;

  const settings = getGuildSettings(guildId);
  const typeList = types.map((t) => `**${t.displayName}** — ${t.optionDescription ?? t.department}`).join("\n");

  const description = settings.panelDescription
    ? resolveTemplate(settings.panelDescription, { types: typeList })
    : "Select a category below to get started.";

  const embed = new EmbedBuilder()
    .setTitle((settings.panelTitle ?? DEFAULT_TITLE).slice(0, 256))
    .setColor(0x5865f2)
    .setDescription(description.slice(0, 4096));

  const select = new StringSelectMenuBuilder()
    .setCustomId(TICKET_PANEL_SELECT_ID)
    .setPlaceholder("Select a ticket type...")
    .addOptions(
      types.map((t) => ({
        label: t.displayName,
        value: t.typeKey,
        description: (t.optionDescription ?? t.department).slice(0, 100),
      }))
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
  return { embed, row };
}

/** Re-renders an already-posted panel message in place; returns false if there's nothing to refresh. */
export async function refreshPostedPanel(client: Client, guildId: string): Promise<boolean> {
  const settings = getGuildSettings(guildId);
  if (!settings.panelChannelId || !settings.panelMessageId) return false;

  const content = buildPanelContent(guildId);
  if (!content) return false;

  const channel = await client.channels.fetch(settings.panelChannelId).catch(() => null);
  if (!(channel instanceof TextChannel)) return false;

  const message = await channel.messages.fetch(settings.panelMessageId).catch(() => null);
  if (!message) return false;

  await message.edit({ embeds: [content.embed], components: [content.row] });
  return true;
}
