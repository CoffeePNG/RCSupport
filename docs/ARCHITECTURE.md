# Source layout

The bot remains one process with the same commands and runtime entry points.

- `src/features/bugReports/`: Minecraft report integration, commands, panel, API client, synchronization and persistence helpers.
- `src/features/tickets/`: staff/application tickets, their commands, handlers, panels, templates, repositories and default ticket types.
- `src/features/todo/`: task commands, interactions, panels and persistence.
- `src/features/moderation/`: moderation commands, warnings and purge helpers.
- `src/features/archive/`: archive command.
- `src/commands/`: shared command contract, registry and guild registration helper.
- `src/config/guilds.ts`: semantic Public/Staff guild configuration and compatibility resolution.
- `src/modules/`: small module definitions for reviewed feature placement.
- `src/security/access.ts`: shared guild and runtime Discord permission policies, independent of an interaction object.
- `src/interactions/`: typed component route helpers and the combined feature route registry.
- `src/events/interactionCreate.ts`: command/autocomplete dispatch and common error handling. Each feature owns its component route declarations, IDs and handlers.
- `src/db/`: database connection, ordered migrations and shared guild settings.
- `src/utils/`: utilities shared across features.

## Bug-report responsibilities

`forum.ts` owns lifecycle, polling and one per-thread queue. `posts.ts` handles post creation, repair and deletion. `statusSync.ts` handles status reconciliation, closure retry and Discord attribution. `historySync.ts` handles live and backfilled history. They receive an internal `ForumContext` that refers to the same coordinator, API client and queue. The existing smaller formatting, history import, tag, API and delivery helpers remain shared.

Status changes, deletion and history must use that one queue. The cleanup preserves ordering, revision checks, delivery receipts, mappings and history cursors. Polling, timers and SSE subscriptions still have one lifecycle owner.

## Module and interaction conventions

Keep commands, route declarations, services and repositories together under each feature.
Guild scope is module metadata, not directory placement. Commands may declare a module,
additional guild restrictions and required Discord permissions. Module and command
restrictions intersect; neither can broaden the other. Registration uses the same
scope evaluator as runtime dispatch. Administrator bypasses permission bits, never scope.

The central listener checks commands and autocomplete before executing feature code.
Unauthorized autocomplete returns no choices. Component routes declare their interaction
type, ID matcher, access policy and typed handler. First match wins within the combined
registry; specific matches must precede broader prefixes. Unknown IDs remain ignored.
Existing ticket, task and report component IDs remain compatible. Feature handlers retain
resource-specific checks, such as ticket lead membership and access to report channels.

Ticket configuration, panel editing and ticket lead administration require Manage Server
at runtime, including autocomplete and configuration modal submission. Do not rely on
Discord's default command permissions as the only authorization check.

Staff capabilities and role bindings are configured as documented in STAFF_MANAGEMENT.md. A future dashboard
must resolve authenticated membership/permissions on the server and call shared services;
it must never accept the browser's claimed permissions or write directly around them.

## Compatibility and rollout

Set both `PUBLIC_GUILD_ID` and `STAFF_GUILD_ID` to activate semantic routing. Without
both, legacy settings remain supported as described in OPERATIONS.md. Partial configuration
fails startup instead of silently guessing placement. Existing archive pinning remains
until the semantic pair is configured. Other features retain their current placement.

Staff management adds its own tables through the existing migration entry point. There is
no command rename, ticket lead data conversion or bridge API change. Existing deployment entry points and the internal package/service
name remain unchanged. Scope changes can make old ticket controls unavailable in their old
guild: finish those tickets before switching, or defer activating semantic routing.

## Validation

Run `npm run build`, then focused module, routing, ticket and startup tests:

```sh
node --test test/module-foundation.test.js test/interaction-routing.test.js test/ticket-configuration.test.js test/startup-registration.test.js
```

Tests exercise actual registration payloads, legacy configuration, stale components,
autocomplete access, runtime permission checks, existing IDs and ticket persistence using
mocks and disposable SQLite databases. They do not log in to Discord or prove live deployment.

Run `npm test` for the full build and test suite. Keep Node's default process isolation
between test files: these fixtures replace cached modules and use different disposable
database schemas. The previous `--test-isolation=none` setting caused 22 failures through
mock leakage; all 174 tests pass with process isolation on 29 September 2026.
