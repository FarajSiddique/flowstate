# Persistence

Tasks, events and notes are saved in Supabase Postgres. Every change goes through the
API; the mobile app never queries the database.

## Flow

1. The magic bar gets a draft from `POST /api/intent` (nothing saved).
2. Confirming the sheet calls `POST /api/intent-events` with the edited action. The
   `record_intent` SQL function saves the item and appends an `intent_events` row in
   one transaction. Closing the sheet logs `dismissed` instead.
3. The home timeline pages through `GET /api/timeline` (`timeline_page`, keyset on
   `sort_at desc, id desc`, opaque cursor). Undated items sort by creation time.
4. `PATCH /api/items/:kind/:id` edits fields and/or sets `completed`.
5. A confirmed SEARCH draft calls `GET /api/search` (`ilike` over `timeline_items`).
   `%`, `_` and `\` match literally. `*` still acts as a wildcard: PostgREST rewrites
   every `*` in a like pattern to `%`, and escaping it does not help.

## Ownership

The API calls Supabase with `getUserClient(accessToken)`: the publishable key plus the
user's JWT. RLS policies (`user_id = auth.uid()`) scope every table, the view
(`security_invoker`) and both functions (`security invoker`). A row owned by someone
else looks the same as a missing row (404). Deleting the account cascades to all rows.

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
