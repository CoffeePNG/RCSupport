import { ChannelType, Client, EmbedBuilder, escapeMarkdown } from "discord.js";
import type Database from "better-sqlite3";

export interface ServerSnapshot {
  checked_at: number;
  servers: { id: string; name: string; online: boolean }[];
}
export interface StatusApi { serverStatus(): Promise<ServerSnapshot> }
interface PanelRow { guild_id: string; channel_id: string; message_id: string; interval_minutes: number; updated_at: number }

export function validateSnapshot(value: unknown): ServerSnapshot {
  const data = value as ServerSnapshot | null;
  if (!data || !Number.isSafeInteger(data.checked_at) || data.checked_at <= 0
    || !Array.isArray(data.servers) || data.servers.length > 25
    || data.servers.some(s => !s || typeof s.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(s.id)
      || typeof s.name !== "string" || !s.name.trim() || s.name.length > 80 || typeof s.online !== "boolean")
    || new Set(data.servers.map(s => s.id)).size !== data.servers.length)
    throw new Error("Invalid server-status response");
  // Never display a cached response as a fresh check (allow modest clock skew).
  const age = Date.now() / 1000 - data.checked_at;
  if (age > 300 || age < -300) throw new Error("Server-status response is stale or the bridge clock is incorrect");
  return data;
}

export function statusEmbed(snapshot: ServerSnapshot | null): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle("Server Status");
  if (!snapshot) return embed.setColor(0xf0ad4e)
    .setDescription("Status check unavailable. Could not get current results from the support bridge. Server statuses are unknown.")
    .setFooter({ text: "Check attempted" }).setTimestamp();
  embed.setColor(snapshot.servers.length && snapshot.servers.every(s => s.online) ? 0x57f287 : 0x99aab5)
    .setFooter({ text: "Last checked" }).setTimestamp(snapshot.checked_at * 1000);
  if (!snapshot.servers.length) return embed.setDescription("No servers configured. Add servers to the bridge's server-status.servers configuration.");
  const proxy = snapshot.servers.filter(s => s.id.toLowerCase() === "proxy");
  const backends = snapshot.servers.filter(s => s.id.toLowerCase() !== "proxy");
  const groups = [proxy, backends].filter(group => group.length).map(group => group.map(s => ({
    name: `[${escapeMarkdown(s.name).replace(/[\r\n]/g, " ")}]`,
    value: s.online ? "Online ✅" : "Offline ❌",
  })));
  const fields = groups.flat();
  const description = groups.map(group => group.map(f => `**${f.name}** - ${f.value}`).join("\n")).join("\n\n");
  return description.length <= 4096 ? embed.setDescription(description) : embed.addFields(fields);
}

export class ServerStatusPanel {
  private timer: NodeJS.Timeout | null = null;
  private readonly busy = new Set<string>();
  private ticking = false;
  constructor(private client: Client, private api: StatusApi, private db: Database.Database) {}

  start(): void {
    this.stop();
    void this.tick(true);
    this.timer = setInterval(() => void this.tick(), 30_000);
    this.timer.unref();
  }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = null; }
  private row(guild: string): PanelRow | undefined {
    return this.db.prepare("SELECT * FROM server_status_panels WHERE guild_id = ?").get(guild) as PanelRow | undefined;
  }
  private async channel(guild: string, id: string) {
    const channel = await this.client.channels.fetch(id);
    if (!channel || channel.type !== ChannelType.GuildText || channel.guildId !== guild)
      throw new Error("Choose an accessible text channel in this server.");
    return channel;
  }
  private async locked<T>(guild: string, action: () => Promise<T>): Promise<T> {
    if (this.busy.has(guild)) throw new Error("A status update is already running. Try again shortly.");
    this.busy.add(guild);
    try { return await action(); } finally { this.busy.delete(guild); }
  }
  async setup(guild: string, channelId: string, interval = 120, scheduled = false): Promise<void> {
    if (!Number.isInteger(interval) || interval < 1 || interval > 1440) throw new Error("Interval must be 1–1440 minutes.");
    await this.locked(guild, async () => {
      const previous = this.row(guild);
      if (previous && previous.channel_id !== channelId) {
        const oldChannel = await this.channel(guild, previous.channel_id);
        if (await this.existing(oldChannel, previous.message_id))
          throw new Error("Delete the existing status panel before choosing another channel.");
      }
      const channel = await this.channel(guild, channelId);
      let message = previous && previous.channel_id === channelId ? await this.existing(channel, previous.message_id) : null;
      if (scheduled && !message) {
        this.db.prepare("DELETE FROM server_status_panels WHERE guild_id = ?").run(guild);
        return;
      }
      let snapshot: ServerSnapshot | null = null;
      try { snapshot = validateSnapshot(await this.api.serverStatus()); }
      catch (error) { console.error("Server status check failed:", error); }
      const payload = { embeds: [statusEmbed(snapshot)], allowedMentions: { parse: [] as never[] } };
      try {
        if (message) message = await message.edit(payload); else message = await channel.send(payload);
      } catch (error) {
        if (scheduled && (error as { code?: number }).code === 10008) {
          this.db.prepare("DELETE FROM server_status_panels WHERE guild_id = ?").run(guild);
          return;
        }
        throw error;
      }
      this.db.prepare(`INSERT INTO server_status_panels (guild_id, channel_id, message_id, interval_minutes, updated_at)
        VALUES (?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id=excluded.channel_id,
        message_id=excluded.message_id, interval_minutes=excluded.interval_minutes, updated_at=excluded.updated_at`)
        .run(guild, channelId, message.id, interval, Date.now());
    });
  }
  private async existing(channel: Awaited<ReturnType<ServerStatusPanel["channel"]>>, id: string) {
    try {
      const message = await channel.messages.fetch({ message: id, force: true });
      if (message.author.id !== this.client.user?.id) throw new Error("Saved panel is not owned by this bot.");
      return message;
    } catch (error) {
      // Only a confirmed deletion permits creating a replacement; permission/network errors do not.
      if ((error as { code?: number }).code === 10008) return null;
      throw error;
    }
  }
  async refresh(guild: string): Promise<void> {
    const row = this.row(guild);
    if (!row) throw new Error("Run /server-status setup first.");
    await this.setup(guild, row.channel_id, row.interval_minutes, true);
  }
  async tick(force = false): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const rows = this.db.prepare("SELECT * FROM server_status_panels").all() as PanelRow[];
      for (const row of rows) {
        if (this.busy.has(row.guild_id) || (!force && Date.now() - row.updated_at < row.interval_minutes * 60_000)) continue;
        try { await this.refresh(row.guild_id); }
        catch (error) { console.error(`Server status panel update failed for ${row.guild_id}:`, error); }
      }
    } catch (error) { console.error("Server status scheduler failed:", error); }
    finally { this.ticking = false; }
  }
}

let activePanel: ServerStatusPanel | undefined;
export function startServerStatus(client: Client, api: StatusApi, db: Database.Database): void {
  activePanel?.stop();
  activePanel = new ServerStatusPanel(client, api, db);
  activePanel.start();
}
export function getServerStatusPanel(): ServerStatusPanel {
  if (!activePanel) throw new Error("The status service is not ready yet.");
  return activePanel;
}
