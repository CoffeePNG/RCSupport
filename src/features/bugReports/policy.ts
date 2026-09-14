import { PostMapping } from "./types";

export function shouldCreatePost(mapping: PostMapping | null, apiPostId: string | null | undefined): boolean {
  // Gson omits null record fields by default; both forms mean no Forum post yet.
  return mapping === null && apiPostId == null;
}
export function shouldNotifyReporter(mapping: PostMapping | null, authorId: string, isBot: boolean): boolean {
  return !isBot && mapping !== null && mapping.pluginTicketId !== null &&
    authorId !== mapping.reporterDiscordId;
}
export function shouldSyncStatus(mapping: PostMapping | null): boolean {
  return mapping !== null && mapping.pluginTicketId !== null;
}
