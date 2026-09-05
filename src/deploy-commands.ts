import { REST } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { commandBodyFor, syncGuildCommands } from "./deployCommands";

const rest = new REST().setToken(config.token);

async function main() {
  for (const guildId of config.guildIds) {
    const skipped = commands.length - commandBodyFor(guildId).length;
    const count = await syncGuildCommands(rest, config.clientId, guildId);
    console.log(
      `Deployed ${count} guild slash commands to ${guildId}` +
        (skipped > 0 ? ` (${skipped} pinned to other guilds)` : "")
    );
  }
  console.log("Done.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
