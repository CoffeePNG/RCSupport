# RCSupport / RCSupportBridge handoff

## Status: setup is unfinished

The code exists, but deployment and end-to-end operation have not been verified. Continue setup with the operator; do not assume that successful builds or the Minecraft listener log prove that Discord can reach the API.

## Repositories

- RCSupport bot: https://github.com/CoffeePNG/RCSupport (writable source).
- Forgejo bot mirror: https://forgejo.vhosts.win/RepubliCraft/RCSupport (read-only pull mirror when last checked).
- Paper plugin: https://forgejo.vhosts.win/RepubliCraft/RCSupportBridge (writable).
- Local checkouts: `C:/Users/Redux/Desktop/Codex/RCSupport` and `C:/Users/Redux/Desktop/Codex/RCSupportBridge`.

The original bot integration was merged in GitHub PR #3. Subsequent work adds `/bugreport setup channel:<forum>` and `/br setup`, persists the selected Forum in SQLite, creates missing exact-name status tags while preserving existing tags, and keeps the bot online when Forum setup is incomplete. The saved Forum overrides the optional environment fallback. Manage Server is required for setup; the bot needs Manage Channels to add tags. The integration still supports one destination Forum per bot instance. Another guild cannot reassign an existing destination, and moving a Forum with mapped reports requires migration.

## Deployment facts supplied by the operator

- Minecraft and the Discord bot run in separate Docker containers on the same Pterodactyl Wings node.
- Minecraft is Purpur 26.2; DiscordSRV is 1.30.5.
- Destination Discord guild: `903819888903200798`.
- Destination Forum: `1548492034082476052`.
- Bot API URL: `https://172.18.0.1:28001`.
- Minecraft plugin should bind to `0.0.0.0`, port `28001`.
- Last reported Minecraft allocation: `127.0.0.1:28001`.
- Bot's own allocation: `127.0.0.1:28987`; this does not select the destination for outbound API calls.
- Bot working directory is expected to be `/home/container`; confirm the egg/startup working directory if relative paths fail.

## Observed errors and progress

1. The bot found the Forum but rejected a missing `acknowledged` tag. The operator confirmed a spelling mistake. This was not a guild-resolution failure.
2. The bot reported `ECONNREFUSED 172.18.0.1:28001`.
3. Minecraft logs showed malformed YAML: a secret had been pasted on a standalone line. The plugin fell back to `127.0.0.1:28120` with an empty token.
4. After correction, the operator supplied logs confirming a newly generated certificate and `RCSupport HTTPS API listening on 0.0.0.0:28001`.
5. No subsequent successful bot API request or report round trip has been demonstrated.

The newer Forum setup command has not been confirmed deployed. The corrected plugin config was edited on the server, not in these checkouts.

## Next steps for the next maintainer

1. Verify the actual Docker bridge/gateway and published port mapping on the Wings node. `172.18.0.1` is operator-supplied and has not been inspected on the host. A host-loopback-only allocation does not normally accept connections addressed to the bridge gateway. Publishing the additional Minecraft allocation on the verified bridge address is one option; do not change the bot's own allocation. Check actual routing/mapping before making infrastructure changes.
2. Confirm the plugin config contains port 28001, bind address 0.0.0.0, a nonempty bearer token, and certificate SAN `172.18.0.1`. Preserve other configuration fields. Because part of the previous secret appeared in a diagnostic log, use a fresh shared secret on both ends; never commit it.
3. Copy the latest plugin `plugins/RCSupportBridge/rcsupport-cert.pem` to the bot at `/home/container/certs/rcsupport-cert.pem`. Copy after the latest certificate generation. Keep `.p12` and `.pass` files on Minecraft only. Do not disable TLS verification.
4. Preserve the bot's Discord credentials, both configured guild IDs, and SQLite data. Configure the API URL above, matching `RCSUPPORT_API_TOKEN`, and `RCSUPPORT_API_CA_CERT_PATH=/home/container/certs/rcsupport-cert.pem`. Existing `RCSUPPORT_FORUM_CHANNEL_ID=1548492034082476052` can remain as fallback; the new setup command overrides it in SQLite.
5. Deploy/build the new bot code and restart. Confirm slash commands register. In the destination guild run `/bugreport setup channel:<the Forum>` and then `/bugreport post channel:<staff text channel>`. API token and certificate settings still belong in the environment; the command configures only the Forum and tags.
6. Confirm Forum tags `open`, `acknowledged`, `in_progress`, `resolved`, `wontfix`; bot channel/thread permissions; and Message Content Intent. Keep the Forum staff-only.
7. Ask whether alerts should use `broadcast` (in-game, permission `rcsupport.alert`) or `leads` (Discord mentions from this guild's `bug_report` lead assignments). This preference remains unanswered.
8. Test from inside the bot container: `curl --cacert /home/container/certs/rcsupport-cert.pem https://172.18.0.1:28001/api/v1/health`. This public health endpoint tests routing and certificate trust, not bearer authentication. Then check the bot's polling logs for authenticated API success.
9. Grant a linked staff player `rcsupport.report`, submit `/bug <description>`, and verify a Forum post appears after polling (default 20 seconds). Have another staff member reply and select exactly one status tag; verify delivery/status in Minecraft, including offline queued replies if needed. Test the Discord panel separately: Discord-native reports stay in Discord.

## Validation and limitations

The original plugin Maven package and three tests passed locally. The updated bot TypeScript build and five tests passed, including preservation of tags, saved selection across service restarts, repeat setup, and rejection of another guild. The Forum test uses Node's SQLite implementation with a mocked Discord client because the local better-sqlite3 native binding is unavailable. Live Discord permission changes, networking, production database loading, and end-to-end delivery remain unverified. Persist the production SQLite database across redeploys.
