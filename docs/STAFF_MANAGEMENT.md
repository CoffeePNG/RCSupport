# Organizational staff management

`/staff` manages the organizational roster. `/staff-assign` and `/staff-status`
continue to manage ticket leads; their data remains separate.

## Confirmed hierarchy

The current organization chart and subsequent clarification supersede the partial
Community example in the original refactor handoff.

- Management: Director, General Manager, Project Coordinator. The coordinator works across departments.
- Engineering: Department Manager, Administrator (optionally senior), Developer;
  Build Team: Administrator, Builder, Trial Builder; Gameplay Team: Administrator.
- Community: Department Manager, Administrator (optionally senior);
  Moderation Team: Administrator, Senior Moderator, Moderator;
  Public Relations Team: Administrator; Support Team: Administrator.
- Shared Support: Helper, listed once and supporting Gameplay, Public Relations and Support.

Senior Moderator is its own rank. Senior Administrator is Administrator with a
seniority attribute, not another chain-of-command tier. The hierarchy is declared
once in `src/features/staff/hierarchy.ts` and reused for validation, autocomplete
and rendering. Display order is not automatic permission inheritance.

## Configuration

1. Set both `PUBLIC_GUILD_ID` and `STAFF_GUILD_ID`. The new `/staff` module remains
   disabled without explicit semantic guild configuration; the legacy archive pin
   is never used to guess its home.
2. Optionally copy `staff.config.example.json` to a persistent configuration file
   and set `STAFF_CONFIG_PATH` to its path. Restart after changes.
3. Populate `adminRoleIds` and each `permissions` capability with Discord role IDs
   **from the Staff guild**. Administrator is always an override within the Staff
   guild. Other members receive only explicitly granted capabilities. No file
   means Administrator-only access and no automatic Discord role changes.
4. Optionally add role bindings. Example shape (replace placeholders with real IDs):

```json
{
  "position": "senior-moderator",
  "guildId": "TARGET_GUILD_ID",
  "roleId": "SENIOR_MODERATOR_ROLE_ID"
}
```

A binding with `"senior": true` applies only to senior Administrators;
`"senior": false` only to non-senior assignments; omitted matches either.
Use multiple bindings for multiple Discord roles or guilds. Helpers use one
`helper` assignment, not three team assignments. Find all position IDs in the
hierarchy file.

**Bound roles are managed by this module.** For each recorded staff member the
bot reconciles the union of roles granted by their current assignments, removing
bound roles that no longer apply. Do not bind unrelated manually managed roles.
Previously tracked grants remain eligible for removal after a mapping is removed.
The bot needs Manage Roles and a role above every role it manages in each target
guild. Members must be present there for role additions; missing members leave a
retry pending. Existing unrelated roles are untouched.

The roster is published to a text channel in the Staff guild. The bot needs View
Channel, Send Messages and Read Message History there. This version permits one
published roster location, with multiple messages when needed. Moving a published
roster to another channel is not yet supported.

## Commands

- `/staff hire user position [senior] [designation]`: create or reactivate a staff
  member with an initial assignment. Already active members use `assign`.
- `/staff assign user position [senior] [designation]`: add an assignment to an
  active staff member.
- `/staff remove user assignment`: end exactly one current assignment selected
  from that user's autocomplete. Removing their last assignment does not fire them.
- `/staff fire user`: show all current assignments, then require an actor-bound,
  five-minute confirmation. If assignments change, the confirmation is refused.
- `/staff vacancy create position [senior] [designation]`: record a real vacancy.
- `/staff vacancy remove vacancy`: close a selected vacancy, retaining history.
- `/staff vacancy fill vacancy user`: atomically close the vacancy and add its
  assignment, hiring or reactivating the person if necessary. Requires vacancy
  permission plus assign permission for existing staff or hire permission for a
  newcomer/returning member. A hire audit entry is recorded when applicable.
- `/staff roster view`: private preview; requires view permission.
- `/staff roster publish channel`: establish or refresh the published roster.
- `/staff roster refresh`: retry role synchronization and update the roster.

Position autocomplete shows full department/team/position paths. Selecting a
single valid path avoids invalid department/team/rank combinations. Designations
are optional short labels such as E or GT. Position titles remain readable text;
people render as Discord user mentions, with notifications disabled.

## Persistence and failure behavior

All staff data is scoped to the Staff guild, which owns the organization across
both servers. Assignment and vacancy history is retained. Each staff mutation,
audit entry and pending synchronization revision commits in one SQLite transaction.
Audit records contain actor, target, action, before/after data, time and source.
Assignment records hold the effective date; department and team are resolved from
the stable position ID and hierarchy. Do not repurpose existing position IDs.

The bot retries pending Discord work every 30 seconds and reconciles on startup.
Role failures do not undo recorded staff changes; responses distinguish saved data
from pending Discord updates. Duplicate assignment protection and one worker per
organization prevent local overlapping mutations/synchronizations from double
applying work. A newer revision cannot be cleared by an older synchronization.
Run one bot process against this SQLite database.

Roster refresh edits known messages, recreates deleted messages and removes surplus
pages after a successful refresh. Message IDs are saved after each successful write.
A process crash after Discord accepts a new message but before its ID is saved can
leave an orphan message; remove that orphan manually. Stored records remain the
source of truth. A failed refresh retains its pending revision and error in
`staff_sync.last_error`.

Changing `STAFF_GUILD_ID` is not an organization-data migration. Keep it stable or
plan a separate data migration before changing it. Back up the database before
first deployment. Existing ticket data is not converted or moved.

## Validation

```sh
npm run build
node --test test/staff-management.test.js test/module-foundation.test.js test/interaction-routing.test.js test/migrations.test.js test/ticket-configuration.test.js test/startup-registration.test.js
```

The tests use disposable SQLite databases and mocked Discord I/O. They verify
transaction rollback, retained history, capability separation, guild isolation,
confirmation expiry/replay/change detection, vacancy atomicity, role unions,
retry recovery, in-flight revision changes, roster pagination and actual slash
handlers. Live Discord role grants, channel permissions and roster appearance
still require deployment verification.
