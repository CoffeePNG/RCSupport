import { Client, Events, GatewayIntentBits } from "discord.js";
import { config } from "./config";
import { commands } from "./commands";
import { handleInteraction } from "./events/interactionCreate";
import { seedDefaultTicketTypes } from "./seed/defaultTicketTypes";
import "./db/connect";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const commandsByName = new Map(commands.map((command) => [command.data.name, command]));

client.once(Events.ClientReady, (readyClient) => {
  for (const guild of readyClient.guilds.cache.values()) {
    seedDefaultTicketTypes(guild.id);
  }
  console.log(
    `Logged in as ${readyClient.user.tag} — ${commands.length} commands loaded, serving ${readyClient.guilds.cache.size} guild(s) [deploy-test-2026-08-19a]`
  );
});

// Seed default ticket types the moment the bot joins a new guild, not just on the guilds it started with.
client.on(Events.GuildCreate, (guild) => {
  seedDefaultTicketTypes(guild.id);
});

client.on(Events.InteractionCreate, (interaction) => {
  void handleInteraction(interaction, commandsByName);
});

client.login(config.token);
