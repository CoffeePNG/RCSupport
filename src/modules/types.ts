/** Feature placement is independent of its commands and interaction types. */
export interface ModuleDefinition {
  readonly id: string;
  /** Undefined preserves legacy availability; [] disables the module everywhere. */
  readonly guildIds?: readonly string[];
}
