import type { Client } from "discord.js";
import { guildConfiguration } from "../../config/guilds";
let timer:ReturnType<typeof setInterval>|undefined;
export async function startStaff(client:Client):Promise<void> {
  if (!guildConfiguration.staff || timer) return;
  try {
    const {getStaffRuntime}=await import("./runtime");
    const runtime=getStaffRuntime(client);
    runtime.service.repo.queue();
    const tick=() => runtime.sync.sync().catch(error => console.error("Staff synchronization failed:",error));
    timer=setInterval(() => {void tick();},30_000);timer.unref();
    await tick();
  } catch(error) {console.error("Staff management could not start:",error);}
}
