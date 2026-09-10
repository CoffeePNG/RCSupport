import { GuildTextBasedChannel, Message } from "discord.js";

const FETCH_PAGE_SIZE = 100;
const BULK_DELETE_BATCH = 100;
/** Safety valve on how deep a filtered purge (user/bots) will search. */
const DEFAULT_SCAN_LIMIT = 5000;

export type MessagePredicate = (message: Message) => boolean;

export interface PurgeOptions {
  /** Max number of matching messages to delete. */
  limit: number;
  /** Only messages passing this are deleted. Omit to match every message. */
  filter?: MessagePredicate;
  /** Walk forward from this message ID (exclusive) instead of backward from now. */
  after?: string;
  /** Stop scanning past this many messages even if `limit` isn't reached. */
  scanLimit?: number;
}

export interface PurgeResult {
  deleted: number;
  scanned: number;
}

/**
 * Scans a channel's history and bulk-deletes matching messages, batching
 * through Discord's 100-message-per-call bulk-delete endpoint. Messages
 * older than 14 days can't be bulk-deleted (Discord API limitation, not a
 * permissions thing), so `Message#bulkDeletable` gates what gets queued.
 */
export async function purgeMessages(
  channel: GuildTextBasedChannel,
  options: PurgeOptions
): Promise<PurgeResult> {
  const { limit, filter, after, scanLimit = DEFAULT_SCAN_LIMIT } = options;

  let deleted = 0;
  let scanned = 0;
  let pending: string[] = [];

  async function flush(final: boolean): Promise<void> {
    while (pending.length > 0 && (final || pending.length >= BULK_DELETE_BATCH)) {
      const chunk = pending.splice(0, BULK_DELETE_BATCH);
      const result = await channel.bulkDelete(chunk, true);
      deleted += result.size;
    }
  }

  let cursor = after;
  let hitAgeLimit = false;

  while (deleted + pending.length < limit && scanned < scanLimit && !hitAgeLimit) {
    const batch = await (after !== undefined
      ? channel.messages.fetch({ limit: FETCH_PAGE_SIZE, after: cursor })
      : channel.messages.fetch({ limit: FETCH_PAGE_SIZE, before: cursor }));
    if (batch.size === 0) break;

    // Track the page's oldest (backward walk) or newest (forward walk)
    // message as the next cursor without assuming API return order.
    let nextCursor = cursor;
    let extremeTimestamp = after !== undefined ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

    for (const msg of batch.values()) {
      scanned++;
      const isMoreExtreme =
        after !== undefined ? msg.createdTimestamp > extremeTimestamp : msg.createdTimestamp < extremeTimestamp;
      if (isMoreExtreme) {
        extremeTimestamp = msg.createdTimestamp;
        nextCursor = msg.id;
      }

      if (!msg.bulkDeletable) {
        // Pages walk chronologically, so once one message is too old, the
        // rest of a backward walk will be too; a forward walk just skips it.
        if (after === undefined) hitAgeLimit = true;
        continue;
      }
      if (filter && !filter(msg)) continue;

      pending.push(msg.id);
      if (deleted + pending.length >= limit) break;
    }

    await flush(false);
    cursor = nextCursor;
    if (batch.size < FETCH_PAGE_SIZE) break;
  }

  await flush(true);

  return { deleted, scanned };
}
