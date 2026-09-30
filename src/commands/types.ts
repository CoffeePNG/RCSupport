import { AccessPolicy } from "../security/access";
import { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type { RCSupportForum } from "../features/bugReports/forum";

export interface Command extends AccessPolicy {
  data: {
    readonly name: string;
    toJSON(): unknown;
  };
  /**
   * Additional guild restrictions, intersected with the module's guild scope.
   * Omit to inherit the module scope (or every deployment guild without a module).
   * Deployment skips the command elsewhere and the interaction handler refuses
   * it, so a stale registration in another guild still can't run it.
   */
  guildIds?: readonly string[];
  execute(interaction: ChatInputCommandInteraction, forum?: RCSupportForum): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
