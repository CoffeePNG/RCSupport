import {
  ChannelType, Client, EmbedBuilder, ForumChannel, Message, ThreadChannel,
} from "discord.js";
import { getLeads, getTicketType } from "../db/ticketConfigRepo";
import { AlertModeCache, BridgeClient } from "./api";
import { BridgeConfig } from "./config";
import * as repo from "./repo";
import { PluginTicket, STATUSES, TicketStatus } from "./types";
import { shouldCreatePost, shouldForwardReply, shouldSyncStatus } from "./policy";

export class RCSupportForum {
  readonly api: BridgeClient;
  readonly alerts: AlertModeCache;
  readonly config: BridgeConfig;
  private forum: ForumChannel | null = null;
  private polling = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(config: BridgeConfig) {
    this.config = config;
    this.api = new BridgeClient(config);
    this.alerts = new AlertModeCache(async () => (await this.api.configMode()).alert_mode, config.alertModeCacheMs);
  }

  async start(client: Client): Promise<void> {
    const channel = await client.channels.fetch(this.config.forumChannelId);
    if (!channel || channel.type !== ChannelType.GuildForum)
      throw new Error("RCSUPPORT_FORUM_CHANNEL_ID does not identify a Forum channel");
    const missing = STATUSES.filter((status) => !channel.availableTags.some((tag) => tag.name === status));
    if (missing.length) throw new Error(`RCSupport Forum is missing status tags: ${missing.join(", ")}`);
    this.forum = channel;
    client.on("messageCreate", (message) => { void this.onMessage(message).catch((e) => console.error("RCSupport reply sync failed:", e)); });
    client.on("threadUpdate", (oldThread, newThread) => {
      void this.onThreadUpdate(oldThread, newThread).catch((e) => console.error("RCSupport status sync failed:", e));
    });
    await this.poll().catch((e) => console.error("RCSupport initial poll failed:", e));
    this.timer = setInterval(() => { void this.poll().catch((e) => console.error("RCSupport poll failed:", e)); }, this.config.pollIntervalMs);
  }

  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  getForum(): ForumChannel {
    if (!this.forum) throw new Error("RCSupport Forum has not been validated yet");
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
    if (this.polling || !this.forum) return;
    this.polling = true;
    try {
      await this.acknowledgePending();
      const startedAt = Math.floor(Date.now() / 1000);
      const tickets = await this.api.tickets(repo.pollTimestamp());
      for (const ticket of tickets) {
        const known = repo.byPluginTicket(ticket.id);
        if (known) continue;
        // Also respect the plugin's post ID if a previous bot instance created it.
        if (ticket.discord_post_id) {
          repo.storePluginPost(ticket.id, ticket.discord_post_id, ticket.discord_id);
          repo.acknowledge(ticket.discord_post_id);
          continue;
        }
        if (shouldCreatePost(known, ticket.discord_post_id)) await this.createPluginPost(ticket);
      }
      repo.setPollTimestamp(startedAt);
    } finally { this.polling = false; }
  }

  private async createPluginPost(ticket: PluginTicket): Promise<void> {
    const leads = await this.mentionLeads();
    const location = ticket.world && ticket.x !== null && ticket.y !== null && ticket.z !== null
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
