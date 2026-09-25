# Supabase Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Confirming a magic-bar draft saves a task, event or note to Supabase. Every confirm and dismiss is logged. The home screen shows a paginated timeline where items can be edited and completed, and SEARCH runs against saved items.

**Architecture:** Postgres tables with RLS live in `supabase/migrations/`. The Next.js API reads and writes them with a per-request Supabase client that carries the user's JWT, so RLS enforces ownership. Multi-step writes and keyset pagination are `security invoker` SQL functions called with `.rpc()`. Mobile talks only to the API, keeps server state in TanStack Query, and builds its forms from pure, tested field helpers.

**Tech Stack:** Supabase Postgres + CLI, `@supabase/supabase-js` v2, Next.js 16 route handlers, Zod 4 (`@nexui/types`), Expo Router / React Native, TanStack Query v5, Node's built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-24-persistence-design.md`

## Global Constraints

- Node.js 24 (`nvm use`), pnpm 10.34.5. Run commands from the repo root.
- All data access goes through the API. Mobile never queries Postgres directly. RLS stays on every table.
- `getAdminClient()` (secret key) stays limited to account deletion. User data always goes through `getUserClient(accessToken)`.
- Route handler order: `verifyRequest` → `request.json()` in try/catch (400 `Invalid JSON`) → `safeParse` → lib call → `schema.parse` the response. Error bodies are `{ error: string }` with user-safe text. Log `console.error('[tag]', message)` and never log bodies, tokens, user text or provider errors.
- API relative imports include the `.ts` extension. Exported functions have explicit parameter and return types. Use `import type` for type-only imports.
- Always use braces on `if`/`else`/loops. Put a blank line before `return`, after blocks and after declaration groups (`pnpm lint:fix` adds them).
- Shared contracts come from Zod in `packages/types/src/index.ts`.
- Dates and times are wall-clock values (`YYYY-MM-DD`, `HH:MM`) plus an IANA `time_zone`. There's no UTC `starts_at`.
- Completion (`completed_at`) applies to tasks, events and notes. There's no DELETE route in this cut.
- Timeline pagination is keyset: order `sort_at desc, id desc`, opaque base64url cursor `{ sortAt, id }`, `limit` 1–100 (default 50).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Typed values the parser can't read.** A date like "next friday", or a time with no date, gives an inline form error. Nothing is sent and the sheet stays open. _(Task 8 tests)_
2. **Search text with `%`, `_`, `,` or `(`.** It's matched literally, with no PostgREST parse error and no wildcard leak. _(Task 6 test)_
3. **A malformed or tampered timeline cursor.** It gets a 400 `Invalid cursor` without touching the database. _(Task 5 test)_
4. **PATCH of another user's item, a missing id, or a non-UUID id.** The user gets a 404, not a 500, and the row doesn't change. _(Task 7 tests; RLS covered by the Task 1 smoke SQL)_
5. **Confirming a draft.** It must never also log a dismissal, and a failed save keeps the sheet open with a readable error. _(Task 8 tests for the error text; Task 10 manual check for the dismiss rule)_

---

## File Structure

**Create**

- `supabase/config.toml` (via `supabase init`), `supabase/migrations/20260924000000_persistence.sql`, `supabase/tests/rls-smoke.sql`
- `apps/api/src/lib/records/mappers.ts`: rows ↔ contracts, patch → columns
- `apps/api/src/lib/records/cursor.ts`: timeline cursor encoding
- `apps/api/src/lib/records/queries.ts`: `recordIntent`, `getTimelinePage`, `searchItems`, `updateItem`
- `apps/api/src/app/api/intent-events/route.ts`, `apps/api/src/app/api/timeline/route.ts`, `apps/api/src/app/api/search/route.ts`, `apps/api/src/app/api/items/[kind]/[id]/route.ts`
- `apps/mobile/src/lib/form-values.ts`: parses free-text date, time, duration, list and range fields
- `apps/mobile/src/lib/item-fields.ts`: form model, prefill from a draft or item, and reading the form back into an action or patch
- `apps/mobile/src/lib/timeline-pages.ts`: pure optimistic-update helper
- `apps/mobile/src/lib/use-timeline.ts`: infinite query and completion mutation
- `apps/mobile/src/components/draft-sheet.tsx`, `apps/mobile/src/components/edit-sheet.tsx`, `apps/mobile/src/components/timeline-row.tsx`
- `tests/support/records.mjs`, `tests/records-contract.test.mjs`, `tests/records-mappers.test.mjs`, `tests/intent-events-route.test.mjs`, `tests/timeline-route.test.mjs`, `tests/search-route.test.mjs`, `tests/items-route.test.mjs`, `tests/form-values.test.mjs`, `tests/item-fields.test.mjs`, `tests/timeline-pages.test.mjs`
- `docs/architecture/persistence.md`

**Modify**

- `package.json` and `pnpm-workspace.yaml`: supabase CLI and `db:*` scripts
- `packages/types/src/index.ts`: saved-item, intent-event, timeline, search and patch schemas
- `apps/api/src/lib/supabase/clients.ts` (`getUserClient`), `verify-request.ts` (`accessToken`), `README.md`
- `tests/support/supabase-auth.mjs` (`upstreamCall`), `tests/verify-request.test.mjs`
- `apps/mobile/src/lib/api.ts`, `apps/mobile/src/lib/intent-display.ts` (`displayItemMeta`)
- `apps/mobile/src/components/intent-confirmation-modal.tsx`: renamed to `item-form-sheet.tsx` and made presentational
- `apps/mobile/src/app/(app)/index.tsx`: FlatList timeline and sheets
- `AGENTS.md`: structure and commands

---

### Task 1: Database schema, RLS and SQL functions

**Files:**

- Modify: `package.json`, `pnpm-workspace.yaml`
- Create: `supabase/config.toml` (generated), `supabase/migrations/20260924000000_persistence.sql`, `supabase/tests/rls-smoke.sql`

**Interfaces:**

- Produces (used by Tasks 4–7):
  - tables `public.tasks`, `public.events`, `public.notes`, `public.intent_events` (columns below)
  - view `public.timeline_items(kind text, id uuid, user_id uuid, sort_at timestamp, item_date date, search_text text, item jsonb)`, where `item` is the table row as JSON (snake_case)
  - `public.record_intent(input_text text, input_context jsonb, input_decision jsonb, input_outcome text, input_action jsonb, input_time_zone text) returns jsonb`, which returns `{ kind: 'task'|'event'|'note', ...row }` or `null`
  - `public.timeline_page(page_size integer, cursor_sort_at timestamp default null, cursor_id uuid default null) returns setof public.timeline_items`

- [ ] **Step 1: Add the Supabase CLI**

The `supabase` npm package downloads its binary in a postinstall script, which pnpm 10 blocks unless it's allowed. Add it to `pnpm-workspace.yaml`:

```yaml
onlyBuiltDependencies:
  - sharp
  - supabase
  - unrs-resolver
```

Run: `pnpm add -Dw supabase`
Then add these scripts to the root `package.json` `scripts`, after `eval:intent`:

```json
    "db:new": "supabase migration new",
    "db:push": "supabase db push",
```

Run: `pnpm exec supabase --version`
Expected: a version string such as `2.x.y`.

- [ ] **Step 2: Initialise the supabase folder**

Run: `pnpm exec supabase init` (answer "N" to the VS Code/IntelliJ settings prompts).
Expected: it creates `supabase/config.toml` and `supabase/.gitignore`. Don't edit `config.toml`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260924000000_persistence.sql`:

```sql
-- Saved tasks, events and notes, plus the log of confirmed and dismissed drafts.
-- Dates and times are wall-clock values in the item's own IANA time zone.
-- Every table is owner-only through RLS; the API calls these as the signed-in user.

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  due_date date,
  due_time time,
  time_zone text not null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_time is null or due_date is not null)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  start_date date,
  start_time time,
  time_zone text not null,
  duration_min integer not null default 60 check (duration_min between 1 and 1440),
  location text check (char_length(location) <= 200),
  attendees text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time is null or start_date is not null)
);

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  body text check (char_length(body) <= 10000),
  time_zone text not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only: one row per confirmed or dismissed draft.
create table public.intent_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  text text not null check (char_length(text) between 3 and 500),
  context jsonb,
  decision jsonb not null,
  outcome text not null check (outcome in ('confirmed', 'dismissed')),
  confirmed_action jsonb,
  task_id uuid references public.tasks (id) on delete set null,
  event_id uuid references public.events (id) on delete set null,
  note_id uuid references public.notes (id) on delete set null,
  created_at timestamptz not null default now(),
  check (outcome = 'dismissed' or confirmed_action is not null),
  check (num_nonnulls(task_id, event_id, note_id) <= 1)
);

create trigger tasks_set_updated_at before update on public.tasks
  for each row execute function public.set_updated_at();
create trigger events_set_updated_at before update on public.events
  for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();

create index tasks_user_due_idx on public.tasks (user_id, due_date);
create index events_user_start_idx on public.events (user_id, start_date);
create index notes_user_created_idx on public.notes (user_id, created_at desc);
create index intent_events_user_created_idx on public.intent_events (user_id, created_at desc);

alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.notes enable row level security;
alter table public.intent_events enable row level security;

create policy "Owners read tasks" on public.tasks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add tasks" on public.tasks for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners change tasks" on public.tasks for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owners read events" on public.events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add events" on public.events for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners change events" on public.events for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owners read notes" on public.notes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add notes" on public.notes for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "Owners change notes" on public.notes for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "Owners read their log" on public.intent_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners add to their log" on public.intent_events for insert to authenticated
  with check (user_id = (select auth.uid()));

-- Supabase grants everything to anon and authenticated by default; narrow it.
revoke all on public.tasks, public.events, public.notes, public.intent_events
  from anon, authenticated;
grant select, insert, update on public.tasks, public.events, public.notes to authenticated;
grant select, insert on public.intent_events to authenticated;

-- One stream over all three kinds. `sort_at` is the item's wall-clock time, or when
-- it was created (in its own zone) if it has no date. `item` is the full row.
create view public.timeline_items
with (security_invoker = true)
as
select
  'task'::text as kind,
  t.id,
  t.user_id,
  coalesce(t.due_date + coalesce(t.due_time, time '00:00'), t.created_at at time zone t.time_zone)
    as sort_at,
  t.due_date as item_date,
  t.title as search_text,
  to_jsonb(t) as item
from public.tasks t
union all
select
  'event',
  e.id,
  e.user_id,
  coalesce(e.start_date + coalesce(e.start_time, time '00:00'), e.created_at at time zone e.time_zone),
  e.start_date,
  concat_ws(' ', e.title, e.location, array_to_string(e.attendees, ' ')),
  to_jsonb(e)
from public.events e
union all
select
  'note',
  n.id,
  n.user_id,
  n.created_at at time zone n.time_zone,
  null::date,
  concat_ws(' ', n.title, n.body),
  to_jsonb(n)
from public.notes n;

revoke all on public.timeline_items from anon, authenticated;
grant select on public.timeline_items to authenticated;

-- Keyset page: rows strictly after the cursor, newest first. The API asks for one
-- extra row to learn whether another page exists.
create function public.timeline_page(
  page_size integer,
  cursor_sort_at timestamp default null,
  cursor_id uuid default null
)
returns setof public.timeline_items
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from public.timeline_items
  where cursor_sort_at is null or (sort_at, id) < (cursor_sort_at, cursor_id)
  order by sort_at desc, id desc
  limit least(page_size, 101);
$$;

-- Saves a confirmed CREATE_* action and logs the outcome in one transaction.
-- Returns the saved row with its kind, or null when nothing was saved.
create function public.record_intent(
  input_text text,
  input_context jsonb,
  input_decision jsonb,
  input_outcome text,
  input_action jsonb,
  input_time_zone text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_task public.tasks;
  new_event public.events;
  new_note public.notes;
  saved jsonb;
begin
  if input_outcome = 'confirmed' then
    case input_action ->> 'kind'
      when 'CREATE_TASK' then
        insert into public.tasks (title, due_date, due_time, time_zone, priority)
        values (
          input_action ->> 'title',
          (input_action #>> '{due,date}')::date,
          (input_action #>> '{due,time}')::time,
          input_time_zone,
          input_action ->> 'priority'
        )
        returning * into new_task;
        saved := jsonb_build_object('kind', 'task') || to_jsonb(new_task);
      when 'CREATE_EVENT' then
        insert into public.events
          (title, start_date, start_time, time_zone, duration_min, location, attendees)
        values (
          input_action ->> 'title',
          (input_action #>> '{start,date}')::date,
          (input_action #>> '{start,time}')::time,
          input_time_zone,
          (input_action ->> 'durationMin')::integer,
          input_action ->> 'location',
          array(select jsonb_array_elements_text(input_action -> 'attendees'))
        )
        returning * into new_event;
        saved := jsonb_build_object('kind', 'event') || to_jsonb(new_event);
      when 'CREATE_NOTE' then
        insert into public.notes (title, body, time_zone)
        values (input_action ->> 'title', input_action ->> 'body', input_time_zone)
        returning * into new_note;
        saved := jsonb_build_object('kind', 'note') || to_jsonb(new_note);
      else
        saved := null;
    end case;
  end if;

  insert into public.intent_events
    (text, context, decision, outcome, confirmed_action, task_id, event_id, note_id)
  values (
    input_text,
    input_context,
    input_decision,
    input_outcome,
    case when input_outcome = 'confirmed' then input_action end,
    new_task.id,
    new_event.id,
    new_note.id
  );

  return saved;
end;
$$;

revoke execute on function public.timeline_page(integer, timestamp, uuid) from public, anon;
grant execute on function public.timeline_page(integer, timestamp, uuid) to authenticated;
revoke execute on function public.record_intent(text, jsonb, jsonb, text, jsonb, text)
  from public, anon;
grant execute on function public.record_intent(text, jsonb, jsonb, text, jsonb, text)
  to authenticated;
```

- [ ] **Step 4: Write the RLS smoke script**

Create `supabase/tests/rls-smoke.sql`:

```sql
-- Paste into the Supabase SQL editor. It creates two throwaway users, checks that
-- each sees only their own rows, and rolls everything back.
begin;

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'rls-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'rls-b@example.test');

set local role authenticated;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}',
  true
);

select public.record_intent(
  'call mom tomorrow at 3',
  null,
  '{"intent":"CREATE_TASK","confidence":0.9,"entities":{}}',
  'confirmed',
  '{"kind":"CREATE_TASK","title":"Call mom","due":{"date":"2026-09-25","time":"15:00"},"priority":"normal"}',
  'America/New_York'
);

do $$
begin
  assert (select count(*) from public.timeline_page(50)) = 1, 'owner should see their task';
  assert (select count(*) from public.intent_events) = 1, 'owner should see their log row';
end;
$$;

select set_config(
  'request.jwt.claims',
  '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}',
  true
);

do $$
declare
  changed integer;
begin
  assert (select count(*) from public.timeline_page(50)) = 0, 'other user must not see it';
  assert (select count(*) from public.intent_events) = 0, 'other user must not read the log';
  update public.tasks set title = 'hacked';
  get diagnostics changed = row_count;
  assert changed = 0, 'other user must not update it';
end;
$$;

select 'RLS smoke passed' as result;

rollback;
```

- [ ] **Step 5: Link and push (needs the user)**

Ask the user to run these in the prompt, since they need their Supabase login and the project ref (Dashboard → Project Settings → General):

```
! pnpm exec supabase login
! pnpm exec supabase link --project-ref <project-ref>
```

Then run: `pnpm db:push`
Expected: `Applying migration 20260924000000_persistence.sql... Finished supabase db push.`

- [ ] **Step 6: Run the smoke script**

Ask the user to paste `supabase/tests/rls-smoke.sql` into Dashboard → SQL Editor and run it.
Expected: the last result is `RLS smoke passed`, with no `assert` failure. If an assert fails, fix the migration with a new `pnpm db:new fix_…` migration, never by editing the pushed one.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml pnpm-workspace.yaml supabase/
git commit -m "Add Supabase schema for tasks, events, notes and intent log"
```

---

### Task 2: Shared contracts

**Files:**

- Modify: `packages/types/src/index.ts` (append at the end)
- Test: `tests/records-contract.test.mjs`

**Interfaces:**

- Consumes: the existing `localDateTimeSchema`, `taskPrioritySchema`, `searchScopeSchema`, `intentContextSchema`, `intentResponseSchema`, `intentActionSchema`, `isoDateSchema` (a module-private const, already defined above).
- Produces:
  - `itemKindSchema` / `ItemKind = 'task' | 'event' | 'note'`, `itemIdSchema` (uuid)
  - `savedTaskSchema`, `savedEventSchema`, `savedNoteSchema`, `savedItemSchema` / `SavedItem`, `SavedTask`, `SavedEvent`, `SavedNote`
  - `intentOutcomeSchema`, `intentEventRequestSchema` / `IntentEventRequest`, `intentEventResponseSchema` / `IntentEventResponse`
  - `timelineQuerySchema` / `TimelineQuery` (`{ limit: number; cursor?: string }`), `timelineResponseSchema` / `TimelineResponse`
  - `searchQuerySchema` / `SearchQuery`, `searchResponseSchema` / `SearchResponse`
  - `taskPatchSchema`, `eventPatchSchema`, `notePatchSchema`, `itemPatchSchemas` (keyed by `ItemKind`), `TaskPatch`, `EventPatch`, `NotePatch`, `ItemPatch`

- [ ] **Step 1: Write the failing test**

Create `tests/records-contract.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  eventPatchSchema,
  intentEventRequestSchema,
  notePatchSchema,
  savedItemSchema,
  searchQuerySchema,
  taskPatchSchema,
  timelineQuerySchema,
} from '../packages/types/src/index.ts';
import { savedTask } from './support/records.mjs';

const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: {} };
const action = { kind: 'CREATE_TASK', title: 'Call mom', due: null, priority: 'normal' };

test('a saved item accepts PostgREST timestamps and rejects unknown values', () => {
  assert.deepEqual(savedItemSchema.parse(savedTask), savedTask);
  assert.equal(savedItemSchema.safeParse({ ...savedTask, priority: 'urgent' }).success, false);
  assert.equal(savedItemSchema.safeParse({ ...savedTask, kind: 'reminder' }).success, false);
});

test('a confirmed intent event needs a titled action that matches the decision', () => {
  const base = { text: 'call mom', decision, outcome: 'confirmed' };
  assert.equal(intentEventRequestSchema.safeParse({ ...base, action }).success, true);
  assert.equal(intentEventRequestSchema.safeParse(base).success, false);
  assert.equal(
    intentEventRequestSchema.safeParse({ ...base, action: { ...action, title: '   ' } }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({
      ...base,
      action: { kind: 'CREATE_NOTE', title: 'x', body: null },
    }).success,
    false,
  );
  assert.equal(
    intentEventRequestSchema.safeParse({ text: 'call mom', decision, outcome: 'dismissed' })
      .success,
    true,
  );
});

test('timeline query coerces limit, defaults to 50 and caps at 100', () => {
  assert.deepEqual(timelineQuerySchema.parse({}), { limit: 50 });
  assert.deepEqual(timelineQuerySchema.parse({ limit: '20', cursor: 'abc' }), {
    limit: 20,
    cursor: 'abc',
  });
  assert.equal(timelineQuerySchema.safeParse({ limit: '0' }).success, false);
  assert.equal(timelineQuerySchema.safeParse({ limit: '101' }).success, false);
});

test('search query needs text and an ordered date range', () => {
  assert.deepEqual(searchQuerySchema.parse({ q: ' dentist ' }), { q: 'dentist', scope: 'all' });
  assert.equal(searchQuerySchema.safeParse({ q: '  ' }).success, false);
  assert.equal(
    searchQuerySchema.safeParse({ q: 'x', from: '2026-09-30', to: '2026-09-01' }).success,
    false,
  );
});

test('patches accept only their own kind of fields and must change something', () => {
  assert.equal(taskPatchSchema.safeParse({ completed: true }).success, true);
  assert.equal(taskPatchSchema.safeParse({}).success, false);
  assert.equal(taskPatchSchema.safeParse({ durationMin: 30 }).success, false);
  assert.equal(
    eventPatchSchema.safeParse({ start: null, attendees: ['Ana'], completed: false }).success,
    true,
  );
  assert.equal(notePatchSchema.safeParse({ title: '' }).success, false);
});
```

Create `tests/support/records.mjs`. It holds shared fixtures for Tasks 2–7; the UUIDs are valid v4:

```js
export const USER_ID = '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11';
export const TASK_ID = '0b7c1f8e-2d4a-4c6b-9e1f-3a5d7c9b1e2f';
export const EVENT_ID = '1c8d2a9f-3e5b-4d7c-8f2a-4b6e8d0c2f3a';
export const NOTE_ID = '2d9e3b0a-4f6c-4e8d-a03b-5c7f9e1d3a4b';
const STAMP = '2026-09-24T12:00:00.123456+00:00';
const common = { user_id: USER_ID, completed_at: null, created_at: STAMP, updated_at: STAMP };

// Rows as PostgREST returns them.
export const taskRow = {
  ...common,
  id: TASK_ID,
  title: 'Call mom',
  due_date: '2026-09-25',
  due_time: '15:00:00',
  time_zone: 'America/New_York',
  priority: 'normal',
};
export const eventRow = {
  ...common,
  id: EVENT_ID,
  title: 'Design review',
  start_date: '2026-09-26',
  start_time: null,
  time_zone: 'America/New_York',
  duration_min: 60,
  location: 'Room 4',
  attendees: ['Ana', 'Sam'],
};
export const noteRow = {
  ...common,
  id: NOTE_ID,
  title: 'Gift ideas',
  body: 'Book, scarf',
  time_zone: 'America/New_York',
};

// The same rows as API contracts.
const stamps = { completedAt: null, createdAt: STAMP, updatedAt: STAMP };
export const savedTask = {
  kind: 'task',
  id: TASK_ID,
  title: 'Call mom',
  due: { date: '2026-09-25', time: '15:00' },
  timeZone: 'America/New_York',
  priority: 'normal',
  ...stamps,
};
export const savedEvent = {
  kind: 'event',
  id: EVENT_ID,
  title: 'Design review',
  start: { date: '2026-09-26', time: null },
  timeZone: 'America/New_York',
  durationMin: 60,
  location: 'Room 4',
  attendees: ['Ana', 'Sam'],
  ...stamps,
};
export const savedNote = {
  kind: 'note',
  id: NOTE_ID,
  title: 'Gift ideas',
  body: 'Book, scarf',
  timeZone: 'America/New_York',
  ...stamps,
};

export function timelineRow(kind, row, sortAt) {
  return { kind, id: row.id, sort_at: sortAt, item: row };
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/records-contract.test.mjs`
Expected: FAIL with `SyntaxError: The requested module ... does not provide an export named 'eventPatchSchema'`.

- [ ] **Step 3: Add the schemas**

Append to `packages/types/src/index.ts`:

```ts
// Saved records. Timestamps are Postgres ISO strings with an offset.
export const itemKindSchema = z.enum(['task', 'event', 'note']);

export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemIdSchema = z.uuid();

const itemTitleSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.iso.datetime({ offset: true });

const savedItemBase = {
  id: itemIdSchema,
  title: z.string(),
  timeZone: z.string(),
  completedAt: timestampSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};

export const savedTaskSchema = z.object({
  kind: z.literal('task'),
  ...savedItemBase,
  due: localDateTimeSchema.nullable(),
  priority: taskPrioritySchema,
});

export const savedEventSchema = z.object({
  kind: z.literal('event'),
  ...savedItemBase,
  start: localDateTimeSchema.nullable(),
  durationMin: z.number().int().min(1).max(1440),
  location: z.string().nullable(),
  attendees: z.array(z.string()),
});

export const savedNoteSchema = z.object({
  kind: z.literal('note'),
  ...savedItemBase,
  body: z.string().nullable(),
});

export const savedItemSchema = z.discriminatedUnion('kind', [
  savedTaskSchema,
  savedEventSchema,
  savedNoteSchema,
]);

export type SavedTask = z.infer<typeof savedTaskSchema>;
export type SavedEvent = z.infer<typeof savedEventSchema>;
export type SavedNote = z.infer<typeof savedNoteSchema>;
export type SavedItem = z.infer<typeof savedItemSchema>;

export const intentOutcomeSchema = z.enum(['confirmed', 'dismissed']);

export type IntentOutcome = z.infer<typeof intentOutcomeSchema>;

// A draft the user confirmed (with their edits) or dismissed. Confirmed CREATE_* actions are saved.
export const intentEventRequestSchema = z
  .object({
    text: z.string().trim().min(3).max(500),
    context: intentContextSchema.optional(),
    decision: intentResponseSchema,
    outcome: intentOutcomeSchema,
    action: intentActionSchema.optional(),
  })
  .refine((event) => event.outcome === 'dismissed' || event.action !== undefined, {
    message: 'A confirmed draft needs its action',
    path: ['action'],
  })
  .refine((event) => !event.action || event.action.kind === event.decision.intent, {
    message: 'Action kind must match intent',
    path: ['action'],
  })
  .refine(
    (event) =>
      !event.action ||
      event.action.kind === 'SEARCH' ||
      itemTitleSchema.safeParse(event.action.title).success,
    { message: 'Add a title.', path: ['action', 'title'] },
  );

export type IntentEventRequest = z.infer<typeof intentEventRequestSchema>;

export const intentEventResponseSchema = z.object({ item: savedItemSchema.nullable() });

export type IntentEventResponse = z.infer<typeof intentEventResponseSchema>;

export const timelineQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(300).optional(),
});

export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const timelineResponseSchema = z.object({
  items: z.array(savedItemSchema),
  nextCursor: z.string().nullable(),
});

export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

export const searchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(200),
    scope: searchScopeSchema.default('all'),
    from: isoDateSchema.optional(),
    to: isoDateSchema.optional(),
  })
  .refine((query) => !query.from || !query.to || query.from <= query.to, {
    message: 'The range must start before it ends',
    path: ['to'],
  });

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const searchResponseSchema = z.object({ items: z.array(savedItemSchema) });

export type SearchResponse = z.infer<typeof searchResponseSchema>;

// Edits and completion share one PATCH; each kind accepts only its own fields.
const hasChanges = (patch: object): boolean => Object.keys(patch).length > 0;
const completedField = { completed: z.boolean().optional() };

export const taskPatchSchema = z
  .strictObject({
    title: itemTitleSchema.optional(),
    due: localDateTimeSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    ...completedField,
  })
  .refine(hasChanges, 'Nothing to update.');

export const eventPatchSchema = z
  .strictObject({
    title: itemTitleSchema.optional(),
    start: localDateTimeSchema.nullable().optional(),
    durationMin: z.number().int().min(1).max(1440).optional(),
    location: z.string().trim().max(200).nullable().optional(),
    attendees: z.array(z.string().trim().min(1).max(100)).max(50).optional(),
    ...completedField,
  })
  .refine(hasChanges, 'Nothing to update.');

export const notePatchSchema = z
  .strictObject({
    title: itemTitleSchema.optional(),
    body: z.string().max(10_000).nullable().optional(),
    ...completedField,
  })
  .refine(hasChanges, 'Nothing to update.');

export const itemPatchSchemas = {
  task: taskPatchSchema,
  event: eventPatchSchema,
  note: notePatchSchema,
} as const;

export type TaskPatch = z.infer<typeof taskPatchSchema>;
export type EventPatch = z.infer<typeof eventPatchSchema>;
export type NotePatch = z.infer<typeof notePatchSchema>;
export type ItemPatch = TaskPatch | EventPatch | NotePatch;
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/records-contract.test.mjs && pnpm --filter @nexui/types typecheck`
Expected: PASS (5 tests), and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts tests/records-contract.test.mjs tests/support/records.mjs
git commit -m "Add saved item, intent event, timeline, search and patch contracts"
```

---

### Task 3: User-scoped Supabase client, row mappers and cursor

**Files:**

- Modify: `apps/api/src/lib/supabase/clients.ts`, `apps/api/src/lib/supabase/verify-request.ts:6-9,68`, `apps/api/src/lib/supabase/README.md`, `tests/verify-request.test.mjs:22-25`, `tests/support/supabase-auth.mjs`
- Create: `apps/api/src/lib/records/mappers.ts`, `apps/api/src/lib/records/cursor.ts`
- Test: `tests/records-mappers.test.mjs`

**Interfaces:**

- Consumes: `savedItemSchema`, `ItemKind`, `ItemPatch`, `SavedItem`, `LocalDateTime` from Task 2.
- Produces:
  - `getUserClient(accessToken: string, env?: Env): SupabaseClient`
  - `AuthUser` gains `accessToken: string`
  - `type ItemRow = Record<string, unknown>`, `ITEM_TABLES: { task: 'tasks'; event: 'events'; note: 'notes' }`
  - `toSavedItem(kind: ItemKind, row: ItemRow): SavedItem`
  - `toPatchColumns(patch: ItemPatch, now: Date): Record<string, unknown>`
  - `type TimelineCursor = { sortAt: string; id: string }`, `encodeCursor(cursor: TimelineCursor): string`, `decodeCursor(value: string): TimelineCursor | null`
  - test helper `upstreamCall(upstream, index?) → { url: URL; method: string; headers: Headers; body: unknown }`

- [ ] **Step 1: Write the failing tests**

Create `tests/records-mappers.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { decodeCursor, encodeCursor } from '../apps/api/src/lib/records/cursor.ts';
import { toPatchColumns, toSavedItem } from '../apps/api/src/lib/records/mappers.ts';
import {
  eventRow,
  noteRow,
  savedEvent,
  savedNote,
  savedTask,
  taskRow,
  TASK_ID,
} from './support/records.mjs';

test('rows map to contracts, trimming Postgres seconds off times', () => {
  assert.deepEqual(toSavedItem('task', taskRow), savedTask);
  assert.deepEqual(toSavedItem('event', eventRow), savedEvent);
  assert.deepEqual(toSavedItem('note', noteRow), savedNote);
  assert.deepEqual(toSavedItem('task', { ...taskRow, due_date: null, due_time: null }).due, null);
});

test('a malformed row throws instead of reaching the client', () => {
  assert.throws(() => toSavedItem('task', { ...taskRow, priority: 'urgent' }));
});

test('patches become column updates, and completion is stamped by the server', () => {
  const now = new Date('2026-09-24T18:30:00.000Z');
  assert.deepEqual(
    toPatchColumns({ start: { date: '2026-09-27', time: null }, completed: true }, now),
    { start_date: '2026-09-27', start_time: null, completed_at: '2026-09-24T18:30:00.000Z' },
  );
  assert.deepEqual(toPatchColumns({ due: null, completed: false }, now), {
    due_date: null,
    due_time: null,
    completed_at: null,
  });
  assert.deepEqual(toPatchColumns({ title: 'New', durationMin: 30, attendees: [] }, now), {
    title: 'New',
    duration_min: 30,
    attendees: [],
  });
});

test('cursors round-trip and reject anything tampered with', () => {
  const cursor = { sortAt: '2026-09-25T15:00:00', id: TASK_ID };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
  assert.equal(decodeCursor('not-a-cursor'), null);
  assert.equal(decodeCursor(encodeCursor({ ...cursor, id: "x' or 1=1" })), null);
  assert.equal(decodeCursor(encodeCursor({ ...cursor, sortAt: 'tomorrow' })), null);
});
```

In `tests/verify-request.test.mjs`, change the first test's expected object to include the token:

```js
test('a valid token returns the user id, email and access token', async (t) => {
  mockSupabaseAuth(t);
  const token = signToken();
  assert.deepEqual(await verifyRequest(request(`Bearer ${token}`)), {
    userId: '6f1c9a52-0d0e-4b8f-9f4a-2f0d6f2c9a11',
    email: 'tester@example.com',
    accessToken: token,
  });
});
```

Append to `tests/support/supabase-auth.mjs`:

```js
/** Reads one call the upstream mock received, for asserting PostgREST requests. */
export function upstreamCall(upstream, index = 0) {
  const [input, init] = upstream.mock.calls[index].arguments;
  const request = input instanceof Request ? input : null;
  const body = init?.body;
  return {
    url: new URL(request?.url ?? String(input)),
    method: init?.method ?? request?.method ?? 'GET',
    headers: new Headers(request?.headers ?? init?.headers),
    body: typeof body === 'string' ? JSON.parse(body) : null,
  };
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/records-mappers.test.mjs tests/verify-request.test.mjs`
Expected: FAIL. The mappers test can't find `records/cursor.ts`, and verify-request reports a missing `accessToken`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/supabase/verify-request.ts`, add `accessToken: string;` to `AuthUser` and return it:

```ts
return {
  userId: claims.sub,
  email: typeof claims.email === 'string' ? claims.email : null,
  accessToken: token,
};
```

Append to `apps/api/src/lib/supabase/clients.ts`:

```ts
// Acts as the signed-in user, so row-level security scopes every query to their rows.
// Not cached: each request carries its own token.
export function getUserClient(accessToken: string, env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError('SUPABASE_PUBLISHABLE_KEY is required for user data.');
  }

  return createClient(projectUrl(env), key, {
    auth: serverAuth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
```

Create `apps/api/src/lib/records/cursor.ts`:

```ts
import { z } from 'zod';

/**
 * Timeline position: the last row's sort key. Opaque to clients.
 *
 * @example
 * encodeCursor({ sortAt: '2026-09-25T15:00:00', id: '0b7c…' }) // 'eyJzb3J0QXQiOi…'
 */
const cursorSchema = z.object({
  sortAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/),
  id: z.uuid(),
});

export type TimelineCursor = z.infer<typeof cursorSchema>;

export function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** Returns null for anything that isn't a cursor this API issued. */
export function decodeCursor(value: string): TimelineCursor | null {
  try {
    return cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
}
```

Create `apps/api/src/lib/records/mappers.ts`:

```ts
import { savedItemSchema } from '@nexui/types';
import type { ItemKind, ItemPatch, LocalDateTime, SavedItem } from '@nexui/types';

/** A table row as PostgREST returns it (snake_case columns). */
export type ItemRow = Record<string, unknown>;

export const ITEM_TABLES = {
  task: 'tasks',
  event: 'events',
  note: 'notes',
} as const satisfies Record<ItemKind, string>;

// Postgres returns `time` as HH:MM:SS; the contract uses HH:MM.
function localDateTime(date: unknown, time: unknown): LocalDateTime | null {
  if (typeof date !== 'string') {
    return null;
  }

  return { date, time: typeof time === 'string' ? time.slice(0, 5) : null };
}

/** Maps a row to the shared contract, throwing if the row doesn't fit it. */
export function toSavedItem(kind: ItemKind, row: ItemRow): SavedItem {
  const base = {
    kind,
    id: row.id,
    title: row.title,
    timeZone: row.time_zone,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

  switch (kind) {
    case 'task':
      return savedItemSchema.parse({
        ...base,
        due: localDateTime(row.due_date, row.due_time),
        priority: row.priority,
      });
    case 'event':
      return savedItemSchema.parse({
        ...base,
        start: localDateTime(row.start_date, row.start_time),
        durationMin: row.duration_min,
        location: row.location,
        attendees: row.attendees,
      });
    case 'note':
      return savedItemSchema.parse({ ...base, body: row.body });
  }
}

/**
 * Turns a validated patch into column updates. `completed` becomes a server timestamp.
 *
 * @example
 * toPatchColumns({ due: null, completed: true }, now)
 * // { due_date: null, due_time: null, completed_at: '2026-09-24T18:30:00.000Z' }
 */
export function toPatchColumns(patch: ItemPatch, now: Date): Record<string, unknown> {
  const columns: Record<string, unknown> = {};
  const set = (column: string, value: unknown): void => {
    if (value !== undefined) {
      columns[column] = value;
    }
  };

  set('title', patch.title);

  if ('due' in patch && patch.due !== undefined) {
    columns.due_date = patch.due?.date ?? null;
    columns.due_time = patch.due?.time ?? null;
  }

  if ('start' in patch && patch.start !== undefined) {
    columns.start_date = patch.start?.date ?? null;
    columns.start_time = patch.start?.time ?? null;
  }

  if ('priority' in patch) {
    set('priority', patch.priority);
  }

  if ('durationMin' in patch) {
    set('duration_min', patch.durationMin);
  }

  if ('location' in patch) {
    set('location', patch.location);
  }

  if ('attendees' in patch) {
    set('attendees', patch.attendees);
  }

  if ('body' in patch) {
    set('body', patch.body);
  }

  if (patch.completed !== undefined) {
    columns.completed_at = patch.completed ? now.toISOString() : null;
  }

  return columns;
}
```

Add this bullet to `apps/api/src/lib/supabase/README.md` under `clients.ts`:

```md
`getUserClient(accessToken)` also uses the publishable key but sends the user's
token, so Postgres row-level security limits every query to that user's rows.
Use it for all user data.
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test && pnpm --filter @nexui/api typecheck`
Expected: every test passes, including `records-mappers` (4) and the updated `verify-request`. Typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib tests/records-mappers.test.mjs tests/verify-request.test.mjs tests/support/supabase-auth.mjs
git commit -m "Add user-scoped Supabase client, record mappers and timeline cursor"
```

---

### Task 4: `POST /api/intent-events` (save and log)

**Files:**

- Create: `apps/api/src/lib/records/queries.ts`, `apps/api/src/app/api/intent-events/route.ts`
- Test: `tests/intent-events-route.test.mjs`

**Interfaces:**

- Consumes: `getUserClient`, `AuthUser.accessToken`, `toSavedItem`, `ItemRow` (Task 3); `intentEventRequestSchema`, `intentEventResponseSchema` (Task 2); SQL `record_intent` (Task 1).
- Produces: `recordIntent(client: SupabaseClient, event: IntentEventRequest): Promise<SavedItem | null>`. The route is `POST /api/intent-events`, which returns 201 `{ item }` when saved, 200 `{ item: null }` when only logged, 400 `{ error: 'Add a title.' | 'Invalid request.' | 'Invalid JSON' }`, or 500 `{ error: 'Could not save. Try again.' }`.

- [ ] **Step 1: Write the failing test**

Create `tests/intent-events-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { POST } from '../apps/api/src/app/api/intent-events/route.ts';
import { savedTask, taskRow } from './support/records.mjs';
import {
  mockSupabaseAuth,
  signToken,
  supabaseEnv,
  upstreamCall,
} from './support/supabase-auth.mjs';

const decision = { intent: 'CREATE_TASK', confidence: 0.92, entities: { title: 'call mom' } };
const action = {
  kind: 'CREATE_TASK',
  title: ' Call mom ',
  due: { date: '2026-09-25', time: '15:00' },
  priority: 'normal',
};
const context = { now: '2026-09-24T12:00:00.000Z', timeZone: 'America/New_York' };
const text = 'call mom tomorrow at 3';

function request(body, token = signToken()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://localhost/api/intent-events', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

test('logging an intent requires a valid token', async (t) => {
  const upstream = mockSupabaseAuth(t);
  assert.equal((await POST(request({}, null))).status, 401);
  assert.equal(upstream.mock.callCount(), 0);
});

test('a confirmed task is saved and logged as the signed-in user', async (t) => {
  const token = signToken();
  const upstream = mockSupabaseAuth(t, async () => Response.json({ kind: 'task', ...taskRow }));
  const response = await POST(
    request({ text, context, decision, outcome: 'confirmed', action }, token),
  );
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), { item: savedTask });
  const call = upstreamCall(upstream);
  assert.equal(call.url.href, `${supabaseEnv.SUPABASE_URL}/rest/v1/rpc/record_intent`);
  assert.equal(call.headers.get('authorization'), `Bearer ${token}`);
  assert.equal(call.headers.get('apikey'), supabaseEnv.SUPABASE_PUBLISHABLE_KEY);
  assert.equal(call.body.input_outcome, 'confirmed');
  assert.equal(call.body.input_action.title, 'Call mom');
  assert.equal(call.body.input_time_zone, 'America/New_York');
  assert.equal(call.body.input_text, text);
});

test('a dismissed draft is only logged, in UTC when the client sent no zone', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json(null));
  const response = await POST(request({ text, decision, outcome: 'dismissed' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { item: null });
  const call = upstreamCall(upstream);
  assert.equal(call.body.input_action, null);
  assert.equal(call.body.input_time_zone, 'UTC');
});

test('invalid events are rejected before reaching the database', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const missing = await POST(request({ text, decision, outcome: 'confirmed' }));
  assert.equal(missing.status, 400);
  assert.deepEqual(await missing.json(), { error: 'Invalid request.' });
  const untitled = await POST(
    request({ text, decision, outcome: 'confirmed', action: { ...action, title: '  ' } }),
  );
  assert.equal(untitled.status, 400);
  assert.deepEqual(await untitled.json(), { error: 'Add a title.' });
  assert.equal(upstream.mock.callCount(), 0);
});

test('a database failure returns a generic 500 and logs no details', async (t) => {
  mockSupabaseAuth(t, async () =>
    Response.json({ message: 'boom secret', code: 'XX000' }, { status: 500 }),
  );
  const logged = t.mock.method(console, 'error', () => {});
  const response = await POST(request({ text, context, decision, outcome: 'confirmed', action }));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'Could not save. Try again.' });
  assert.equal(JSON.stringify(logged.mock.calls).includes('boom secret'), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/intent-events-route.test.mjs`
Expected: FAIL with `Cannot find module '.../api/intent-events/route.ts'`.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/records/queries.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { IntentEventRequest, ItemKind, SavedItem } from '@nexui/types';

import { toSavedItem, type ItemRow } from './mappers.ts';

/**
 * Logs a confirmed or dismissed draft. A confirmed CREATE_* action is saved in the
 * same transaction (`record_intent`), and the saved item is returned.
 */
export async function recordIntent(
  client: SupabaseClient,
  event: IntentEventRequest,
): Promise<SavedItem | null> {
  const action =
    event.action && event.action.kind !== 'SEARCH'
      ? { ...event.action, title: event.action.title.trim() }
      : event.action;
  const { data, error } = await client.rpc('record_intent', {
    input_text: event.text,
    input_context: event.context ?? null,
    input_decision: event.decision,
    input_outcome: event.outcome,
    input_action: action ?? null,
    input_time_zone: event.context?.timeZone ?? 'UTC',
  });

  if (error) {
    throw error;
  }

  if (!data) {
    return null;
  }

  const row = data as ItemRow & { kind: ItemKind };

  return toSavedItem(row.kind, row);
}
```

Create `apps/api/src/app/api/intent-events/route.ts`:

```ts
import { intentEventRequestSchema, intentEventResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { recordIntent } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['POST'], ['Authorization', 'Content-Type']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Logs a confirmed or dismissed draft; a confirmed task, event or note is saved with it.
export async function POST(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = intentEventRequestSchema.safeParse(body);

  if (!parsed.success) {
    const untitled = parsed.error.issues.some((issue) => issue.path.join('.') === 'action.title');

    return jsonError(untitled ? 'Add a title.' : 'Invalid request.', 400, headers);
  }

  try {
    const item = await recordIntent(getUserClient(user.accessToken), parsed.data);

    return Response.json(intentEventResponseSchema.parse({ item }), {
      status: item ? 201 : 200,
      headers,
    });
  } catch (error) {
    console.error(
      '[intent-events]',
      error instanceof SupabaseConfigurationError ? error.message : 'Saving the intent failed.',
    );

    return jsonError('Could not save. Try again.', 500, headers);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/intent-events-route.test.mjs && pnpm --filter @nexui/api typecheck`
Expected: PASS (5 tests), and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/records/queries.ts apps/api/src/app/api/intent-events tests/intent-events-route.test.mjs
git commit -m "Save confirmed drafts and log intent outcomes"
```

---

### Task 5: `GET /api/timeline` (keyset pagination)

**Files:**

- Modify: `apps/api/src/lib/records/queries.ts`
- Create: `apps/api/src/app/api/timeline/route.ts`
- Test: `tests/timeline-route.test.mjs`

**Interfaces:**

- Consumes: `encodeCursor`, `decodeCursor`, `toSavedItem`, `ItemRow` (Task 3); `timelineQuerySchema`, `timelineResponseSchema`, `TimelineQuery`, `TimelineResponse` (Task 2); SQL `timeline_page` (Task 1).
- Produces:
  - `class InvalidCursorError extends Error`
  - `interface TimelineRow { kind: ItemKind; id: string; sort_at: string; item: ItemRow }`, which Task 6 reuses
  - `getTimelinePage(client: SupabaseClient, query: TimelineQuery): Promise<TimelineResponse>`
  - the route `GET /api/timeline?limit&cursor`

- [ ] **Step 1: Write the failing test**

Create `tests/timeline-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/timeline/route.ts';
import {
  eventRow,
  noteRow,
  savedEvent,
  savedNote,
  savedTask,
  taskRow,
  TASK_ID,
  timelineRow,
} from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

const rows = [
  timelineRow('event', eventRow, '2026-09-26T00:00:00'),
  timelineRow('task', taskRow, '2026-09-25T15:00:00'),
  timelineRow('note', noteRow, '2026-09-24T08:00:00'),
];

function request(query = '', token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`http://localhost/api/timeline${query}`, { headers });
}

const decode = (cursor) => JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));

test('the timeline requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(request('', null))).status, 401);
});

test('a full page returns a cursor at its last row', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json(rows));
  const response = await GET(request('?limit=2'));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.items, [savedEvent, savedTask]);
  assert.deepEqual(decode(body.nextCursor), { sortAt: '2026-09-25T15:00:00', id: TASK_ID });
  const call = upstreamCall(upstream);
  assert.equal(call.url.pathname, '/rest/v1/rpc/timeline_page');
  assert.deepEqual(call.body, { page_size: 3, cursor_sort_at: null, cursor_id: null });
});

test('the next page starts after the cursor and ends with a null cursor', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([rows[2]]));
  const cursor = Buffer.from(
    JSON.stringify({ sortAt: '2026-09-25T15:00:00', id: TASK_ID }),
  ).toString('base64url');
  const response = await GET(request(`?limit=2&cursor=${cursor}`));
  assert.deepEqual(await response.json(), { items: [savedNote], nextCursor: null });
  assert.deepEqual(upstreamCall(upstream).body, {
    page_size: 3,
    cursor_sort_at: '2026-09-25T15:00:00',
    cursor_id: TASK_ID,
  });
});

test('a tampered cursor or bad limit is rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const tampered = await GET(request('?cursor=abc'));
  assert.equal(tampered.status, 400);
  assert.deepEqual(await tampered.json(), { error: 'Invalid cursor' });
  assert.equal((await GET(request('?limit=500'))).status, 400);
  assert.equal(upstream.mock.callCount(), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/timeline-route.test.mjs`
Expected: FAIL with `Cannot find module '.../api/timeline/route.ts'`.

- [ ] **Step 3: Implement**

Add these to `apps/api/src/lib/records/queries.ts`. Update the imports to:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  IntentEventRequest,
  ItemKind,
  SavedItem,
  TimelineQuery,
  TimelineResponse,
} from '@nexui/types';

import { decodeCursor, encodeCursor } from './cursor.ts';
import { toSavedItem, type ItemRow } from './mappers.ts';

export class InvalidCursorError extends Error {}

/** A `timeline_items` row: the kind, sort key and full item row. */
export interface TimelineRow {
  kind: ItemKind;
  id: string;
  sort_at: string;
  item: ItemRow;
}
```

and append:

```ts
/**
 * One page of the timeline, newest first. The query fetches one extra row to learn
 * whether a next page exists; its cursor is the last row returned.
 */
export async function getTimelinePage(
  client: SupabaseClient,
  query: TimelineQuery,
): Promise<TimelineResponse> {
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;

  if (query.cursor && !cursor) {
    throw new InvalidCursorError('Invalid cursor');
  }

  const { data, error } = await client.rpc('timeline_page', {
    page_size: query.limit + 1,
    cursor_sort_at: cursor?.sortAt ?? null,
    cursor_id: cursor?.id ?? null,
  });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TimelineRow[];
  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const hasMore = rows.length > query.limit && last !== undefined;

  return {
    items: page.map((row) => toSavedItem(row.kind, row.item)),
    nextCursor: hasMore ? encodeCursor({ sortAt: last.sort_at, id: last.id }) : null,
  };
}
```

Create `apps/api/src/app/api/timeline/route.ts`:

```ts
import { timelineQuerySchema, timelineResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { getTimelinePage, InvalidCursorError } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Pages through the user's tasks, events and notes, newest first.
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const parsed = timelineQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );

  if (!parsed.success) {
    return jsonError('Invalid timeline request.', 400, headers);
  }

  try {
    const page = await getTimelinePage(getUserClient(user.accessToken), parsed.data);

    return Response.json(timelineResponseSchema.parse(page), { headers });
  } catch (error) {
    if (error instanceof InvalidCursorError) {
      return jsonError('Invalid cursor', 400, headers);
    }

    console.error(
      '[timeline]',
      error instanceof SupabaseConfigurationError ? error.message : 'Loading the timeline failed.',
    );

    return jsonError('Could not load your items. Try again.', 500, headers);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/timeline-route.test.mjs && pnpm --filter @nexui/api typecheck`
Expected: PASS (4 tests), and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/records/queries.ts apps/api/src/app/api/timeline tests/timeline-route.test.mjs
git commit -m "Add paginated timeline route"
```

---

### Task 6: `GET /api/search`

**Files:**

- Modify: `apps/api/src/lib/records/queries.ts`
- Create: `apps/api/src/app/api/search/route.ts`
- Test: `tests/search-route.test.mjs`

**Interfaces:**

- Consumes: `TimelineRow`, `toSavedItem` (Tasks 3 and 5); `searchQuerySchema`, `searchResponseSchema`, `SearchQuery`, `SearchScope` (Task 2); the `timeline_items` view (Task 1).
- Produces: `searchItems(client: SupabaseClient, query: SearchQuery): Promise<SavedItem[]>`. The route `GET /api/search?q&scope&from&to` returns `{ items }`, 400 `{ error: 'Enter something to search for.' | 'Invalid search.' }`, or 500.

- [ ] **Step 1: Write the failing test**

Create `tests/search-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { GET } from '../apps/api/src/app/api/search/route.ts';
import { savedTask, taskRow, timelineRow } from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

function request(params, token = signToken()) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return new Request(`http://localhost/api/search?${new URLSearchParams(params)}`, { headers });
}

test('search requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await GET(request({ q: 'mom' }, null))).status, 401);
});

test('search matches typed text literally within scope and dates', async (t) => {
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json([timelineRow('task', taskRow, '2026-09-25T15:00:00')]),
  );
  const response = await GET(
    request({ q: '50%_off, (sale)', scope: 'tasks', from: '2026-09-01', to: '2026-09-30' }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { items: [savedTask] });
  const { url } = upstreamCall(upstream);
  assert.equal(url.pathname, '/rest/v1/timeline_items');
  assert.equal(url.searchParams.get('search_text'), 'ilike.%50\\%\\_off, (sale)%');
  assert.equal(url.searchParams.get('kind'), 'in.(task)');
  assert.deepEqual(url.searchParams.getAll('item_date'), ['gte.2026-09-01', 'lte.2026-09-30']);
  assert.equal(url.searchParams.get('order'), 'sort_at.desc,id.desc');
  assert.equal(url.searchParams.get('limit'), '50');
});

test('an empty query or reversed range is rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const empty = await GET(request({ q: '  ' }));
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { error: 'Enter something to search for.' });
  const reversed = await GET(request({ q: 'x', from: '2026-09-30', to: '2026-09-01' }));
  assert.deepEqual(await reversed.json(), { error: 'Invalid search.' });
  assert.equal(upstream.mock.callCount(), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/search-route.test.mjs`
Expected: FAIL with `Cannot find module '.../api/search/route.ts'`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/records/queries.ts`, add `SearchQuery` and `SearchScope` to the `@nexui/types` type import, then append:

```ts
const SCOPE_KINDS = {
  all: ['task', 'event', 'note'],
  tasks: ['task'],
  events: ['event'],
  notes: ['note'],
} as const satisfies Record<SearchScope, readonly ItemKind[]>;

const SEARCH_LIMIT = 50;

// Escapes LIKE wildcards so "50%" matches the literal text.
function containsPattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

/**
 * Case-insensitive substring search over titles (plus note bodies and event
 * location/people), newest first. A date range keeps only dated tasks and events.
 */
export async function searchItems(
  client: SupabaseClient,
  query: SearchQuery,
): Promise<SavedItem[]> {
  let request = client
    .from('timeline_items')
    .select('kind, id, sort_at, item')
    .ilike('search_text', containsPattern(query.q))
    .in('kind', [...SCOPE_KINDS[query.scope]]);

  if (query.from) {
    request = request.gte('item_date', query.from);
  }

  if (query.to) {
    request = request.lte('item_date', query.to);
  }

  const { data, error } = await request
    .order('sort_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(SEARCH_LIMIT);

  if (error) {
    throw error;
  }

  return ((data ?? []) as TimelineRow[]).map((row) => toSavedItem(row.kind, row.item));
}
```

Create `apps/api/src/app/api/search/route.ts`:

```ts
import { searchQuerySchema, searchResponseSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../lib/http/responses.ts';
import { searchItems } from '../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['GET'], ['Authorization']);

export function OPTIONS(): Response {
  return preflight(headers);
}

// Runs a confirmed SEARCH draft against the user's saved items.
export async function GET(request: Request): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));

  if (!parsed.success) {
    const missingText = parsed.error.issues.some((issue) => issue.path[0] === 'q');

    return jsonError(
      missingText ? 'Enter something to search for.' : 'Invalid search.',
      400,
      headers,
    );
  }

  try {
    const items = await searchItems(getUserClient(user.accessToken), parsed.data);

    return Response.json(searchResponseSchema.parse({ items }), { headers });
  } catch (error) {
    console.error(
      '[search]',
      error instanceof SupabaseConfigurationError ? error.message : 'Search failed.',
    );

    return jsonError('Search is unavailable right now. Try again.', 500, headers);
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `node --experimental-strip-types --test tests/search-route.test.mjs && pnpm --filter @nexui/api typecheck`
Expected: PASS (3 tests), and typecheck exits 0. If the `search_text` assertion fails only because of encoding, print `url.searchParams.get('search_text')`. The decoded value must be exactly `ilike.%50\%\_off, (sale)%`; fix the escaping, not the test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/records/queries.ts apps/api/src/app/api/search tests/search-route.test.mjs
git commit -m "Add search over saved items"
```

---

### Task 7: `PATCH /api/items/[kind]/[id]` (edit and complete)

**Files:**

- Modify: `apps/api/src/lib/records/queries.ts`
- Create: `apps/api/src/app/api/items/[kind]/[id]/route.ts`
- Test: `tests/items-route.test.mjs`

**Interfaces:**

- Consumes: `ITEM_TABLES`, `toPatchColumns`, `toSavedItem` (Task 3); `itemKindSchema`, `itemIdSchema`, `itemPatchSchemas`, `savedItemSchema`, `ItemPatch` (Task 2).
- Produces:
  - `class RecordNotFoundError extends Error`
  - `updateItem(client: SupabaseClient, kind: ItemKind, id: string, patch: ItemPatch, now?: Date): Promise<SavedItem>`
  - the route `PATCH /api/items/:kind/:id`, which returns 200 `SavedItem`, 404 `{ error: 'Item not found.' }`, 400 `{ error: 'Nothing to update.' | 'Invalid changes.' | 'Invalid JSON' }`, or 500

- [ ] **Step 1: Write the failing test**

Create `tests/items-route.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { PATCH } from '../apps/api/src/app/api/items/[kind]/[id]/route.ts';
import { EVENT_ID, eventRow, savedEvent, savedTask, TASK_ID, taskRow } from './support/records.mjs';
import { mockSupabaseAuth, signToken, upstreamCall } from './support/supabase-auth.mjs';

function patch(kind, id, body, token = signToken()) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const request = new Request(`http://localhost/api/items/${kind}/${id}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
  return PATCH(request, { params: Promise.resolve({ kind, id }) });
}

test('editing requires a valid token', async (t) => {
  mockSupabaseAuth(t);
  assert.equal((await patch('task', TASK_ID, { completed: true }, null)).status, 401);
});

test('completing a task stamps completed_at on that row only', async (t) => {
  const completedAt = '2026-09-24T18:30:00.000000+00:00';
  const upstream = mockSupabaseAuth(t, async () =>
    Response.json([{ ...taskRow, completed_at: completedAt }]),
  );
  const response = await patch('task', TASK_ID, { completed: true });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ...savedTask, completedAt });
  const call = upstreamCall(upstream);
  assert.equal(call.method, 'PATCH');
  assert.equal(call.url.pathname, '/rest/v1/tasks');
  assert.equal(call.url.searchParams.get('id'), `eq.${TASK_ID}`);
  assert.equal(typeof call.body.completed_at, 'string');
  assert.deepEqual(Object.keys(call.body), ['completed_at']);
});

test('an event can be rescheduled, re-staffed and completed in one request', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([eventRow]));
  const response = await patch('event', EVENT_ID, {
    start: { date: '2026-09-27', time: '10:00' },
    attendees: ['Ana'],
    completed: false,
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), savedEvent);
  assert.deepEqual(upstreamCall(upstream).body, {
    start_date: '2026-09-27',
    start_time: '10:00',
    attendees: ['Ana'],
    completed_at: null,
  });
});

test('unknown kinds, bad ids and rows RLS hides are all 404', async (t) => {
  const upstream = mockSupabaseAuth(t, async () => Response.json([]));
  for (const [kind, id] of [
    ['reminder', TASK_ID],
    ['task', 'not-a-uuid'],
  ]) {
    const response = await patch(kind, id, { completed: true });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Item not found.' });
  }
  assert.equal(upstream.mock.callCount(), 0);
  assert.equal((await patch('task', TASK_ID, { completed: true })).status, 404);
  assert.equal(upstream.mock.callCount(), 1);
});

test('empty or cross-kind patches are rejected without a query', async (t) => {
  const upstream = mockSupabaseAuth(t);
  const empty = await patch('task', TASK_ID, {});
  assert.deepEqual(await empty.json(), { error: 'Nothing to update.' });
  const crossKind = await patch('task', TASK_ID, { durationMin: 30 });
  assert.equal(crossKind.status, 400);
  assert.deepEqual(await crossKind.json(), { error: 'Invalid changes.' });
  assert.equal(upstream.mock.callCount(), 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/items-route.test.mjs`
Expected: FAIL with `Cannot find module '.../api/items/[kind]/[id]/route.ts'`.

- [ ] **Step 3: Implement**

In `apps/api/src/lib/records/queries.ts`, add `ItemPatch` to the `@nexui/types` type import and change the mappers import to `import { ITEM_TABLES, toPatchColumns, toSavedItem, type ItemRow } from './mappers.ts';`. Then append:

```ts
export class RecordNotFoundError extends Error {}

/**
 * Applies an edit and/or completion. A missing id and another user's row look the
 * same: RLS makes the update touch zero rows, which is reported as not found.
 */
export async function updateItem(
  client: SupabaseClient,
  kind: ItemKind,
  id: string,
  patch: ItemPatch,
  now: Date = new Date(),
): Promise<SavedItem> {
  const { data, error } = await client
    .from(ITEM_TABLES[kind])
    .update(toPatchColumns(patch, now))
    .eq('id', id)
    .select();

  if (error) {
    throw error;
  }

  const row = (data as ItemRow[] | null)?.[0];

  if (!row) {
    throw new RecordNotFoundError('Item not found');
  }

  return toSavedItem(kind, row);
}
```

Create `apps/api/src/app/api/items/[kind]/[id]/route.ts`:

```ts
import { itemIdSchema, itemKindSchema, itemPatchSchemas, savedItemSchema } from '@nexui/types';

import { corsHeaders, jsonError, preflight } from '../../../../../lib/http/responses.ts';
import { RecordNotFoundError, updateItem } from '../../../../../lib/records/queries.ts';
import { getUserClient, SupabaseConfigurationError } from '../../../../../lib/supabase/clients.ts';
import { verifyRequest } from '../../../../../lib/supabase/verify-request.ts';

const headers = corsHeaders(['PATCH'], ['Authorization', 'Content-Type']);

interface ItemRouteContext {
  params: Promise<{ kind: string; id: string }>;
}

export function OPTIONS(): Response {
  return preflight(headers);
}

// Edits a saved task, event or note, and/or marks it complete.
export async function PATCH(request: Request, { params }: ItemRouteContext): Promise<Response> {
  const user = await verifyRequest(request, headers);

  if (user instanceof Response) {
    return user;
  }

  const { kind: kindParam, id } = await params;
  const kind = itemKindSchema.safeParse(kindParam);

  if (!kind.success || !itemIdSchema.safeParse(id).success) {
    return jsonError('Item not found.', 404, headers);
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return jsonError('Invalid JSON', 400, headers);
  }

  const parsed = itemPatchSchemas[kind.data].safeParse(body);

  if (!parsed.success) {
    const empty = parsed.error.issues.some((issue) => issue.message === 'Nothing to update.');

    return jsonError(empty ? 'Nothing to update.' : 'Invalid changes.', 400, headers);
  }

  try {
    const item = await updateItem(getUserClient(user.accessToken), kind.data, id, parsed.data);

    return Response.json(savedItemSchema.parse(item), { headers });
  } catch (error) {
    if (error instanceof RecordNotFoundError) {
      return jsonError('Item not found.', 404, headers);
    }

    console.error(
      '[items]',
      error instanceof SupabaseConfigurationError ? error.message : 'Updating an item failed.',
    );

    return jsonError('Could not save your changes. Try again.', 500, headers);
  }
}
```

- [ ] **Step 4: Run the full API checks**

Run: `pnpm test && pnpm --filter @nexui/api typecheck && pnpm --filter @nexui/api lint && pnpm --filter @nexui/api build`
Expected: all tests pass, and typecheck, lint and build exit 0. The Next build validates the `[kind]/[id]` route context type.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/records/queries.ts "apps/api/src/app/api/items" tests/items-route.test.mjs
git commit -m "Add item edit and completion route"
```

---

### Task 8: Mobile form parsing and field model

**Files:**

- Create: `apps/mobile/src/lib/form-values.ts`, `apps/mobile/src/lib/item-fields.ts`
- Modify: `apps/mobile/src/lib/intent-display.ts` (add `displayItemMeta`), and possibly `apps/mobile/tsconfig.json` (see Step 3)
- Test: `tests/form-values.test.mjs`, `tests/item-fields.test.mjs`

**Interfaces:**

- Consumes: `IntentDecision`, `IntentAction`, `Intent`, `SavedItem`, `ItemPatch`, `LocalDateTime`, `DateRange`, `intentActionSchema`, `taskPrioritySchema`, `searchScopeSchema` (Task 2 and existing); the display helpers in `intent-display.ts`.
- Produces:
  - `type FieldResult<T> = { ok: true; value: T } | { ok: false }`
  - `parseDateInput(text: string, today: string): FieldResult<string | null>`, `parseTimeInput(text: string): FieldResult<string | null>`, `parseDurationInput(text: string): FieldResult<number>`, `parseListInput(text: string): string[]`, `parseRangeInput(text: string, today: string): FieldResult<DateRange | null>`, `localToday(now?: Date): string`
  - `type FormFields` (the same keys as today's modal), `type FormResult<T> = { ok: true; value: T } | { ok: false; error: string }`
  - `fieldsFromDecision(decision: IntentDecision): FormFields` (moved from the modal's `initialFields`), `fieldsFromItem(item: SavedItem): FormFields`
  - `fieldsToAction(intent: Intent, fields: FormFields, today: string): FormResult<IntentAction>`, `fieldsToPatch(item: SavedItem, fields: FormFields, today: string): FormResult<ItemPatch>`
  - `displayItemMeta(item: SavedItem): string`

- [ ] **Step 1: Write the failing tests**

Create `tests/form-values.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  localToday,
  parseDateInput,
  parseDurationInput,
  parseListInput,
  parseRangeInput,
  parseTimeInput,
} from '../apps/mobile/src/lib/form-values.ts';

const ok = (value) => ({ ok: true, value });
const today = '2026-09-24';

test('dates read what the sheet shows and what people type', () => {
  assert.deepEqual(parseDateInput('Thu, Sep 24', today), ok('2026-09-24'));
  assert.deepEqual(parseDateInput('sep 25', today), ok('2026-09-25'));
  assert.deepEqual(parseDateInput('September 5', today), ok('2026-09-05'));
  assert.deepEqual(parseDateInput('Tomorrow', today), ok('2026-09-25'));
  assert.deepEqual(parseDateInput('2026-10-01', today), ok('2026-10-01'));
  assert.deepEqual(parseDateInput('  ', today), ok(null));
});

test('a month and day without a year picks the nearest year', () => {
  assert.deepEqual(parseDateInput('Jan 3', '2026-12-20'), ok('2027-01-03'));
  assert.deepEqual(parseDateInput('Dec 30', '2027-01-02'), ok('2026-12-30'));
});

test('unreadable or impossible dates fail', () => {
  for (const text of ['next friday', 'Feb 30', '2026-13-01', 'Sept']) {
    assert.deepEqual(parseDateInput(text, today), { ok: false }, text);
  }
});

test('times accept 12- and 24-hour forms but not a bare hour', () => {
  assert.deepEqual(parseTimeInput('3:30 PM'), ok('15:30'));
  assert.deepEqual(parseTimeInput('3pm'), ok('15:00'));
  assert.deepEqual(parseTimeInput('12 am'), ok('00:00'));
  assert.deepEqual(parseTimeInput('09:05'), ok('09:05'));
  assert.deepEqual(parseTimeInput('noon'), ok('12:00'));
  assert.deepEqual(parseTimeInput(''), ok(null));
  for (const text of ['3', '25:00', '13pm', '9:75']) {
    assert.deepEqual(parseTimeInput(text), { ok: false }, text);
  }
});

test('durations read hours and minutes within a day', () => {
  assert.deepEqual(parseDurationInput('1 hr 30 min'), ok(90));
  assert.deepEqual(parseDurationInput('45 min'), ok(45));
  assert.deepEqual(parseDurationInput('2 hours'), ok(120));
  assert.deepEqual(parseDurationInput('90'), ok(90));
  for (const text of ['', '0 min', '25 hr', 'a while']) {
    assert.deepEqual(parseDurationInput(text), { ok: false }, text);
  }
});

test('lists split on commas and ranges read one or two dates', () => {
  assert.deepEqual(parseListInput(' Ana, Sam ,, '), ['Ana', 'Sam']);
  assert.deepEqual(
    parseRangeInput('Sep 24 – Sep 30', today),
    ok({ from: '2026-09-24', to: '2026-09-30' }),
  );
  assert.deepEqual(
    parseRangeInput('Thu, Sep 24', today),
    ok({ from: '2026-09-24', to: '2026-09-24' }),
  );
  assert.deepEqual(parseRangeInput('', today), ok(null));
  assert.deepEqual(parseRangeInput('Sep 30 to Sep 1', today), { ok: false });
});

test('today is the device’s local calendar date', () => {
  assert.equal(localToday(new Date(2026, 8, 24, 23, 59)), '2026-09-24');
});
```

Create `tests/item-fields.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { displayItemMeta } from '../apps/mobile/src/lib/intent-display.ts';
import {
  fieldsFromDecision,
  fieldsFromItem,
  fieldsToAction,
  fieldsToPatch,
} from '../apps/mobile/src/lib/item-fields.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

const today = '2026-09-24';

test('a drafted event round-trips through the form unchanged', () => {
  const action = {
    kind: 'CREATE_EVENT',
    title: 'Dinner with Ana',
    start: { date: '2026-09-25', time: '19:00' },
    durationMin: 90,
    attendees: ['Ana'],
    location: 'Blue Bottle',
  };
  const decision = { intent: 'CREATE_EVENT', confidence: 0.9, entities: {}, action };
  const fields = fieldsFromDecision(decision);
  assert.equal(fields.date, 'Fri, Sep 25');
  assert.deepEqual(fieldsToAction('CREATE_EVENT', fields, today), { ok: true, value: action });
});

test('edited fields become a typed action, with blanks as null', () => {
  const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: { title: 'pay rent' } };
  const fields = { ...fieldsFromDecision(decision), date: 'Oct 1', time: '', priority: 'high' };
  assert.deepEqual(fieldsToAction('CREATE_TASK', fields, today), {
    ok: true,
    value: {
      kind: 'CREATE_TASK',
      title: 'pay rent',
      due: { date: '2026-10-01', time: null },
      priority: 'high',
    },
  });
});

test('unreadable fields explain themselves instead of sending anything', () => {
  const decision = { intent: 'CREATE_TASK', confidence: 0.9, entities: { title: 'x' } };
  const base = fieldsFromDecision(decision);
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, date: 'next friday' }, today), {
    ok: false,
    error: 'Enter a date like Sep 24.',
  });
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, date: '', time: '3pm' }, today), {
    ok: false,
    error: 'Add a date for this time.',
  });
  assert.deepEqual(fieldsToAction('CREATE_TASK', { ...base, title: '  ' }, today), {
    ok: false,
    error: 'Add a title.',
  });
  assert.equal(fieldsToAction('UNKNOWN', base, today).ok, false);
});

test('a search reads its query, scope and range', () => {
  const decision = { intent: 'SEARCH', confidence: 0.9, entities: { query: 'dentist' } };
  const fields = { ...fieldsFromDecision(decision), scope: 'events', range: 'Sep 1 – Sep 30' };
  assert.deepEqual(fieldsToAction('SEARCH', fields, today), {
    ok: true,
    value: {
      kind: 'SEARCH',
      query: 'dentist',
      scope: 'events',
      range: { from: '2026-09-01', to: '2026-09-30' },
    },
  });
});

test('saved items prefill the form and read back as a full patch', () => {
  assert.deepEqual(fieldsToPatch(savedTask, fieldsFromItem(savedTask), today), {
    ok: true,
    value: { title: 'Call mom', due: { date: '2026-09-25', time: '15:00' }, priority: 'normal' },
  });
  const eventFields = { ...fieldsFromItem(savedEvent), location: '  ', attendees: 'Ana' };
  assert.deepEqual(fieldsToPatch(savedEvent, eventFields, today), {
    ok: true,
    value: {
      title: 'Design review',
      start: { date: '2026-09-26', time: null },
      durationMin: 60,
      location: null,
      attendees: ['Ana'],
    },
  });
  assert.deepEqual(fieldsToPatch(savedNote, fieldsFromItem(savedNote), today), {
    ok: true,
    value: { title: 'Gift ideas', body: 'Book, scarf' },
  });
});

test('timeline rows describe kind and timing', () => {
  assert.equal(displayItemMeta(savedTask), 'Task · Fri, Sep 25 · 3:00 PM');
  assert.equal(displayItemMeta({ ...savedEvent, start: null }), 'Event · Unscheduled');
  assert.equal(displayItemMeta(savedEvent), 'Event · Sat, Sep 26 · 1 hr');
  assert.equal(displayItemMeta(savedNote), 'Note');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --experimental-strip-types --test tests/form-values.test.mjs tests/item-fields.test.mjs`
Expected: FAIL with `Cannot find module '.../lib/form-values.ts'`.

- [ ] **Step 3: Implement `form-values.ts`**

These modules import each other at runtime, so their relative imports use the `.ts` extension. That's what lets the Node test runner load them, as the API already does. If `pnpm --filter @nexui/mobile typecheck` reports TS5097 ("An import path can only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled"), add `"allowImportingTsExtensions": true` to `compilerOptions` in `apps/mobile/tsconfig.json`. Metro resolves explicit `.ts` paths.

Create `apps/mobile/src/lib/form-values.ts`:

```ts
import type { DateRange } from '@nexui/types';

/** The result of reading one free-text form field. */
export type FieldResult<T> = { ok: true; value: T } | { ok: false };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 86_400_000;

function isoDate(year: number, month: number, day: number): string | null {
  const value = new Date(Date.UTC(year, month - 1, day));

  if (value.getUTCMonth() !== month - 1 || value.getUTCDate() !== day) {
    return null;
  }

  return value.toISOString().slice(0, 10);
}

const dayNumber = (date: string): number => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/** The device's calendar date as YYYY-MM-DD. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');

  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Reads a date the sheet showed or the user typed. Blank means "no date". A month
 * and day without a year resolves to the year nearest `today`.
 *
 * @example
 * parseDateInput('Thu, Sep 24', '2026-09-20') // { ok: true, value: '2026-09-24' }
 */
export function parseDateInput(text: string, today: string): FieldResult<string | null> {
  const input = text.trim().toLowerCase();

  if (!input) {
    return { ok: true, value: null };
  }

  if (input === 'today') {
    return { ok: true, value: today };
  }

  if (input === 'tomorrow') {
    return {
      ok: true,
      value: new Date((dayNumber(today) + 1) * DAY_MS).toISOString().slice(0, 10),
    };
  }

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);

  if (iso) {
    const value = isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

    return value ? { ok: true, value } : { ok: false };
  }

  const monthDay = /^(?:[a-z]{3,9},?\s+)?([a-z]{3})[a-z]*\.?\s+(\d{1,2})$/.exec(input);
  const month = monthDay ? MONTHS.indexOf(monthDay[1]!) + 1 : 0;

  if (!monthDay || month === 0) {
    return { ok: false };
  }

  const year = Number(today.slice(0, 4));
  const candidates = [year - 1, year, year + 1]
    .map((candidate) => isoDate(candidate, month, Number(monthDay[2])))
    .filter((candidate): candidate is string => candidate !== null);

  if (!candidates.length) {
    return { ok: false };
  }

  const distance = (date: string): number => Math.abs(dayNumber(date) - dayNumber(today));
  const nearest = candidates.reduce((best, date) =>
    distance(date) < distance(best) ? date : best,
  );

  return { ok: true, value: nearest };
}

/**
 * Reads a time as HH:MM. A bare hour ("3") is ambiguous and rejected.
 *
 * @example
 * parseTimeInput('3:30 PM') // { ok: true, value: '15:30' }
 */
export function parseTimeInput(text: string): FieldResult<string | null> {
  const input = text.trim().toLowerCase().replace(/\s+/g, '');

  if (!input) {
    return { ok: true, value: null };
  }

  if (input === 'noon') {
    return { ok: true, value: '12:00' };
  }

  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(input);

  if (!match) {
    return { ok: false };
  }

  let hour = Number(match[1]);
  const minute = Number(match[2] ?? '0');
  const meridiem = match[3];

  if (minute > 59) {
    return { ok: false };
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return { ok: false };
    }

    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  } else if (hour > 23 || match[2] === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    value: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
  };
}

/**
 * Reads a duration in minutes (1–1440). A bare number means minutes.
 *
 * @example
 * parseDurationInput('1 hr 30 min') // { ok: true, value: 90 }
 */
export function parseDurationInput(text: string): FieldResult<number> {
  const input = text.trim().toLowerCase();
  const match =
    /^(?:(\d+)\s*(?:h|hr|hrs|hour|hours))?\s*(?:(\d+)\s*(?:m|min|mins|minute|minutes)?)?$/.exec(
      input,
    );

  if (!input || !match) {
    return { ok: false };
  }

  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);

  return minutes >= 1 && minutes <= 1440 ? { ok: true, value: minutes } : { ok: false };
}

/** Splits a comma-separated list, dropping blanks. */
export function parseListInput(text: string): string[] {
  return text
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Reads "Sep 24 – Sep 30", "Sep 24 to Sep 30" or a single date as a range.
 *
 * @example
 * parseRangeInput('Sep 24', '2026-09-20') // { ok: true, value: { from: '2026-09-24', to: '2026-09-24' } }
 */
export function parseRangeInput(text: string, today: string): FieldResult<DateRange | null> {
  if (!text.trim()) {
    return { ok: true, value: null };
  }

  const parts = text.split(/\s+(?:–|—|-|to)\s+/i);

  if (parts.length > 2) {
    return { ok: false };
  }

  const from = parseDateInput(parts[0]!, today);
  const to = parseDateInput(parts[1] ?? parts[0]!, today);

  if (!from.ok || !to.ok || !from.value || !to.value || from.value > to.value) {
    return { ok: false };
  }

  return { ok: true, value: { from: from.value, to: to.value } };
}
```

- [ ] **Step 4: Implement `item-fields.ts` and `displayItemMeta`**

Create `apps/mobile/src/lib/item-fields.ts`. `fieldsFromDecision` is the modal's current `initialFields`, moved here unchanged apart from its name and the shared empty fields:

```ts
import { intentActionSchema, searchScopeSchema, taskPrioritySchema } from '@nexui/types';
import type {
  Intent,
  IntentAction,
  IntentDecision,
  ItemPatch,
  LocalDateTime,
  SavedItem,
} from '@nexui/types';

import {
  parseDateInput,
  parseDurationInput,
  parseListInput,
  parseRangeInput,
  parseTimeInput,
} from './form-values.ts';
import {
  displayDate,
  displayDuration,
  displayLocalDate,
  displayRange,
  displayTime,
} from './intent-display.ts';

/** Every sheet field as the text the user sees and edits. */
export type FormFields = Record<
  | 'title'
  | 'date'
  | 'time'
  | 'duration'
  | 'location'
  | 'attendees'
  | 'body'
  | 'query'
  | 'range'
  | 'priority'
  | 'scope',
  string
>;

export type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

const EMPTY_FIELDS: FormFields = {
  title: '',
  date: '',
  time: '',
  duration: '',
  location: '',
  attendees: '',
  body: '',
  query: '',
  range: '',
  priority: 'normal',
  scope: 'all',
};

function whenFields(when: LocalDateTime | null): Pick<FormFields, 'date' | 'time'> {
  return {
    date: when ? displayLocalDate(when.date) : '',
    time: displayTime(when?.time ?? undefined) ?? '',
  };
}

/** Prefills the sheet from the typed draft; legacy entities cover older API responses. */
export function fieldsFromDecision({ action, entities }: IntentDecision): FormFields {
  const fields: FormFields = {
    ...EMPTY_FIELDS,
    title: entities.title ?? '',
    date: displayDate(entities.date) ?? '',
    time: displayTime(entities.time) ?? '',
    query: entities.query ?? '',
  };

  switch (action?.kind) {
    case 'CREATE_TASK':
      return {
        ...fields,
        title: action.title,
        ...whenFields(action.due),
        priority: action.priority,
      };
    case 'CREATE_EVENT':
      return {
        ...fields,
        title: action.title,
        ...whenFields(action.start),
        duration: displayDuration(action.durationMin),
        location: action.location ?? '',
        attendees: action.attendees.join(', '),
      };
    case 'CREATE_NOTE':
      return { ...fields, title: action.title, body: action.body ?? '' };
    case 'SEARCH':
      return {
        ...fields,
        query: action.query,
        scope: action.scope,
        range: displayRange(action.range) ?? '',
      };
    default:
      return fields;
  }
}

/** Prefills the edit sheet from a saved item. */
export function fieldsFromItem(item: SavedItem): FormFields {
  const fields = { ...EMPTY_FIELDS, title: item.title };

  switch (item.kind) {
    case 'task':
      return { ...fields, ...whenFields(item.due), priority: item.priority };
    case 'event':
      return {
        ...fields,
        ...whenFields(item.start),
        duration: displayDuration(item.durationMin),
        location: item.location ?? '',
        attendees: item.attendees.join(', '),
      };
    case 'note':
      return { ...fields, body: item.body ?? '' };
  }
}

function readTitle(fields: FormFields): FormResult<string> {
  const title = fields.title.trim();

  if (!title) {
    return { ok: false, error: 'Add a title.' };
  }

  return title.length > 200
    ? { ok: false, error: 'Keep the title under 200 characters.' }
    : { ok: true, value: title };
}

function readWhen(fields: FormFields, today: string): FormResult<LocalDateTime | null> {
  const date = parseDateInput(fields.date, today);

  if (!date.ok) {
    return { ok: false, error: 'Enter a date like Sep 24.' };
  }

  const time = parseTimeInput(fields.time);

  if (!time.ok) {
    return { ok: false, error: 'Enter a time like 3:30 PM.' };
  }

  if (!date.value) {
    return time.value
      ? { ok: false, error: 'Add a date for this time.' }
      : { ok: true, value: null };
  }

  return { ok: true, value: { date: date.value, time: time.value } };
}

interface TaskValues {
  title: string;
  due: LocalDateTime | null;
  priority: 'low' | 'normal' | 'high';
}

interface EventValues {
  title: string;
  start: LocalDateTime | null;
  durationMin: number;
  location: string | null;
  attendees: string[];
}

interface NoteValues {
  title: string;
  body: string | null;
}

function readTask(fields: FormFields, today: string): FormResult<TaskValues> {
  const title = readTitle(fields);

  if (!title.ok) {
    return title;
  }

  const due = readWhen(fields, today);

  if (!due.ok) {
    return due;
  }

  const priority = taskPrioritySchema.catch('normal').parse(fields.priority);

  return { ok: true, value: { title: title.value, due: due.value, priority } };
}

function readEvent(fields: FormFields, today: string): FormResult<EventValues> {
  const title = readTitle(fields);

  if (!title.ok) {
    return title;
  }

  const start = readWhen(fields, today);

  if (!start.ok) {
    return start;
  }

  const duration = parseDurationInput(fields.duration);

  if (!duration.ok) {
    return { ok: false, error: 'Enter a duration like 45 min.' };
  }

  return {
    ok: true,
    value: {
      title: title.value,
      start: start.value,
      durationMin: duration.value,
      location: fields.location.trim() || null,
      attendees: parseListInput(fields.attendees),
    },
  };
}

function readNote(fields: FormFields): FormResult<NoteValues> {
  const title = readTitle(fields);

  if (!title.ok) {
    return title;
  }

  return { ok: true, value: { title: title.value, body: fields.body.trim() || null } };
}

/**
 * Reads the draft sheet back into the action to confirm.
 *
 * @example
 * fieldsToAction('CREATE_TASK', { ...fields, date: 'next friday' }, today)
 * // { ok: false, error: 'Enter a date like Sep 24.' }
 */
export function fieldsToAction(
  intent: Intent,
  fields: FormFields,
  today: string,
): FormResult<IntentAction> {
  let action: IntentAction;

  switch (intent) {
    case 'CREATE_TASK': {
      const task = readTask(fields, today);

      if (!task.ok) {
        return task;
      }

      action = { kind: intent, ...task.value };
      break;
    }

    case 'CREATE_EVENT': {
      const event = readEvent(fields, today);

      if (!event.ok) {
        return event;
      }

      action = { kind: intent, ...event.value };
      break;
    }

    case 'CREATE_NOTE': {
      const note = readNote(fields);

      if (!note.ok) {
        return note;
      }

      action = { kind: intent, ...note.value };
      break;
    }

    case 'SEARCH': {
      const query = fields.query.trim();

      if (!query) {
        return { ok: false, error: 'Enter something to search for.' };
      }

      const range = parseRangeInput(fields.range, today);

      if (!range.ok) {
        return { ok: false, error: 'Enter dates like Sep 1 – Sep 30.' };
      }

      const scope = searchScopeSchema.catch('all').parse(fields.scope);

      action = { kind: intent, query, scope, range: range.value };
      break;
    }

    case 'UNKNOWN':
      return { ok: false, error: 'Nexui could not tell what to create.' };
  }

  return { ok: true, value: intentActionSchema.parse(action) };
}

/** Reads the edit sheet back into a full patch of the item's editable fields. */
export function fieldsToPatch(
  item: SavedItem,
  fields: FormFields,
  today: string,
): FormResult<ItemPatch> {
  switch (item.kind) {
    case 'task':
      return readTask(fields, today);
    case 'event':
      return readEvent(fields, today);
    case 'note':
      return readNote(fields);
  }
}
```

Append to `apps/mobile/src/lib/intent-display.ts`, changing its first import to `import type { DateRange, LocalDateTime, SavedItem, SearchScope, TaskPriority } from '@nexui/types';`:

```ts
const KIND_LABELS = { task: 'Task', event: 'Event', note: 'Note' } as const;

/** One line under a timeline row: kind, then when (or "Unscheduled"). */
export function displayItemMeta(item: SavedItem): string {
  if (item.kind === 'note') {
    return KIND_LABELS.note;
  }

  const when = item.kind === 'task' ? item.due : item.start;

  if (!when) {
    return `${KIND_LABELS[item.kind]} · Unscheduled`;
  }

  const parts = [KIND_LABELS[item.kind], displayLocalDate(when.date)];

  if (when.time) {
    parts.push(displayTime(when.time) ?? when.time);
  }

  if (item.kind === 'event') {
    parts.push(displayDuration(item.durationMin));
  }

  return parts.join(' · ');
}
```

Note: the `savedTask` fixture has a time, so its meta is `Task · Fri, Sep 25 · 3:00 PM`. The event fixture has no time, so its meta is `Event · Sat, Sep 26 · 1 hr`. Both match the test.

- [ ] **Step 5: Run the tests**

Run: `node --experimental-strip-types --test tests/form-values.test.mjs tests/item-fields.test.mjs && pnpm --filter @nexui/mobile typecheck`
Expected: PASS (7 + 6 tests), and typecheck exits 0 (add `allowImportingTsExtensions` if TS5097 appears, per Step 3).

- [ ] **Step 6: Commit**

```bash
git add apps/mobile/src/lib/form-values.ts apps/mobile/src/lib/item-fields.ts apps/mobile/src/lib/intent-display.ts apps/mobile/tsconfig.json tests/form-values.test.mjs tests/item-fields.test.mjs
git commit -m "Add mobile form parsing and item field model"
```

---

### Task 9: Mobile API client and timeline cache helper

**Files:**

- Modify: `apps/mobile/src/lib/api.ts`
- Create: `apps/mobile/src/lib/timeline-pages.ts`, `apps/mobile/src/lib/use-timeline.ts`
- Test: `tests/timeline-pages.test.mjs`

**Interfaces:**

- Consumes: `fetchWithSession`, `supabase`, `requestContext` (existing, in `api.ts`); the Task 2 schemas.
- Produces:
  - `class ApiError extends Error { status: number }`, whose message is the server's user-safe `error`
  - `recordIntentEvent(event: Omit<IntentEventRequest, 'context'>): Promise<IntentEventResponse>`
  - `getTimelinePage(cursor: string | null, signal?: AbortSignal): Promise<TimelineResponse>`
  - `searchItems(action: Extract<IntentAction, { kind: 'SEARCH' }>): Promise<SearchResponse>`
  - `updateItem(item: Pick<SavedItem, 'kind' | 'id'>, patch: ItemPatch): Promise<SavedItem>`
  - `withCompletedAt(data: InfiniteData<TimelineResponse> | undefined, target: Pick<SavedItem, 'kind' | 'id'>, completedAt: string | null): InfiniteData<TimelineResponse> | undefined`
  - `TIMELINE_KEY = ['timeline']`, `useTimeline()` → `{ items: SavedItem[] } & UseInfiniteQueryResult`, `useCompleteItem()` → a mutation taking `{ item: SavedItem; completed: boolean }`

- [ ] **Step 1: Write the failing test**

Create `tests/timeline-pages.test.mjs`:

```js
import assert from 'node:assert/strict';
import test from 'node:test';

import { withCompletedAt } from '../apps/mobile/src/lib/timeline-pages.ts';
import { savedEvent, savedNote, savedTask } from './support/records.mjs';

const data = {
  pages: [
    { items: [savedTask, savedEvent], nextCursor: 'c1' },
    { items: [savedNote], nextCursor: null },
  ],
  pageParams: [null, 'c1'],
};

test('marks only the matching kind and id, across pages', () => {
  const stamp = '2026-09-24T18:30:00.000Z';
  const next = withCompletedAt(data, savedNote, stamp);
  assert.equal(next.pages[1].items[0].completedAt, stamp);
  assert.equal(next.pages[0].items[0].completedAt, null);
  assert.deepEqual(next.pageParams, data.pageParams);
  assert.equal(data.pages[1].items[0].completedAt, null, 'input is not mutated');
  assert.equal(
    withCompletedAt(data, { kind: 'event', id: savedTask.id }, stamp).pages[0].items[0].completedAt,
    null,
  );
  assert.equal(withCompletedAt(undefined, savedTask, stamp), undefined);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --experimental-strip-types --test tests/timeline-pages.test.mjs`
Expected: FAIL with `Cannot find module '.../lib/timeline-pages.ts'`.

- [ ] **Step 3: Implement**

Create `apps/mobile/src/lib/timeline-pages.ts`:

```ts
import type { InfiniteData } from '@tanstack/react-query';
import type { SavedItem, TimelineResponse } from '@nexui/types';

/** Returns cached timeline pages with one item's completion changed (for optimistic updates). */
export function withCompletedAt(
  data: InfiniteData<TimelineResponse> | undefined,
  target: Pick<SavedItem, 'kind' | 'id'>,
  completedAt: string | null,
): InfiniteData<TimelineResponse> | undefined {
  if (!data) {
    return data;
  }

  return {
    ...data,
    pages: data.pages.map((page) => ({
      ...page,
      items: page.items.map((item) =>
        item.kind === target.kind && item.id === target.id ? { ...item, completedAt } : item,
      ),
    })),
  };
}
```

In `apps/mobile/src/lib/api.ts`, extend the `@nexui/types` import with `authErrorSchema, intentEventRequestSchema, intentEventResponseSchema, savedItemSchema, searchResponseSchema, timelineResponseSchema` and the types `IntentAction, IntentEventRequest, IntentEventResponse, ItemPatch, SavedItem, SearchResponse, TimelineResponse`. Then append:

```ts
/** A failed API call. `message` is the server's user-safe error text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

interface Schema<T> {
  parse: (value: unknown) => T;
}

// Sends an authenticated JSON request with a 10s timeout and validates the reply.
async function sendJson<T>(path: string, init: RequestInit, schema: Schema<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  if (init.signal?.aborted) {
    controller.abort();
  }

  init.signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 10_000);

  try {
    const response = await fetchWithSession(supabase.auth, `${apiUrl}${path}`, {
      ...init,
      signal: controller.signal,
    });
    const body: unknown = await response.json().catch(() => null);

    if (!response.ok) {
      const error = authErrorSchema.safeParse(body);

      throw new ApiError(
        error.success ? error.data.error : 'Something went wrong. Try again.',
        response.status,
      );
    }

    return schema.parse(body);
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', cancel);
  }
}

// Logs a confirmed or dismissed draft; the server saves confirmed tasks, events and notes.
// Async so an invalid event rejects (callers `.catch` it) instead of throwing synchronously.
export async function recordIntentEvent(
  event: Omit<IntentEventRequest, 'context'>,
): Promise<IntentEventResponse> {
  const body = intentEventRequestSchema.parse({ ...event, context: requestContext() });
  const response = await sendJson(
    '/api/intent-events',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    intentEventResponseSchema,
  );

  return response;
}

export function getTimelinePage(
  cursor: string | null,
  signal?: AbortSignal,
): Promise<TimelineResponse> {
  const query = new URLSearchParams({ limit: '50' });

  if (cursor) {
    query.set('cursor', cursor);
  }

  return sendJson(`/api/timeline?${query}`, { signal }, timelineResponseSchema);
}

export function searchItems(
  action: Extract<IntentAction, { kind: 'SEARCH' }>,
): Promise<SearchResponse> {
  const query = new URLSearchParams({ q: action.query, scope: action.scope });

  if (action.range) {
    query.set('from', action.range.from);
    query.set('to', action.range.to);
  }

  return sendJson(`/api/search?${query}`, {}, searchResponseSchema);
}

export function updateItem(
  item: Pick<SavedItem, 'kind' | 'id'>,
  patch: ItemPatch,
): Promise<SavedItem> {
  return sendJson(
    `/api/items/${item.kind}/${item.id}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
    savedItemSchema,
  );
}
```

Create `apps/mobile/src/lib/use-timeline.ts`:

```ts
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import type { SavedItem, TimelineResponse } from '@nexui/types';
import { useMemo } from 'react';

import { getTimelinePage, updateItem } from './api';
import { withCompletedAt } from './timeline-pages';

export const TIMELINE_KEY = ['timeline'] as const;

/** The signed-in user's items, newest first, 50 per page. */
export function useTimeline() {
  const query = useInfiniteQuery({
    queryKey: TIMELINE_KEY,
    queryFn: ({ pageParam, signal }) => getTimelinePage(pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
  const items = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data]);

  return { ...query, items };
}

/** Toggles completion immediately and rolls back if the server refuses. */
export function useCompleteItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ item, completed }: { item: SavedItem; completed: boolean }) =>
      updateItem(item, { completed }),
    onMutate: async ({ item, completed }) => {
      await queryClient.cancelQueries({ queryKey: TIMELINE_KEY });
      const previous = queryClient.getQueryData<InfiniteData<TimelineResponse>>(TIMELINE_KEY);

      queryClient.setQueryData<InfiniteData<TimelineResponse>>(TIMELINE_KEY, (data) =>
        withCompletedAt(data, item, completed ? new Date().toISOString() : null),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(TIMELINE_KEY, context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: TIMELINE_KEY }),
  });
}
```

- [ ] **Step 4: Run the checks**

Run: `node --experimental-strip-types --test tests/timeline-pages.test.mjs && pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint`
Expected: PASS (1 test), and typecheck and lint exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/mobile/src/lib/api.ts apps/mobile/src/lib/timeline-pages.ts apps/mobile/src/lib/use-timeline.ts tests/timeline-pages.test.mjs
git commit -m "Add mobile client for intent events, timeline, search and edits"
```

---

### Task 10: Sheets: confirm, dismiss, search results and edit

**Files:**

- Rename + modify: `apps/mobile/src/components/intent-confirmation-modal.tsx` → `apps/mobile/src/components/item-form-sheet.tsx`
- Create: `apps/mobile/src/components/draft-sheet.tsx`, `apps/mobile/src/components/edit-sheet.tsx`

**Interfaces:**

- Consumes: `FormFields`, `fieldsFromDecision`, `fieldsFromItem`, `fieldsToAction`, `fieldsToPatch` (Task 8); `localToday` (Task 8); `displayItemMeta` (Task 8); `recordIntentEvent`, `searchItems`, `updateItem`, `ApiError` (Task 9); `TIMELINE_KEY` (Task 9).
- Produces:
  - `ItemFormSheet(props: ItemFormSheetProps)`, which is presentational
  - `DraftSheet({ decision, text, onClose, onSaved }: { decision: IntentDecision; text: string; onClose: () => void; onSaved: () => void })`
  - `EditSheet({ item, onClose }: { item: SavedItem; onClose: () => void })`

- [ ] **Step 1: Make the existing modal presentational**

Run: `git mv apps/mobile/src/components/intent-confirmation-modal.tsx apps/mobile/src/components/item-form-sheet.tsx`

In `item-form-sheet.tsx`:

1. Delete `FORM_COPY`, the `FormFields` type and `initialFields`; they now live in `item-fields.ts` or the new sheets. Import `type FormFields` from `@/lib/item-fields`.
2. Replace the `IntentConfirmationModal` signature and state with these props:

```tsx
export interface ItemFormSheetProps {
  layout: Exclude<Intent, 'UNKNOWN'>;
  heading: string;
  actionLabel: string;
  fields: FormFields;
  onChangeField: (key: keyof FormFields, value: string) => void;
  markedFields?: ReadonlySet<HighlightField>;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children?: ReactNode;
}

// The shared bottom sheet for drafting and editing items. It owns no data or requests.
export function ItemFormSheet({
  layout,
  heading,
  actionLabel,
  fields,
  onChangeField,
  markedFields,
  error,
  busy,
  onSubmit,
  onClose,
  children,
}: ItemFormSheetProps) {
```

3. Inside it, `label` reads `markedFields?.has(field)` instead of the `marked` set. `update` becomes `onChangeField`. `form[decision.intent]` becomes `form[layout]`, and the `UNKNOWN: []` entry is removed from `form`. The heading text is `{heading}`.
4. Replace the submit button and the "Preview only" hint with:

```tsx
{
  error ? (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </Text>
  ) : null;
}
<Pressable
  accessibilityRole="button"
  accessibilityState={{ disabled: busy, busy }}
  disabled={busy}
  onPress={onSubmit}
  style={({ pressed }) => [styles.submit, (pressed || busy) && styles.pressed]}
>
  <Text style={styles.submitText}>{busy ? 'Saving…' : actionLabel}</Text>
</Pressable>;
{
  children;
}
```

5. In `styles`, delete `hint` and add:

```ts
  error: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 20,
  },
```

6. Update the imports: add `type ReactNode` from `react` and `type Intent` from `@nexui/types`. Remove the now-unused `useState`, `IntentDecision` and display helpers (only `PRIORITY_OPTIONS` and `SCOPE_OPTIONS` are still used).

- [ ] **Step 2: Create the draft sheet**

Create `apps/mobile/src/components/draft-sheet.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { IntentAction, IntentDecision, SavedItem } from '@nexui/types';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ItemFormSheet } from '@/components/item-form-sheet';
import { ApiError, recordIntentEvent, searchItems } from '@/lib/api';
import { localToday } from '@/lib/form-values';
import { displayItemMeta } from '@/lib/intent-display';
import { fieldsFromDecision, fieldsToAction, type FormFields } from '@/lib/item-fields';
import { colors, fonts } from '@/lib/theme';
import { TIMELINE_KEY } from '@/lib/use-timeline';

const DRAFT_COPY = {
  CREATE_EVENT: { heading: 'New event', action: 'Create event' },
  CREATE_TASK: { heading: 'New task', action: 'Create task' },
  CREATE_NOTE: { heading: 'New note', action: 'Create note' },
  SEARCH: { heading: 'Search', action: 'Search' },
} as const;

// Logs the confirmed draft (saving CREATE_* items); a search then runs against saved items.
async function confirmDraft(
  decision: IntentDecision,
  text: string,
  action: IntentAction,
): Promise<SavedItem[] | null> {
  await recordIntentEvent({ text, decision, outcome: 'confirmed', action });

  if (action.kind !== 'SEARCH') {
    return null;
  }

  const { items } = await searchItems(action);

  return items;
}

/**
 * Reviews a magic-bar draft. Confirming saves and logs it; closing without
 * confirming logs a dismissal so the app can learn from skipped drafts.
 */
export function DraftSheet({
  decision,
  text,
  onClose,
  onSaved,
}: {
  decision: IntentDecision;
  text: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => fieldsFromDecision(decision));
  const [formError, setFormError] = useState<string | null>(null);
  const [results, setResults] = useState<SavedItem[] | null>(null);
  const confirmed = useRef(false);
  const confirm = useMutation({
    mutationFn: (action: IntentAction) => confirmDraft(decision, text, action),
    onSuccess: (items) => {
      confirmed.current = true;

      if (items) {
        setResults(items);

        return;
      }

      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onSaved();
    },
  });

  if (decision.intent === 'UNKNOWN') {
    return null;
  }

  const copy = DRAFT_COPY[decision.intent];
  const requestError = confirm.error instanceof ApiError ? confirm.error.message : null;
  const error =
    formError ??
    (confirm.error ? (requestError ?? 'Could not save. Check your connection.') : null);

  function submit() {
    const action = fieldsToAction(decision.intent, fields, localToday());

    if (!action.ok) {
      setFormError(action.error);

      return;
    }

    setFormError(null);
    confirm.mutate(action.value);
  }

  function close() {
    if (!confirmed.current) {
      void recordIntentEvent({ text, decision, outcome: 'dismissed' }).catch(() => undefined);
    }

    onClose();
  }

  return (
    <ItemFormSheet
      layout={decision.intent}
      heading={copy.heading}
      actionLabel={copy.action}
      fields={fields}
      onChangeField={(key: keyof FormFields, value: string) =>
        setFields((current) => ({ ...current, [key]: value }))
      }
      markedFields={new Set(decision.highlights?.map((span) => span.field))}
      error={error}
      busy={confirm.isPending}
      onSubmit={submit}
      onClose={close}
    >
      {results ? (
        <View style={styles.results} accessibilityLiveRegion="polite">
          <Text style={styles.resultsHeading}>
            {results.length ? `${results.length} found` : 'Nothing matched.'}
          </Text>
          {results.map((item) => (
            <View key={`${item.kind}:${item.id}`} style={styles.result}>
              <Text style={styles.resultTitle}>{item.title}</Text>
              <Text style={styles.resultMeta}>{displayItemMeta(item)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </ItemFormSheet>
  );
}

const styles = StyleSheet.create({
  results: { marginTop: 24, gap: 12 },
  resultsHeading: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  result: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  resultTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
  resultMeta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
```

(Check that `fonts.bodyBold` exists in `theme.ts`; the old modal already uses it.)

- [ ] **Step 3: Create the edit sheet**

Create `apps/mobile/src/components/edit-sheet.tsx`:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ItemPatch, SavedItem } from '@nexui/types';
import { useState } from 'react';

import { ItemFormSheet } from '@/components/item-form-sheet';
import { ApiError, updateItem } from '@/lib/api';
import { localToday } from '@/lib/form-values';
import { fieldsFromItem, fieldsToPatch, type FormFields } from '@/lib/item-fields';
import { TIMELINE_KEY } from '@/lib/use-timeline';

const EDIT_COPY = {
  task: { heading: 'Edit task', layout: 'CREATE_TASK' },
  event: { heading: 'Edit event', layout: 'CREATE_EVENT' },
  note: { heading: 'Edit note', layout: 'CREATE_NOTE' },
} as const;

// Edits a saved item in the same sheet used for drafts.
export function EditSheet({ item, onClose }: { item: SavedItem; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [fields, setFields] = useState(() => fieldsFromItem(item));
  const [formError, setFormError] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (patch: ItemPatch) => updateItem(item, patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      onClose();
    },
  });
  const copy = EDIT_COPY[item.kind];
  const requestError = save.error instanceof ApiError ? save.error.message : null;
  const error =
    formError ?? (save.error ? (requestError ?? 'Could not save. Check your connection.') : null);

  function submit() {
    const patch = fieldsToPatch(item, fields, localToday());

    if (!patch.ok) {
      setFormError(patch.error);

      return;
    }

    setFormError(null);
    save.mutate(patch.value);
  }

  return (
    <ItemFormSheet
      layout={copy.layout}
      heading={copy.heading}
      actionLabel="Save changes"
      fields={fields}
      onChangeField={(key: keyof FormFields, value: string) =>
        setFields((current) => ({ ...current, [key]: value }))
      }
      error={error}
      busy={save.isPending}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
```

- [ ] **Step 4: Typecheck and lint**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint`
Expected: both exit 0. (Home still imports the old modal. Task 11 rewires it, so a missing-module error for `intent-confirmation-modal` in `(app)/index.tsx` is expected here. If you see it, do Task 11 Step 1 before committing.)

- [ ] **Step 5: Commit** (together with Task 11 if Step 4 flagged the home import)

```bash
git add apps/mobile/src/components
git commit -m "Split the item sheet into draft and edit flows that save through the API"
```

---

### Task 11: Home timeline

**Files:**

- Create: `apps/mobile/src/components/timeline-row.tsx`
- Modify: `apps/mobile/src/app/(app)/index.tsx`

**Interfaces:**

- Consumes: `useTimeline`, `useCompleteItem` (Task 9); `DraftSheet`, `EditSheet` (Task 10); `displayItemMeta` (Task 8).
- Produces: `TimelineRow({ item, onToggle, onOpen })`.

- [ ] **Step 1: Rewire the home screen**

Create `apps/mobile/src/components/timeline-row.tsx`:

```tsx
import type { SavedItem } from '@nexui/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { displayItemMeta } from '@/lib/intent-display';
import { colors, fonts } from '@/lib/theme';

// One saved item: a completion checkbox and a tappable body that opens the edit sheet.
export function TimelineRow({
  item,
  onToggle,
  onOpen,
}: {
  item: SavedItem;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = item.completedAt !== null;

  return (
    <View style={[styles.row, done && styles.done]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${item.title}: ${done ? 'done' : 'not done'}`}
        hitSlop={10}
        onPress={onToggle}
        style={[styles.check, done && styles.checkOn]}
      >
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the edit form"
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <Text numberOfLines={2} style={[styles.title, done && styles.titleDone]}>
          {item.title}
        </Text>
        <Text style={styles.meta}>{displayItemMeta(item)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  done: { opacity: 0.55 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkMark: { color: colors.page, fontFamily: fonts.bodyBold, fontSize: 14 },
  body: { flex: 1 },
  pressed: { opacity: 0.7 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  titleDone: { textDecorationLine: 'line-through' },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
```

In `apps/mobile/src/app/(app)/index.tsx`:

1. Replace the `ScrollView` import with `ActivityIndicator, FlatList`. Replace the `IntentConfirmationModal` import with `DraftSheet` from `@/components/draft-sheet`, `EditSheet` from `@/components/edit-sheet` and `TimelineRow` from `@/components/timeline-row`, and add `useCompleteItem, useTimeline` from `@/lib/use-timeline`. Import `type SavedItem` from `@nexui/types`.
2. Replace `selectedDecision` state with:

```tsx
type Sheet =
  { type: 'draft'; decision: IntentDecision; text: string } | { type: 'edit'; item: SavedItem };

const [sheet, setSheet] = useState<Sheet | null>(null);
const timeline = useTimeline();
const complete = useCompleteItem();
```

Declare `type Sheet` at module level, above `HomeScreen`, not inside the function. 3. Move everything that was inside `<View style={styles.content}>` into a `const header = (<View>…</View>);` element. The `IntentPreview` `onContinue` now calls `setSheet({ type: 'draft', decision, text: text.trim() })`. Add a section label at the end of `header`: `<Text accessibilityRole="header" style={styles.sectionLabel}>Your items</Text>`. 4. Replace the `ScrollView` with the list. `ListHeaderComponent` must be the `header` **element**, not an inline component function. A new component type on every render would remount the magic bar and dismiss the keyboard while typing:

```tsx
<FlatList
  style={styles.list}
  contentContainerStyle={styles.scroll}
  keyboardShouldPersistTaps="handled"
  data={timeline.items}
  keyExtractor={(item) => `${item.kind}:${item.id}`}
  ListHeaderComponent={header}
  renderItem={({ item }) => (
    <TimelineRow
      item={item}
      onToggle={() => complete.mutate({ item, completed: item.completedAt === null })}
      onOpen={() => setSheet({ type: 'edit', item })}
    />
  )}
  onEndReachedThreshold={0.5}
  onEndReached={() => {
    if (timeline.hasNextPage && !timeline.isFetchingNextPage) {
      void timeline.fetchNextPage();
    }
  }}
  ListEmptyComponent={
    timeline.isPending ? (
      <Text style={styles.feedback}>Loading your items…</Text>
    ) : timeline.isError ? (
      <Pressable accessibilityRole="button" onPress={() => void timeline.refetch()}>
        <Text style={styles.error}>Could not load your items. Tap to try again.</Text>
      </Pressable>
    ) : (
      <Text style={styles.feedback}>Nothing saved yet. Type a plan above.</Text>
    )
  }
  ListFooterComponent={
    timeline.isFetchingNextPage ? (
      <ActivityIndicator accessibilityLabel="Loading more" style={styles.footer} />
    ) : null
  }
/>;
{
  sheet?.type === 'draft' ? (
    <DraftSheet
      decision={sheet.decision}
      text={sheet.text}
      onClose={() => setSheet(null)}
      onSaved={() => {
        setSheet(null);
        setText('');
      }}
    />
  ) : null;
}
{
  sheet?.type === 'edit' ? <EditSheet item={sheet.item} onClose={() => setSheet(null)} /> : null;
}
```

The `ListEmptyComponent` nested ternary breaks the "expand nested ternaries" rule. Move it into a small `emptyState` const built with `if`/`else`, above the `return`:

```tsx
let emptyState = <Text style={styles.feedback}>Nothing saved yet. Type a plan above.</Text>;

if (timeline.isPending) {
  emptyState = <Text style={styles.feedback}>Loading your items…</Text>;
} else if (timeline.isError) {
  emptyState = (
    <Pressable accessibilityRole="button" onPress={() => void timeline.refetch()}>
      <Text style={styles.error}>Could not load your items. Tap to try again.</Text>
    </Pressable>
  );
}
```

Then pass `ListEmptyComponent={emptyState}`. 5. Styles: drop `content` and add

```ts
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.faint,
    marginTop: 32,
  },
  footer: { marginVertical: 20 },
```

- [ ] **Step 2: Check the mobile workspace**

Run: `pnpm --filter @nexui/mobile typecheck && pnpm --filter @nexui/mobile lint && pnpm --filter @nexui/mobile build`
Expected: all exit 0. `rg -n "intent-confirmation-modal|Preview only" apps/mobile` prints nothing.

- [ ] **Step 3: Smoke test in Expo (web)**

With the migration pushed (Task 1) and `apps/api/.env.local` filled in, run `pnpm dev`, open `http://localhost:8081`, sign in and check:

- Typing "call mom tomorrow at 3pm" → Review → Create task closes the sheet, clears the bar, and the task appears as `Task · <tomorrow> · 3:00 PM`.
- Double-tapping Create quickly saves once (the button shows "Saving…" and is disabled).
- Opening a draft and closing it adds one `dismissed` row in `intent_events` (Dashboard → Table Editor). Confirming adds **only** a `confirmed` row.
- Entering "next friday" as the date shows "Enter a date like Sep 24." and nothing is saved.
- Tapping a row, changing its time and choosing Save changes updates the row. The checkbox toggles done/undone and survives a reload.
- A SEARCH draft ("find dentist") lists results inside the sheet.
- With the API stopped, the checkbox rolls back and the sheet shows an error instead of closing.

- [ ] **Step 4: Commit**

```bash
git add apps/mobile/src
git commit -m "Show a paginated, editable timeline on the home screen"
```

---

### Task 12: Docs, reviews and full verification

**Files:**

- Create: `docs/architecture/persistence.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Write the architecture note**

Create `docs/architecture/persistence.md`:

```md
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

## Ownership

The API calls Supabase with `getUserClient(accessToken)`: the publishable key plus the
user's JWT. RLS policies (`user_id = auth.uid()`) scope every table, the view
(`security_invoker`) and both functions (`security invoker`). A row owned by someone
else looks the same as a missing row (404). Deleting the account cascades to all rows.

## Dates

Items store wall-clock `date` + `time` and the IANA `time_zone` they were entered in.
There is no UTC instant yet; add one when reminders need it.

## Migrations

SQL lives in `supabase/migrations/`. One-time setup:
`pnpm exec supabase login` and `pnpm exec supabase link --project-ref <ref>`.
Create a migration with `pnpm db:new <name>` and apply it with `pnpm db:push`. Never
edit a pushed migration; add a new one. `supabase/tests/rls-smoke.sql` checks RLS in
the SQL editor and rolls itself back.
```

In `AGENTS.md`:

- Under "Project Structure", add: ``- `supabase/migrations/`: Postgres schema, RLS and SQL functions (see `docs/architecture/persistence.md`). Saved-record queries live in `apps/api/src/lib/records/`.``
- Under "Build, Test, and Development Commands", add: ``- `pnpm db:new <name>` / `pnpm db:push`: create a migration / apply migrations to the linked Supabase project (`supabase link` once first).``

- [ ] **Step 2: Run the reviewers**

Dispatch in parallel: `api-reviewer` (apps/api + packages/types), `mobile-reviewer` (apps/mobile), and `security-reviewer`. Security gets extra attention on RLS, the new routes, logged user text in `intent_events`, and `getUserClient`. Fix every confirmed finding, rerunning the relevant tests after each fix. Then dispatch `docs-keeper` to reconcile README, `.env.example` files and the docs with the final code.

- [ ] **Step 3: Full verification**

Run: `pnpm fix && git diff --stat` and check that the diff has no unrelated changes. Then run:

```bash
pnpm test && pnpm lint && pnpm typecheck && pnpm format:check && pnpm build
```

Expected: every command exits 0. Also check `curl -s localhost:3000/api/health` returns `{"status":"ok"}` while `pnpm dev:api` runs.

Pagination check: in the SQL editor, seed 60 tasks for your own user:

```sql
insert into public.tasks (user_id, title, time_zone)
select '<your auth user id>', 'Seed ' || n, 'UTC' from generate_series(1, 60) n;
```

Scroll the app's timeline to the end and check that 60+ rows appear with no duplicates. Then delete the seed rows (`delete from public.tasks where title like 'Seed %';`, run as the postgres role in the editor).

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md docs/
git commit -m "Document persistence architecture and database commands"
```
