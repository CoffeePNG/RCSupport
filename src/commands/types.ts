import { AutocompleteInteraction, ChatInputCommandInteraction } from "discord.js";
import type { RCSupportForum } from "../features/bugReports/forum";

export interface Command {
  data: {
    readonly name: string;
    toJSON(): unknown;
  };
  /**
   * Guilds this command is limited to. Omit for every guild the bot deploys to.
   * Deployment skips the command elsewhere and the interaction handler refuses
   * it, so a stale registration in another guild still can't run it.
   */
  guildIds?: readonly string[];
  execute(interaction: ChatInputCommandInteraction, forum?: RCSupportForum): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}
