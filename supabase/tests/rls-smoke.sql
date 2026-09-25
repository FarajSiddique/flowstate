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

-- Remember the owner's task id for the other user's link attempt below.
select set_config('rls_smoke.task_id', (select id::text from public.tasks limit 1), true);

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

  begin
    insert into public.intent_events (text, decision, outcome, confirmed_action, task_id)
    values (
      'claim a task',
      '{"intent":"CREATE_TASK","confidence":0.9,"entities":{}}',
      'confirmed',
      '{"kind":"CREATE_TASK"}',
      current_setting('rls_smoke.task_id')::uuid
    );
    raise exception 'other user must not link a log row to it';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

select 'RLS smoke passed' as result;

rollback;
