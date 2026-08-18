import { Command } from "./types";
import { ticketCreateCommand } from "./tickets/ticket-create";
import { staffAssignCommand } from "./admin/staff-assign";
import { staffStatusCommand } from "./admin/staff-status";
import { ticketConfigCommand } from "./admin/ticket-config";
import { ticketPanelCommand } from "./admin/ticket-panel";
import { modConfigCommand } from "./admin/mod-config";
import { todoPanelCommand } from "./admin/todo-panel";
import { banCommand } from "./moderation/ban";
import { kickCommand } from "./moderation/kick";
import { timeoutCommand } from "./moderation/timeout";
import { warnCommand } from "./moderation/warn";
import { unwarnCommand } from "./moderation/unwarn";
import { warningsCommand } from "./moderation/warnings";
import { myTasksCommand } from "./todo/my-tasks";

export const commands: Command[] = [
  ticketCreateCommand,
  staffAssignCommand,
  staffStatusCommand,
  ticketConfigCommand,
  ticketPanelCommand,
  modConfigCommand,
  todoPanelCommand,
  banCommand,
  kickCommand,
  timeoutCommand,
  warnCommand,
  unwarnCommand,
  warningsCommand,
  myTasksCommand,
];
