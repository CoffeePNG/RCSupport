import "dotenv/config";
import { guildConfiguration } from "./config/guilds";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requireGuildIds(): string[] {
  if (!guildConfiguration.deploymentIds.length) {
    throw new Error("Set PUBLIC_GUILD_ID and STAFF_GUILD_ID, or DISCORD_GUILD_IDS.");
  }
  return guildConfiguration.deploymentIds;
}

export const config = {
  token: requireEnv("DISCORD_TOKEN"),
  clientId: requireEnv("DISCORD_CLIENT_ID"),
  guildIds: requireGuildIds(),
  archiveGuildIds: guildConfiguration.staffIds,
  guilds: { public: guildConfiguration.public, staff: guildConfiguration.staff },
  /** Register slash commands on boot. Set to "false" to leave it to the CLI script. */
  deployCommandsOnStart: process.env.DEPLOY_COMMANDS_ON_START !== "false",
  databasePath: process.env.DATABASE_PATH || "data/rcbot.sqlite",
};
