-- Completing a task takes it off every list. Only tasks can be completed. Completed rows
-- stay for 30 days, so Undo and completion metrics still work, then a nightly job
-- deletes them.

-- Events and notes can no longer be completed: restore any that were, and forbid it.
update public.events set completed_at = null where completed_at is not null;
update public.notes set completed_at = null where completed_at is not null;

alter table public.events add constraint events_never_completed check (completed_at is null);
alter table public.notes add constraint notes_never_completed check (completed_at is null);

-- Same columns as before; completed tasks drop out of the timeline and search.
create or replace view public.timeline_items
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
where t.completed_at is null
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

create index tasks_completed_idx on public.tasks (completed_at) where completed_at is not null;

create extension if not exists pg_cron with schema pg_catalog;

-- Daily at 04:15 UTC. Runs as the migration role, so RLS doesn't apply: keep it one fixed
-- statement that never takes input.
select cron.schedule(
  'purge-completed-tasks',
  '15 4 * * *',
  $$ delete from public.tasks where completed_at < now() - interval '30 days' $$
);
