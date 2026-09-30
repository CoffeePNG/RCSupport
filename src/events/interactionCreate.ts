import { Interaction, MessageFlags } from "discord.js";
import { Command } from "../commands/types";
import type { RCSupportForum } from "../features/bugReports/forum";
import { accessDenial } from "../security/access";
import { dispatchComponent } from "../interactions/router";
import { interactionRoutes } from "../interactions/registry";

export async function handleInteraction(
  interaction: Interaction,
  commandsByName: Map<string, Command>,
  rcForum?: RCSupportForum
) {
  try {
    if (interaction.isChatInputCommand() || interaction.isAutocomplete()) {
      const command = commandsByName.get(interaction.commandName);
      if (!command) return;
      const denied = accessDenial(command, {
        guildId: interaction.guildId,
        permissions: interaction.memberPermissions?.bitfield ?? 0n,
      });
      if (interaction.isAutocomplete()) {
        if (denied) await interaction.respond([]);
        else if (command.autocomplete) await command.autocomplete(interaction);
        return;
      }
      if (denied) {
        await interaction.reply({ content: denied, flags: MessageFlags.Ephemeral });
        return;
      }
      await command.execute(interaction, rcForum);
      return;
    }
    await dispatchComponent(interaction, interactionRoutes, rcForum);
  } catch (error) {
    console.error("Error handling interaction:", error);
    if (interaction.isAutocomplete()) {
      if (!interaction.responded) await interaction.respond([]).catch(() => null);
    } else if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "Something went wrong handling that action.", flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  }
}
