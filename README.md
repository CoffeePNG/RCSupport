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
