import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { getGuildSettings, setPanelText } from "../../db/guildSettingsRepo";
import {
  getTicketType,
  setClaimMessage,
  setOpenMessage,
  setOptionDescription,
} from "./ticketConfigRepo";
import { TicketTypeConfig } from "./ticket";
import { refreshPostedPanel } from "./ticketPanel";

export const CONFIG_EDIT_MODAL_PREFIX = "ticket_config_edit:";
export const PANEL_EDIT_MODAL_ID = "ticket_panel_edit";

export type ConfigField = "open" | "claim" | "optdesc";

const FIELD_META: Record<
  ConfigField,
  { label: string; placeholder: string; maxLength: number; style: TextInputStyle }
> = {
  open: {
    label: "Open message",
    placeholder: "Supports {department}, {leads}, {creator}",
    maxLength: 1000,
    style: TextInputStyle.Paragraph,
  },
  claim: {
    label: "Claim message",
    placeholder: "Supports {claimant}, {creator}, {department}",
    maxLength: 1000,
    style: TextInputStyle.Paragraph,
  },
  optdesc: {
    label: "Dropdown description",
    placeholder: "Shown under this option in the ticket panel dropdown",
    maxLength: 100,
    style: TextInputStyle.Short,
  },
};

function currentValue(field: ConfigField, ticketType: TicketTypeConfig): string {
  if (field === "open") return ticketType.openMessage;
  if (field === "claim") return ticketType.claimMessage;
  return ticketType.optionDescription ?? "";
}

/** Opens a modal pre-filled with the current template/blurb so it's editable as multi-line text, not a slash-command option. */
export function buildConfigEditModal(field: ConfigField, ticketType: TicketTypeConfig): ModalBuilder {
  const meta = FIELD_META[field];
  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(meta.label.slice(0, 45))
    .setPlaceholder(meta.placeholder)
    .setStyle(meta.style)
    .setRequired(true)
    .setMaxLength(meta.maxLength)
    .setValue(currentValue(field, ticketType).slice(0, meta.maxLength));

  return new ModalBuilder()
    .setCustomId(`${CONFIG_EDIT_MODAL_PREFIX}${field}:${ticketType.typeKey}`)
    .setTitle(`Edit ${meta.label}`.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
}

export async function handleConfigEditModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const rest = interaction.customId.slice(CONFIG_EDIT_MODAL_PREFIX.length);
  const separatorIndex = rest.indexOf(":");
  const field = rest.slice(0, separatorIndex) as ConfigField;
  const typeKey = rest.slice(separatorIndex + 1);

  const ticketType = getTicketType(guildId, typeKey);
  if (!ticketType) {
    await interaction.reply({
      content: "This ticket type is no longer configured.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const value = interaction.fields.getTextInputValue("value");
  if (field === "open") setOpenMessage(guildId, typeKey, value);
  else if (field === "claim") setClaimMessage(guildId, typeKey, value);
  else setOptionDescription(guildId, typeKey, value);

  const refreshed = field === "optdesc" ? await refreshPostedPanel(interaction.client, guildId) : false;

  await interaction.reply({
    content: `${FIELD_META[field].label} for **${ticketType.displayName}** updated.${
      refreshed ? " The live panel has been updated." : ""
    }`,
    flags: MessageFlags.Ephemeral,
  });
}

/** Opens a modal pre-filled with the panel's current title/description; leaving a field blank resets it to the default. */
export function buildPanelEditModal(guildId: string): ModalBuilder {
  const settings = getGuildSettings(guildId);

  const title = new TextInputBuilder()
    .setCustomId("title")
    .setLabel("Panel title (blank = default)")
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(256);
  if (settings.panelTitle) title.setValue(settings.panelTitle);

  const description = new TextInputBuilder()
    .setCustomId("description")
    .setLabel("Description (blank = default)")
    .setPlaceholder("Use {types} to insert the ticket type list")
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setMaxLength(3800);
  if (settings.panelDescription) description.setValue(settings.panelDescription);

  return new ModalBuilder()
    .setCustomId(PANEL_EDIT_MODAL_ID)
    .setTitle("Customize Ticket Panel")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(title),
      new ActionRowBuilder<TextInputBuilder>().addComponents(description)
    );
}

export async function handlePanelEditModalSubmit(interaction: ModalSubmitInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) return;

  const title = interaction.fields.getTextInputValue("title").trim();
  const description = interaction.fields.getTextInputValue("description").trim();

  setPanelText(guildId, title || null, description || null);
  const refreshed = await refreshPostedPanel(interaction.client, guildId);

  await interaction.reply({
    content: `Panel text updated.${
      refreshed ? " The live panel has been updated." : " Run /ticket-panel post to publish it."
    }`,
    flags: MessageFlags.Ephemeral,
  });
}
