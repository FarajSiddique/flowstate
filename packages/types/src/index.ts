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

export const intentRequestSchema = z.object({
  text: z.string().trim().min(3).max(500),
});

export type IntentRequest = z.infer<typeof intentRequestSchema>;

export const intentResponseSchema = z.object({
  intent: intentSchema,
  confidence: z.number().min(0).max(1),
  entities: intentEntitiesSchema,
});

export type IntentDecision = z.infer<typeof intentResponseSchema>;
