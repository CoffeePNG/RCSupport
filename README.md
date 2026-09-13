# RCBotApplications — Republicraft Discord Utility Bot

A config-driven ticket system (applications, bug reports, appeals, help
requests), a separate RCSupportBridge staff bug Forum, and a moderation suite.
The staff Forum is independent of the existing ticket pipeline.

## Design summary

- **One existing ticket pipeline.** Every configured ticket type (application, bug
  report, appeal, help request, or any new type added later) shares the same
  create → claim → close pipeline in `src/handlers/ticketHandler.ts`. What
  differs between types is a row in the `ticket_configs` table — never a
  separate code path. Adding a new type later is one DB entry, no new code.
- **No roles for ticket visibility.** Who can see/claim/manage a given ticket
  type ("leads") is resolved by Discord user ID against the `ticket_leads`
  table, not by role membership. The public server stays clean — no
  "Head Developer" style roles get created by this bot. Ticket channels use
  per-user permission overwrites (creator + that type's leads + the bot);
  `@everyone` is denied `View Channel`.
- **Scoped bot permissions.** The bot needs `Manage Channels` (create/delete
  ticket channels), `Kick Members`, `Ban Members`, `Moderate Members` (for
  the moderation suite), and `Send Messages`/`Read Message History`/
  `Attach Files` generally. It does **not** need Administrator, and does not
  request `Manage Roles` — application approval is a status update only, it
  does not auto-assign a role (see "Decisions" below).
- **Built for handoff.** Routine staff management — who's a lead for which
  ticket type, and an at-a-glance status view — is done entirely through
  slash commands (`/staff-assign`, `/staff-status`). No terminal access or
  JSON/DB editing is needed for that. Adding a brand-new ticket *type*
  (not just adding/removing a lead) is a structural change and does require
  a config/code change — see "Adding a new ticket type" below.

## Decisions made during build

These were open questions in the spec, resolved as follows:

| Question | Decision |
|---|---|
| Single- or multi-claim? | Single-claim — the Claim button disables once someone claims, until the ticket closes. |
| Transcript delivery | Archive channel only — posted as a `.txt` file to that ticket type's configured review/archive channel. No DM to the creator. |
| Application approval automation | Status update only — the bot does not assign a role on approval. A human handles onboarding/role assignment separately. `Manage Roles` is intentionally not requested. |
| Auto-close/auto-unclaim inactive tickets | Not implemented — tickets stay open/claimed until a lead or the creator explicitly closes them. No background scheduler. |
| Complete set of ticket types? | Application, Bug Report, Appeal, Help Request seeded by default; config schema is generic, so more can be added later without code changes to the pipeline. |
| Lead notification on new ticket | Leads are pinged (individually, by user ID — there's no role to ping) inside the new ticket channel itself, and a short notice is posted to that type's review channel. |

One deviation from the suggested file layout: **Claim and Close are buttons
on the ticket message, not slash commands** (`ticket-claim.ts`/
`ticket-close.ts` in the spec's suggested tree became button handlers inside
`src/handlers/ticketHandler.ts` instead). This matches the described lifecycle
("a lead clicks a Claim button") more directly than a typed command would.

Text-heavy config (open/claim messages, dropdown blurbs, panel title/
description) is edited via **modals**, not slash-command string options —
Discord's slash-command text input is a single-line box with no line breaks,
which is painful for anything longer than a few words. `/ticket-config
open-message type:application`, for example, takes no text argument at all;
it just opens a modal pre-filled with the current message, ready to edit and
resubmit.

## Ticket type config fields

Each row in `ticket_configs` (see `src/db/connect.ts` for the schema) has:
`typeKey`, `displayName`, `department`, `channelPrefix`, `reviewChannelId`,
`openMessage`, `claimMessage`, `optionDescription`. Leads are a separate
`ticket_leads` table (many-to-many by `type_key` + user ID).
`openMessage`/`claimMessage` support `{department}`, `{leads}`, `{creator}`,
`{claimant}` template variables, resolved at send time
(`src/utils/ticketFormatter.ts`). `optionDescription` is the short blurb shown
under a type's label in the ticket panel's dropdown (e.g. "Apply to join the
staff team.") — falls back to `department` if not set.

## Commands

**Tickets**
- `/ticket create type:<autocomplete>` — anyone; opens a modal for ticket
  details, then creates a private ticket channel.
- **Ticket panel** — a persistent embed + dropdown (Ticket Tool style) that
  members click instead of typing a slash command; see below.
- **Claim** button on the ticket's message — restricted to that type's
  configured leads (or anyone with `Manage Server`).
- **Close** button — restricted to a lead, the claimant, `Manage Server`
  holders, or the ticket's creator. Clicking it asks for confirmation
  (ephemeral **Confirm Close** / **Cancel** buttons) before anything happens,
  so a misclick can't nuke a ticket.

**Admin** (require `Manage Server`)
- `/staff-assign type:<autocomplete> action:<add|remove> user:<user>` —
  manage leads for a ticket type. Takes effect immediately, no restart.
- `/staff-status` — embed showing every ticket type, its leads, its review
  channel, and live open/claimed/closed counts.
- `/ticket-config review-channel type:<autocomplete> channel:<channel>` —
  (re)point a ticket type's review/archive channel.
- `/ticket-config open-message type:<autocomplete>` /
  `claim-message type:<autocomplete>` / `option-description type:<autocomplete>`
  — each opens a modal pre-filled with the current text so you can edit it as
  proper multi-line text instead of a cramped single-line command option.
  Saves take effect immediately, no restart. `option-description` is the
  blurb shown under that type in the panel's dropdown.
- `/ticket-panel post channel:<channel>` — post the ticket creation panel
  (embed + select menu, one option per configured ticket type, each showing
  its `option-description` as the dropdown's sub-text) in a channel.
  Re-running it (even in a different channel) edits the existing panel
  message in place rather than leaving duplicates behind — the panel's
  channel/message ID is tracked in `guild_settings`. Run this again any time
  ticket types change, so the dropdown reflects the current list.
- `/ticket-panel customize` — opens a modal pre-filled with the panel's
  current title/description (use `{types}` in the description to insert the
  type list). Leaving a field blank resets it to the default. If a panel is
  already posted, it's refreshed live immediately.
- `/mod-config log-channel channel:<channel>` — set the moderation log
  channel.
- `/mod-config archive-log channel:<channel>` — set the channel `/archive`
  exports are logged to. With no options it reports where they go today; with
  `disable:true` it stops logging them. Unset, exports are logged to the
  mod-log channel, so a guild with a mod-log gets a paper trail without
  configuring anything.
- `/todo-panel post channel:<channel>` — post the to-do list panel (embed +
  **Add Task** / **Assign** / **Complete** / **Remove** buttons) in a channel.
  Re-running it edits the existing panel message in place, same as
  `/ticket-panel post` — the panel's channel/message ID is tracked in
  `guild_settings`.

**To-Do list**
- `/task create description:<text> assignee:<user>?` — anyone; adds a task
  directly (optionally pre-assigned) without touching the panel. Same effect
  as the Add Task button, just without the modal — handy for quickly adding
  and assigning in one step.
- **Add Task** button — anyone; opens a modal for the task text.
- **Assign** button — anyone; pick an open task, then pick who it goes to (or
  hit **Unassign**). No `Manage Server` requirement — teams self-organize.
- **Complete** / **Remove** buttons — restricted to the task's creator, its
  assignee, or a `Manage Server` holder.
- The panel embed groups open tasks by assignee (plus an "Unassigned" group);
  within a group, tasks are separated by a divider line so a busy list stays
  scannable instead of reading as one block of text.
- `/todo` — anyone; ephemeral copy of the full shared board (same grouping
  and buttons as the panel), for whenever you don't want to jump to the
  channel it's posted in.
- `/my-tasks` — anyone; ephemeral list of just the open tasks assigned to
  you, for a personal view without scrolling the shared panel.

**Channel transcripts**
- `/archive duration? from? channel? limit?` — anyone, in the guilds listed in
  `ARCHIVE_GUILD_IDS` (defaults to `903819888903200798`); pulls
  the channel's messages from the last `duration` (`30m`, `24h`, `7d`, `1w2d`;
  defaults to `24h`, max 90 days) and DMs you an embed summarizing who talked,
  when, and in which channel, plus the full `.txt` transcript attached — the
  embed itself doesn't quote any message content, since the point is a quick
  summary, not a second place to read the conversation. Defaults to the channel you run it in. `limit` caps how many messages
  are included (default 1000, max 5000). `from` takes a message link (right-click
  a message → **Copy Message Link**) or a raw message ID and transcripts that
  message onwards to the newest one, instead of looking back by time — use it
  for "everything since this happened". A link supplies its own channel, so
  `channel` is redundant with one and conflicting values are rejected. `from`
  and `duration` are mutually exclusive. There is no role gate inside the
  allowed guilds: access to the channel *is* the permission. Elsewhere the
  command isn't registered at all, and a stale registration is refused at
  runtime rather than trusted. You only get a transcript for channels you can
  already read, and the bot needs `View Channel` + `Read Message
  History` there. If your DMs are closed, the file comes back as an ephemeral
  reply instead. Transcripts are files only, not hosted links: the bot has no
  web host, and a public URL for a private channel's history is a leak waiting
  to happen.
- Every completed export is logged to the archive-log channel (or the mod-log
  channel if none is set): who ran it, which channel, the window, how many
  messages, and whether it went out by DM. Metadata only, never the transcript
  itself, since the log channel's audience is not the requester. Anyone who can
  read a channel can export it, so the log is what makes that accountable.
  `/mod-config archive-log disable:true` turns it off.

**Moderation**
- `/ban user reason? delete_message_days?` — requires `Ban Members`.
- `/kick user reason?` — requires `Kick Members`.
- `/timeout user minutes reason?` — requires `Moderate Members`.
- `/warn user reason` — requires `Moderate Members`; persisted in SQLite.
- `/unwarn warning_id` — clears (soft-deletes) a warning.
- `/warnings user` — lists a user's active warnings.
- `/purge` — requires `Manage Messages`; bulk-deletes in the channel it's run
  in, batching through Discord's 100-message-per-call bulk-delete endpoint.
  Always stops early if it hits messages older than 14 days, since Discord's
  bulk-delete won't touch those regardless of permissions.
  - `/purge any amount` — deletes the most recent `amount` messages (max 5000),
    no filtering.
  - `/purge user target amount` — deletes up to `amount` messages from `target`,
    searching back up to 5000 messages to find them.
  - `/purge bots amount` — same as `user`, but matches any bot's messages.
  - `/purge after message` — deletes everything after the given message link
    or ID (exclusive), up to 5000 messages. No `amount`; it just goes until it
    runs out of newer messages or hits the search cap.

All moderation actions that succeed are logged as an embed to the channel set
via `/mod-config log-channel`, if configured.

## Ticket archive logs

When a ticket closes, its review/archive channel gets one embed per ticket
(color-coded, titled `<Ticket Type> — Ticket #<id>`, with Opened/Claimed/Closed
by + duration fields) so consecutive closures are easy to tell apart at a
glance instead of blending into a wall of plain text. The transcript itself is
plain text in the embed description (not a code block — Discord doesn't
resolve `<@id>` mentions to names inside code blocks, so usernames would show
as raw IDs); if it's too long to fit, it's truncated there and the full
transcript is still attached as a `.txt` file on the same message.

## Ticket channel names

Channels are named `<prefix>-<username>-<ticket id>` (e.g. `application-coffee-4`).
The numeric suffix is the same ticket ID shown in the embed footer and the
archive log, so a channel name and its eventual archive entry are always
easy to match up.

## Adding a new ticket type

Not a routine change — add an entry to `src/seed/defaultTicketTypes.ts` (or
insert directly into the `ticket_configs` table) with the six fields above,
then run `/ticket-config review-channel` and `/staff-assign` to finish wiring
it up in Discord. No changes to `ticketHandler.ts` or any command are needed.

## Setup

### RCSupportBridge staff bug Forum

Run `/bugreport setup channel:#your-forum` (or `/br setup`) in the destination guild to save the Forum in SQLite and add missing status tags. The command requires Manage Server; the bot needs Manage Channels on that Forum when adding tags. Existing tags are preserved. The saved channel overrides `RCSUPPORT_FORUM_CHANNEL_ID`, which is now an optional fallback. On startup, the bot also adds missing status tags to the selected Forum automatically (Manage Channels is required). Setup reports synchronization failures separately from successful channel/tag configuration. Missing Forum configuration or insufficient permissions leave the bot online so setup can run. A configured bridge cannot be reassigned from another guild, but setup can assign a replacement Forum even if the old channel was deleted or has mapped reports. Existing mappings are preserved; setup does not move or recreate historical posts. New reports use the newly assigned Forum. API URL, token, and certificate settings remain in `.env`.

The `src/rcsupport` module is separate from the existing ticket pipeline. It uses one existing **staff-only Forum channel** with status tags Open 🔴, Acknowledged 👀, In Progress 🔧, Resolved ✅, and Won’t Fix ⛔ (legacy internal names are migrated in place); the bot prepares missing tags at boot without removing custom tags. Select an empty Forum with the setup command and the bot configures all five status tags plus Closed 🔒. Existing channel permissions are preserved. The existing bug-report type in this repository is keyed `bug_report`, and its current `ticket_leads` assignments supply individual mentions when the Paper plugin's `alerts.mode` is `leads`. In `broadcast` mode, the Paper plugin alerts players with `rcsupport.alert` and neither kind of Forum post pings leads.

Set `RCSUPPORT_API_TOKEN` and `RCSUPPORT_API_CA_CERT_PATH` (the public PEM automatically generated by the Paper plugin) in `.env`. Both are required. Select the Forum with `/bugreport setup`, or use `RCSUPPORT_FORUM_CHANNEL_ID` as an optional fallback. `RCSUPPORT_API_BASE_URL` defaults to `https://127.0.0.1:28120`, `RCSUPPORT_POLL_INTERVAL_MS` to `20000`, and `RCSUPPORT_ALERT_MODE_CACHE_MS` to `60000`. The bot trusts only the supplied certificate for these requests, and the URL hostname/IP must appear in the certificate's subject alternative names. Separate Pterodactyl/Wings containers do not share loopback: configure the plugin's bind address and API allocation for container-to-container access, then set this URL to the actual reachable address. The included Docker Compose file does not mount the PEM, so add a read-only mount and set `RCSUPPORT_API_CA_CERT_PATH` to its **in-container** path if using Compose. Enable the Discord **Message Content** privileged intent in the developer portal; the module needs it to forward staff replies from plugin-originated Forum posts. Grant the bot Forum access, message sending, and thread message permissions.

On startup, the bot polls open Paper reports and creates a tagged Forum post for each. It stores the mapping before acknowledging the post to the plugin, so retries do not create a duplicate. Staff replies and manual status-tag changes on these mapped posts go back to the plugin. `/bugreport post channel:#staff-channel` (or the shorter `/br post channel:#staff-channel`) posts a persistent **Open Bug Report** button for staff filing directly in Discord. These Discord-native posts have no plugin ticket ID: only the alert-mode config read is sent to the plugin, and replies/statuses stay entirely in Discord. The command requires Manage Server; anyone using the button must be able to view the staff Forum.

Run `npm test` for the focused mapping, filtering, source-branching, and alert-cache tests. The existing `better-sqlite3` native dependency may require a supported Node prebuild or local C++ toolchain when installing on Windows.

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`,
   `DISCORD_CLIENT_ID`, `DISCORD_GUILD_IDS` (comma-separated — one bot can run
   in several guilds at once, e.g. a public server and a staff-only server).
3. Register slash commands. The bot does this itself on every boot, so on a
   host with no shell (Pterodactyl, most panel hosts) there is nothing to run:
   restart it and the commands match the running code. To register by hand:
   ```
   npm run deploy-commands
   ```
   Either path registers commands in every guild listed in `DISCORD_GUILD_IDS`.
   Commands pinned to specific guilds (see `ARCHIVE_GUILD_IDS`) are skipped
   everywhere else, and each guild's set is replaced wholesale, so unpinning a
   command removes it from the guilds it no longer belongs to. Set
   `DEPLOY_COMMANDS_ON_START=false` if you would rather only ever register with
   the script.
4. Run the bot:
   ```
   npm run dev
   ```
   or build and run compiled JS: `npm run build && npm start`.

On connect (and again whenever it's added to a new server), the bot seeds the
four default ticket types into SQLite for that guild (if they don't already
exist). Every guild the bot is in gets its own independent ticket types,
leads, panel, mod-log channel, and to-do list — nothing is shared across
guilds. Then, in Discord (repeat per guild):

1. `/ticket-config review-channel type:application channel:#staff-applications`
   (repeat per type)
2. `/staff-assign type:application action:add user:@SomeLead` (repeat per
   type/lead)
3. `/mod-config log-channel channel:#mod-log`, and optionally
   `/mod-config archive-log channel:#archive-log` to split `/archive` exports
   out of the mod-log
4. `/ticket-panel post channel:#create-a-ticket` (optional — gives members a
   dropdown instead of needing to know the slash command)

Members can then run `/ticket create` or use the panel.

## Required bot permissions/intents

Gateway intents: `Guilds`, `GuildMessages`, and privileged `MessageContent` (for RCSupportBridge reply capture). Server permissions: `Manage Channels`,
`Kick Members`, `Ban Members`, `Moderate Members`, plus the ability to send
messages/embeds/files and read message history in whatever channels get used
as review/archive/mod-log channels. No Administrator, no Manage Roles.

## Deploying to a VPS (24/7)

The SQLite file at `DATABASE_PATH` (default `data/rcbot.sqlite`) holds all
state — ticket types, leads, tickets, warnings — so make sure it lives on a
persistent volume/directory in whichever option you pick below.

### Option A: Docker Compose (recommended)

1. Copy the repo to the server and create `.env` there. Never commit `.env`.
2. Register slash commands once (needs the same `.env`):
   ```
   npm install
   npm run deploy-commands
   ```
3. Build and start the bot as a background service:
   ```
   docker compose up -d --build
   ```
4. `data/` is bind-mounted next to `docker-compose.yml`, so the SQLite file
   survives container rebuilds/restarts. Check logs with
   `docker compose logs -f`.

### Option B: systemd (no Docker)

1. On the server: `git clone`, then `npm ci`, `npm run build`, and create
   `.env` in the project root (`npm run deploy-commands` needs it once too).
2. Copy `deploy/rcbotapplications.service` to `/etc/systemd/system/`, editing
   `User` and `WorkingDirectory` to match where you deployed the bot.
3. Enable and start it:
   ```
   sudo systemctl daemon-reload
   sudo systemctl enable --now rcbotapplications
   sudo systemctl status rcbotapplications
   journalctl -u rcbotapplications -f
   ```
4. To deploy an update: `git pull && npm ci && npm run build && sudo systemctl restart rcbotapplications`.

Whichever option you use, re-run `npm run deploy-commands` only when the
slash command *definitions* change (new options, new commands) — day-to-day
lead/config edits go through `/staff-assign`, `/ticket-config`, and
`/mod-config` and need no redeploy.

## Live Minecraft report notifications

With RCSupportBridge 1.0.2+, the bot maintains an authenticated SSE connection at `/api/v1/events` using its existing HTTPS URL, certificate, and token. Filing `/bug` triggers an immediate reconciliation. Reconnects also reconcile pending reports; events arriving during a poll queue another pass. No inbound bot port or new dependencies are needed.

Polling remains a recovery fallback, defaulting to 60000ms. Existing `RCSUPPORT_POLL_INTERVAL_MS` values remain effective; set it to `60000` for one-minute recovery checks. Older plugins continue to work via polling while the event connection retries. Look for `RCSupport live report notifications connected` in the bot console. Updating requires rebuilding the bot and installing the new plugin JAR.

### Updating report details

The GUI plugin and Discord bot must both be updated. Pull the bot source, install its dependencies, run `npm run build`, and restart the bot using the existing host workflow (or rebuild the Docker image if that is how it is deployed). Pulling source without rebuilding leaves `dist` running the old renderer. Keep the existing environment, certificate, and persistent data configuration.

Use Discord `/bugreport refresh report:<Minecraft report number>` to restore saved title, category, description, reproduction steps, attachments, and reporter/server/location in an existing report starter. Replies and status tags remain intact; no duplicate post is created. The command requires Manage Server in the configured Forum guild. Re-register slash commands if startup registration is disabled. A failed individual report or acknowledgment no longer blocks later reports; errors identify the affected report and are retried by normal reconciliation.


### In-game report browser and status synchronization (bridge 1.0.5)

Update the bridge and rebuild/restart this bot together. Minecraft `/bugreport list` adds owner-only browsing for ordinary reporters and Everyone/Mine plus confirmed close/reopen for administrators. Pending Minecraft status changes are stored transactionally by the bridge and reconciled in batches even after reports close. Failures stay queued; one missing historical post does not block later reports. Status synchronization replaces only status tags and preserves unrelated tags. Exact revision acknowledgments and compare-and-set Discord updates prevent stale updates and duplicate history.

Startup/setup upgrades existing status tags in place, preserving their IDs and assignments: Open 🔴, Acknowledged 👀, In Progress 🔧, Resolved ✅, Won’t Fix ⛔. Both old keys and new labels are recognized during migration. Ambiguous duplicates are reported without deleting tags. The bot needs Manage Channels for tag preparation and permission to edit report-thread tags. Existing replacement-Forum behavior and category embed colors remain unchanged. No network, certificate, port, token or database reset is needed.


### Closure announcements and thread deletion (bridge 1.0.7)

Upgrade the bot and bridge together. Closing a report adds **Closed 🔒** alongside **Resolved ✅** or **Won’t Fix ⛔**; reopening removes Closed. Other tags remain, subject to Discord's five applied-tag limit (a closed report has room for three custom tags). Setup/startup adds the Closed tag without replacing existing IDs.

The bot announces each active-to-closed transition: `This report has been closed by **USER** - <t:UNIX:T> · <t:UNIX:d>`. These are Discord's localized long-time and short-date formats. In-game actions show the recorded IGN, without its audit UUID. Discord tag edits use a uniquely matching audit-log entry; grant the bot **View Audit Log** for attribution. If Discord does not expose the actor, the message says **Unknown staff member**. Switching Resolved to Won’t Fix does not generate another closure notice. Closure events survive bridge restarts and close/reopen cycles; persisted bot delivery receipts and uncertain-send recovery prevent repeat notices on acknowledgment retries. The bot needs **Read Message History** for recovery.

Discord `/bugreport delete` (alias `/br delete`) targets the current tracked report thread. Elsewhere, use `/bugreport delete thread:<Discord thread ID>`. The command requires **Manage Server** and **Manage Threads**, with View Channel and Manage Threads in the target thread. A private preview offers a red **Delete thread** button and blue **Keep thread** button, expiring after 60 seconds. Confirmation rechecks access and the exact target. The bot also needs Manage Threads. Deletion permanently removes the Discord thread/messages, keeps the Minecraft report/history and mapping, and records that this thread must not be recreated or receive further updates. It does not delete the saved Minecraft report or automatically close it.

Re-register slash commands if startup registration is disabled. Keep both databases and existing certificates/environment. No live threads are deleted by installing this update.
