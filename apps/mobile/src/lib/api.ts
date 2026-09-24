import {
  healthResponseSchema,
  intentContextSchema,
  intentRequestSchema,
  intentResponseSchema,
  type HealthResponse,
  type IntentContext,
  type IntentDecision,
  type IntentRequest,
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
