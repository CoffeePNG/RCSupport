import { PermissionFlagsBits } from "discord.js";
import { ModuleDefinition } from "../modules/types";

export interface AccessPolicy {
  module?: ModuleDefinition;
  guildIds?: readonly string[];
  requiredPermissions?: bigint;
}
export interface AccessContext {
  guildId: string | null;
  permissions: bigint;
}

/** Shared by command registration, Discord routing and future API adapters. */
export function isGuildAllowed(policy: AccessPolicy, guildId: string | null): boolean {
  return [policy.module?.guildIds, policy.guildIds].every(ids =>
    ids === undefined || (guildId !== null && ids.includes(guildId)));
}

export function accessDenial(policy: AccessPolicy, context: AccessContext): string | undefined {
  if (!isGuildAllowed(policy, context.guildId)) return "That action isn't available in this server.";
  const required = policy.requiredPermissions;
  if (required !== undefined && (!context.guildId || (
    (context.permissions & PermissionFlagsBits.Administrator) === 0n &&
    (context.permissions & required) !== required
  ))) return "You don't have permission to use that action.";
  return undefined;
}
