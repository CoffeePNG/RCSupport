import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { validateSnapshot } from "./panel";

export interface ServerInformation {
  checked_at: number;
  id: string;
  name: string;
  hostname?: string | null;
  online: boolean;
  version?: string | null;
  whitelist?: boolean | null;
}

export function validateInformation(value: unknown, requestedId: string): ServerInformation {
  const data = value as ServerInformation | null;
  if (!data || data.id !== requestedId
    || (data.hostname != null && (typeof data.hostname !== "string" || data.hostname.length > 255))
    || (data.version != null && (typeof data.version !== "string" || data.version.length > 100))
    || (data.whitelist != null && typeof data.whitelist !== "boolean"))
    throw new Error("Invalid server information response");
  validateSnapshot({ checked_at: data.checked_at, servers: [data] });
  return data;
}

export function informationEmbed(info: ServerInformation): EmbedBuilder {
  const code = (value: string) => `\`${value.replace(/[`\r\n]/g, " ")}\``;
  return new EmbedBuilder().setTitle("Server Information")
    .setColor(info.online ? 0x57f287 : 0xed4245)
    .setDescription([
      `**[${escapeMarkdown(info.name)}]**`,
      `Hostname: ${code(info.hostname || "Not configured")}`,
      `Status: ${code(info.online ? "ONLINE" : "OFFLINE")} ${info.online ? "✅" : "❌"}`,
      `Version: ${code(info.version || "Unknown")}`,
      "",
      `Whitelist: ${code(info.whitelist === true ? "ACTIVE" : info.whitelist === false ? "INACTIVE" : "UNKNOWN")}`,
    ].join("\n"))
    .setFooter({ text: "Last checked" }).setTimestamp(info.checked_at * 1000);
}
