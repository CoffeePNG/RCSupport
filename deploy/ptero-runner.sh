#!/usr/bin/env bash
set -Eeuo pipefail

# RCSupport startup: cache dependency installation separately from src -> dist builds.

SERVER_ROOT="${SERVER_ROOT:-/home/container}"
cd "${SERVER_ROOT}"

log() {
    printf '[ptero-discord-ts] %s\n' "$*"
}

setup_git_auth() {
    if [[ -z "${GIT_TOKEN:-}" ]]; then
        return 0
    fi

    export GIT_ASKPASS="/tmp/ptero-git-askpass.sh"
    export GIT_TERMINAL_PROMPT=0

    cat > "${GIT_ASKPASS}" <<'ASKPASS' || return 72
#!/bin/sh
case "$1" in
    *Username*) printf '%s\n' "${GIT_USERNAME:-x-access-token}" ;;
    *Password*) printf '%s\n' "${GIT_TOKEN:-}" ;;
    *) printf '\n' ;;
esac
ASKPASS
    chmod 700 "${GIT_ASKPASS}"
}

cleanup_git_auth() {
    if [[ -n "${GIT_ASKPASS:-}" ]]; then
        rm -f "${GIT_ASKPASS}"
        unset GIT_ASKPASS
    fi
}

package_json_value() {
    local expression="$1"

    if [[ ! -f package.json ]]; then
        return 1
    fi

    node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const value = (${expression});
if (value === undefined || value === null) process.exit(1);
process.stdout.write(String(value));
" 2>/dev/null
}

detect_package_manager() {
    if [[ "${PACKAGE_MANAGER:-auto}" != "auto" ]]; then
        printf '%s\n' "${PACKAGE_MANAGER}"
        return
    fi

    local declared=""
    declared="$(package_json_value 'p.packageManager' || true)"
    case "${declared}" in
        pnpm@*) printf 'pnpm\n'; return ;;
        yarn@*) printf 'yarn\n'; return ;;
        npm@*)  printf 'npm\n'; return ;;
    esac

    if [[ -f pnpm-lock.yaml ]]; then
        printf 'pnpm\n'
    elif [[ -f yarn.lock ]]; then
        printf 'yarn\n'
    else
        printf 'npm\n'
    fi
}

run_package_manager() {
    local pm="$1"
    shift

    case "${pm}" in
        npm)
            npm "$@"
            ;;
        pnpm)
            corepack pnpm "$@"
            ;;
        yarn)
            corepack yarn "$@"
            ;;
        *)
            log "Unsupported package manager: ${pm}"
            return 64
            ;;
    esac
}

run_install() {
    local command="${INSTALL_COMMAND:-auto}"
    local pm
    pm="$(detect_package_manager)"

    if [[ -z "${command}" || "${command}" == "skip" || "${command}" == "none" ]]; then
        log "Dependency installation skipped."
        return 0
    fi

    if [[ "${command}" != "auto" ]]; then
        log "Running custom dependency command: ${command}"
        NODE_ENV=development NPM_CONFIG_PRODUCTION=false bash -lc "${command}"
        return
    fi

    log "Installing dependencies with ${pm}, including TypeScript build dependencies."
    case "${pm}" in
        npm)
            if [[ -f package-lock.json || -f npm-shrinkwrap.json ]]; then
                NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm ci --include=dev
            else
                NODE_ENV=development NPM_CONFIG_PRODUCTION=false npm install --include=dev
            fi
            ;;
        pnpm)
            NODE_ENV=development corepack pnpm install --frozen-lockfile \
                || NODE_ENV=development corepack pnpm install
            ;;
        yarn)
            NODE_ENV=development corepack yarn install --immutable \
                || NODE_ENV=development corepack yarn install --frozen-lockfile \
                || NODE_ENV=development corepack yarn install
            ;;
    esac
}

has_script() {
    local script_name="$1"

    [[ -f package.json ]] || return 1

    SCRIPT_NAME="${script_name}" node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
process.exit(p.scripts && Object.prototype.hasOwnProperty.call(p.scripts, process.env.SCRIPT_NAME) ? 0 : 1);
" >/dev/null 2>&1
}

run_build() {
    local command="${BUILD_COMMAND:-auto}"
    local pm
    pm="$(detect_package_manager)"

    if [[ -z "${command}" || "${command}" == "skip" || "${command}" == "none" ]]; then
        log "Build skipped."
        return 0
    fi

    if [[ "${command}" != "auto" ]]; then
        log "Running custom build command: ${command}"
        bash -lc "${command}"
        return
    fi

    if has_script build; then
        log "Running package.json build script with ${pm}."
        run_package_manager "${pm}" run build
    else
        log "No package.json build script found; build skipped."
    fi
}

update_repository() {
    if [[ "${AUTO_UPDATE:-0}" != "1" || ! -d .git ]]; then
        return 1
    fi

    setup_git_auth || return 72

    local before after branch
    before="$(git rev-parse HEAD 2>/dev/null)" || {
        cleanup_git_auth
        return 72
    }

    branch="${GIT_BRANCH:-}"
    if [[ -z "${branch}" ]]; then
        branch="$(git branch --show-current)" || { cleanup_git_auth; return 72; }
    fi

    if [[ -z "${branch}" ]]; then
        log "Cannot auto-update because no Git branch is checked out."
        cleanup_git_auth
        return 72
    fi

    log "Checking origin/${branch} for updates."
    git fetch --prune origin "${branch}" || {
        log "Git fetch failed; refusing to launch with a partially updated checkout."
        cleanup_git_auth
        return 70
    }

    git merge --ff-only "origin/${branch}" || {
        log "Git history diverged or the fast-forward failed. Resolve it manually."
        cleanup_git_auth
        return 71
    }

    after="$(git rev-parse HEAD)" || { cleanup_git_auth; return 72; }
    cleanup_git_auth
    [[ "${before}" != "${after}" ]]
}

export_bot_token() {
    if [[ -z "${BOT_TOKEN:-}" ]]; then
        log "BOT_TOKEN is empty. The bot may fail unless it obtains credentials another way."
        return 0
    fi

    local target="${TOKEN_ENV_NAME:-DISCORD_TOKEN}"
    if [[ ! "${target}" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
        log "TOKEN_ENV_NAME is not a valid environment variable name: ${target}"
        return 64
    fi

    export "${target}=${BOT_TOKEN}"
}

resolve_start_command() {
    local command="${START_COMMAND:-auto}"
    local pm
    pm="$(detect_package_manager)"

    if [[ "${command}" != "auto" ]]; then
        printf '%s\n' "${command}"
        return
    fi

    if has_script start; then
        case "${pm}" in
            npm)  printf 'npm start\n' ;;
            pnpm) printf 'corepack pnpm start\n' ;;
            yarn) printf 'corepack yarn start\n' ;;
        esac
        return
    fi

    local main_file=""
    main_file="$(package_json_value 'p.main' || true)"
    if [[ -n "${main_file}" && -f "${main_file}" ]]; then
        printf 'node %q\n' "${main_file}"
        return
    fi

    local candidate
    for candidate in dist/index.js dist/main.js build/index.js build/main.js index.js main.js; do
        if [[ -f "${candidate}" ]]; then
            printf 'node %q\n' "${candidate}"
            return
        fi
    done

    log "Could not automatically determine how to start the bot."
    log "Set START_COMMAND to the repository's documented command, commonly: npm start"
    return 66
}

# Hash only inputs that affect dependencies/builds; never use Git HEAD as the cache key.
# State contains SHA-256 digests only, not registry credentials or environment values.
fingerprint() {
    local kind="$1"
    node - "${kind}" "${PACKAGE_MANAGER_VERSION}" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const kind = process.argv[2];
const hash = crypto.createHash('sha256');
const add = value => hash.update(JSON.stringify(value) + '\n');
function file(name) {
    add(name);
    if (!fs.existsSync(name)) { add('missing'); return; }
    const stat = fs.lstatSync(name);
    if (stat.isSymbolicLink()) {
        add(fs.readlinkSync(name));
        if (!fs.statSync(name).isFile()) throw Error('Directory symlinks are not supported in build inputs: ' + name);
    }
    if (stat.isDirectory()) {
        for (const child of fs.readdirSync(name).sort()) file(path.join(name, child));
    } else {
        add(fs.readFileSync(name).toString('base64'));
    }
}
add('rcsupport-startup-cache-v1');
if (kind === 'output') {
    file('dist');
} else {
    const header = process.report?.getReport().header;
    add([process.version, process.versions.modules, process.platform, process.arch, header?.glibcVersionRuntime,
        process.argv[3], process.env.PACKAGE_MANAGER || 'auto', process.env.INSTALL_COMMAND || 'auto']);
    for (const key of Object.keys(process.env).sort()) {
        if (/^(npm_config_|yarn_|pnpm_)/i.test(key)) add([key, process.env[key]]);
    }
    for (const name of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml',
        'yarn.lock', '.npmrc', '.yarnrc', '.yarnrc.yml', 'pnpm-workspace.yaml']) file(name);
    // Include user npm configuration when present without storing its contents in the stamp.
    const userConfig = process.env.NPM_CONFIG_USERCONFIG || process.env.npm_config_userconfig
        || path.join(require('os').homedir(), '.npmrc');
    file(userConfig);
    if (kind === 'build') {
        add(process.env.BUILD_COMMAND || 'auto');
        file('src');
        for (const name of fs.readdirSync('.').filter(n => /^tsconfig.*\.json$/.test(n)).sort()) file(name);
    }
}
process.stdout.write(hash.digest('hex'));
NODE
}

dependencies_present() {
    [[ -d node_modules ]] || return 1
    node <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
for (const name of Object.keys({...p.dependencies, ...p.devDependencies})) {
    if (!fs.existsSync('node_modules/' + name + '/package.json')) process.exit(1);
}
if (p.devDependencies?.typescript && !fs.existsSync('node_modules/.bin/tsc')) process.exit(1);
NODE
}

stamp_matches() {
    [[ -f "$1" && "$(cat "$1")" == "$2" ]]
}

write_stamp() {
    printf '%s\n' "$2" > "$1.tmp"
    mv "$1.tmp" "$1"
}

main() {
    mkdir -p .ptero
    local update_status=0
    update_repository || update_status=$?
    case "${update_status}" in
        0) log "Repository updated." ;;
        1) ;; # Auto-update disabled, non-Git checkout, or no new commit.
        *) log "Repository update failed; startup stopped."; return "${update_status}" ;;
    esac

    local pm install_key build_key output_key
    pm="$(detect_package_manager)"
    PACKAGE_MANAGER_VERSION="$(run_package_manager "${pm}" --version)"
    install_key="$(fingerprint install)"

    case "${INSTALL_COMMAND:-auto}" in
        skip|none) log "Dependency installation explicitly skipped." ;;
        *)
            if [[ "${INSTALL_ON_START:-0}" == "1" ]] \
                || ! stamp_matches .ptero/install.sha256 "${install_key}" || ! dependencies_present; then
                log "Dependency inputs changed, dependencies are missing, or installation was forced."
                # Invalidate before work, including forced runs with unchanged inputs.
                rm -f .ptero/install.sha256 .ptero/build.sha256 .ptero/output.sha256
                run_install
                if ! dependencies_present; then
                    log "Dependency command finished but required packages are missing; startup stopped."
                    return 73
                fi
                # npm install may create/update a lockfile.
                install_key="$(fingerprint install)"
                write_stamp .ptero/install.sha256 "${install_key}"
            else
                log "Dependency inputs unchanged; skipping installation."
            fi
            ;;
    esac

    build_key="$(fingerprint build)"
    output_key="$(fingerprint output)"
    case "${BUILD_COMMAND:-auto}" in
        skip|none) log "Build explicitly skipped." ;;
        *)
            if [[ "${BUILD_ON_START:-0}" == "1" || ! -f dist/index.js ]] \
                || ! stamp_matches .ptero/build.sha256 "${build_key}" \
                || ! stamp_matches .ptero/output.sha256 "${output_key}"; then
                log "Build inputs changed, compiled output is missing/changed, or build was forced."
                rm -f .ptero/build.sha256 .ptero/output.sha256
                # RCSupport's dist is generated; clean it so deleted source cannot leave stale modules.
                node -e "require('fs').rmSync('dist', {recursive: true, force: true})"
                run_build
                if [[ ! -f dist/index.js ]]; then
                    log "Build did not produce dist/index.js; startup stopped."
                    return 74
                fi
                write_stamp .ptero/build.sha256 "${build_key}"
                write_stamp .ptero/output.sha256 "$(fingerprint output)"
            else
                log "Build inputs and output unchanged; skipping compilation."
            fi
            ;;
    esac

    touch .ptero/deployed

    export_bot_token
    export NODE_ENV="${NODE_ENV:-production}"
    export PORT="${PORT:-${SERVER_PORT:-}}"

    local command
    command="$(resolve_start_command)"

    log "Node version: $(node --version)"
    log "Launching: ${command}"
    echo "PTERODACTYL: Discord bot process launching"
    exec bash -lc "${command}"
}

trap cleanup_git_auth EXIT
main "$@"
