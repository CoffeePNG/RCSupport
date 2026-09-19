import { zenCommand } from "../features/moderation/commands/zen";
import { Command } from "./types";
import { ticketCreateCommand } from "../features/tickets/commands/ticket-create";
import { staffAssignCommand } from "../features/tickets/commands/staff-assign";
import { staffStatusCommand } from "../features/tickets/commands/staff-status";
import { ticketConfigCommand } from "../features/tickets/commands/ticket-config";
import { ticketPanelCommand } from "../features/tickets/commands/ticket-panel";
import { archiveCommand } from "../features/archive/commands/archive";
import { modConfigCommand } from "../features/moderation/commands/mod-config";
import { todoPanelCommand } from "../features/todo/commands/todo-panel";
import { banCommand } from "../features/moderation/commands/ban";
import { kickCommand } from "../features/moderation/commands/kick";
import { purgeCommand } from "../features/moderation/commands/purge";
import { timeoutCommand } from "../features/moderation/commands/timeout";
import { warnCommand } from "../features/moderation/commands/warn";
import { unwarnCommand } from "../features/moderation/commands/unwarn";
import { warningsCommand } from "../features/moderation/commands/warnings";
import { myTasksCommand } from "../features/todo/commands/my-tasks";
import { taskCommand } from "../features/todo/commands/task";
import { todoCommand } from "../features/todo/commands/todo";
import { bugreportCommand, brCommand } from "../features/bugReports/commands/bugreport";

import { setVaultCommand, vaultCommand } from "../features/vault/commands";

export const commands: Command[] = [
  setVaultCommand,
  vaultCommand,
  ticketCreateCommand,
  staffAssignCommand,
  staffStatusCommand,
  ticketConfigCommand,
  ticketPanelCommand,
  modConfigCommand,
  archiveCommand,
  todoPanelCommand,
  banCommand,
  kickCommand,
  purgeCommand,
  timeoutCommand,
  zenCommand,
  warnCommand,
  unwarnCommand,
  warningsCommand,
  myTasksCommand,
  taskCommand,
  todoCommand,
  bugreportCommand,
  brCommand,
];
