import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated guild IDs to deploy commands to. Falls back to the old singular var for compatibility. */
function requireGuildIds(): string[] {
  const raw = process.env.DISCORD_GUILD_IDS || process.env.DISCORD_GUILD_ID;
  if (!raw) {
    throw new Error("Missing required environment variable: DISCORD_GUILD_IDS");
  }
  const ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) {
    throw new Error("DISCORD_GUILD_IDS is set but contains no guild IDs");
  }
  return ids;
}

export const config = {
  token: requireEnv("DISCORD_TOKEN"),
  clientId: requireEnv("DISCORD_CLIENT_ID"),
  guildIds: requireGuildIds(),
  databasePath: process.env.DATABASE_PATH || "data/rcbot.sqlite",
};
