export const STATUSES = ["open", "acknowledged", "in_progress", "resolved", "wontfix"] as const;
export type TicketStatus = typeof STATUSES[number];
export type AlertMode = "broadcast" | "leads";

export interface PluginTicket {
  id: number;
  reporter_uuid: string;
  reporter_name: string;
  discord_id: string;
  description: string;
  world: string | null;
  x: number | null;
  y: number | null;
  z: number | null;
  server_id: string;
  status: TicketStatus;
  discord_post_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface PostMapping {
  discordPostId: string;
  pluginTicketId: number | null;
  reporterDiscordId: string | null;
  apiAcknowledged: boolean;
}
