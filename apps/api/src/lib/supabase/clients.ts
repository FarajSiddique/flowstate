import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export class SupabaseConfigurationError extends Error {}

type Env = Record<string, string | undefined>;

// Server clients never hold a user session; each request brings its own token.
const serverAuth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
const clients = new Map<string, SupabaseClient>();

function cachedClient(url: string, key: string): SupabaseClient {
  const cacheKey = `${url}\n${key}`;
  let client = clients.get(cacheKey);

  if (!client) {
    client = createClient(url, key, { auth: serverAuth });
    clients.set(cacheKey, client);
  }

  return client;
}

function projectUrl(env: Env): string {
  const url = env.SUPABASE_URL?.trim();

  if (!url) {
    throw new SupabaseConfigurationError('SUPABASE_URL is required for auth.');
  }

  return url;
}

// Verifies user tokens with the publishable key.
export function getAuthClient(env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError('SUPABASE_PUBLISHABLE_KEY is required for auth.');
  }

  return cachedClient(projectUrl(env), key);
}

// Bypasses row-level security. Only use it for admin actions such as account deletion.
export function getAdminClient(env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_SECRET_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError('SUPABASE_SECRET_KEY is required for account deletion.');
  }

  return cachedClient(projectUrl(env), key);
}

// Acts as the signed-in user, so row-level security scopes every query to their rows.
// Not cached: each request carries its own token.
export function getUserClient(accessToken: string, env: Env = process.env): SupabaseClient {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();

  if (!key) {
    throw new SupabaseConfigurationError('SUPABASE_PUBLISHABLE_KEY is required for user data.');
  }

  return createClient(projectUrl(env), key, {
    auth: serverAuth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}
