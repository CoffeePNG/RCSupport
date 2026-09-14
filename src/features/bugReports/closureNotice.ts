import { createHash } from "node:crypto";
import { escapeMarkdown, ThreadChannel } from "discord.js";
import * as repo from "./repo";

export function closureContent(actor: string, time: number): string {
  // In-game actors include a UUID for audit history; display just their name here.
  const name = actor.replace(/ \([0-9a-f-]{36}\)$/i, "").replace(/[\r\n]/g, " ").slice(0, 100) || "Unknown staff member";
  return `This report has been closed by **${escapeMarkdown(name)}** - <t:${time}:T> · <t:${time}:d>`;
}
export async function deliverClosure(thread: ThreadChannel, notice: repo.ClosureNotice): Promise<void> {
  notice = repo.closureNotice(notice.event_key) ?? notice;
  if (notice.message_id) return;
  const content = closureContent(notice.actor, notice.closed_at);
  if (notice.attempted_at !== null) {
    // A send may have succeeded before its response/receipt was lost. Search only
    // the possible delivery window, and never reuse another closure's message.
    let before: string | undefined;
    while (true) {
      const batch = await thread.messages.fetch({ limit: 100, ...(before ? { before } : {}), cache: false });
      const found = batch.find(m => m.author.id === thread.client.user!.id && m.content === content && !repo.usedClosureMessage(m.id));
      if (found) { repo.completeClosure(notice.event_key, found.id); return; }
      if (!batch.size) break;
      const oldest = [...batch.values()].reduce((a, b) => BigInt(a.id) < BigInt(b.id) ? a : b);
      if (oldest.createdTimestamp < (notice.attempted_at - 2) * 1000 || batch.size < 100) break;
      if (before === oldest.id) throw new Error("Closure recovery cursor did not advance");
      before = oldest.id;
    }
  }
  repo.beginClosureAttempt(notice.event_key);
  const nonce = createHash("sha256").update(notice.event_key).digest("hex").slice(0, 24);
  const message = await thread.send({ content, allowedMentions: { parse: [] }, nonce, enforceNonce: true });
  repo.completeClosure(notice.event_key, message.id);
}
