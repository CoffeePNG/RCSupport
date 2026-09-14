import { ensureTicketType } from "./ticketConfigRepo";

export interface TicketTypeSeed {
  typeKey: string;
  displayName: string;
  department: string;
  channelPrefix: string;
  openMessage: string;
  claimMessage: string;
  optionDescription: string;
}

export const DEFAULT_TICKET_TYPES: TicketTypeSeed[] = [
  {
    typeKey: "application",
    displayName: "Staff Application",
    department: "leadership",
    channelPrefix: "application",
    openMessage:
      "Thanks for applying! This is your staff application ticket for **{department}**.\n{leads}\n\nA lead will review your application and follow up here.",
    claimMessage: "{claimant} has claimed this application and will be reviewing it.",
    optionDescription: "Apply to join the staff team.",
  },
  {
    typeKey: "bug_report",
    displayName: "Bug Report",
    department: "development",
    channelPrefix: "bug",
    openMessage:
      "Thanks for the report! This ticket is routed to **{department}**.\n{leads}\n\nPlease include steps to reproduce, and screenshots/logs if you have them.",
    claimMessage: "{claimant} has claimed this bug report and is looking into it.",
    optionDescription: "Report a bug or glitch you've run into.",
  },
  {
    typeKey: "appeal",
    displayName: "Appeal",
    department: "moderation",
    channelPrefix: "appeal",
    openMessage:
      "This is your appeal ticket, routed to **{department}**.\n{leads}\n\nPlease explain what you're appealing and why.",
    claimMessage: "{claimant} has claimed this appeal and will be reviewing it.",
    optionDescription: "Appeal a ban, mute, or other moderation action.",
  },
  {
    typeKey: "help_request",
    displayName: "Help Request",
    department: "support",
    channelPrefix: "help",
    openMessage:
      "This is your help request, routed to **{department}**.\n{leads}\n\nDescribe what you need help with and someone will be with you shortly.",
    claimMessage: "{claimant} has claimed this help request.",
    optionDescription: "Get help with anything else.",
  },
];

export function seedDefaultTicketTypes(guildId: string): void {
  for (const seed of DEFAULT_TICKET_TYPES) {
    ensureTicketType({ guildId, ...seed });
  }
}
