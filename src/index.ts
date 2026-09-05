import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { syncGuildCommands } from "./deployCommands";
import { handleInteraction } from "./events/interactionCreate";
import { seedDefaultTicketTypes } from "./seed/defaultTicketTypes";
import "./db/connect";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commandsByName = new Map(commands.map((command) => [command.data.name, command]));

/**
 * Registering on boot keeps slash commands in step with the running code on
 * hosts where there's no shell to run `npm run deploy-commands` from. It's an
 * idempotent full PUT, so restarting costs nothing when nothing changed.
 */
async function registerCommands(clientId: string, guildIds: readonly string[]): Promise<void> {
  for (const guildId of guildIds) {
    try {
      const count = await syncGuildCommands(client.rest, clientId, guildId);
      console.log(`Registered ${count} slash commands in guild ${guildId}.`);
    } catch (error) {
      // One unreachable guild (bot removed, ID typo) shouldn't stop the others
      // or take the bot down: it's already logged in and serving.
      console.error(`Failed to register slash commands in guild ${guildId}:`, error);
    }
  }
}

client.once(Events.ClientReady, (readyClient) => {
  for (const guild of readyClient.guilds.cache.values()) {
    seedDefaultTicketTypes(guild.id);
  }

  console.log(
    `Logged in as ${readyClient.user.tag} — ${commands.length} commands loaded, serving ${readyClient.guilds.cache.size} guild(s) [deploy-test-2026-08-19a]`
  );

  if (config.deployCommandsOnStart) {
    void registerCommands(readyClient.user.id, config.guildIds);
  }
});

// Seed default ticket types the moment the bot joins a new guild, not just on the guilds it started with.
client.on(Events.GuildCreate, (guild) => {
  seedDefaultTicketTypes(guild.id);
  // A configured guild the bot is only now joining still needs its commands.
  if (config.deployCommandsOnStart && config.guildIds.includes(guild.id)) {
    void registerCommands(guild.client.user.id, [guild.id]);
  }
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, commandsByName);
});

client.login(config.token);
