import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseGuildIds(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((id) => id.trim()).filter(Boolean);
}

/** Comma-separated guild IDs to deploy commands to. Falls back to the old singular var for compatibility. */
function requireGuildIds(): string[] {
  const raw = process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID;
  if (!raw) {
    throw new Error("Missing required environment variable: DISCORD_GUILD_IDS");
  }
  const ids = parseGuildIds(raw);
  if (ids.length === 0) {
    throw new Error("DISCORD_GUILD_IDS is set but contains no guild IDs");
  }
  return ids;
}

/**
 * Guilds allowed to use /archive. Transcripts are bulk history exports, so the
 * command stays pinned to the one server that asked for it unless overridden.
 */
const DEFAULT_ARCHIVE_GUILD_IDS = ["903819888903200798"];

function archiveGuildIds(): string[] {
  const ids = parseGuildIds(process.env.ARCHIVE_GUILD_IDS);
  return ids.length > 0 ? ids : DEFAULT_ARCHIVE_GUILD_IDS;
}

export const config = {
  token: requireEnv("DISCORD_TOKEN"),
  clientId: requireEnv("DISCORD_CLIENT_ID"),
  guildIds: requireGuildIds(),
  archiveGuildIds: archiveGuildIds(),
  /** Register slash commands on boot. Set to "false" to leave it to the CLI script. */
  deployCommandsOnStart: process.env.DEPLOY_COMMANDS_ON_START !== "false",
  databasePath: process.env.DATABASE_PATH || "data/rcbot.sqlite",
};
