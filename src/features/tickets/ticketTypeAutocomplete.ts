import { AutocompleteInteraction } from "discord.js";
import { getTicketTypes } from "./ticketConfigRepo";

export async function respondTicketTypeAutocomplete(interaction: AutocompleteInteraction) {
  const guildId = interaction.guildId;
  if (!guildId) {
    await interaction.respond([]);
    return;
  }

  const focused = interaction.options.getFocused().toLowerCase();
  const types = getTicketTypes(guildId).filter(
    (t) =>
      t.displayName.toLowerCase().includes(focused) || t.typeKey.toLowerCase().includes(focused)
  );

  await interaction.respond(
    types.slice(0, 25).map((t) => ({ name: t.displayName, value: t.typeKey }))
  );
}
