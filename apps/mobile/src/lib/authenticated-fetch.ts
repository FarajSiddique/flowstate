import type { AuthError, Session, SupabaseClient } from '@supabase/supabase-js';

type SessionClient = Pick<SupabaseClient['auth'], 'getSession' | 'refreshSession'>;

interface SessionResult {
  data: { session: Session | null };
  error: AuthError | null;
}

export class UnauthorizedError extends Error {}

function sessionToken(result: SessionResult): string {
  if (result.error) {
    throw result.error;
  }
  const token = result.data.session?.access_token;
  if (!token) {
    throw new UnauthorizedError('Not signed in');
  }
  return token;
}

// React Native's AbortSignal lacks throwIfAborted().
function throwIfAborted(signal?: AbortSignal | null) {
  if (signal?.aborted) {
    const error = new Error('Request aborted');
    error.name = 'AbortError';
    throw error;
  }
}

/** Sends a bearer token and retries one 401 with a refreshed token. Never forces sign-out. */
export async function fetchWithSession(
  auth: SessionClient,
  url: string,
  init: RequestInit,
  send: typeof fetch = fetch,
): Promise<Response> {
  throwIfAborted(init.signal);
  const token = sessionToken(await auth.getSession());
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);

  throwIfAborted(init.signal);
  const response = await send(url, { ...init, headers });
  if (response.status !== 401) {
    return response;
  }

  throwIfAborted(init.signal);
  const refreshedToken = sessionToken(await auth.refreshSession());
  headers.set('Authorization', `Bearer ${refreshedToken}`);

  throwIfAborted(init.signal);
  const retried = await send(url, { ...init, headers });
  if (retried.status === 401) {
    throw new UnauthorizedError('Session rejected by the API');
  }
  return retried;
}
