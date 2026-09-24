import { isAuthRetryableFetchError } from '@supabase/supabase-js';

import { getAuthClient, SupabaseConfigurationError } from './clients.ts';

export interface AuthUser {
  userId: string;
  email: string | null;
}

type Env = Record<string, string | undefined>;

const bearerPattern = /^Bearer ([\w-]+\.[\w-]+\.[\w-]+)$/i;

function unauthorized(headers: HeadersInit): Response {
  const withChallenge = new Headers(headers);
  withChallenge.set('WWW-Authenticate', 'Bearer');
  return Response.json({ error: 'Sign in to continue.' }, { status: 401, headers: withChallenge });
}

function unavailable(headers: HeadersInit): Response {
  return Response.json({ error: 'Sign-in is temporarily unavailable.' }, { status: 503, headers });
}

/**
 * Checks the request's Supabase access token. Returns the signed-in user, or a
 * ready-to-send error response (401 for a missing or bad token).
 */
export async function verifyRequest(
  request: Request,
  headers: HeadersInit = {},
  env: Env = process.env,
): Promise<AuthUser | Response> {
  const token = bearerPattern.exec(request.headers.get('authorization')?.trim() ?? '')?.[1];
  if (!token) {
    return unauthorized(headers);
  }

  try {
    // Verifies the signature locally against the project's cached JWKS, and checks expiry.
    const { data, error } = await getAuthClient(env).auth.getClaims(token);
    if (error && isAuthRetryableFetchError(error)) {
      console.error('[auth] Could not reach Supabase to verify a token.');
      return unavailable(headers);
    }
    const claims = data?.claims;
    if (
      error ||
      !claims ||
      typeof claims.sub !== 'string' ||
      claims.role !== 'authenticated' ||
      claims.is_anonymous === true
    ) {
      return unauthorized(headers);
    }
    return { userId: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
  } catch (error) {
    console.error(
      '[auth]',
      error instanceof SupabaseConfigurationError ? error.message : 'Token verification failed.',
    );
    return unavailable(headers);
  }
}
