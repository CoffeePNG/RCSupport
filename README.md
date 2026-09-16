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

Use `/bugreport` to open a questionnaire: category, title (100 characters), description (2,000), optional reproduction steps (1,000), and an optional HTTP/HTTPS screenshot/video link (500). Categories mirror the checked-in in-game wizard: Gameplay, World / Building, Permissions, Other. Keep these options aligned with RCSupportBridge’s wizard.yml when changing categories. Minecraft item capture and automatic player location are available only in game. Submission creates a Forum report and privately returns its link. Access requires visibility of the configured bug Forum. Existing panel buttons still work, but a panel is no longer needed.

Administrative commands are `/br setup channel:<forum>`, `/br refresh report:<number>`, and `/br delete [thread:<id>]`. These require Manage Server. Restart with command registration enabled (or run `npm run deploy-commands`) to publish the changed slash commands.
