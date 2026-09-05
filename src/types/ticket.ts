export interface TicketTypeConfig {
  id: number;
  guildId: string;
  typeKey: string;
  displayName: string;
  department: string;
  channelPrefix: string;
  reviewChannelId: string | null;
  openMessage: string;
  claimMessage: string;
  optionDescription: string | null;
}

export type TicketStatus = "open" | "claimed" | "closed";

export interface Ticket {
  id: number;
  guildId: string;
  typeKey: string;
  creatorId: string;
  channelId: string;
  messageId: string | null;
  status: TicketStatus;
  claimedBy: string | null;
  createdAt: number;
  claimedAt: number | null;
  closedAt: number | null;
  closedBy: string | null;
}

export interface Warning {
  id: number;
  guildId: string;
  userId: string;
  moderatorId: string;
  reason: string;
  createdAt: number;
  active: boolean;
}

export interface GuildSettings {
  guildId: string;
  modLogChannelId: string | null;
  panelChannelId: string | null;
  panelMessageId: string | null;
  panelTitle: string | null;
  panelDescription: string | null;
  todoPanelChannelId: string | null;
  todoPanelMessageId: string | null;
  /** Where /archive exports are logged. Null falls back to the mod-log channel. */
  archiveLogChannelId: string | null;
  /** Set when archive logging is turned off outright, rather than just unset. */
  archiveLogDisabled: boolean;
}

export type TodoStatus = "open" | "done";

export interface Todo {
  id: number;
  guildId: string;
  title: string;
  content: string | null;
  assigneeId: string | null;
  createdBy: string;
  status: TodoStatus;
  createdAt: number;
  completedAt: number | null;
  completedBy: string | null;
}
