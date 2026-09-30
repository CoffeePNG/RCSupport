# Ticket configuration and daily workflows

These commands use the ticket module's Public guild scope. Organizational `/staff`
assignments remain independent of ticket leads configured through `/staff-assign`.

## Create and lock ticket types

Managers can use `/ticket-config create key name department [prefix]` to create a
new type without editing source or SQLite. New types start locked. Set category,
questions, leads and review channel, inspect configuration, then run
`/ticket-config unlock type`.

`/ticket-config lock type` stops new tickets, including submissions from old forms.
The final database reservation checks intake again, so locking while category
permissions are being checked cannot admit a new ticket. Existing tickets remain
in the staff queue and can still be claimed, released or closed. A ticket already
reserved before a lock may finish opening; the lock is not a cancellation of
accepted work.

The member-facing dropdown and `/ticket create` autocomplete show only enabled
types. Administrative autocomplete includes locked types and labels them. When
all types are locked, the panel shows a locked notice and no controls. Settings
remain saved even if Discord panel refresh fails, and the command explains how
to repost it. `/staff-status` includes intake state and splits long summaries into
private pages.

Create/lock/unlock require Manage Server and save an audit entry in the same
transaction as the change. Duplicate keys are rejected. Names can be up to 45
characters, departments 100, and keys/prefixes 32. Keys accept letters, numbers,
underscores and hyphens; channel prefixes accept letters, numbers and hyphens.
Keys/prefixes normalize to lowercase. There is a supported limit of 25 total types
per guild, including locked types; no delete operation is added here.

## Inspect configuration

- `/ticket-config view type`: private summary of the category, archive channel,
  assigned leads, question sets, application roles and active counts.
- `/ticket-config check type`: read-only inspection of the configured category,
  archive channel, published panel and required bot permissions. It reports missing
  channels or permissions and does not change settings.
- `/ticket-config review-channel`: validates an accessible text channel in the
  current guild, outside ticket channels, with View Channel, Send Messages, Read
  Message History, Attach Files and Embed Links before saving it.

These commands require Manage Server. A configuration check reflects current
access; later role or channel changes can still cause an operation to fail.

## Work the queue

`/ticket queue [status] [type] [page]` lists active tickets oldest first, ten per
page. Status filters are All active, Unclaimed, Claimed and Claimed by me.
Ticket leads see only types they manage. Manage Server holders see the full guild
queue. Access restrictions are applied before counting or pagination, including
type autocomplete. Reservations without a created channel are not listed.

Claim a ticket using its Claim button or `/ticket claim` inside the channel.
Only a configured lead or Manage Server holder can claim it. Simultaneous attempts
cannot overwrite an existing claimant.

The button then becomes **Release claim**. The current claimant, while still a
lead, or a Manage Server holder can return the ticket to the unclaimed queue.
`/ticket release` also works inside the channel, including for older ticket messages
whose Claim button was disabled. Other leads cannot remove someone's claim.

The **Ticket status** field reflects current ownership. Existing questionnaire
fields are preserved, even if a question happens to use a similar label.

## Close and archive safely

The creator, a configured lead, or a Manage Server holder may request closure.
Confirmation rechecks permission and validates both the ticket's guild and channel.
Ownership changes and closure share one per-ticket operation queue. Run one bot
process against this database.

On confirmation:

1. Capture a transcript snapshot, including the stored original submission.
2. Save the transcript in `ticket_close_exports` in SQLite.
3. If a review/archive channel is configured, deliver the transcript there and
   record its message ID. The destination must be in the same guild and must not
   itself be a ticket channel.
4. Mark the ticket closed and queue channel deletion together in one transaction.
5. Begin deletion after five seconds; failed deletions retry automatically, including
   after a bot restart. Cleanup checks the stored guild before deleting a channel.

A failed configured archive delivery leaves the ticket active and the channel
intact. Fix the destination or permissions and press Confirm Close again. Retry
captures a fresh snapshot; a confirmed export with identical contents and destination
can be reused. A crash after Discord accepts an export but before its receipt is
saved can leave a duplicate archive message on retry, but does not authorize deletion
without a recorded transcript.

Without a configured review channel, the transcript is retained in the bot database
before closure. Configure a review channel for convenient staff access, and back up
the database. This increment does not add a transcript-retention purge or a download
command. Transcripts remain until deliberately removed by an operator.

The automatic transcript limit is 10,000 messages. A truncated capture prevents
closure rather than silently deleting older history. An attachment over 7.5 MB also
prevents automatic closure when a review channel is configured. These cases require
manual archival and operator handling. A transcript is a snapshot taken during
confirmation; messages posted after that snapshot are not part of the export.

Cleanup retries every 15 seconds, with failed tickets delayed 30 seconds so one
failure cannot monopolize the batch. `ticket_close_exports.last_error` records the
latest deletion failure. Old closed tickets without a stored export are not picked
up for automatic deletion.

## Validation

```sh
npm run build
node --test test/ticket-type-management.test.js test/ticket-workflows.test.js test/ticket-configuration.test.js test/interaction-routing.test.js test/migrations.test.js test/startup-registration.test.js
```

Tests use disposable databases and mocked Discord I/O. They cover competing claims,
release authorization, cross-guild/channel controls, private queue filters, failed
archive delivery, durable cleanup retries, transcript limits, preserved questionnaire
fields and read-only configuration inspection. Live permissions and appearance still
need verification after deployment.

## Reassignment

`/ticket reassign [type] [staff] [reason]` works inside an active ticket. Supply a
team/type, a staff member, or both. Leads must manage both the current and destination
types; Manage Server can transfer across types. The assignee must be a destination
lead or server manager. Locked types can receive existing tickets; locking only
prevents new intake. Changing type without selecting staff clears the claim.

The channel and original submission stay intact. The bot moves the channel to the
destination category and replaces old lead/claimant overwrites with destination
staff access. Explicit guest overwrites remain; inherited Administrator access is
unaffected. The starter embed changes to the new type. The channel name stays the
same so existing references remain recognizable. The destination type controls
future closure exports and history access.

Transfer intent is saved before Discord edits. Claims, closure and reminders are
blocked while a transfer is pending. A worker retries each minute and after restart.
`/ticket details id` shows the pending error. Fix bot/category permissions, or a
server manager can run `/ticket reassign` again to correct the destination or
assignee. Selecting the original type restores that routing. The bot remembers
previously targeted staff grants so a corrected transfer removes them too.
Successful transfers record actor, reason, old/new types and old/new assignees.
The bot needs Manage Channels and Manage Roles to update the channel and overwrites.

## History and transcripts

- `/ticket history [requester] [type] [status] [page]` lists ten tickets per page,
  newest first, including closed tickets whose channels were deleted.
- `/ticket details id` shows current ownership, waiting state, pending transfers,
  and recent reassignment/waiting events.
- `/ticket transcript id` privately attaches the saved transcript for a closed ticket.

Access is checked against the ticket's **current** type in the current guild.
Leads see their types; Manage Server sees all types. Requesters have no history
or transcript access through these commands. SQL filters access before pagination.
After a transfer, former leads lose history access unless they also lead the new type.
Existing transcripts in review channels retain those channels' Discord permissions.
Older closed tickets without a saved transcript cannot be reconstructed after their
channels have been deleted. Downloads are capped at 7.5 MB; oversized stored exports
require an operator to retrieve them from the database. No automatic retention purge
is introduced.

## In-ticket notifications

`/ticket-config notifications type [unclaimed-minutes] [waiting-minutes]` shows or
updates timers. Manage Server is required. Each timer defaults to **off**; zero
turns it off, and 1–10080 sets minutes (up to seven days). Omitted settings remain
unchanged. Configuration changes are audited.

`/ticket waiting on:staff|requester|none` lets the ticket's leads or a server manager
set the expected responder. The next human message from that side clears the state;
bots, unrelated participants, and messages older than the state do not. This does
not automatically switch the waiting state to the other side. Reply detection needs
the bot online; messages sent while it is offline are not replayed by this worker.

Reminders post **inside the ticket only**. Unclaimed tickets ping configured leads
(up to twenty); staff-waiting tickets ping the claimant or leads; requester-waiting
tickets ping the requester. No role/everyone mentions or DMs are enabled. One reminder
is sent per unclaimed period or explicit waiting state. A waiting state takes
precedence over the unclaimed reminder. Releasing a claim or transferring starts a
fresh unclaimed timer; transfers also clear the waiting state. Closed tickets never
receive reminders. Delivery runs each minute; failed sends retry after five minutes.
Persistent receipts prevent ordinary repeats after restart, though a crash or network
failure after Discord accepts a message but before saving its receipt may duplicate
that reminder. Timers do not close tickets automatically.

Validation: `npm test` includes `test/ticket-history-notifications.test.js`, covering
cross-guild/type access, transcript retrieval, transfer authorization and permission
updates, pending recovery/correction, preserved submissions, reminder timing,
restart persistence, reply detection and failed delivery. Live Discord behavior
still requires deployment and a controlled ticket walkthrough.
