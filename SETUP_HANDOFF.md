# RCSupport / RCSupportBridge handoff

## Canonical workspace

Work only in `C:/Users/Redux/Documents/Development/Republicraft/Git Repos/` going forward. It contains RCSupport, RCSupportBridge, RCUI, RCPlatform, and RCModeration. The former `Desktop/Codex` copies are being retired; do not use them as the working location.

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

## Next work: wizard design, not yet implemented

Read `RCSupportBridge/BUG_REPORT_GUI_DESIGN_HANDOFF.md`. The user requested an inventory category screen, report editor, private chat text prompts with CANCEL, attachments, green confirm dye bottom-right, red cancel dye bottom-left, and cancellation on manual inventory close. Messages and UI must integrate with RCUI and RCPlatform. Inspect those adjacent repos before coding; API details and deployed versions are not yet confirmed.

No wizard implementation has been requested yet. The user is discussing its design. SSE deployment and the complete production report/reply/status round trip still need operator verification; passing local tests is not live verification.

## Build and preserve

Bot: `npm run build`; use `npm ci` only when dependencies need installation/update. Bridge: Java 25, `mvn package`; install `target/RCSupportBridge-1.0.2-SNAPSHOT.jar`. Replace only the plugin JAR and fully restart Minecraft. Keep its data folder. Preserve the bot's database and environment. Recopy the public certificate only when it changes.

Most recent local checks: eight bot tests and the plugin Maven package/tests passed, including SSE delivery/reconnect and command permissions. The bot's SQLite tests use Node SQLite with mocked Discord services; this does not test production permissions or deployment. Build outputs are ignored by Git and can be regenerated in the canonical workspace.