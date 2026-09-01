import { AttachmentBuilder, Collection, GuildTextBasedChannel, Message } from "discord.js";

interface TranscriptLine {
  timestamp: number;
  tag: string;
  content: string;
  attachments: string;
}

export interface TranscriptOptions {
  /** Maximum number of messages to include. */
  limit?: number;
  /** Only include messages created at or after this epoch millisecond timestamp. */
  since?: number;
}

export interface TranscriptResult {
  text: string;
  messageCount: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  /** True when the limit was hit before reaching the requested time window. */
  truncated: boolean;
}

const FETCH_PAGE_SIZE = 100;

function toLine(msg: Message): TranscriptLine {
  return {
    timestamp: msg.createdTimestamp,
    tag: msg.author.tag,
    content: msg.content,
    attachments: msg.attachments.map((a) => a.url).join(" "),
  };
}

function formatLines(lines: TranscriptLine[]): string {
  return lines
    .map(
      (m) =>
        `[${new Date(m.timestamp).toISOString()}] ${m.tag}: ${m.content}${
          m.attachments ? ` ${m.attachments}` : ""
        }`
    )
    .join("\n");
}

export async function collectTranscript(
  channel: GuildTextBasedChannel,
  options: TranscriptOptions = {}
): Promise<TranscriptResult> {
  const limit = options.limit ?? 500;
  const since = options.since;
  const lines: TranscriptLine[] = [];
  let before: string | undefined;
  let reachedWindowStart = false;
  let exhausted = false;

  while (lines.length < limit) {
    const batch: Collection<string, Message> = await channel.messages.fetch({
      limit: FETCH_PAGE_SIZE,
      before,
    });
    if (batch.size === 0) {
      exhausted = true;
      break;
    }

    let oldestId = before;
    let oldestTimestamp = Number.POSITIVE_INFINITY;
    for (const msg of batch.values()) {
      if (msg.createdTimestamp < oldestTimestamp) {
        oldestTimestamp = msg.createdTimestamp;
        oldestId = msg.id;
      }
      if (since !== undefined && msg.createdTimestamp < since) {
        reachedWindowStart = true;
        continue;
      }
      if (lines.length >= limit) break;
      lines.push(toLine(msg));
    }

    before = oldestId;
    if (reachedWindowStart) break;
    if (batch.size < FETCH_PAGE_SIZE) {
      exhausted = true;
      break;
    }
  }

  lines.sort((a, b) => a.timestamp - b.timestamp);

  return {
    text: formatLines(lines) || "(no messages)",
    messageCount: lines.length,
    oldestTimestamp: lines[0]?.timestamp,
    newestTimestamp: lines[lines.length - 1]?.timestamp,
    truncated: lines.length >= limit && !reachedWindowStart && !exhausted,
  };
}

export async function generateTranscript(
  channel: GuildTextBasedChannel,
  limit = 500
): Promise<string> {
  const result = await collectTranscript(channel, { limit });
  return result.text;
}

export function buildTranscriptAttachment(text: string, name: string): AttachmentBuilder {
  return new AttachmentBuilder(Buffer.from(text, "utf-8"), { name });
}
