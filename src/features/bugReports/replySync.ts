import { createHash } from "node:crypto";
import { escapeMarkdown, ThreadChannel } from "discord.js";
import { db } from "../../db/connect";
import type { ForumContext } from "./forumContext";
import type { OutboundReply } from "./types";
import * as repo from "./repo";

interface Receipt { attempted_at: number | null; message_id: string | null }
function receipt(reply: OutboundReply): Receipt {
  db.prepare("INSERT OR IGNORE INTO rcsupport_reply_receipts(reply_id,post_id) VALUES (?,?)").run(reply.id, reply.post_id);
  return db.prepare("SELECT * FROM rcsupport_reply_receipts WHERE reply_id=? AND post_id=?").get(reply.id,reply.post_id) as Receipt;
}
function complete(reply: OutboundReply, id: string): string {
  db.prepare("UPDATE rcsupport_reply_receipts SET message_id=? WHERE reply_id=? AND post_id=?").run(id,reply.id,reply.post_id);
  return id;
}
export async function deliverReply(thread: ThreadChannel, reply: OutboundReply, allowSend = true): Promise<string | null> {
  const saved = receipt(reply);
  if (saved.message_id) return saved.message_id;
  const marker = `Minecraft reply #${reply.id}`;
  if (saved.attempted_at !== null) {
    let before: string | undefined;
    while (true) {
      const batch = await thread.messages.fetch({limit:100,cache:false,...(before ? {before} : {})});
      const found = batch.find(m => m.author.id === thread.client.user!.id && (m.content?.endsWith(`\n-# ${marker}`) || m.embeds.some(e => e.footer?.text === marker)));
      if (found) return complete(reply, found.id);
      if (!batch.size) break;
      const oldest = [...batch.values()].reduce((a,b) => BigInt(a.id)<BigInt(b.id) ? a : b);
      if (oldest.createdTimestamp < (saved.attempted_at-2)*1000 || batch.size<100) break;
      if (before === oldest.id) throw new Error("Reply recovery cursor did not advance");
      before=oldest.id;
    }
  }
  if (!allowSend) return null;
  if (thread.archived || thread.locked) throw new Error("Reply thread is archived or locked; delivery will retry");
  db.prepare("UPDATE rcsupport_reply_receipts SET attempted_at=COALESCE(attempted_at,?) WHERE reply_id=? AND post_id=?")
    .run(Math.floor(Date.now()/1000),reply.id,reply.post_id);
  const nonce=createHash("sha256").update(`reply:${reply.post_id}:${reply.id}`).digest("hex").slice(0,24);
  const content = `${escapeMarkdown(reply.author)} (Minecraft): ${escapeMarkdown(reply.body)}\n-# ${marker}`;
  const sent=await thread.send({
    ...(content.length <= 2000 ? {content} : {
      content: `${escapeMarkdown(reply.author)} (Minecraft): reply attached.\n-# ${marker}`,
      files: [{attachment: Buffer.from(reply.body, "utf8"), name: "reply.txt"}],
    }),
    allowedMentions:{parse:[]},nonce,enforceNonce:true,
  });
  return complete(reply,sent.id);
}
export async function reconcileReplies(ctx: ForumContext): Promise<void> {
  // One bounded page per poll with a rotating cursor so an outage on one thread
  // cannot starve replies belonging to other reports.
  const replies=await ctx.api.outboundReplies(cursors.get(ctx) ?? 0);
  if (!replies.length) { cursors.set(ctx,0); return; }
  for (const reply of replies) {
    try {
      await ctx.serial(reply.post_id,async () => {
        const saved=receipt(reply);
        if (saved.message_id) { await ctx.api.acknowledgeReply(reply,{message_id:saved.message_id}); return; }
        if (repo.threadDeleted(reply.post_id)) {
          await ctx.api.acknowledgeReply(reply,{failure:"Discord thread unavailable"}); return;
        }
        const {ticket}=await ctx.api.ticket(reply.ticket_id);
        if (ticket.discord_post_id!==reply.post_id) {
          await ctx.api.acknowledgeReply(reply,{failure:"Thread mapping changed"}); return;
        }
        const thread=await ctx.getForum().threads.fetch(reply.post_id);
        if (!thread) { await ctx.api.acknowledgeReply(reply,{failure:"Discord thread unavailable"}); return; }
        if (thread.parentId!==ctx.getForum().id) throw new Error("Reply thread belongs to another Forum");
        const messageId=await deliverReply(thread,reply,!["resolved","wontfix"].includes(ticket.status));
        await ctx.api.acknowledgeReply(reply,messageId ? {message_id:messageId} : {failure:"Report closed"});
      });
    } catch (error) {
      if (typeof error==="object" && error!==null && "code" in error && String(error.code)==="10003") {
        await ctx.api.acknowledgeReply(reply,{failure:"Discord thread unavailable"});
      } else ctx.reportSyncError(reply.ticket_id,"deliver Minecraft reply",error);
    }
  }
  cursors.set(ctx,replies.length<50 ? 0 : replies[replies.length-1].id);
}
const cursors=new WeakMap<ForumContext,number>();
