import { GuildScope, guildConfiguration } from "../config/guilds";
import { ModuleDefinition } from "./types";

export const ticketModule: ModuleDefinition = { id: "tickets", guildIds: GuildScope.PUBLIC };
export const archiveModule: ModuleDefinition = { id: "archive", guildIds: GuildScope.STAFF };
// Unreviewed features keep their existing placement and feature-specific authorization.
export const todoModule: ModuleDefinition = { id: "todo" };
export const bugReportModule: ModuleDefinition = { id: "bugReports" };

// New staff management requires explicit configuration; never infer its home from the legacy archive pin.
export const staffModule: ModuleDefinition = { id: "staff", guildIds: guildConfiguration.staff ? [guildConfiguration.staff] : [] };
