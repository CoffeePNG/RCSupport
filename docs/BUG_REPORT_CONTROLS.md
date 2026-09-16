# Discord bug-report controls

Implemented locally. Not published or deployed; live Discord validation remains outstanding.

## Controls on the original bot-created report message

- **Claim**: assigns the report to the clicking user and sets In Progress.
- **Release**: removes the claim and sets Open. Only the current claimant or a member with Manage Server may release.
- **Close**: opens a private choice of Resolved or Not Planned, followed by explicit confirmation. Confirmation expires after 60 seconds and belongs to the initiating user.
- **Delete**: appears beside Reopen on closed reports. Requires Manage Server and Manage Threads, checks permissions and closed status again on confirmation, and retains the saved report/history. Shared message buttons are visible to everyone who can view the report; unauthorized users receive a private refusal.
- **Reopen**: appears on closed reports; sets Open and clears the old claim.

Members must be an individually assigned bug-report lead or have Manage Server, and must still be able to view the thread. Permissions are fetched again when the final action runs. Claims do not grant additional access.

The original report embed and attachments are preserved. A status/claimant line is added to the original message above the embed; buttons appear below it. Assignment mentions do not ping anyone.

## Persistence and synchronization

Claims and pending operations are saved in SQLite. Competing clicks use a revision check and the existing per-thread queue. Accepted operations retry after network failures, and a newer Minecraft status supersedes an older pending action.

For linked Minecraft reports, status changes use the bridge's revision-checked status API. Claimant identity currently stays in the bot's database; only status syncs to Minecraft.

For Discord-only reports created by the bot's report button, controls update Discord status tags and preserve the existing closure announcements. This change does not import those reports into Minecraft.

New bot-created posts include buttons immediately. Existing tracked bot-created posts receive controls gradually during polling, five posts per pass, with failures moved to the back of the queue. Posts whose original message is not owned by the bot cannot have these buttons attached by this workflow.

## Suggested command naming

Recommend /bugreport leads add|remove|list, also available under /br if implemented. This groups lead management with the report workflow. This change does not rename or replace /staff-assign; current lead assignment remains:

    /staff-assign type:bug_report action:add user:@person

## Local validation

- npm.cmd run build: passed.
- 47 focused tests passed across case-controls.test.js (13), forum-setup.test.js (27), interaction-routing.test.js (3), migrations.test.js (1), and status-tags.test.js (3).
- Coverage includes concurrent claims, claimant/admin release restrictions, close choice/confirmation, cancellation, expiry, changed permissions, forged message controls, persisted state, lost API responses, Discord write failure, newer Minecraft status, new starters, and existing-message refresh.
- Run test files separately using node --test --test-isolation=none test/<file>.test.js; their dependency substitutes are scoped to each process.

## Live acceptance

1. Update/restart the bot after deployment is authorized; this change requires no new slash-command registration and no bridge rebuild.
2. Verify bot permissions to view the Forum/history, edit its messages, manage thread tags, and send closure notices.
3. Create one Discord-button report and one Minecraft report. Check the buttons under the original embed and the status/claimant line.
4. Have two leads claim the same case, then test release as the claimant, another lead, and an admin.
5. Choose Close, test Cancel, then confirm each closing status. Reopen and verify the previous claim clears.
6. Verify Minecraft status changes update the linked message controls.
7. Restart with a saved claim and simulate a bot/bridge outage during a transition; ensure recovery does not duplicate notices.
8. Check a previously created report and an archived thread. Visual layout and runtime behavior have not yet been verified on the actual server.

The stored/API status remains `wontfix`. Startup renames existing Won’t Fix tags to Not Planned in place, preserving tag IDs and report assignments.

For threads deleted outside the bot, admins can run `/br mark-deleted thread:<id>`. The bot verifies the channel is missing (Discord 10003), then marks the existing mapping deleted to stop polling and recreation. Existing threads and permission-denied responses are refused. Saved report data/history remain.
