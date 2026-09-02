export interface MessageReference {
  /** Present only when the input was a full link. */
  guildId?: string;
  /** Present only when the input was a full link. */
  channelId?: string;
  messageId: string;
}

const LINK_PATTERN =
  /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20}|@me)\/(\d{17,20})\/(\d{17,20})\/?$/i;
const SNOWFLAKE_PATTERN = /^\d{17,20}$/;

/**
 * Accepts a Discord message link or a bare message ID. A bare ID carries no
 * channel of its own, so the caller resolves it against the target channel.
 */
export function parseMessageReference(input: string): MessageReference | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const link = LINK_PATTERN.exec(trimmed);
  if (link) {
    const [, guildId, channelId, messageId] = link;
    // "@me" is a DM link; there's nothing in a guild for us to archive.
    if (guildId === "@me") return null;
    return { guildId, channelId, messageId };
  }

  if (SNOWFLAKE_PATTERN.test(trimmed)) {
    return { messageId: trimmed };
  }

  return null;
}
