/** Replaces `{key}` placeholders in a template with values from `vars`; unknown keys are left as-is. */
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}

/** Renders the `{leads}` line for a ticket's open message. */
export function formatLeadsMention(leadIds: string[]): string {
  if (leadIds.length === 0) {
    return "No leads are currently assigned to this department yet — a wider team member will pick this up.";
  }
  return `Current leads for this department: ${leadIds.map((id) => `<@${id}>`).join(", ")}`;
}

/** Lowercases and strips a string down to Discord's channel-name-safe charset. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20) || "user";
}

/** Builds a ticket channel name; the ticket ID suffix matches the "Ticket #" shown in its embed/archive log. */
export function buildChannelName(channelPrefix: string, username: string, ticketId: number): string {
  return `${slugify(channelPrefix)}-${slugify(username)}-${ticketId}`.slice(0, 90);
}
