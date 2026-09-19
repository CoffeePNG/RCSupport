import { ChannelType, Client, OverwriteType, PermissionFlagsBits, TextChannel } from "discord.js";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const permissions = ["SendMessages", "SendMessagesInThreads", "CreatePublicThreads", "CreatePrivateThreads"] as const;
type Speaking = typeof permissions[number];
type SavedOverwrite = { id: string; values: Record<Speaking, boolean | null> };
type Lock = { channelId: string; until: number; overwrites: SavedOverwrite[] };

/** Persist before changing Discord so an interrupted lock can always be restored. */
export class ZenService {
  private locks: Lock[];
  private busy = new Set<string>();
  private timer?: NodeJS.Timeout;

  constructor(private client: Client, private path: string) {
    this.locks = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : [];
  }

  private save() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(`${this.path}.tmp`, JSON.stringify(this.locks), { mode: 0o600 });
    renameSync(`${this.path}.tmp`, this.path);
  }

  start() {
    if (this.timer) return;
    void this.expire();
    this.timer = setInterval(() => void this.expire(), 5000);
    this.timer.unref();
  }

  async lock(channel: TextChannel, duration: number) {
    if (this.busy.has(channel.id) || this.locks.some(lock => lock.channelId === channel.id)) {
      throw new Error("This channel is already in the chill zone.");
    }
    this.busy.add(channel.id);
    try {
      await channel.fetch();
      // Deny @everyone and existing role/member allows; member allows otherwise bypass role denies.
      const ids = new Set([channel.guild.id]);
      for (const overwrite of channel.permissionOverwrites.cache.values()) {
        if (overwrite.id === this.client.user!.id) continue;
        if (overwrite.type === OverwriteType.Role || permissions.some(p => overwrite.allow.has(PermissionFlagsBits[p]))) ids.add(overwrite.id);
      }
      const lock: Lock = { channelId: channel.id, until: Date.now() + duration, overwrites: [...ids].map(id => {
        const overwrite = channel.permissionOverwrites.cache.get(id);
        return { id, values: Object.fromEntries(permissions.map(p => [p,
          overwrite?.allow.has(PermissionFlagsBits[p]) ? true : overwrite?.deny.has(PermissionFlagsBits[p]) ? false : null,
        ])) as SavedOverwrite["values"] };
      }) };
      this.locks.push(lock);
      this.save();
      try {
        for (const overwrite of lock.overwrites) {
          await channel.permissionOverwrites.edit(overwrite.id, Object.fromEntries(permissions.map(p => [p, false])), { reason: "Temporary /zen chill zone" });
        }
      } catch (error) {
        lock.until = 0;
        this.save();
        try { await this.restore(channel, lock); } catch (restoreError) { console.error("Zen rollback will retry:", restoreError); }
        throw error;
      }
      return lock.until;
    } finally { this.busy.delete(channel.id); }
  }

  private async restore(channel: TextChannel, lock: Lock) {
    for (const overwrite of lock.overwrites) {
      if (!channel.permissionOverwrites.cache.has(overwrite.id)) continue;
      await channel.permissionOverwrites.edit(overwrite.id, overwrite.values, { reason: "/zen duration ended; restoring speaking permissions" });
    }
    this.locks = this.locks.filter(item => item !== lock);
    this.save();
  }

  async expire() {
    for (const lock of [...this.locks]) {
      if (lock.until > Date.now() || this.busy.has(lock.channelId)) continue;
      this.busy.add(lock.channelId);
      try {
        const channel = await this.client.channels.fetch(lock.channelId, { force: true });
        if (channel?.type === ChannelType.GuildText) await this.restore(channel, lock);
      } catch (error) { console.error(`Failed to restore /zen in ${lock.channelId}; will retry:`, error); }
      finally { this.busy.delete(lock.channelId); }
    }
  }
}

let service: ZenService | undefined;
export function startZen(client: Client, path: string) {
  service = new ZenService(client, path);
  service.start();
}
export function getZen(): ZenService {
  if (!service) throw new Error("Zen is not ready yet. Please try again shortly.");
  return service;
}
