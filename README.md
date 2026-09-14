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
