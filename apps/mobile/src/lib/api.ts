import {
  authErrorSchema,
  healthResponseSchema,
  intentContextSchema,
  intentEventRequestSchema,
  intentEventResponseSchema,
  intentRequestSchema,
  intentResponseSchema,
  savedItemSchema,
  searchResponseSchema,
  timelineResponseSchema,
  type HealthResponse,
  type IntentAction,
  type IntentContext,
  type IntentDecision,
  type IntentEventRequest,
  type IntentEventResponse,
  type IntentRequest,
  type ItemPatch,
  type SavedItem,
  type SearchResponse,
  type TimelineResponse,
} from '@nexui/types';

import { fetchWithSession } from './authenticated-fetch';
import { supabase } from './supabase';

const apiUrl = (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').replace(/\/+$/, '');

export async function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  }

  signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 5_000);

  try {
    const response = await fetch(`${apiUrl}/api/health`, { signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Health request failed: ${response.status}`);
    }

    const body: unknown = await response.json();

    return healthResponseSchema.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

// Lets the server resolve "tomorrow" in the user's zone; omitted if the runtime lacks it.
function requestContext(): IntentContext | undefined {
  try {
    return intentContextSchema.safeParse({
      now: new Date().toISOString(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }).data;
  } catch {
    return undefined;
  }
}

export async function classifyIntent(
  input: IntentRequest,
  signal?: AbortSignal,
): Promise<IntentDecision> {
  const controller = new AbortController();
  const cancel = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  }

  signal?.addEventListener('abort', cancel);
  const timeout = setTimeout(cancel, 5_000);

  try {
    const response = await fetchWithSession(supabase.auth, `${apiUrl}/api/intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        intentRequestSchema.parse({ ...input, context: input.context ?? requestContext() }),
      ),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Intent request failed: ${response.status}`);
    }

    const body: unknown = await response.json();

    return intentResponseSchema.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', cancel);
  }
}

// Permanently deletes the signed-in user's account on the server.
export async function deleteAccount(): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetchWithSession(supabase.auth, `${apiUrl}/api/account`, {
      method: 'DELETE',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Account deletion failed: ${response.status}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

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
