import { Client } from "discord.js";
import { db } from "../../db/connect";
import { guildConfiguration } from "../../config/guilds";
import { StaffRepository } from "./repository";
import { StaffService } from "./service";
import { loadStaffSettings } from "./settings";
import { discordAdapter, StaffSynchronizer } from "./sync";
let instance: {service:StaffService;sync:StaffSynchronizer}|undefined;
export function getStaffRuntime(client:Client) {
  if (!instance) {
    if (!guildConfiguration.staff) throw new Error("Set PUBLIC_GUILD_ID and STAFF_GUILD_ID before using staff management.");
    const repo=new StaffRepository(db,guildConfiguration.staff),settings=loadStaffSettings();
    instance={service:new StaffService(repo,settings),sync:new StaffSynchronizer(repo,settings,discordAdapter(client))};
  }
  return instance;
}
