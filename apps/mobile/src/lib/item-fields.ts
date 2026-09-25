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
  localToday,
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

function whenFields(when: LocalDateTime | null, today: string): Pick<FormFields, 'date' | 'time'> {
  return {
    date: when ? displayLocalDate(when.date, true, Number(today.slice(0, 4))) : '',
    time: displayTime(when?.time ?? undefined) ?? '',
  };
}

/** Prefills the sheet from the typed draft; legacy entities cover older API responses. */
export function fieldsFromDecision(
  { action, entities }: IntentDecision,
  today: string = localToday(),
): FormFields {
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
        ...whenFields(action.due, today),
        priority: action.priority,
      };
    case 'CREATE_EVENT':
      return {
        ...fields,
        title: action.title,
        ...whenFields(action.start, today),
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
export function fieldsFromItem(item: SavedItem, today: string = localToday()): FormFields {
  const fields = { ...EMPTY_FIELDS, title: item.title };

  switch (item.kind) {
    case 'task':
      return { ...fields, ...whenFields(item.due, today), priority: item.priority };
    case 'event':
      return {
        ...fields,
        ...whenFields(item.start, today),
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
