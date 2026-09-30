import { staffRoutes } from "../features/staff/interactions";
import { bugReportRoutes } from "../features/bugReports/interactions";
import { ticketRoutes } from "../features/tickets/interactions";
import { todoRoutes } from "../features/todo/interactions";

/** Specific matches precede general prefixes within each feature. */
export const interactionRoutes = [...staffRoutes, ...bugReportRoutes, ...ticketRoutes, ...todoRoutes];
