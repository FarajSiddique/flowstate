# Supabase persistence: tasks, events, notes + intent log

## Context

Supabase is used only for auth right now. `/api/intent` returns a draft `IntentAction`, and the confirm button in `apps/mobile/src/components/intent-confirmation-modal.tsx` just closes the sheet ("Preview only. Nothing is saved yet."). `docs/specs/living-interface.md` names persistence (the tables plus an `intent_events` log) as the foundation for every later idea: undo, learning from corrections, UPDATE/COMPLETE intents, search, and the timeline.

**Goal of this cut:** confirming a draft saves it; the home screen shows a paginated timeline of the user's items; items can be edited and completed; SEARCH runs against saved data; every confirm and dismiss is logged for later personalization and evals.

**Decisions made while brainstorming:**

- All data access goes through the API (mobile never talks to Postgres directly). RLS stays on as defense in depth.
- Separate `tasks`, `events` and `notes` tables. The timeline is a `UNION ALL` view.
- The intent log records confirms and dismisses, not every keystroke prediction.
- Events may be undated.
- All three kinds can be completed (`completed_at`). No DELETE in this cut.
- The timeline uses cursor (keyset) pagination.

Out of scope: DELETE, full-text/pgvector search, UTC `starts_at`, people/places tables, undo, multi-action.

## 1. Database (`supabase/migrations/<ts>_persistence.sql`)

Tooling: add the `supabase` CLI as a root devDependency (it isn't installed yet). Add the scripts `db:new` (`supabase migration new`) and `db:push` (`supabase db push`, run against the linked hosted project, so Docker isn't needed). Document `supabase link` in `docs/architecture/persistence.md`.

Shared columns on every table:
`user_id uuid not null default auth.uid() references auth.users on delete cascade`, `created_at`, `updated_at` (kept current by a `set_updated_at()` trigger), `completed_at timestamptz null`.

| Table           | Columns                                                                                                                                                                                                                                                                                                                                                                                |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tasks`         | `id uuid pk default gen_random_uuid()`, `title text not null check (char_length between 1 and 200)`, `due_date date null`, `due_time time null` (check: needs `due_date`), `time_zone text not null`, `priority text not null default 'normal' check in (low, normal, high)`                                                                                                           |
| `events`        | `id`, `title`, `start_date date null`, `start_time time null` (check: needs `start_date`; null = all-day), `time_zone text not null`, `duration_min int not null default 60 check 1..1440`, `location text null`, `attendees text[] not null default '{}'`                                                                                                                             |
| `notes`         | `id`, `title`, `body text null`, `time_zone text not null`                                                                                                                                                                                                                                                                                                                             |
| `intent_events` | `id`, `text text not null`, `context jsonb null`, `decision jsonb not null`, `outcome text check in (confirmed, dismissed)`, `confirmed_action jsonb null` (check: required when confirmed), `task_id` / `event_id` / `note_id` nullable FKs `on delete set null`, `check (num_nonnulls(task_id, event_id, note_id) <= 1)`. No `updated_at` or `completed_at`; the log is append-only. |

- **RLS:** enabled on every table. The policies check `user_id = (select auth.uid())`: select/insert/update on the item tables, and select/insert only on `intent_events`.
- **View `timeline_items`** (`security_invoker = true`): `kind, id, title, date, time, time_zone, completed_at, created_at, sort_at`. `sort_at` is `date + coalesce(time, '00:00')` for dated items, and otherwise `created_at` shifted to the item's own time zone.
- **Functions** (`security invoker`, so RLS applies):
  - `record_intent(text, context, decision, outcome, action jsonb)` inserts the item (for CREATE_*) and the log row in a single transaction, then returns the item.
  - `timeline_page(cursor_sort_at, cursor_id, page_size)` filters with `where (sort_at, id) < (cursor…) order by sort_at desc, id desc limit page_size + 1`. The extra row tells the caller whether another page exists.
- **Indexes:** `tasks(user_id, due_date)`, `events(user_id, start_date)`, `notes(user_id, created_at desc)`, `intent_events(user_id, created_at desc)`.
- Account deletion already cascades through the existing `DELETE /api/account`.

## 2. API (`apps/api`)

- `lib/supabase/clients.ts`: add `getUserClient(accessToken, env = process.env)`. It uses the publishable key with `global.headers.Authorization = Bearer <token>` and isn't cached. `verify-request.ts`: add `accessToken` to `AuthUser`.
- New `lib/records/`: row↔contract mappers (snake_case ↔ camelCase, wall-clock ↔ `LocalDateTime`), `recordIntent`, `getTimelinePage`, `searchItems`, `updateItem`, and a `RecordNotFoundError` subclass. Routes stay thin, following `apps/api/AGENTS.md`: verify → parse JSON → safeParse → lib → `schema.parse` the response.
- Cursors are opaque base64url JSON `{ sortAt, id }`. A cursor that won't decode gets a 400 `Invalid cursor`.

| Route                                | Contract                                                                         | Behavior                                                                                                                               |
| ------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/intent-events`            | `{ text, context?, decision, outcome, action? }` → `{ item: SavedItem \| null }` | Calls `record_intent`. SEARCH and dismissed only log.                                                                                  |
| `GET /api/timeline?limit=50&cursor=` | → `{ items: SavedItem[], nextCursor: string \| null }`                           | `limit` 1–100, default 50                                                                                                              |
| `GET /api/search?q&scope&from&to`    | → `{ items: SavedItem[] }`                                                       | `ilike` on title/body in the scoped tables; date range on due/start dates; capped at 50                                                |
| `PATCH /api/items/[kind]/[id]`       | per-kind partial body + `completed?: boolean` → `SavedItem`                      | Edits and/or completes. An unknown kind, a missing row or another user's row (zero rows updated) gets a 404. An empty body gets a 400. |

**`@nexui/types` additions:** `savedTaskSchema`, `savedEventSchema` and `savedNoteSchema` → `savedItemSchema` (a discriminated union on `kind`), `intentEventRequestSchema` (reuses `intentResponseSchema` + `intentActionSchema`), `timelineQuerySchema` and `timelineResponseSchema`, `searchResponseSchema`, and `taskPatchSchema` / `eventPatchSchema` / `notePatchSchema`.

## 3. Mobile (`apps/mobile`)

- `lib/api.ts`: add `recordIntentEvent`, `getTimelinePage`, `searchItems` and `updateItem`, all through `fetchWithSession`, each parsing its response with the shared schema.
- `intent-confirmation-modal.tsx`: add a `fieldsToAction()` function (the inverse of `initialFields`). Submit runs a `useMutation(recordIntentEvent)`. On success it invalidates `['timeline']`, closes the sheet and clears the magic bar. On error the sheet stays open and shows the error inline. Closing without confirming sends a fire-and-forget `dismissed` log. Remove the "Preview only" hint. A SEARCH confirm logs the event and shows results from `searchItems`.
- Home (`(app)/index.tsx`): switch from `ScrollView` to `FlatList`, with the magic bar and status as `ListHeaderComponent`. The timeline uses `useInfiniteQuery(['timeline'])`, with `onEndReached → fetchNextPage` and a footer spinner. Each row has a completion checkbox (`updateItem({ completed })`, updated optimistically), and tapping a row opens the same sheet in **edit** mode, prefilled from the `SavedItem` and submitting a PATCH. Undated items show an "Unscheduled" tag. Completed items are dimmed.
- TanStack Query holds the server state; Zustand stays UI-only.

## Verification

- `pnpm test`: new `tests/intent-events-route.test.mjs`, `timeline-route`, `search-route` and `items-route`, stubbing Supabase REST/RPC at the network boundary (extending `tests/support/supabase-auth.mjs`); `records-mappers.test.mjs`; contract tests for the new schemas, including the cursor round-trip and the per-kind patch validation.
- Migration: `pnpm db:push` to the linked project. Check RLS manually with two accounts: user B's timeline doesn't show user A's rows, and a PATCH to user A's item from B gets a 404.
- `pnpm fix && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build`.
- Expo smoke test: confirm a task, an event and a note, and see them in the timeline. Dismiss a draft and check that the `intent_events` row exists. Edit an event's time. Complete a task. Scroll past 50 items (seed them via SQL) to check pagination has no duplicates. Delete the account and check its rows are gone.
- Agents: `api-reviewer`, `mobile-reviewer`, `security-reviewer` (RLS, the new routes, logged user text), then `docs-keeper` (new `docs/architecture/persistence.md` and the env/CLI steps).
