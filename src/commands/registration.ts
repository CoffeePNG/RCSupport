import { isGuildAllowed } from "../security/access";
import { REST, Routes } from "discord.js";
import { commands } from "./index";

/** Registration and runtime enforce the same module and command guild scopes. */
export function commandBodyFor(guildId: string) {
  return commands
    .filter((command) => isGuildAllowed(command, guildId))
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
