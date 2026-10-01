import { readFileSync } from "node:fs";
import { positions } from "./hierarchy";
export const capabilities = ["view","hire","fire","assign","remove","vacancy","roster"] as const;
export type Capability = typeof capabilities[number];
export interface StaffSettings {
  /** Display-only role tags; these never grant or remove Discord roles. */
  rosterRoleIds?: Record<string,string>;
  adminRoleIds: string[];
  permissions: Partial<Record<Capability,string[]>>;
  roleBindings: {position:string;senior?:boolean;guildId:string;roleId:string}[];
}
export function loadStaffSettings(path = process.env.STAFF_CONFIG_PATH): StaffSettings {
  if (!path) return {adminRoleIds:[],permissions:{},roleBindings:[]};
  const value = JSON.parse(readFileSync(path,"utf8"));
  const ids = (list: unknown): list is string[] => Array.isArray(list) && list.every(id => typeof id === "string" && /^\d{17,20}$/.test(id));
  if (!value || !ids(value.adminRoleIds) || !value.permissions || typeof value.permissions !== "object" || Array.isArray(value.permissions)
    || Object.entries(value.permissions).some(([key,list]) => !capabilities.includes(key as Capability) || !ids(list))
    || !Array.isArray(value.roleBindings)) throw new Error("Invalid staff configuration: expected adminRoleIds, permissions and roleBindings.");
  if (value.rosterRoleIds !== undefined && (!value.rosterRoleIds || typeof value.rosterRoleIds !== "object"
    || Array.isArray(value.rosterRoleIds) || Object.entries(value.rosterRoleIds).some(([position,id]) =>
      !positions.some(p => p.id === position) || !ids([id])))) throw new Error("Invalid roster role labels.");
  for (const binding of value.roleBindings) {
    const position = positions.find(position => position.id === binding.position);
    if (!position || !ids([binding.guildId,binding.roleId]) || (binding.senior !== undefined && typeof binding.senior !== "boolean")
      || (binding.senior === true && !position.seniority)) throw new Error("Invalid staff role binding.");
  }
  return value;
}
