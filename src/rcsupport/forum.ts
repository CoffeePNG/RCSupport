import { setTimeout as delay } from "node:timers/promises";
import {
  ChannelType, Client, EmbedBuilder, ForumChannel, Message, ThreadChannel, PermissionFlagsBits, AuditLogEvent,
} from "discord.js";
import { getLeads, getTicketType } from "../db/ticketConfigRepo";
import { AlertModeCache, BridgeClient } from "./api";
import { BridgeConfig } from "./config";
import * as repo from "./repo";
import { PluginTicket, STATUSES, TicketStatus } from "./types";
import { shouldCreatePost, shouldForwardReply, shouldSyncStatus } from "./policy";
import { db } from "../db/connect";
import { subscribeReports } from "./events";
import { reportEmbedBatches } from "./reportEmbeds";
import { planStatusTags, statusTagId, replaceStatusTag, isClosed } from "./statusTags";
import { StatusUpdate } from "./types";
import { deliverClosure } from "./closureNotice";

export class RCSupportForum {
  readonly api: BridgeClient;
  readonly alerts: AlertModeCache;
  readonly config: BridgeConfig;
  private forum: ForumChannel | null = null;
  private polling = false;
  private timer: NodeJS.Timeout | null = null;
  private listening = false;
  private configuring = false;
  private lastPollSummary = "";
  private stopEvents: (() => void) | null = null;
  private pollAgain = false;
  private syncError: string | null = null;
  private statusWork = new Map<string, Promise<unknown>>();
  private ownTagUpdates = new Map<string, number>();

  private async serial<T>(postId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.statusWork.get(postId) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(work);
    this.statusWork.set(postId, next);
    try { return await next; }
    finally { if (this.statusWork.get(postId) === next) this.statusWork.delete(postId); }
  }
  private tagSignature(postId: string, tags: readonly string[]): string { return postId + ":" + [...tags].sort().join(","); }

  get lastSyncError(): string | null { return this.syncError; }

  constructor(config: BridgeConfig) {
    this.config = config;
    this.api = new BridgeClient(config);
    this.alerts = new AlertModeCache(async () => (await this.api.configMode()).alert_mode, config.alertModeCacheMs);
  }

  async start(client: Client): Promise<void> {
    const saved = db.prepare("SELECT channel_id FROM rcsupport_forum_settings WHERE singleton = 1").get() as { channel_id: string } | undefined;
    if (saved) this.config.forumChannelId = saved.channel_id;
    if (!this.config.forumChannelId) throw new Error("Choose a Forum with /bugreport setup.");
    const channel = await client.channels.fetch(this.config.forumChannelId);
    if (!channel || channel.type !== ChannelType.GuildForum)
      throw new Error("RCSUPPORT_FORUM_CHANNEL_ID does not identify a Forum channel");
    await this.prepareForum(client, channel);
    this.forum = channel;
    console.log(`RCSupport Forum ready: guild=${channel.guildId} forum=${channel.id}; polling every ${this.config.pollIntervalMs}ms; report-renderer=structured-v2; setup=assign`);
    if (!this.listening) {
    client.on("messageCreate", (message) => { void this.onMessage(message).catch((e) => console.error("RCSupport reply sync failed:", e)); });
    client.on("threadUpdate", (oldThread, newThread) => {
      void this.onThreadUpdate(oldThread, newThread).catch((e) => console.error("RCSupport status sync failed:", e));
    });
    this.listening = true;
    }
    this.stop();
    await this.poll().catch((e) => console.error("RCSupport initial poll failed:", e));
    this.timer = setInterval(() => { void this.poll().catch((e) => console.error("RCSupport poll failed:", e)); }, this.config.pollIntervalMs);
    this.stopEvents = subscribeReports(this.config, () => {
      void this.poll().catch(e => console.error("RCSupport event-triggered poll failed:", e));
    });
  }

  async setup(client: Client, guildId: string, channelId: string): Promise<void> {
    if (this.configuring || this.polling) throw new Error("The bridge is busy. Try setup again in a moment.");
    this.configuring = true;
    try {
      const saved = db.prepare("SELECT guild_id FROM rcsupport_forum_settings WHERE singleton = 1").get() as { guild_id: string } | undefined;
      const current = this.config.forumChannelId
        ? await client.channels.fetch(this.config.forumChannelId).catch(() => null) : null;
      const ownerGuild = saved?.guild_id ?? (current && "guildId" in current ? current.guildId : undefined);
      if (ownerGuild && ownerGuild !== guildId) throw new Error("Configure the bridge in the server containing its current Forum.");
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildForum || channel.guildId !== guildId)
        throw new Error("Choose a Forum channel in this server.");
      await this.prepareForum(client, channel);
      db.prepare("INSERT INTO rcsupport_forum_settings (singleton, guild_id, channel_id) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET guild_id = excluded.guild_id, channel_id = excluded.channel_id")
        .run(guildId, channelId);
      this.config.forumChannelId = channelId;
      await this.start(client);
    } finally { this.configuring = false; }
  }

  private async prepareForum(client: Client, channel: ForumChannel): Promise<void> {
    const plan = planStatusTags(channel.availableTags);
    if (!plan.changed) return;
    if (!client.user || !channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels))
      throw new Error("Give the bot Manage Channels on the bug Forum so it can prepare readable status tags.");
    await channel.setAvailableTags(plan.tags, "Configure RCSupport status labels and icons");
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopEvents?.(); this.stopEvents = null;
    this.pollAgain = false;
  }
  getForum(): ForumChannel {
    if (!this.forum) throw new Error("Run /bugreport setup channel:<forum> to configure the bug Forum.");
    return this.forum;
  }
  tag(status: TicketStatus): string {
    return statusTagId(this.getForum().availableTags, status);
  }
  private leads(): string[] {
    const forum = this.getForum();
    // The existing bot seeds the Bug Report ticket type as "bug_report".
    const ticketType = getTicketType(forum.guildId, "bug_report");
    if (!ticketType) { console.warn("RCSupport: bug_report ticket type is not configured"); return []; }
    const leads = getLeads(ticketType.id);
    if (leads.length === 0) console.warn("RCSupport: no current bug_report leads assigned");
    return leads;
  }
  private async mentionLeads(): Promise<string[]> {
    return (await this.alerts.get()) === "leads" ? this.leads() : [];
  }

  private async acknowledgePending(): Promise<void> {
    for (const pending of repo.unacknowledged()) {
      try {
        await this.api.setPost(pending.pluginTicketId!, pending.discordPostId);
        repo.acknowledge(pending.discordPostId);
      } catch (error) {
        this.reportSyncError(pending.pluginTicketId!, "acknowledge", error);
      }
    }
  }

  async poll(): Promise<void> {
    if (!this.forum) return;
    if (this.polling) { this.pollAgain = true; return; }
    this.polling = true;
    this.syncError = null;
    try {
      // Process durable changes before the legacy open-report listing. A large open
      // listing or an individual deleted post must not starve closed status updates.
      try {
        let after = 0;
        while (true) {
          const updates = await this.api.statusUpdates(after);
          for (const update of updates) {
            try { await this.syncStatusUpdate(update); }
            catch (error) { this.reportSyncError(update.ticket.id, "synchronize Discord status", error); }
          }
          if (updates.length < 50) break;
          const next = updates[updates.length - 1].ticket.id;
          if (next <= after) throw new Error("Status update cursor did not advance");
          after = next;
        }
      } catch (error) { this.reportSyncError(0, "read pending status updates (update the plugin as well as the bot)", error); }
      for (const [key, expiry] of this.ownTagUpdates) if (expiry < Date.now()) this.ownTagUpdates.delete(key);
      for (const notice of repo.pendingClosures()) {
        try {
          if (repo.threadDeleted(notice.post_id)) { repo.completeClosure(notice.event_key, "thread-deleted"); continue; }
          await this.serial(notice.post_id, async () => {
            if (repo.threadDeleted(notice.post_id)) return;
            const thread = await this.getForum().threads.fetch(notice.post_id);
            if (!thread || thread.parentId !== this.getForum().id) throw new Error("Closure thread is unavailable");
            // Native reports have no plugin outbox to retry a failed Closed-label edit.
            if (repo.byPost(notice.post_id)?.pluginTicketId === null) {
              const selected = STATUSES.filter(status => thread.appliedTags.includes(this.tag(status)));
              if (selected.length === 1) {
                const tags = replaceStatusTag(this.getForum().availableTags, thread.appliedTags, selected[0]);
                if (this.tagSignature(thread.id, tags) !== this.tagSignature(thread.id, thread.appliedTags)) {
                  this.ownTagUpdates.set(this.tagSignature(thread.id, tags), Date.now() + 300000);
                  await thread.setAppliedTags(tags, "Retry RCSupport Closed label");
                }
              }
            }
            await deliverClosure(thread, notice);
          });
        } catch (error) { this.reportSyncError(0, "deliver closure message for thread " + notice.post_id, error); }
      }
      await this.acknowledgePending();
      // The bot and Minecraft can have different clocks. Reconcile all open reports;
      // persisted mappings below prevent duplicate Forum posts.
      const tickets = await this.api.tickets(0);
      let created = 0, mapped = 0, restored = 0;
      for (const ticket of tickets) {
        const known = repo.byPluginTicket(ticket.id);
        if (known) { mapped++; continue; }
        // Also respect the plugin's post ID if a previous bot instance created it.
        if (ticket.discord_post_id) {
          repo.storePluginPost(ticket.id, ticket.discord_post_id, ticket.discord_id);
          repo.acknowledge(ticket.discord_post_id);
          restored++;
          continue;
        }
        if (shouldCreatePost(known, ticket.discord_post_id)) {
          try {
            await this.createPluginPost(ticket);
            created++;
          } catch (error) {
            this.reportSyncError(ticket.id, "create Discord post", error);
          }
        }
      }
      const summary = `RCSupport poll ${this.syncError ? "PARTIAL" : "OK"}: forum=${this.forum.id} received=${tickets.length} created=${created} already-mapped=${mapped} restored-mappings=${restored}`;
      if (summary !== this.lastPollSummary) console.log(summary);
      this.lastPollSummary = summary;
    } catch (error) {
      this.syncError = "Could not read saved Minecraft reports. Check the bot logs for the bridge error.";
      throw error;
    } finally {
      this.polling = false;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.poll().catch(e => console.error("RCSupport queued poll failed:", e));
      }
    }
  }

  private async syncStatusUpdate(update: StatusUpdate): Promise<void> {
    const ticket = update.ticket;
    if (!repo.byPluginTicket(ticket.id) && ticket.discord_post_id) {
      repo.storePluginPost(ticket.id, ticket.discord_post_id, ticket.discord_id);
      repo.acknowledge(ticket.discord_post_id);
    }
    let postId = repo.byPluginTicket(ticket.id)?.discordPostId ?? ticket.discord_post_id;
    if (!postId) {
      await this.createPluginPost(ticket);
      postId = repo.byPluginTicket(ticket.id)!.discordPostId;
    }
    if (repo.threadDeleted(postId)) { await this.api.acknowledgeStatus(ticket.id, update.revision); return; }
    await this.serial(postId, async () => {
      if (repo.threadDeleted(postId!)) { await this.api.acknowledgeStatus(ticket.id, update.revision); return; }
      // A newer in-game transition supersedes this snapshot; never acknowledge that newer revision.
      const current = await this.api.ticket(ticket.id);
      if (current.revision !== update.revision) { this.pollAgain = true; return; }
      const forum = this.getForum();
      const thread = await forum.threads.fetch(postId!);
      if (!thread || thread.parentId !== forum.id) throw new Error("The mapped report post is missing or belongs to an earlier Forum. Its mapping was preserved.");
      const tags = replaceStatusTag(forum.availableTags, thread.appliedTags, current.ticket.status);
      if (this.tagSignature(postId!, tags) !== this.tagSignature(postId!, thread.appliedTags)) {
        // Retain until the gateway echo arrives, including echoes delayed until after another transition.
        this.ownTagUpdates.set(this.tagSignature(postId!, tags), Date.now() + 300000);
        await thread.setAppliedTags(tags, "Synchronize saved RCSupport report status");
      }
      for (const closure of update.closures ?? []) {
        const notice = repo.queueClosure(`plugin:${ticket.id}:${closure.id}`, postId!, closure.actor || "Unknown staff member", closure.closed_at);
        await deliverClosure(thread, notice);
      }
      const ack = await this.api.acknowledgeStatus(ticket.id, update.revision);
      if (!ack.acknowledged) this.pollAgain = true;
    });
  }

  private reportSyncError(id: number, operation: string, error: unknown): void {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const hint = code === "50013" || code === "50001"
      ? "Check the bot's View Channel, Send Messages, Send Messages in Threads, and Embed Links permissions."
      : "Check the bot logs for details; synchronization will retry.";
    this.syncError = `Report #${id}: could not ${operation}. ${hint}`;
    console.error(`RCSupport report #${id} failed to ${operation}:`, error);
  }

  /** Repair the existing starter from the stored report, preserving replies and status tags. */
  async refreshReport(guildId: string, id: number): Promise<string> {
    const forum = this.getForum();
    if (forum.guildId !== guildId) throw new Error("Refresh reports in the server containing the bug Forum.");
    const { ticket } = await this.api.ticket(id);
    const postId = repo.byPluginTicket(id)?.discordPostId ?? ticket.discord_post_id;
    if (!postId) throw new Error("This report has no Discord post yet. Wait for synchronization and retry.");
    const thread = await forum.threads.fetch(postId);
    if (!thread || thread.parentId !== forum.id) throw new Error("The saved post is not in the configured bug Forum.");
    const starter = await thread.fetchStarterMessage();
    if (!starter?.editable) throw new Error("The bot cannot edit this report's starter message.");
    const batches = reportEmbedBatches(ticket);
    if (batches.length !== 1)
      throw new Error("This legacy report is too large for a single starter. Its existing post has been preserved.");
    await starter.edit({ embeds: batches[0], allowedMentions: { parse: [] } });
    await thread.setName(`#${ticket.id} ${ticket.title || ticket.description}`.replace(/\s+/g, " ").slice(0, 100));
    return postId;
  }

  private async createPluginPost(ticket: PluginTicket): Promise<void> {
    const leads = await this.mentionLeads();
    const batches = reportEmbedBatches(ticket);
    const post = await this.getForum().threads.create({
      name: `#${ticket.id} ${ticket.title || ticket.description}`.replace(/\s+/g, " ").slice(0, 100),
      appliedTags: replaceStatusTag(this.getForum().availableTags, [], ticket.status ?? "open"),
      message: {
        content: leads.map((id) => `<@${id}>`).join(" ") || undefined,
        embeds: batches[0],
        allowedMentions: { parse: [], users: leads },
      },
    });
    // Persist before the API acknowledgement so a retry cannot create another post.
    repo.storePluginPost(ticket.id, post.id, ticket.discord_id);
    // Wizard reports fit the starter. Preserve unusually long legacy reports as continuations.
    for (const embeds of batches.slice(1)) await post.send({ embeds, allowedMentions: { parse: [] } });
    await this.api.setPost(ticket.id, post.id);
    repo.acknowledge(post.id);
  }

  async createNativePost(description: string, reporterId: string): Promise<ThreadChannel> {
    const leads = await this.mentionLeads();
    const post = await this.getForum().threads.create({
      name: description.replace(/\s+/g, " ").slice(0, 100),
      appliedTags: [this.tag("open")],
      message: {
        content: [`Reporter: <@${reporterId}>`, ...leads.map((id) => `<@${id}>`)].join(" "),
        embeds: [new EmbedBuilder().setTitle("Bug Report").setDescription(description.slice(0, 4000))],
        allowedMentions: { parse: [], users: leads },
      },
    });
    repo.storeNativePost(post.id);
    return post;
  }

  async deletionTarget(guildId: string, postId: string, actorId: string): Promise<ThreadChannel> {
    const forum = this.getForum();
    if (guildId !== forum.guildId) throw new Error("Use this command in the configured bug Forum's server.");
    const member = await forum.guild.members.fetch({ user: actorId, force: true });
    if (!member.permissions.has(PermissionFlagsBits.ManageGuild) || !member.permissions.has(PermissionFlagsBits.ManageThreads))
      throw new Error("Manage Server and Manage Threads are required.");
    const thread = await forum.threads.fetch(postId);
    if (!thread || thread.parentId !== forum.id || !repo.byPost(postId)) throw new Error("Choose a tracked RCSupport report thread in the configured Forum.");
    if (!thread.permissionsFor(member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageThreads])) throw new Error("You need View Channel and Manage Threads in this report thread.");
    if (!thread.client.user || !thread.permissionsFor(thread.client.user)?.has(PermissionFlagsBits.ManageThreads)) throw new Error("The bot needs permission to delete this thread (Manage Threads).");
    return thread;
  }
  async deleteReportThread(guildId: string, postId: string, actorId: string): Promise<void> {
    await this.serial(postId, async () => {
      const thread = await this.deletionTarget(guildId, postId, actorId);
      await thread.delete(`RCSupport thread deletion confirmed by ${actorId}`);
      repo.recordThreadDeleted(postId, actorId);
    });
  }

  private async closingActor(thread: ThreadChannel, newTags: readonly string[]): Promise<{ name: string; time: number; key: string }> {
    const now = Date.now();
    try {
      for (const wait of [0, 350, 850]) {
        if (wait) await delay(wait);
        const logs = await thread.guild.fetchAuditLogs({ type: AuditLogEvent.ThreadUpdate, limit: 10 });
        const candidates = logs.entries.filter(entry => entry.target?.id === thread.id && Math.abs(now - entry.createdTimestamp) < 30000 &&
          (entry.changes as ReadonlyArray<{key: string; new?: unknown}>).some(change => change.key === "applied_tags" && Array.isArray(change.new) &&
            [...change.new].map((tag: any) => typeof tag === "string" ? tag : tag.id).sort().join(",") === [...newTags].sort().join(",")));
        if (candidates.size === 1) {
          const entry = candidates.first()!;
          if (entry.executor?.username) return { name: entry.executor.username, time: Math.floor(entry.createdTimestamp / 1000), key: entry.id };
        }
      }
    } catch { /* No audit-log permission or entry yet: do not invent an actor. */ }
    console.warn(`RCSupport could not identify the closer of thread ${thread.id}; View Audit Log is needed for Discord-side attribution.`);
    return { name: "Unknown staff member", time: Math.floor(now / 1000), key: `${thread.id}:${now}` };
  }

  private async onMessage(message: Message): Promise<void> {
    if (!message.channel.isThread() || message.channel.parentId !== this.config.forumChannelId) return;
    const mapped = repo.byPost(message.channelId);
    if (!shouldForwardReply(mapped, message.author.id, message.author.bot)) return;
    if (!message.content.trim()) return;
    await this.api.reply(mapped!.pluginTicketId!,
      message.member?.displayName ?? message.author.username, message.content);
  }

  private async onThreadUpdate(oldThread: ThreadChannel, newThread: ThreadChannel): Promise<void> {
    if (newThread.parentId !== this.config.forumChannelId) return;
    if (oldThread.appliedTags.join(",") === newThread.appliedTags.join(",")) return;
    const mapped = repo.byPost(newThread.id);
    if (!mapped || repo.threadDeleted(newThread.id)) return;
    const selected = STATUSES.filter((status) => newThread.appliedTags.includes(this.tag(status)));
    if (selected.length !== 1) { console.warn(`RCSupport post ${newThread.id} must have exactly one status tag`); return; }
    const previous = STATUSES.filter((status) => oldThread.appliedTags.includes(this.tag(status)));
    if (previous.length === 1 && previous[0] === selected[0]) return;
    const echo = this.tagSignature(newThread.id, newThread.appliedTags);
    if ((this.ownTagUpdates.get(echo) ?? 0) >= Date.now()) { this.ownTagUpdates.delete(echo); return; }
    await this.serial(newThread.id, async () => {
      const closes = previous.length === 1 && !isClosed(previous[0]) && isClosed(selected[0]);
      const actor = closes ? await this.closingActor(newThread, newThread.appliedTags) : null;
      if (!shouldSyncStatus(mapped)) {
        if (actor) repo.queueClosure(`native:${actor.key}`, newThread.id, actor.name, actor.time);
        const tags = replaceStatusTag(this.getForum().availableTags, newThread.appliedTags, selected[0]);
        if (this.tagSignature(newThread.id, tags) !== this.tagSignature(newThread.id, newThread.appliedTags)) {
          this.ownTagUpdates.set(this.tagSignature(newThread.id, tags), Date.now() + 300000);
          await newThread.setAppliedTags(tags, "Update RCSupport Closed label");
        }
        if (actor) await deliverClosure(newThread, repo.queueClosure(`native:${actor.key}`, newThread.id, actor.name, actor.time));
        return;
      }
      const current = await this.api.ticket(mapped!.pluginTicketId!);
      if (current.ticket.status === selected[0]) return;
      if (previous.length !== 1 || previous[0] !== current.ticket.status) {
        void this.poll().catch(e => console.error("RCSupport concurrent status reconciliation failed:", e)); return;
      }
      // Compare-and-set prevents a delayed Discord change overwriting a newer in-game decision.
      await this.api.status(mapped!.pluginTicketId!, selected[0], actor?.name, current.revision);
    });
  }
}
