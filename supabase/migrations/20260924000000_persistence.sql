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
