import { REST, Routes } from "discord.js";
import { commands } from "./commands";

/** A command with no guildIds goes everywhere; one with them goes only there. */
export function commandBodyFor(guildId: string) {
  return commands
    .filter((command) => !command.guildIds || command.guildIds.includes(guildId))
    .map((command) => command.data.toJSON());
}

/**
 * Replaces one guild's command set with the commands it should have, and
 * returns how many were registered. A full PUT, so a command that no longer
 * belongs to this guild is removed by the same call that deploys the rest.
 */
export async function syncGuildCommands(
  rest: REST,
  clientId: string,
  guildId: string
): Promise<number> {
  const body = commandBodyFor(guildId);
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
  return body.length;
}
