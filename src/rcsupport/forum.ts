import {
  ChannelType, Client, EmbedBuilder, ForumChannel, Message, ThreadChannel, PermissionFlagsBits,
} from "discord.js";
import { getLeads, getTicketType } from "../db/ticketConfigRepo";
import { AlertModeCache, BridgeClient } from "./api";
import { BridgeConfig } from "./config";
import * as repo from "./repo";
import { PluginTicket, STATUSES, TicketStatus } from "./types";
import { shouldCreatePost, shouldForwardReply, shouldSyncStatus } from "./policy";
import { db } from "../db/connect";
import { subscribeReports } from "./events";

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
    const missing = STATUSES.filter((status) => !channel.availableTags.some((tag) => tag.name === status));
    if (missing.length) throw new Error(`RCSupport Forum is missing status tags: ${missing.join(", ")}`);
    this.forum = channel;
    console.log(`RCSupport Forum ready: guild=${channel.guildId} forum=${channel.id}; polling every ${this.config.pollIntervalMs}ms`);
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
      if (this.config.forumChannelId && this.config.forumChannelId !== channelId) {
        const count = db.prepare("SELECT COUNT(*) AS total FROM rcsupport_posts").get() as { total: number };
        if (count.total) throw new Error("This bridge already has reports in its current Forum. Moving existing reports requires a migration.");
      }
      const channel = await client.channels.fetch(channelId);
      if (!channel || channel.type !== ChannelType.GuildForum || channel.guildId !== guildId)
        throw new Error("Choose a Forum channel in this server.");
      const missing = STATUSES.filter((status) => !channel.availableTags.some((tag) => tag.name === status));
      if (missing.length) {
        if (!client.user || !channel.permissionsFor(client.user)?.has(PermissionFlagsBits.ManageChannels))
          throw new Error("Give the bot Manage Channels on this Forum so it can add missing status tags.");
        if (channel.availableTags.length + missing.length > 20)
          throw new Error("There is not enough room for the missing status tags. Remove unused Forum tags and try again.");
        await channel.setAvailableTags([
          ...channel.availableTags,
          ...missing.map((name) => ({ name, moderated: false })),
        ], "Configure RCSupport status tags");
      }
      db.prepare("INSERT INTO rcsupport_forum_settings (singleton, guild_id, channel_id) VALUES (1, ?, ?) ON CONFLICT(singleton) DO UPDATE SET guild_id = excluded.guild_id, channel_id = excluded.channel_id")
        .run(guildId, channelId);
      this.config.forumChannelId = channelId;
      await this.start(client);
    } finally { this.configuring = false; }
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
    const tag = this.getForum().availableTags.find((t) => t.name === status);
    if (!tag) throw new Error(`Missing RCSupport status tag: ${status}`);
    return tag.id;
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
      await this.api.setPost(pending.pluginTicketId!, pending.discordPostId);
      repo.acknowledge(pending.discordPostId);
    }
  }

  async poll(): Promise<void> {
    if (!this.forum) return;
    if (this.polling) { this.pollAgain = true; return; }
    this.polling = true;
    try {
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
          await this.createPluginPost(ticket);
          created++;
        }
      }
      const summary = `RCSupport poll OK: forum=${this.forum.id} received=${tickets.length} created=${created} already-mapped=${mapped} restored-mappings=${restored}`;
      if (summary !== this.lastPollSummary) console.log(summary);
      this.lastPollSummary = summary;
    } finally {
      this.polling = false;
      if (this.pollAgain) {
        this.pollAgain = false;
        void this.poll().catch(e => console.error("RCSupport queued poll failed:", e));
      }
    }
  }

  private async createPluginPost(ticket: PluginTicket): Promise<void> {
    const leads = await this.mentionLeads();
    const location = ticket.world && ticket.x != null && ticket.y != null && ticket.z != null
      ? `${ticket.world} (${ticket.x.toFixed(1)}, ${ticket.y.toFixed(1)}, ${ticket.z.toFixed(1)})` : "Not recorded";
    const embed = new EmbedBuilder()
      .setTitle(`Bug #${ticket.id}`)
      .setDescription(ticket.description.slice(0, 4000))
      .addFields({ name: "Server", value: ticket.server_id }, { name: "Location", value: location });
    const post = await this.getForum().threads.create({
      name: `#${ticket.id} ${ticket.description}`.replace(/\s+/g, " ").slice(0, 100),
      appliedTags: [this.tag("open")],
      message: {
        content: [`Reporter: <@${ticket.discord_id}>`, ...leads.map((id) => `<@${id}>`)].join(" "),
        embeds: [embed],
        allowedMentions: { parse: [], users: leads },
      },
    });
    // Persist before the API acknowledgement so a retry cannot create another post.
    repo.storePluginPost(ticket.id, post.id, ticket.discord_id);
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
    if (!shouldSyncStatus(mapped)) return;
    const selected = STATUSES.filter((status) => newThread.appliedTags.includes(this.tag(status)));
    if (selected.length !== 1) { console.warn(`RCSupport post ${newThread.id} must have exactly one status tag`); return; }
    const previous = STATUSES.filter((status) => oldThread.appliedTags.includes(this.tag(status)));
    if (previous.length === 1 && previous[0] === selected[0]) return;
    // Audit-log actor lookup is best effort and omitted when unavailable.
    await this.api.status(mapped!.pluginTicketId!, selected[0]);
  }
}
