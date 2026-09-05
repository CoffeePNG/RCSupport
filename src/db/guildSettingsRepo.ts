import { db } from "./connect";
import { GuildSettings } from "../types/ticket";

/**
 * Archive logging is three-state: a channel, unset (fall back to the mod-log
 * channel), or off. The off state rides in the channel column as a sentinel,
 * which never escapes this module: callers see a channel ID or a boolean.
 */
const ARCHIVE_LOG_OFF = "off";

export function getGuildSettings(guildId: string): GuildSettings {
  const row = db
    .prepare(`SELECT * FROM guild_settings WHERE guild_id = ?`)
    .get(guildId) as any;
  return {
    guildId,
    modLogChannelId: row ? row.mod_log_channel_id : null,
    panelChannelId: row ? row.panel_channel_id : null,
    panelMessageId: row ? row.panel_message_id : null,
    panelTitle: row ? row.panel_title : null,
    panelDescription: row ? row.panel_description : null,
    todoPanelChannelId: row ? row.todo_panel_channel_id : null,
    todoPanelMessageId: row ? row.todo_panel_message_id : null,
    archiveLogChannelId:
      row && row.archive_log_channel_id !== ARCHIVE_LOG_OFF
        ? row.archive_log_channel_id
        : null,
    archiveLogDisabled: !!row && row.archive_log_channel_id === ARCHIVE_LOG_OFF,
  };
}

/** Pass null to turn archive logging off; it stops falling back to the mod-log channel. */
export function setArchiveLogChannel(guildId: string, channelId: string | null): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, archive_log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET archive_log_channel_id = excluded.archive_log_channel_id`
  ).run(guildId, channelId ?? ARCHIVE_LOG_OFF);
}

export function setModLogChannel(guildId: string, channelId: string): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, mod_log_channel_id)
     VALUES (?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET mod_log_channel_id = excluded.mod_log_channel_id`
  ).run(guildId, channelId);
}

export function setPanelInfo(guildId: string, channelId: string, messageId: string): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, panel_channel_id, panel_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       panel_channel_id = excluded.panel_channel_id,
       panel_message_id = excluded.panel_message_id`
  ).run(guildId, channelId, messageId);
}

export function setTodoPanelInfo(guildId: string, channelId: string, messageId: string): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, todo_panel_channel_id, todo_panel_message_id)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       todo_panel_channel_id = excluded.todo_panel_channel_id,
       todo_panel_message_id = excluded.todo_panel_message_id`
  ).run(guildId, channelId, messageId);
}

/** Sets the panel's title/description; pass null for either to reset it back to the default. */
export function setPanelText(guildId: string, title: string | null, description: string | null): void {
  db.prepare(
    `INSERT INTO guild_settings (guild_id, panel_title, panel_description)
     VALUES (?, ?, ?)
     ON CONFLICT(guild_id) DO UPDATE SET
       panel_title = excluded.panel_title,
       panel_description = excluded.panel_description`
  ).run(guildId, title, description);
}
