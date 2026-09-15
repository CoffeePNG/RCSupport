import { Interaction } from "discord.js";
import { BUGTHREAD_BUTTON_ID, BUGTHREAD_MODAL_ID } from "./commands/bugreport";
import { RCSupportForum } from "./forum";
import { openBugModal, submitBugModal } from "./panel";

export async function handleBugReportsInteraction(interaction: Interaction, rcForum?: RCSupportForum): Promise<boolean> {
  if (!rcForum) return false;
  if (interaction.isModalSubmit() && interaction.customId === BUGTHREAD_MODAL_ID) {
    await submitBugModal(interaction, rcForum);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith("rcsupport:case:")) {
    await rcForum.handleControl(interaction);
    return true;
  }
  if (interaction.isButton() && interaction.customId === BUGTHREAD_BUTTON_ID) {
    await openBugModal(interaction, rcForum);
    return true;
  }
  return false;
}
