import { z } from 'zod';

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const intentSchema = z.enum([
  'CREATE_TASK',
  'CREATE_EVENT',
  'CREATE_NOTE',
  'SEARCH',
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

function isTimeZone(timeZone: string): boolean {
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

// Wall-clock values in the user's time zone; an all-day item has no time.
export const localDateTimeSchema = z.object({
  date: isoDateSchema,
  time: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .nullable(),
});

export type LocalDateTime = z.infer<typeof localDateTimeSchema>;

export const dateRangeSchema = z.object({ from: isoDateSchema, to: isoDateSchema });

export type DateRange = z.infer<typeof dateRangeSchema>;

export const taskPrioritySchema = z.enum(['low', 'normal', 'high']);

export type TaskPriority = z.infer<typeof taskPrioritySchema>;

export const searchScopeSchema = z.enum(['all', 'tasks', 'events', 'notes']);

export type SearchScope = z.infer<typeof searchScopeSchema>;

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
]);

export type IntentAction = z.infer<typeof intentActionSchema>;

export const intentResponseSchema = z
  .object({
    intent: intentSchema,
    confidence: z.number().min(0).max(1),
    entities: intentEntitiesSchema,
    // Additive typed draft; older clients keep reading `entities`.
    action: intentActionSchema.optional(),
  })
  .refine((decision) => !decision.action || decision.action.kind === decision.intent, {
    message: 'Action kind must match intent',
    path: ['action'],
  });

export type IntentDecision = z.infer<typeof intentResponseSchema>;
