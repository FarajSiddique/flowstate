# API Guidelines

These rules add to the root `AGENTS.md` for the Next.js API. Rules marked _(lint)_ are enforced by `apps/api/eslint.config.mjs`.

## Route handlers

- A `route.ts` authenticates, parses, validates, calls a `src/lib/<domain>/` function, and maps the result to a response. Keep business logic out of route files.
- Follow this order inside a handler:
  1. `verifyRequest(request, headers)`. If it returns a `Response`, return that response.
  2. `await request.json()` inside `try`/`catch`. Respond with 400 `Invalid JSON` if parsing fails.
  3. `safeParse` the body with a schema from `@nexui/types`. Respond with 400 and a user-safe message if it fails.
  4. Do the work, then `schema.parse` the response body before sending it.
- Build responses with `src/lib/http/responses.ts`: `corsHeaders` once per route, `preflight` for `OPTIONS`, and `jsonError` for failures. Send the route's headers on every response.
- Error bodies are always `{ error: string }`. The message must be safe to show a user, so never include provider errors, stack traces, or IDs.

## Errors and logging

- Log with `console.error('[tag]', message)`, where the tag names the route or module (`[intent]`, `[auth]`). Use `console.info` only for development diagnostics behind a `NODE_ENV` check. _(lint: `no-console` allows `error`, `warn`, and `info`)_
- Never log tokens, request bodies, email addresses, or raw provider errors.
- Represent known failure modes as `Error` subclasses (e.g. `SupabaseConfigurationError`). Log their message, and log a generic message for anything else.

## Configuration

- Read environment variables through an `env` parameter that defaults to `process.env` (see `verifyRequest`), so tests can pass explicit values.
- Server secrets stay in `apps/api`. Never import server modules from `packages/types` or the mobile app.

## Types and imports

- Exported functions have explicit parameter and return types. _(lint: `explicit-module-boundary-types`)_
- Use `import type` for type-only imports. _(lint)_
- Import groups go in this order: Node builtins, packages, `@nexui/*`, then relative paths, with a blank line between groups. _(lint: `import/order`)_
- Relative imports include the `.ts` extension, because the Node test runner loads source files directly.
- Derive request and response contracts from Zod schemas in `@nexui/types`.

## Tests

- Each route has a `tests/<name>-route.test.mjs` that calls the exported handler directly with a `Request`. Stub external services at the network boundary (see `tests/support/supabase-auth.mjs`) instead of mocking modules.
