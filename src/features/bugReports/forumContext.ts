import type { ForumChannel, ThreadChannel } from "discord.js";
import type { AlertModeCache, BridgeClient } from "./api";
import type { BridgeConfig } from "./config";
import type { PluginTicket, TicketStatus, StatusUpdate } from "./types";

export interface ForumContext {
  api: BridgeClient;
  alerts: AlertModeCache;
  config: BridgeConfig;
  ownTagUpdates: Map<string, number>;
  getForum(): ForumChannel;
  tag(status: TicketStatus): string;
  tagSignature(postId: string, tags: readonly string[]): string;
  serial<T>(postId: string, work: () => Promise<T>): Promise<T>;
  requestPoll(): void;
  poll(): Promise<void>;
  reportSyncError(id: number, operation: string, error: unknown): void;
  leads(): string[];
  mentionLeads(): Promise<string[]>;
  createPluginPost(ticket: PluginTicket): Promise<void>;
  deletionTarget(guildId: string, postId: string, actorId: string, requireClosed?: boolean): Promise<ThreadChannel>;
  closingActor(thread: ThreadChannel, tags: readonly string[]): Promise<{name: string; time: number; key: string}>;
  syncStatusUpdate(update: StatusUpdate): Promise<void>;
}
