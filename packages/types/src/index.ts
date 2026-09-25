import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

// Sign-in by emailed one-time code. Supabase sends 6 digits (Auth → Emails → OTP length).
export const emailCodeRequestSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email()),
});

export type EmailCodeRequest = z.infer<typeof emailCodeRequestSchema>;

export const emailCodeVerificationSchema = emailCodeRequestSchema.extend({
  token: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export type EmailCodeVerification = z.infer<typeof emailCodeVerificationSchema>;

// Error body for 401, 503 and other failed API responses.
export const authErrorSchema = z.object({
  error: z.string(),
});

export type AuthError = z.infer<typeof authErrorSchema>;

export const intentSchema = z.enum([
  'CREATE_TASK',
  'CREATE_EVENT',
  'CREATE_NOTE',
  'SEARCH',
  'COMPLETE',
  'RESCHEDULE',
  'APPEND',
  'UNKNOWN',
]);

export type Intent = z.infer<typeof intentSchema>;

export const intentEntitiesSchema = z.object({
  title: z.string().optional(),
  date: z.string().optional(),
  time: z.string().optional(),
  person: z.string().optional(),
  query: z.string().optional(),
});

export type IntentEntities = z.infer<typeof intentEntitiesSchema>;

// IANA names only: Postgres reads offsets such as "+05:30" as POSIX zones, sign flipped.
function isTimeZone(timeZone: string): boolean {
  if (timeZone.startsWith('+') || timeZone.startsWith('-')) {
    return false;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone });

    return true;
  } catch {
    return false;
  }
}

// The client's clock and zone let the server resolve relative dates such as "tomorrow".
export const intentContextSchema = z.object({
  now: z.iso.datetime({ offset: true }),
  timeZone: z.string().min(1).max(64).refine(isTimeZone, 'Unknown time zone'),
});

export type IntentContext = z.infer<typeof intentContextSchema>;

export const intentRequestSchema = z.object({
  text: z.string().trim().min(3).max(500),
  context: intentContextSchema.optional(),
});

export type IntentRequest = z.infer<typeof intentRequestSchema>;

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeOfDaySchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

// Wall-clock values in the user's time zone; an all-day item has no time.
export const localDateTimeSchema = z.object({
  date: isoDateSchema,
  time: timeOfDaySchema.nullable(),
});

export type LocalDateTime = z.infer<typeof localDateTimeSchema>;

export const dateRangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema });

export type DateRange = z.infer<typeof dateRangeSchema>;

export const taskPrioritySchema = z.enum(['low', 'normal', 'high']);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const searchScopeSchema = z.enum(['all', 'tasks', 'events', 'notes']);

export type SearchScope = z.infer<typeof searchScopeSchema>;

export const itemKindSchema = z.enum(['task', 'event', 'note']);

export type ItemKind = z.infer<typeof itemKindSchema>;

export const itemIdSchema = z.uuid();

// A saved item a change intent can act on, as the server found it.
export const itemRefSchema = z.object({
  kind: itemKindSchema,
  id: itemIdSchema,
  title: z.string(),
  when: localDateTimeSchema.nullable(),
});

export type ItemRef = z.infer<typeof itemRefSchema>;

// A new date and/or time as the user said it, before it is merged with the item's current one.
export const partialWhenSchema = z
  .object({ date: isoDateSchema.nullable(), time: timeOfDaySchema.nullable() })
  .refine((when) => when.date !== null || when.time !== null, 'Say a date or a time');

export type PartialWhen = z.infer<typeof partialWhenSchema>;

// One match sets `target`; an unsure match lists `alternatives`; no match leaves both empty.
const targetFields = {
  phrase: z.string().min(1).max(200),
  target: itemRefSchema.nullable(),
  alternatives: z.array(itemRefSchema).max(5),
};

export const intentActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('CREATE_TASK'),
    title: z.string(),
    due: localDateTimeSchema.nullable(),
    priority: taskPrioritySchema,
  }),
  z.object({
    kind: z.literal('CREATE_EVENT'),
    title: z.string(),
    start: localDateTimeSchema.nullable(),
    durationMin: z.number().int().min(1).max(1440),
    attendees: z.array(z.string()),
    location: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('CREATE_NOTE'),
    title: z.string(),
    body: z.string().nullable(),
  }),
  z.object({
    kind: z.literal('SEARCH'),
    query: z.string(),
    scope: searchScopeSchema,
    range: dateRangeSchema.nullable(),
  }),
  z.object({ kind: z.literal('COMPLETE'), ...targetFields }),
  z.object({
    kind: z.literal('RESCHEDULE'),
    ...targetFields,
    to: localDateTimeSchema.nullable(),
    toParsed: partialWhenSchema.nullable(),
  }),
  z.object({ kind: z.literal('APPEND'), ...targetFields, text: z.string().max(2000) }),
]);

export type IntentAction = z.infer<typeof intentActionSchema>;

export const CHANGE_INTENTS = ['COMPLETE', 'RESCHEDULE', 'APPEND'] as const;

export type ChangeIntent = (typeof CHANGE_INTENTS)[number];
export type ChangeAction = Extract<IntentAction, { kind: ChangeIntent }>;

export function isChangeIntent(intent: Intent): intent is ChangeIntent {
  return (CHANGE_INTENTS as readonly Intent[]).includes(intent);
}

export function isChangeAction(action: IntentAction): action is ChangeAction {
  return isChangeIntent(action.kind);
}

// Which saved kinds each change intent may target.
export const TARGET_KINDS = {
  COMPLETE: ['task', 'event', 'note'],
  RESCHEDULE: ['task', 'event'],
  APPEND: ['note'],
} as const satisfies Record<ChangeIntent, readonly ItemKind[]>;

/**
 * Merges a spoken date/time with the item's current one; unsaid parts are kept.
 *
 * @example
 * resolveRescheduleTo({ date: null, time: '10:00' }, { date: '2026-09-24', time: '15:00' }, today)
 * // { date: '2026-09-24', time: '10:00' }
 */
export function resolveRescheduleTo(
  parsed: PartialWhen,
  current: LocalDateTime | null,
  today: string,
): LocalDateTime {
  return {
    date: parsed.date ?? current?.date ?? today,
    time: parsed.time ?? current?.time ?? null,
  };
}

export const highlightFieldSchema = z.enum([
  'when',
  'duration',
  'location',
  'attendees',
  'range',
  'priority',
]);

export type HighlightField = z.infer<typeof highlightFieldSchema>;

// Offsets index the input after trimming and collapsing whitespace; `end` is exclusive.
export const intentHighlightSchema = z
  .object({
    field: highlightFieldSchema,
    start: z.number().int().min(0),
    end: z.number().int().min(1),
    text: z.string().min(1),
  })
  .refine((span) => span.end - span.start === span.text.length, {
    message: 'Highlight offsets must match its text',
  });

export type IntentHighlight = z.infer<typeof intentHighlightSchema>;

export const intentResponseSchema = z
  .object({
    intent: intentSchema,
    confidence: z.number().min(0).max(1),
    entities: intentEntitiesSchema,
    // Additive typed draft; older clients keep reading `entities`.
    action: intentActionSchema.optional(),
    // Source spans behind the draft's fields, for marking up the user's own text.
    highlights: z.array(intentHighlightSchema).max(12).optional(),
  })
  .refine((decision) => !decision.action || decision.action.kind === decision.intent, {
    message: 'Action kind must match intent',
    path: ['action'],
  });

export type IntentDecision = z.infer<typeof intentResponseSchema>;

// Drafts at or above this confidence can be saved without the form.
export const HIGH_CONFIDENCE = 0.85;

/** True when return or the card's main button may save the draft at once (with Undo). */
export function canCommit(decision: IntentDecision): boolean {
  const { action } = decision;

  if (!action || decision.confidence < HIGH_CONFIDENCE) {
    return false;
  }

  switch (action.kind) {
    case 'CREATE_TASK':
    case 'CREATE_EVENT':
    case 'CREATE_NOTE':
      return action.title.trim().length > 0;
    case 'COMPLETE':
      return action.target !== null;
    case 'RESCHEDULE':
      return action.target !== null && action.to !== null;
    case 'APPEND':
      return action.target !== null && action.text.trim().length > 0;
    case 'SEARCH':
      return false;
  }
}

// Saved records. Timestamps are Postgres ISO strings with an offset.
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

// Whether a confirmed draft was saved straight away or through the form.
export const commitViaSchema = z.enum(['instant', 'form']);

export type CommitVia = z.infer<typeof commitViaSchema>;

// The saved columns' limits, shared by the create and edit paths.
const noteBodySchema = z.string().max(10_000).nullable();
const eventLocationSchema = z.string().max(200).nullable();
const attendeesSchema = z.array(z.string().trim().min(1).max(100)).max(50);

function targetFits(action: ChangeAction): boolean {
  const kinds: readonly ItemKind[] = TARGET_KINDS[action.kind];

  return action.target !== null && kinds.includes(action.target.kind);
}

// A draft the user confirmed (with their edits) or dismissed. Confirmed actions other than SEARCH are saved.
export const intentEventRequestSchema = z
  .object({
    text: z.string().trim().min(3).max(500),
    context: intentContextSchema.optional(),
    decision: intentResponseSchema,
    outcome: intentOutcomeSchema,
    action: intentActionSchema.optional(),
    via: commitViaSchema.optional(),
  })
  .refine((event) => event.outcome === 'dismissed' || event.action !== undefined, {
    message: 'A confirmed draft needs its action',
    path: ['action'],
  })
  .refine((event) => event.outcome === 'dismissed' || event.via !== undefined, {
    message: 'A confirmed draft says how it was confirmed',
    path: ['via'],
  })
  .refine((event) => !event.action || event.action.kind === event.decision.intent, {
    message: 'Action kind must match intent',
    path: ['action'],
  })
  .refine(
    (event) =>
      !event.action ||
      !('title' in event.action) ||
      itemTitleSchema.safeParse(event.action.title).success,
    { message: 'Add a title.', path: ['action', 'title'] },
  )
  .refine(
    (event) =>
      event.outcome === 'dismissed' ||
      !event.action ||
      !isChangeAction(event.action) ||
      targetFits(event.action),
    { message: 'Pick an item.', path: ['action', 'target'] },
  )
  .refine(
    (event) =>
      event.outcome === 'dismissed' ||
      event.action?.kind !== 'RESCHEDULE' ||
      event.action.to !== null,
    { message: 'Pick a new date.', path: ['action', 'to'] },
  )
  .refine(
    (event) =>
      event.action?.kind !== 'APPEND' ||
      z.string().trim().min(1).max(2000).safeParse(event.action.text).success,
    { message: 'Add some text.', path: ['action', 'text'] },
  )
  .refine(
    (event) =>
      event.action?.kind !== 'CREATE_NOTE' || noteBodySchema.safeParse(event.action.body).success,
    { message: 'Keep the note under 10,000 characters.', path: ['action', 'body'] },
  )
  .refine(
    (event) =>
      event.action?.kind !== 'CREATE_EVENT' ||
      eventLocationSchema.safeParse(event.action.location).success,
    { message: 'Keep the location under 200 characters.', path: ['action', 'location'] },
  )
  .refine(
    (event) =>
      event.action?.kind !== 'CREATE_EVENT' ||
      attendeesSchema.safeParse(event.action.attendees).success,
    { message: 'List up to 50 attendees.', path: ['action', 'attendees'] },
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
    attendees: attendeesSchema.optional(),
    ...completedField,
  })
  .refine(hasChanges, 'Nothing to update.');

export const notePatchSchema = z
  .strictObject({
    title: itemTitleSchema.optional(),
    body: noteBodySchema.optional(),
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
