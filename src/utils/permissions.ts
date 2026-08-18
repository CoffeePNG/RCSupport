import { PermissionFlagsBits, PermissionsBitField } from "discord.js";
import { isLead } from "../db/ticketConfigRepo";
import { Todo } from "../types/ticket";

export function hasManageGuild(
  permissions: PermissionsBitField | Readonly<PermissionsBitField> | null | undefined
): boolean {
  return !!permissions?.has(PermissionFlagsBits.ManageGuild);
}

export function canManageTicket(
  userId: string,
  permissions: PermissionsBitField | Readonly<PermissionsBitField> | null | undefined,
  ticketConfigId: number
): boolean {
  if (hasManageGuild(permissions)) return true;
  return isLead(ticketConfigId, userId);
}

export function canManageTodo(
  userId: string,
  permissions: PermissionsBitField | Readonly<PermissionsBitField> | null | undefined,
  todo: Todo
): boolean {
  if (hasManageGuild(permissions)) return true;
  return userId === todo.createdBy || userId === todo.assigneeId;
}
