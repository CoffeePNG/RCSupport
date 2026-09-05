import { REST, Routes } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";

const rest = new REST().setToken(config.token);

/** A command with no guildIds goes everywhere; one with them goes only there. */
function bodyFor(guildId: string) {
  return commands
    .filter((command) => !command.guildIds || command.guildIds.includes(guildId))
    .map((command) => command.data.toJSON());
}

async function main() {
  for (const guildId of config.guildIds) {
    const body = bodyFor(guildId);
    const skipped = commands.length - body.length;
    console.log(
      `Deploying ${body.length} guild slash commands to ${guildId}` +
        (skipped > 0 ? ` (${skipped} pinned to other guilds)...` : "...")
    );
    // A full PUT replaces the guild's set, so a command that lost access here
    // is removed by the same call that deploys the rest.
    await rest.put(Routes.applicationGuildCommands(config.clientId, guildId), {
      body,
    });
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
