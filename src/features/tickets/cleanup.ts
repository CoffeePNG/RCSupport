import type { Client } from "discord.js";
import { pendingTicketCleanup, recordTicketCleanup } from "./ticketRepo";
let running = false;
let timer: ReturnType<typeof setInterval> | undefined;
export async function retryTicketCleanup(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (const ticket of pendingTicketCleanup()) {
      try {
        const channel = await client.channels.fetch(ticket.channelId);
        if (channel) {
          if (!("guildId" in channel) || channel.guildId !== ticket.guildId) throw new Error("Ticket channel guild does not match.");
          await channel.delete("Closed ticket; transcript saved by RCSupport");
        }
        recordTicketCleanup(ticket.id, null);
      } catch (error) {
        if ((error as {code?:number}).code === 10003) recordTicketCleanup(ticket.id, null);
        else {
          recordTicketCleanup(ticket.id, (error as Error).message.slice(0,1000));
          console.error(`Ticket #${ticket.id} channel cleanup will retry:`, error);
        }
      }
    }
  } finally { running = false; }
}
export function startTicketCleanup(client: Client): void {
  if (timer) return;
  const tick = () => retryTicketCleanup(client).catch(error => console.error("Ticket cleanup failed:", error));
  timer = setInterval(() => { void tick(); }, 15_000); timer.unref();
  void tick();
}
