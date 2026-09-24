# RCSupport — Republicraft Discord bot

Discord tickets and staff applications, moderation, task lists, and Minecraft bug-report synchronization.

## Documentation

- [Commands, configuration, and deployment](docs/OPERATIONS.md)
- [Setup handoff](docs/SETUP_HANDOFF.md)
- [Source layout and cleanup guarantees](docs/ARCHITECTURE.md)

## Development

Run commands from this repository root:

```sh
npm ci
npm run build
npm test
```

`npm start` runs `dist/index.js`. `npm run deploy-commands` remains the existing command registration entry point. See the operations guide before configuring or deploying a bot.

## Repository layout

```text
src/          application source and feature modules
test/         automated tests
docs/         operating guide, setup notes, architecture
deploy/       existing systemd service definition
```

Package manifests, TypeScript configuration, Docker files, and `.env.example` remain at the root for the existing tooling. `node_modules/` and `dist/` are generated locally and ignored by Git.

### Discord bug reports

Use `/bugreport` to open a questionnaire: category, title (100 characters), description (2,000), optional reproduction steps (1,000), and optional screenshot/video links or notes (500 characters). Categories mirror the checked-in in-game wizard: Gameplay, World / Building, Permissions, Other. Keep these options aligned with RCSupportBridge’s wizard.yml when changing categories. Minecraft item capture and automatic player location are available only in game. Submission creates a Forum report and privately returns its link. Access requires visibility of the configured bug Forum. Existing panel buttons still work, but a panel is no longer needed.

Administrative commands are `/br setup channel:<forum>`, `/br refresh report:<number>`, and `/br delete [thread:<id>]`. These require Manage Server. Restart with command registration enabled (or run `npm run deploy-commands`) to publish the changed slash commands.

Discord-created report threads use `#<number> <title>`. The bridge reserves each number from the same sequence as in-game reports; category and description appear only in the body. Install the bridge version with `/api/v1/report-numbers` before updating the bot. Discord-only reports remain Discord-only; shared numbering does not import them into the in-game report browser. Failed submissions can leave number gaps.

Polling also repairs tracked Discord-only reports whose thread names contain the old `**Category**` body text, preserving their report content and controls.

Deleted reports retain saved conversation history for 72 hours, then the bot and bridge remove history records while keeping report details, numbers, mappings, and deletion markers. Closing or archiving a report does not trigger cleanup. The bot detects direct Discord deletion, deletion through its controls, and `/br mark-deleted`; missed deletion events are recovered when Discord returns Unknown Channel during polling. Permission failures do not mark a report deleted.

The bridge also supports `/rcsupport admin delete <report-number> confirm`. These requests are durable and the bot retries thread deletion. The 72-hour bridge timer begins once thread deletion is confirmed (or immediately if no thread was created); an offline bridge starts its grace period when notified. Cleanup survives restarts and runs every five minutes in the bridge, and each bot poll for local metadata. Existing backups are not rewritten. Update both the bot and bridge JAR to enable the complete flow.

## Minecraft server status

The bot reuses the **existing RCSupportBridge HTTPS API, certificate, bearer token and port**.
Install the bridge version with `GET /api/v1/server-status`, then list only the relevant
Java Edition servers in the bridge's `plugins/RCSupportBridge/config.yml`:

```yaml
server-status:
  servers:
    - id: survival
      name: Survival
      host: 127.0.0.1 # Example only: replace with the address reachable FROM the bridge
      port: 25565    # Existing Minecraft game port
    - id: creative
      name: Creative
      host: 10.0.0.2 # Example only
      port: 25566
```

Apply the list with `/rcsupport admin reload`. Servers not in this list are ignored;
no proxy discovery, new API listener, UDP query port or proxy plugin is required.
Up to 25 servers are supported, with unique IDs and display names up to 80 characters.
Addresses/ports remain in the bridge config and are not returned to Discord.

- `/servers`: anyone can request a compact **ephemeral** status embed; no panel setup required.
- `/server-status setup channel:#server-status interval:120`: administrators create the persistent
  embed. The interval is in minutes, defaults to two hours, and accepts 1–1440.
- `/server-status refresh`: administrators request an immediate panel check (bridge results may
  be cached for up to ten seconds).
- **Delete the panel message to stop monitoring.** It is not automatically recreated, including
  after a restart. Run setup again to create a replacement. Delete the old panel before moving
  it to a different channel. There is no disable command.

Rows use `**[Name]** - Online ✅` or `**[Name]** - Offline ❌`, with a last-checked timestamp.
To show the proxy first, add it to the same bridge server list with `id: proxy`, `name: Proxy`,
and its actual Minecraft host/game port. It appears above a blank line, followed by the other
servers in their configured order. This applies to both the panel and private `/servers` replies.
The proxy must be explicitly configured; its status is not inferred from backend statuses.
An unreachable/invalid API response produces a check-unavailable notice, not false offline results.
A successful Minecraft status response means online; refused connections, timeouts or invalid
Minecraft responses mean offline **from the bridge's network perspective**. This is not a TPS,
whitelist, player-count or gameplay-health check. The servers must allow normal Minecraft status
requests (`enable-status=true`). Results are cached for ten seconds to share concurrent requests.

Panel channel/message IDs and intervals are saved in SQLite. The bot refreshes saved panels on
startup and then checks for due updates every 30 seconds. The bot needs View Channel, Send Messages,
Embed Links and Read Message History in the chosen channel. Deploy slash commands or restart with
`DEPLOY_COMMANDS_ON_START` enabled after updating the bot.

### Connectivity test during installation

Configure the real backend addresses and game ports, reload the bridge, then run `/servers`.
From the bridge machine/container, the existing authenticated API can also be checked:

```sh
curl --cacert plugins/RCSupportBridge/rcsupport-cert.pem \
  -H "Authorization: Bearer $TOKEN" \
  https://127.0.0.1:28120/api/v1/server-status
```

Use the existing API address if it differs. A server known to be running but shown offline needs
its address, game port, status setting and network reachability checked from the **bridge container**.
Being on the same physical machine does not make another container reachable at `127.0.0.1`.
Local automated tests cover the implementation; real hosting connectivity still needs this test.

Both the persistent panel and private `/servers` reply display `republicraft.net` in the footer.
`/servers` has no `info` argument. Setup and refresh require Discord's Administrator permission,
enforced both in slash-command registration and at execution (Manage Server alone is not enough).

## Faster Pterodactyl restarts

Use the [RCSupport runner](deploy/ptero-runner.sh) and follow the
[panel setup instructions](deploy/PTERODACTYL.md). It skips `npm ci` when dependency inputs are
unchanged and skips compilation when source and generated output are unchanged. It preserves the
existing update/token/start settings. Selecting the new runner in the panel is a separate step;
a Git push does not replace an external `.ptero/runner.sh`.

The same message now includes a second **Server Information** embed: the configured public-facing
version **1.26.2**, address **republicraft.net**, and Production whitelist **ON/OFF**. These version
and address labels are fixed display values, not inferred from server pings. Whitelist is read live
from the Minecraft server running RCSupportBridge (Production) through the existing status API.
It uses Minecraft's built-in whitelist, not third-party maintenance plugins. An old bridge, API
outage or unavailable server-thread read shows **UNKNOWN**, never a guessed OFF. This applies to
both `/servers` and the persistent panel; no additional command argument or config change is needed.
Update/restart the bridge and bot to enable live whitelist reporting.
