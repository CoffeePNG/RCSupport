import { STATUSES, TicketStatus } from "./types";

export const STATUS_PRESENTATION: Record<TicketStatus, { name: string; emoji: string }> = {
  open: { name: "Open", emoji: "🔴" },
  acknowledged: { name: "Acknowledged", emoji: "👀" },
  in_progress: { name: "In Progress", emoji: "🔧" },
  resolved: { name: "Resolved", emoji: "✅" },
  wontfix: { name: "Not Planned", emoji: "⛔" },
};
export const CLOSED_TAG_NAME = "Closed";
export const isClosed = (status: TicketStatus): boolean => status === "resolved" || status === "wontfix";
export function statusKey(name: string): TicketStatus | undefined {
  if (name === "Won’t Fix" || name === "Won't Fix" || name === "Won\uFFFDt Fix") return "wontfix";
  return STATUSES.find(key => key === name || STATUS_PRESENTATION[key].name === name);
}
interface Tag { id: string; name: string; moderated: boolean; emoji: { id: string | null; name: string | null } | null }
export function planStatusTags(tags: readonly Tag[]) {
  for (const status of STATUSES) {
    if (tags.filter(tag => statusKey(tag.name) === status).length > 1)
      throw new Error(`Ambiguous RCSupport tags for ${status}. Resolve the duplicate tags before setup; no tags were changed.`);
  }
  const closed = tags.filter(tag => tag.name === CLOSED_TAG_NAME);
  if (closed.length > 1) throw new Error("Ambiguous Closed tags. Resolve duplicates before setup; no tags were changed.");
  let changed = false;
  const result: Array<{ id?: string; name: string; moderated: boolean; emoji: { id: string | null; name: string | null } | null }> = tags.map(tag => {
    const key = statusKey(tag.name);
    if (!key) return tag;
    const presentation = STATUS_PRESENTATION[key];
    if (tag.name === presentation.name && tag.emoji?.name === presentation.emoji && !tag.emoji?.id) return tag;
    changed = true;
    return { ...tag, name: presentation.name, emoji: { id: null, name: presentation.emoji } };
  });
  for (const status of STATUSES) if (!tags.some(tag => statusKey(tag.name) === status)) {
    changed = true;
    result.push({ name: STATUS_PRESENTATION[status].name, moderated: false, emoji: { id: null, name: STATUS_PRESENTATION[status].emoji } });
  }
  if (!closed.length) {
    changed = true; result.push({ name: CLOSED_TAG_NAME, moderated: false, emoji: { id: null, name: "🔒" } });
  }
  if (result.length > 20) throw new Error("The bug Forum has no room for missing status tags. Remove unused tags and retry setup.");
  return { changed, tags: result };
}
export function statusTagId(tags: readonly { id: string; name: string }[], status: TicketStatus): string {
  const matches = tags.filter(tag => statusKey(tag.name) === status);
  if (matches.length !== 1) throw new Error(`Missing or ambiguous RCSupport status tag: ${status}`);
  return matches[0].id;
}
export function replaceStatusTag(tags: readonly { id: string; name: string }[], applied: readonly string[], status: TicketStatus): string[] {
  const custom = applied.filter(id => !tags.some(tag => tag.id === id && (statusKey(tag.name) || tag.name === CLOSED_TAG_NAME)));
  const statusTags = [statusTagId(tags, status)];
  if (isClosed(status)) {
    const closed = tags.filter(tag => tag.name === CLOSED_TAG_NAME);
    if (closed.length !== 1) throw new Error("Missing or ambiguous Closed tag; run /br setup.");
    statusTags.push(closed[0].id);
  }
  if (custom.length + statusTags.length > 5) throw new Error("Post has too many custom tags for its status and Closed tags. Custom tags were preserved.");
  return [...custom, ...statusTags];
}
