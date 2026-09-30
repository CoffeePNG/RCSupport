import { ButtonInteraction, Interaction, MessageFlags, ModalSubmitInteraction, StringSelectMenuInteraction, UserSelectMenuInteraction } from "discord.js";
import type { RCSupportForum } from "../features/bugReports/forum";
import { AccessPolicy, accessDenial } from "../security/access";

type InteractionTypes = {
  button: ButtonInteraction;
  modal: ModalSubmitInteraction;
  stringSelect: StringSelectMenuInteraction;
  userSelect: UserSelectMenuInteraction;
};
type ComponentInteraction = InteractionTypes[keyof InteractionTypes];
export interface InteractionRoute extends AccessPolicy {
  kind: keyof InteractionTypes;
  matches: (id: string) => boolean;
  execute: (interaction: ComponentInteraction, forum?: RCSupportForum) => Promise<unknown>;
  requiresForum?: boolean;
}
export const exact = (id: string) => (candidate: string) => candidate === id;
export const prefix = (id: string) => (candidate: string) => candidate.startsWith(id);

/** The router verifies kind before invoking the typed handler. */
export function route<K extends keyof InteractionTypes>(
  kind: K, matches: (id: string) => boolean,
  execute: (interaction: InteractionTypes[K], forum?: RCSupportForum) => Promise<unknown>,
  policy: AccessPolicy & { requiresForum?: boolean } = {}
): InteractionRoute {
  return { ...policy, kind, matches, execute: (interaction, forum) => execute(interaction as InteractionTypes[K], forum) };
}

export async function dispatchComponent(
  interaction: Interaction, routes: readonly InteractionRoute[], forum?: RCSupportForum
): Promise<boolean> {
  const kind = interaction.isButton() ? "button" : interaction.isModalSubmit() ? "modal"
    : interaction.isStringSelectMenu() ? "stringSelect" : interaction.isUserSelectMenu() ? "userSelect" : undefined;
  if (!kind || !("customId" in interaction)) return false;
  const selected = routes.find(candidate => candidate.kind === kind && candidate.matches(interaction.customId));
  if (!selected) return false;
  const denied = accessDenial(selected, { guildId: interaction.guildId, permissions: interaction.memberPermissions?.bitfield ?? 0n });
  if (denied) {
    await (interaction as ComponentInteraction).reply({ content: denied, flags: MessageFlags.Ephemeral });
    return true;
  }
  if (selected.requiresForum && !forum) return false;
  await selected.execute(interaction as ComponentInteraction, forum);
  return true;
}
