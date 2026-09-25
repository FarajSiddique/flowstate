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

select set_config(
  'rls_smoke.create_event_id',
  public.record_intent(
    'call mom tomorrow at 3',
    null,
    '{"intent":"CREATE_TASK","confidence":0.9,"entities":{}}',
    'confirmed',
    '{"kind":"CREATE_TASK","title":"Call mom","due":{"date":"2026-09-25","time":"15:00"},"priority":"normal"}',
    'America/New_York',
    'form'
  ) ->> 'eventId',
  true
);

do $$
begin
  assert (select count(*) from public.timeline_page(50)) = 1, 'owner should see their task';
  assert (select count(*) from public.intent_events) = 1, 'owner should see their log row';
end;
$$;

do $$
declare
  owned_task uuid := (select id from public.tasks limit 1);
  logged jsonb;
begin
  logged := public.record_intent(
    'done with call mom',
    null,
    '{"intent":"COMPLETE","confidence":0.9,"entities":{}}',
    'confirmed',
    jsonb_build_object(
      'kind', 'COMPLETE',
      'phrase', 'call mom',
      'target', jsonb_build_object('kind', 'task', 'id', owned_task, 'title', 'Call mom', 'when', null),
      'alternatives', '[]'::jsonb
    ),
    'America/New_York',
    'instant'
  );
  assert (logged #>> '{item,completed_at}') is not null, 'complete should stamp completed_at';
  assert (public.undo_intent((logged ->> 'eventId')::uuid) ->> 'completed_at') is null,
    'undo should reopen the task';

  begin
    perform public.undo_intent((logged ->> 'eventId')::uuid);
    raise exception 'undoing twice must be refused';
  exception
    when sqlstate 'NXU09' then
      null;
  end;
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

  begin
    perform public.undo_intent(current_setting('rls_smoke.create_event_id')::uuid);
    raise exception 'other user must not undo it';
  exception
    when sqlstate 'NXU04' then
      null;
  end;

  delete from public.tasks;
  get diagnostics changed = row_count;
  assert changed = 0, 'other user must not delete it';

  update public.intent_events set undone_at = now();
  get diagnostics changed = row_count;
  assert changed = 0, 'other user must not mark the log undone';

  begin
    update public.intent_events set text = 'edited';
    raise exception 'log text must stay append-only';
  exception
    when insufficient_privilege then
      null;
  end;
end;
$$;

select 'RLS smoke passed' as result;

rollback;
