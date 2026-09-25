# Persistence

Tasks, events and notes are saved in Supabase Postgres. Every change goes through the
API; the mobile app never queries the database.

## Flow

1. The magic bar gets a draft from `POST /api/intent` (nothing saved).
2. Confirming the card or the sheet calls `POST /api/intent-events` with the edited
   action and `via` (`instant` or `form`). The `record_intent` SQL function — 7 args,
   the last being `input_via` — saves a `CREATE_*` item or applies a `COMPLETE`,
   `RESCHEDULE` or `APPEND` change, and appends an `intent_events` row, in one
   transaction. It returns `{ eventId, item }`: `eventId` is the log row's id (for
   undo), `item` is the saved or changed record. Closing the sheet logs `dismissed`
   instead. A change that touches no row (wrong kind, another user's item, already
   complete, or nothing matched) raises `NXU01`, which the API maps to 409.
3. The home timeline pages through `GET /api/timeline` (`timeline_page`, keyset on
   `sort_at desc, id desc`, opaque cursor). Undated items sort by creation time.
4. `PATCH /api/items/:kind/:id` edits fields and/or sets `completed`.
5. A confirmed SEARCH draft calls `GET /api/search` (`ilike` over `timeline_items`).
   `%`, `_` and `\` match literally. `*` still acts as a wildcard: PostgREST rewrites
   every `*` in a like pattern to `%`, and escaping it does not help.

## Instant actions and Undo

A confirmed `CREATE_*`, `COMPLETE`, `RESCHEDULE` or `APPEND` action saves `before`
(the columns a change is about to overwrite, null for a create) and `after_updated_at`
(the item's `updated_at` right after the write) on its `intent_events` row, alongside
the existing `task_id`/`event_id`/`note_id` link. `POST /api/intent-events/:id/undo`
calls `undo_intent(event_id)`, which:

- Raises `NXU04` (404) when the log row is missing or owned by someone else — RLS
  makes it look the same as missing.
- Raises `NXU09` (409) when the outcome isn't `confirmed`, the action is `SEARCH`,
  `undone_at` is already set, the row is older than 60 seconds, or the item's current
  `updated_at` no longer matches `after_updated_at` (it was edited since). The message
  is one of `Too late to undo`, `Item was edited, so undo was skipped`, `Already
undone` or `Nothing to undo`, and is safe to show.
- Otherwise deletes a created item or restores the `before` columns of a change, then
  stamps `undone_at = now()`.

Undoing a newly created item deletes it; the log row's `task_id`/`event_id`/`note_id`
foreign key is `on delete set null`, so that column clears on the log row instead of
the row disappearing. See `docs/architecture/instant-actions.md` for the mobile side
(commit, the Undo card, and how change intents find their target).

## Ownership

The API calls Supabase with `getUserClient(accessToken)`: the publishable key plus the
user's JWT. RLS policies (`user_id = auth.uid()`) scope every table, the view
(`security_invoker`) and both functions (`security invoker`). A row owned by someone
else looks the same as a missing row (404). Deleting the account cascades to all rows.

`tasks`, `events` and `notes` also grant `delete` to `authenticated`, with an
owner-only delete policy on each, so `undo_intent` can remove a created item.
`intent_events` stays append-only except for one column: `grant update (undone_at)`
plus an owner-only update policy lets undo stamp a row without letting anyone touch
the text, decision or outcome it logged.

## Retention and scale

`intent_events` keeps the raw typed text and the decision JSON until the account is
deleted. There is no per-row purge yet; add one if the log needs a retention window.

Every timeline page reads and sorts the user's whole `timeline_items` union before
taking its slice (search scans it too). That is fine at prototype scale; revisit it when users have thousands of
items.

## Dates

Items store wall-clock `date` + `time` and the IANA `time_zone` they were entered in.
There is no UTC instant yet; add one when reminders need it.

## Migrations

SQL lives in `supabase/migrations/`. One-time setup:
`pnpm exec supabase login` and `pnpm exec supabase link --project-ref <ref>`.
Create a migration with `pnpm db:new <name>` and apply it with `pnpm db:push`. Never
edit a pushed migration; add a new one. `supabase/tests/rls-smoke.sql` checks RLS in
the SQL editor and rolls itself back.
