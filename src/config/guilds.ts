import "dotenv/config";

const DEFAULT_ARCHIVE_GUILD_IDS = ["903819888903200798"];
const parseIds = (raw?: string): string[] => [...new Set((raw ?? "").split(",").map(id => id.trim()).filter(Boolean))];

/** Pure resolver: safe to use from setup tools without a bot token or database. */
export function resolveGuildConfiguration(env: Record<string, string | undefined>) {
  const publicId = env.PUBLIC_GUILD_ID?.trim();
  const staffId = env.STAFF_GUILD_ID?.trim();
  if (!!publicId !== !!staffId) {
    throw new Error("Set both PUBLIC_GUILD_ID and STAFF_GUILD_ID, or leave both unset for legacy routing.");
  }
  for (const [name, id] of [["PUBLIC_GUILD_ID", publicId], ["STAFF_GUILD_ID", staffId]]) {
    if (id && !/^\d{17,20}$/.test(id)) throw new Error(`${name} must be one Discord guild ID.`);
  }
  if (publicId && publicId === staffId) throw new Error("Public and Staff must be different guilds.");
  const legacy = parseIds(env.DISCORD_GUILD_IDS || env.DISCORD_GUILD_ID);
  const archive = parseIds(env.ARCHIVE_GUILD_IDS);
  return {
    public: publicId,
    staff: staffId,
    // Retain old deployment targets so full PUT registration removes stale commands there.
    deploymentIds: [...new Set([...legacy, ...[publicId, staffId].filter((id): id is string => !!id)])],
    publicIds: publicId ? [publicId] : undefined,
    staffIds: staffId ? [staffId] : archive.length ? archive : DEFAULT_ARCHIVE_GUILD_IDS,
  };
}

export const guildConfiguration = resolveGuildConfiguration(process.env);
export const GuildScope = {
  PUBLIC: guildConfiguration.publicIds,
  STAFF: guildConfiguration.staffIds,
  // Legacy deployment behavior is intentionally unrestricted when no semantic pair is supplied.
  BOTH: guildConfiguration.public ? [guildConfiguration.public, guildConfiguration.staff!] : undefined,
} as const;
