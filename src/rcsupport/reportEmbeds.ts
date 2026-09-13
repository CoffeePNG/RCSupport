import { EmbedBuilder } from "discord.js";
import { PluginTicket } from "./types";

/** Each batch fits a Discord message, without truncating accepted report fields. */
export function reportEmbedBatches(ticket: PluginTicket): EmbedBuilder[][] {
  const location = ticket.world && ticket.x != null && ticket.y != null && ticket.z != null
    ? `${ticket.world} (${ticket.x.toFixed(1)}, ${ticket.y.toFixed(1)}, ${ticket.z.toFixed(1)})` : "Not recorded";
  const fields: [string, string][] = [
    ["Title", ticket.title || `Bug #${ticket.id}`],
    ["Category", ticket.category || "Other (legacy report)"],
    ["Description", ticket.description],
    ["Reporter", `${ticket.reporter_name} (<@${ticket.discord_id}>)`],
    ["Server", ticket.server_id], ["Location", location],
  ];
  if (ticket.reproduction_steps) fields.push(["Reproduction steps", ticket.reproduction_steps]);
  if (ticket.item_attachment) fields.push(["Attached item", ticket.item_attachment]);
  if (ticket.url_attachment) fields.push(["Screenshot / video link", ticket.url_attachment]);
  const batches: EmbedBuilder[][] = [];
  let embed = new EmbedBuilder().setTitle(`RCSupport • Bug #${ticket.id}`);
  let size = embed.data.title!.length;
  let count = 0;
  for (const [label, value] of fields) {
    const content = value || "Not provided";
    for (let offset = 0; offset < content.length;) {
      let end = Math.min(offset + 1024, content.length);
      // Do not split a UTF-16 surrogate pair at a Discord field boundary.
      if (end < content.length && /[\uD800-\uDBFF]/.test(content[end - 1])) end--;
      const text = content.slice(offset, end);
      const name = offset ? `${label} (continued)` : label;
      if (size + name.length + text.length > 5800 || count === 25) {
        batches.push([embed]);
        embed = new EmbedBuilder().setTitle(`RCSupport • Bug #${ticket.id} (continued)`);
        size = embed.data.title!.length; count = 0;
      }
      embed.addFields({ name, value: text });
      size += name.length + text.length; count++;
      offset = end;
    }
  }
  batches.push([embed]);
  return batches;
}
