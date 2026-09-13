# RCSupport / RCSupportBridge handoff

## Canonical workspace

On this Mac, work in `/Users/nickmerzon/Development/Republicraft/`. The Git checkouts were moved out of the Obsidian vault; notes remain in the vault. RCSupport, RCSupportBridge, RCUI and RCPlatform have been restored from their remotes. The Windows paths in older design documents are historical.

- RCSupport source: https://github.com/CoffeePNG/RCSupport.git
- RCSupport Forgejo pull mirror: https://forgejo.vhosts.win/RepubliCraft/RCSupport.git
- RCSupportBridge source: https://forgejo.vhosts.win/RepubliCraft/RCSupportBridge.git
- No separate GitHub remote is configured for RCSupportBridge.

## Current implementation and deployment

Minecraft runs on gs02; the bot runs on gs01, in separate Wings containers on separate nodes. Bot endpoint: `https://10.20.30.202:28002`. Plugin binds to `0.0.0.0:28002`. The operator resolved Docker publication, certificate trust, and bearer authentication. Do not revert to the old same-node gateway assumptions. Preserve production configuration, secrets, certificates, and databases.

Destination Discord guild: `903819888903200798`; Forum: `1548492034082476052`. `/bugreport setup` or `/br setup` configures the Forum in Discord and persists it in SQLite. The existing integration supports one destination Forum per bot instance.

The bot reconciles all open reports instead of filtering by its own clock, and correctly handles Gson-omitted null fields. Previously, an omitted `discord_post_id` silently prevented post creation. Saved mappings prevent duplicates. Logs report received, created, already-mapped, and restored-mapping counts.

RCSupportBridge 1.0.2 and the current bot implement authenticated SSE at `/api/v1/events`. Saving an in-game report notifies the bot immediately; reconnects reconcile missed reports. Polling remains a fallback, default 60000ms unless overridden by `RCSUPPORT_POLL_INTERVAL_MS`. Existing deployments configured for 20000ms keep that interval. The event connection uses the existing HTTPS certificate and bearer token. No additional ports or npm dependencies are required. Look for `RCSupport live report notifications connected` after upgrading both ends.

Plugin console diagnostics: `rcsupport admin diagnostics 10.20.30.202 28002`. Console and RCON access are explicitly allowed. Probes run from Minecraft's network namespace; a locally rejected SAN does not prove the bot's endpoint certificate is invalid. The public PEM must match the bot's configured CA file. Never share private keystores, password files, or bearer tokens in logs.

## Current local work (2026-09-13)

The submission wizard was already implemented in 1.0.4. The 1.0.5 release adds `/bugreport list`, paginated Active/Closed/All and admin-only Everyone/Mine views, private details and history, and confirmed admin close/reopen. Pending status updates are persisted transactionally and reconciled to Discord in batches. The bot migrates status tags in place to readable names and emojis. See each README for the final behavior and API additions.

Opening the list during an unfinished draft asks the user to finish/cancel the draft first, preserving it. Reopen targets Open. Reply history has no unread tracking. These are the implementation defaults for the otherwise unsettled design choices.

Both projects must be updated together. Changes have been built/tested locally; the previous report-browser changes were pushed, and neither service has been deployed/restarted by this work. Live Purpur visual acceptance and the full report/reply/status round trip remain to be verified. Preserve the existing production network setup below.

## Build and preserve

Bot: `npm run build`; use `npm ci` only when dependencies need installation/update. Bridge: Java 25, `mvn package`; install `target/RCSupportBridge-1.0.7-SNAPSHOT.jar`. Replace only the plugin JAR and fully restart Minecraft. Keep its data folder. Preserve the bot's database and environment. Recopy the public certificate only when it changes.

Most recent local checks: focused plugin storage, browser lifecycle, API revision/batching, real RCUI catalog and existing wizard tests passed; the bot suite passed, covering tag migration, closed-report retries, missing historical posts, mapping restoration and loop prevention. Local tests do not prove deployed permissions or visual appearance. Build artifacts remain ignored by Git.


## Closure/theme follow-up (1.0.7, 2026-09-13)

The bot and bridge now support a separate Closed tag and durable closure announcements with actor and long-time/short-date Discord timestamps. Bot delivery receipts recover uncertain sends; stale acknowledgments preserve newer closures. The bot adds a confirmed admin-only `/bugreport delete [thread]` command that retains Minecraft history and suppresses later recreation. The packaged messages now use gray text, a green gradient prefix, and semantic action colors. Existing catalogs need the supplied restyled `rcsupport.yml` applied separately. No live deployment, restart, message or thread deletion was performed here.

Verification: 31 bot tests and 20 focused bridge tests passed, including closure persistence/retries, tag transitions, permission checks, delete confirmation/cancellation/timeout, and the real RCUI message loader. Subscription and in-game reply commands remain planning only.
