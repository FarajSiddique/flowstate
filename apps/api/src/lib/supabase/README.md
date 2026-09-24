# Supabase

Server-side Supabase code. Never import this directory from the mobile app or the
shared contracts package.

- `clients.ts`: cached clients without sessions. `getAuthClient()` uses the
  publishable key; `getAdminClient()` uses `SUPABASE_SECRET_KEY` and bypasses
  row-level security, so it's only for admin actions such as account deletion.
- `verify-request.ts`: `verifyRequest(request, headers)` checks the
  `Authorization: Bearer` access token with `auth.getClaims()`. With ES256 signing
  keys this is checked locally against the project's cached JWKS. It returns
  `{ userId, email }`, a 401 for a missing, invalid or expired token, or a 503 when
  Supabase is unreachable or not configured.

Copy the API's `.env.example` to `.env.local` and fill in the `SUPABASE_*` values.
