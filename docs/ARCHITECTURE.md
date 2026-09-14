# Source layout

The bot remains one process with the same commands and runtime entry points.

- `src/features/bugReports/`: Minecraft report integration, commands, panel, API client, synchronization and persistence helpers.
- `src/features/tickets/`: staff/application tickets, their commands, handlers, panels, templates, repositories and default ticket types.
- `src/features/todo/`: task commands, interactions, panels and persistence.
- `src/features/moderation/`: moderation commands, warnings and purge helpers.
- `src/features/archive/`: archive command.
- `src/commands/`: shared command contract, registry and guild registration helper.
- `src/events/interactionCreate.ts`: command dispatch, feature dispatch and common error handling. Each feature owns its component IDs and handlers.
- `src/db/`: database connection, ordered migrations and shared guild settings.
- `src/utils/`: utilities shared across features.

## Bug-report responsibilities

`forum.ts` owns lifecycle, polling and one per-thread queue. `posts.ts` handles post creation, repair and deletion. `statusSync.ts` handles status reconciliation, closure retry and Discord attribution. `historySync.ts` handles live and backfilled history. They receive an internal `ForumContext` that refers to the same coordinator, API client and queue. The existing smaller formatting, history import, tag, API and delivery helpers remain shared.

Status changes, deletion and history must use that one queue. The cleanup preserves ordering, revision checks, delivery receipts, mappings and history cursors. Polling, timers and SSE subscriptions still have one lifecycle owner.

## Preserved settings and behavior

The cleanup changes source paths and documentation organization. It does not change environment variable names/defaults, bridge URLs or API paths, TLS/certificate handling, tokens, polling/reconnection settings, command names, permissions, confirmation flows or database locations. The database migration statements and order are retained; only their source module is separated from connection setup.

`package.json`, `package-lock.json`, `tsconfig.json`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `.dockerignore` and `deploy/rcbotapplications.service` remain unchanged. In particular, the package and service retain their existing internal `rcbotapplications` identity. Build/start commands and generated `dist/index.js` remain in their existing locations. Run commands in the repository root, including commands documented in OPERATIONS.md.

`dist/` and `node_modules/` are generated output, not duplicate source repositories. After changing source layouts, remove the old generated `dist/` folder before rebuilding so old compiled module paths do not linger. Keep runtime data and configuration intact.

## Validation

The 35 existing tests pass, plus four regression tests covering all existing component routes and command scope/error handling, cross-feature thread serialization after a failure, and legacy task migration/data preservation. The tests use mocks and disposable SQLite databases, without logging the bot into Discord or contacting a live bridge.
