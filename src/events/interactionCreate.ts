import { Interaction, MessageFlags } from "discord.js";
import { Command } from "../commands/types";
import { RCSupportForum } from "../features/bugReports/forum";
import { handleBugReportsInteraction } from "../features/bugReports/interactions";
import { handleTicketsInteraction } from "../features/tickets/interactions";
import { handleTodoInteraction } from "../features/todo/interactions";

export async function handleInteraction(
  interaction: Interaction,
  commandsByName: Map<string, Command>,
  rcForum?: RCSupportForum
) {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      // Registration is the first gate, this is the one that can't go stale:
      // a leftover registration in a guild the command was pinned away from
      // still lands here, and gets refused.
      const pinnedElsewhere =
        command.guildIds &&
        (!interaction.guildId || !command.guildIds.includes(interaction.guildId));
      if (pinnedElsewhere) {
        await interaction.reply({
          content: "That command isn't available in this server.",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await command.execute(interaction, rcForum);
      return;
    }

    if (interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command?.autocomplete) return;
      await command.autocomplete(interaction);
      return;
    }

    if (await handleBugReportsInteraction(interaction, rcForum)) return;
    if (await handleTicketsInteraction(interaction)) return;
    await handleTodoInteraction(interaction);
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction
        .reply({ content: "Something went wrong handling that action.", flags: MessageFlags.Ephemeral })
        .catch(() => null);
    }
  }
}
