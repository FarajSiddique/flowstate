-- Instant actions with Undo, and intents that change saved items (COMPLETE, RESCHEDULE,
-- APPEND). Changes keep the overwritten columns in the log so undo can restore them.

alter table public.intent_events
  add column via text check (via in ('instant', 'form')),
  add column before jsonb,
  add column after_updated_at timestamptz,
  add column undone_at timestamptz;

-- Rows logged before this migration have no `via`; only new rows are checked.
alter table public.intent_events
  add constraint intent_events_confirmed_via check (outcome = 'dismissed' or via is not null)
  not valid;

-- Undo stamps `undone_at`; every other log column stays append-only.
grant update (undone_at) on public.intent_events to authenticated;
create policy "Owners mark their log undone" on public.intent_events for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Undoing a new item deletes it.
grant delete on public.tasks, public.events, public.notes to authenticated;
create policy "Owners delete tasks" on public.tasks for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners delete events" on public.events for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "Owners delete notes" on public.notes for delete to authenticated
  using (user_id = (select auth.uid()));

drop function public.record_intent(text, jsonb, jsonb, text, jsonb, text);

-- Saves a confirmed create or applies a confirmed change, and logs the outcome, in one
-- transaction. Returns { eventId, item }; item is null when nothing was saved.
-- A change that touches no row (not yours, wrong kind, already complete) raises NXU01.
create function public.record_intent(
  input_text text,
  input_context jsonb,
  input_decision jsonb,
  input_outcome text,
  input_action jsonb,
  input_time_zone text,
  input_via text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_kind text := input_action ->> 'kind';
  target_id uuid := (input_action #>> '{target,id}')::uuid;
  target_kind text := input_action #>> '{target,kind}';
  task_row public.tasks;
  event_row public.events;
  note_row public.notes;
  before_values jsonb;
  saved jsonb;
  log_id uuid;
begin
  if input_outcome = 'confirmed' then
    case action_kind
      when 'CREATE_TASK' then
        insert into public.tasks (title, due_date, due_time, time_zone, priority)
        values (
          input_action ->> 'title',
          (input_action #>> '{due,date}')::date,
          (input_action #>> '{due,time}')::time,
          input_time_zone,
          input_action ->> 'priority'
        )
        returning * into task_row;
        saved := jsonb_build_object('kind', 'task') || to_jsonb(task_row);
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
        returning * into event_row;
        saved := jsonb_build_object('kind', 'event') || to_jsonb(event_row);
      when 'CREATE_NOTE' then
        insert into public.notes (title, body, time_zone)
        values (input_action ->> 'title', input_action ->> 'body', input_time_zone)
        returning * into note_row;
        saved := jsonb_build_object('kind', 'note') || to_jsonb(note_row);
      when 'COMPLETE' then
        before_values := jsonb_build_object('completed_at', null);

        if target_kind = 'task' then
          update public.tasks set completed_at = now()
          where id = target_id and completed_at is null
          returning * into task_row;
          saved := jsonb_build_object('kind', 'task') || to_jsonb(task_row);
        elsif target_kind = 'event' then
          update public.events set completed_at = now()
          where id = target_id and completed_at is null
          returning * into event_row;
          saved := jsonb_build_object('kind', 'event') || to_jsonb(event_row);
        elsif target_kind = 'note' then
          update public.notes set completed_at = now()
          where id = target_id and completed_at is null
          returning * into note_row;
          saved := jsonb_build_object('kind', 'note') || to_jsonb(note_row);
        end if;
      when 'RESCHEDULE' then
        if target_kind = 'task' then
          select jsonb_build_object('due_date', due_date, 'due_time', due_time)
          into before_values
          from public.tasks
          where id = target_id and completed_at is null
          for update;

          update public.tasks
          set due_date = (input_action #>> '{to,date}')::date,
              due_time = (input_action #>> '{to,time}')::time
          where id = target_id and completed_at is null
          returning * into task_row;
          saved := jsonb_build_object('kind', 'task') || to_jsonb(task_row);
        elsif target_kind = 'event' then
          select jsonb_build_object('start_date', start_date, 'start_time', start_time)
          into before_values
          from public.events
          where id = target_id and completed_at is null
          for update;

          update public.events
          set start_date = (input_action #>> '{to,date}')::date,
              start_time = (input_action #>> '{to,time}')::time
          where id = target_id and completed_at is null
          returning * into event_row;
          saved := jsonb_build_object('kind', 'event') || to_jsonb(event_row);
        end if;
      when 'APPEND' then
        if target_kind = 'note' then
          select jsonb_build_object('body', body)
          into before_values
          from public.notes
          where id = target_id and completed_at is null
          for update;

          update public.notes
          set body = case
            when coalesce(body, '') = '' then input_action ->> 'text'
            else body || E'\n' || (input_action ->> 'text')
          end
          where id = target_id and completed_at is null
          returning * into note_row;
          saved := jsonb_build_object('kind', 'note') || to_jsonb(note_row);
        end if;
      else
        saved := null;
    end case;

    -- A row variable with no row serializes as all-null fields, so check the id.
    if action_kind in ('COMPLETE', 'RESCHEDULE', 'APPEND') and (saved ->> 'id') is null then
      raise exception using errcode = 'NXU01', message = 'The item changed or is not yours';
    end if;
  end if;

  insert into public.intent_events (
    text, context, decision, outcome, confirmed_action, via, before, after_updated_at,
    task_id, event_id, note_id
  )
  values (
    input_text,
    input_context,
    input_decision,
    input_outcome,
    case when input_outcome = 'confirmed' then input_action end,
    case when input_outcome = 'confirmed' then input_via end,
    before_values,
    coalesce(task_row.updated_at, event_row.updated_at, note_row.updated_at),
    task_row.id,
    event_row.id,
    note_row.id
  )
  returning id into log_id;

  return jsonb_build_object('eventId', log_id, 'item', saved);
end;
$$;

-- Reverses a confirmed create or change within 60 seconds, unless the item was edited
-- since. Returns the restored item, or null when a created item was deleted.
create function public.undo_intent(input_event_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  logged public.intent_events;
  action_kind text;
  current_updated_at timestamptz;
  task_row public.tasks;
  event_row public.events;
  note_row public.notes;
  restored jsonb;
begin
  select * into logged from public.intent_events where id = input_event_id for update;

  if not found then
    raise exception using errcode = 'NXU04', message = 'Not found';
  end if;

  action_kind := logged.confirmed_action ->> 'kind';

  if logged.outcome <> 'confirmed' or action_kind = 'SEARCH' then
    raise exception using errcode = 'NXU09', message = 'Nothing to undo';
  end if;

  if logged.undone_at is not null then
    raise exception using errcode = 'NXU09', message = 'Already undone';
  end if;

  if logged.created_at < now() - interval '60 seconds' then
    raise exception using errcode = 'NXU09', message = 'Too late to undo';
  end if;

  if logged.task_id is not null then
    select updated_at into current_updated_at from public.tasks
    where id = logged.task_id for update;
  elsif logged.event_id is not null then
    select updated_at into current_updated_at from public.events
    where id = logged.event_id for update;
  elsif logged.note_id is not null then
    select updated_at into current_updated_at from public.notes
    where id = logged.note_id for update;
  end if;

  if current_updated_at is null or current_updated_at <> logged.after_updated_at then
    raise exception using errcode = 'NXU09', message = 'Item was edited, so undo was skipped';
  end if;

  case action_kind
    when 'CREATE_TASK' then
      delete from public.tasks where id = logged.task_id;
    when 'CREATE_EVENT' then
      delete from public.events where id = logged.event_id;
    when 'CREATE_NOTE' then
      delete from public.notes where id = logged.note_id;
    when 'COMPLETE' then
      if logged.task_id is not null then
        update public.tasks set completed_at = null where id = logged.task_id
        returning * into task_row;
        restored := jsonb_build_object('kind', 'task') || to_jsonb(task_row);
      elsif logged.event_id is not null then
        update public.events set completed_at = null where id = logged.event_id
        returning * into event_row;
        restored := jsonb_build_object('kind', 'event') || to_jsonb(event_row);
      else
        update public.notes set completed_at = null where id = logged.note_id
        returning * into note_row;
        restored := jsonb_build_object('kind', 'note') || to_jsonb(note_row);
      end if;
    when 'RESCHEDULE' then
      if logged.task_id is not null then
        update public.tasks
        set due_date = (logged.before ->> 'due_date')::date,
            due_time = (logged.before ->> 'due_time')::time
        where id = logged.task_id
        returning * into task_row;
        restored := jsonb_build_object('kind', 'task') || to_jsonb(task_row);
      else
        update public.events
        set start_date = (logged.before ->> 'start_date')::date,
            start_time = (logged.before ->> 'start_time')::time
        where id = logged.event_id
        returning * into event_row;
        restored := jsonb_build_object('kind', 'event') || to_jsonb(event_row);
      end if;
    when 'APPEND' then
      update public.notes set body = logged.before ->> 'body' where id = logged.note_id
      returning * into note_row;
      restored := jsonb_build_object('kind', 'note') || to_jsonb(note_row);
    else
      raise exception using errcode = 'NXU09', message = 'Nothing to undo';
  end case;

  update public.intent_events set undone_at = now() where id = input_event_id;

  return restored;
end;
$$;

revoke execute on function public.record_intent(text, jsonb, jsonb, text, jsonb, text, text)
  from public, anon;
grant execute on function public.record_intent(text, jsonb, jsonb, text, jsonb, text, text)
  to authenticated;
revoke execute on function public.undo_intent(uuid) from public, anon;
grant execute on function public.undo_intent(uuid) to authenticated;
