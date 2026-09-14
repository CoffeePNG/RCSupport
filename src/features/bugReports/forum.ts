import { ChannelType, Client, ForumChannel, Message, PermissionFlagsBits, ThreadChannel } from "discord.js";
import { db } from "../../db/connect";
import { AlertModeCache, BridgeClient } from "./api";
import { BridgeConfig } from "./config";
import { subscribeReports } from "./events";
import type { ForumContext } from "./forumContext";
import * as historySync from "./historySync";
import { shouldCreatePost } from "./policy";
import * as posts from "./posts";
import * as repo from "./repo";
import * as statusSync from "./statusSync";
import { planStatusTags, statusTagId } from "./statusTags";
import { PluginTicket, StatusUpdate, TicketStatus } from "./types";

export class RCSupportForum {
  private readonly context: ForumContext;
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
    this.context = {
      api: this.api, alerts: this.alerts, config: this.config, ownTagUpdates: this.ownTagUpdates,
      getForum: () => this.getForum(), tag: status => this.tag(status),
      tagSignature: (id, tags) => this.tagSignature(id, tags),
      serial: (id, work) => this.serial(id, work),
      requestPoll: () => { this.pollAgain = true; }, poll: () => this.poll(),
      reportSyncError: (id, operation, error) => this.reportSyncError(id, operation, error),
      leads: () => this.leads(), mentionLeads: () => this.mentionLeads(),
      createPluginPost: ticket => this.createPluginPost(ticket),
      deletionTarget: (guild, post, actor) => this.deletionTarget(guild, post, actor),
      closingActor: (thread, tags) => this.closingActor(thread, tags),
      syncStatusUpdate: update => this.syncStatusUpdate(update),
    };
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
  async poll(): Promise<void> {
    if (!this.forum) return;
    if (this.polling) { this.pollAgain = true; return; }
    this.polling = true;
    this.syncError = null;
    try {
      // Process durable changes before the legacy open-report listing. A large open
      // listing or an individual deleted post must not starve closed status updates.
      await statusSync.reconcileStatuses(this.context);
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
      await this.reconcileHistories();
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

  private reportSyncError(id: number, operation: string, error: unknown): void {
    const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
    const hint = code === "50013" || code === "50001"
      ? "Check the bot's View Channel, Send Messages, Send Messages in Threads, and Embed Links permissions."
      : "Check the bot logs for details; synchronization will retry.";
    this.syncError = `Report #${id}: could not ${operation}. ${hint}`;
    console.error(`RCSupport report #${id} failed to ${operation}:`, error);
  }

  private leads(): string[] {
    return posts.leads(this.context);
  }
  private mentionLeads(): Promise<string[]> {
    return posts.mentionLeads(this.context);
  }
  private acknowledgePending(): Promise<void> {
    return posts.acknowledgePending(this.context);
  }
  /** Repair the existing starter, preserving replies and status tags. */
  refreshReport(guildId: string, id: number): Promise<string> {
    return posts.refreshReport(this.context, guildId, id);
  }
  private createPluginPost(ticket: PluginTicket): Promise<void> {
    return posts.createPluginPost(this.context, ticket);
  }
  createNativePost(description: string, reporterId: string): Promise<ThreadChannel> {
    return posts.createNativePost(this.context, description, reporterId);
  }
  deletionTarget(guildId: string, postId: string, actorId: string): Promise<ThreadChannel> {
    return posts.deletionTarget(this.context, guildId, postId, actorId);
  }
  deleteReportThread(guildId: string, postId: string, actorId: string): Promise<void> {
    return posts.deleteReportThread(this.context, guildId, postId, actorId);
  }
  private syncStatusUpdate(update: StatusUpdate): Promise<void> {
    return statusSync.syncStatusUpdate(this.context, update);
  }
  private closingActor(thread: ThreadChannel, newTags: readonly string[]): Promise<{ name: string; time: number; key: string }> {
    return statusSync.closingActor(this.context, thread, newTags);
  }
  private onThreadUpdate(oldThread: ThreadChannel, newThread: ThreadChannel): Promise<void> {
    return statusSync.onThreadUpdate(this.context, oldThread, newThread);
  }
  private reconcileHistories(): Promise<void> {
    return historySync.reconcileHistories(this.context);
  }
  private onMessage(message: Message): Promise<void> {
    return historySync.onMessage(this.context, message);
  }
}
