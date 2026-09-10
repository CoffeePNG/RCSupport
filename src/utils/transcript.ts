import { AttachmentBuilder, Collection, GuildTextBasedChannel, Message } from "discord.js";

interface TranscriptLine {
  timestamp: number;
  authorId: string;
  tag: string;
  content: string;
  attachments: string;
}

export interface TranscriptParticipant {
  id: string;
  tag: string;
  count: number;
}

export interface TranscriptOptions {
  /** Maximum number of messages to include. */
  limit?: number;
  /** Only include messages created at or after this epoch millisecond timestamp. */
  since?: number;
  /**
   * Collect forwards from this message ID instead of backwards from now.
   * Exclusive of the message itself — pass `anchor` to include it.
   */
  after?: string;
  /** Seeds the transcript, so an `after` run can include its own anchor message. */
  anchor?: Message;
}

export interface TranscriptResult {
  text: string;
  messageCount: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  /** True when the limit was hit before reaching the requested time window. */
  truncated: boolean;
  /** Unique authors in the transcript, sorted by message count descending. */
  participants: TranscriptParticipant[];
}

const FETCH_PAGE_SIZE = 100;

/** Discord caps embed descriptions at 4096; leave room for the truncation notice. */
export const TRANSCRIPT_PREVIEW_LIMIT = 3800;

/**
 * Trims a transcript down to something an embed description can hold.
 * Kept as plain text (not a code block) so mentions still resolve.
 */
export function buildTranscriptPreview(text: string): string {
  if (!text) return "*(no messages)*";
  if (text.length <= TRANSCRIPT_PREVIEW_LIMIT) return text;
  return `${text.slice(
    0,
    TRANSCRIPT_PREVIEW_LIMIT
  )}\n… *(truncated, see attached file for the full transcript)*`;
}

function toLine(msg: Message): TranscriptLine {
  return {
    timestamp: msg.createdTimestamp,
    authorId: msg.author.id,
    tag: msg.author.tag,
    content: msg.content,
    attachments: msg.attachments.map((a) => a.url).join(" "),
  };
}

function tallyParticipants(lines: TranscriptLine[]): TranscriptParticipant[] {
  const counts = new Map<string, TranscriptParticipant>();
  for (const line of lines) {
    const existing = counts.get(line.authorId);
    if (existing) {
      existing.count += 1;
    } else {
      counts.set(line.authorId, { id: line.authorId, tag: line.tag, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Renders participants as "@mention — N messages" lines, trimmed to fit a
 * Discord embed field (1024 chars) without cutting a line in half.
 */
export function buildParticipantsSummary(participants: TranscriptParticipant[]): string {
  if (participants.length === 0) return "*(no messages)*";

  const FIELD_LIMIT = 1024;
  const allLines = participants.map(
    (p) => `<@${p.id}> — ${p.count} message${p.count === 1 ? "" : "s"}`
  );
  const full = allLines.join("\n");
  if (full.length <= FIELD_LIMIT) return full;

  const shown: string[] = [];
  let length = 0;
  for (const line of allLines) {
    const hidden = allLines.length - shown.length;
    const footer = `\n*(+${hidden} more)*`;
    const addition = (shown.length > 0 ? 1 : 0) + line.length;
    if (length + addition + footer.length > FIELD_LIMIT) break;
    shown.push(line);
    length += addition;
  }

  const hiddenCount = allLines.length - shown.length;
  const footer = `*(+${hiddenCount} more)*`;
  return shown.length > 0 ? `${shown.join("\n")}\n${footer}` : footer;
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
  let reachedWindowStart = false;
  let exhausted = false;

  if (options.anchor) {
    lines.push(toLine(options.anchor));
  }

  if (options.after !== undefined) {
    // Walk forwards from the anchor toward the newest message.
    let after = options.after;
    while (lines.length < limit) {
      const batch: Collection<string, Message> = await channel.messages.fetch({
        limit: FETCH_PAGE_SIZE,
        after,
      });
      if (batch.size === 0) {
        exhausted = true;
        break;
      }

      let newestId = after;
      let newestTimestamp = Number.NEGATIVE_INFINITY;
      for (const msg of batch.values()) {
        if (msg.createdTimestamp > newestTimestamp) {
          newestTimestamp = msg.createdTimestamp;
          newestId = msg.id;
        }
        if (lines.length >= limit) continue;
        lines.push(toLine(msg));
      }

      after = newestId;
      if (batch.size < FETCH_PAGE_SIZE) {
        exhausted = true;
        break;
      }
    }
  } else {
    // Walk backwards from the newest message toward the window start.
    let before: string | undefined;
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
  }

  lines.sort((a, b) => a.timestamp - b.timestamp);

  return {
    text: formatLines(lines) || "(no messages)",
    messageCount: lines.length,
    oldestTimestamp: lines[0]?.timestamp,
    newestTimestamp: lines[lines.length - 1]?.timestamp,
    truncated: lines.length >= limit && !reachedWindowStart && !exhausted,
    participants: tallyParticipants(lines),
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
