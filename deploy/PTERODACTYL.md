# RCSupport Pterodactyl startup

`ptero-runner.sh` is a replacement for the supplied `.ptero/runner.sh`, tailored to this bot's
`src/`, root `tsconfig*.json`, `node_modules/`, and generated `dist/` layout. It retains the
runner's Git update/authentication, token mapping, package-manager/custom commands, and startup
configuration. It does not change the bot database, environment file or certificate.

## Enable it

1. Pull this repository update (or let the current runner fetch it once).
2. Change the panel's Startup Command to:

   ```sh
   bash /home/container/deploy/ptero-runner.sh
   ```

   Alternatively, copy this script over `/home/container/.ptero/runner.sh` and retain the old
   Startup Command. The repository-managed path is preferable for future runner updates.
3. Keep the existing install command:

   ```sh
   npm ci --include=dev --no-audit --no-fund
   ```

4. Set `INSTALL_ON_START=0` and `BUILD_ON_START=0`. Keep the existing `BUILD_COMMAND` (typically
   `auto` or `npm run build`), `START_COMMAND`, token settings and `AUTO_UPDATE` preference.
5. Restart. The first run installs/builds once to establish trusted cache stamps; later unchanged
   restarts skip both. The previous `.ptero/deployed` marker cannot prove dependencies are current.

The source push alone cannot change the panel's Startup Command or replace its external runner.
The optimized script must be selected or copied as above. No production panel files were changed
while creating this replacement.

## When work runs

| Change | Install dependencies | Compile |
| --- | --- | --- |
| Unchanged restart | No | No |
| README/documentation-only update | No | No |
| `src/` or root TypeScript config change | No | Yes |
| Package manifest, lockfile or npm/package-manager settings change | Yes | Yes |
| Node version/ABI/platform/architecture, detected libc version or package-manager version change | Yes | Yes |
| Missing direct dependency files or `node_modules` | Yes | Yes |
| Missing or modified `dist` output | No | Yes |
| Changed custom build command | No | Yes |
| Changed custom install command | Yes | Yes |

Dependency and build fingerprints live in `.ptero/`. They are hashes, not copies of registry
credentials or environment values. The dependency key covers package/lock files, project and user
npm config, npm/yarn/pnpm environment settings, runtime identity and install command. The build key
also covers source and TypeScript configs. Runtime `.env`/certificate/database changes do not force
installation or compilation; the newly started bot still loads them normally.

Keep `node_modules`, `dist` and `.ptero` persistent between restarts. Missing direct package files
are detected, but this is not a full integrity scan of every dependency. After a corrupted native
module or another dependency issue, set `INSTALL_ON_START=1` for one restart, then restore `0`.
Likewise use `BUILD_ON_START=1` for a forced rebuild. Existing `skip`/`none` commands still deliberately
bypass their step; they do not record successful work and should not be used as the normal cache.

Compilation clears only the generated `dist` directory, preventing deleted TypeScript modules
from leaving stale JavaScript. Do not keep manually maintained files in `dist`. Failed Git updates,
installations or builds stop startup. Stamps are recorded only after success, so failed work retries
on the next restart even if Git already advanced.

This runner assumes this repository's build layout. If build inputs move outside `src` and root
`tsconfig*.json`, extend the fingerprint accordingly. It expects a `node_modules` installation;
Yarn Plug'n'Play and unrelated application layouts are not supported by this RCSupport replacement.
