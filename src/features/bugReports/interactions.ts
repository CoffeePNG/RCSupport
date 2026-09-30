import { confirmThreadDeletion } from "./deleteThread";
import { Interaction } from "discord.js";
import { BUGTHREAD_BUTTON_ID, BUGTHREAD_MODAL_ID } from "./commands/bugreport";
import { RCSupportForum } from "./forum";
import { openBugModal, submitBugModal } from "./panel";

import { bugReportModule } from "../../modules/catalog";
import { dispatchComponent, exact, prefix, route } from "../../interactions/router";

const policy = { module: bugReportModule, requiresForum: true };
export const bugReportRoutes = [
  route("modal", exact(BUGTHREAD_MODAL_ID), (interaction, forum) => submitBugModal(interaction, forum!), policy),
  route("button", id => /^rcsupport:case:delete:\d+$/.test(id), (interaction, forum) => confirmThreadDeletion(interaction, forum!), policy),
  route("button", prefix("rcsupport:case:"), (interaction, forum) => forum!.handleControl(interaction), policy),
  route("button", exact(BUGTHREAD_BUTTON_ID), (interaction, forum) => openBugModal(interaction, forum!), policy),
];

export function handleBugReportsInteraction(interaction: Interaction, rcForum?: RCSupportForum): Promise<boolean> {
  return dispatchComponent(interaction, bugReportRoutes, rcForum);
}
