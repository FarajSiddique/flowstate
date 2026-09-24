# Authentication

Nexui supports email codes and native Google sign-in through Supabase. The mobile
app owns the UI; Supabase owns the session. The API verifies a bearer token on each
protected request and never stores a user session.

## Follow an operation

```text
Sign-in / Verify / Account screen
  → auth.ts (connects dependencies once)
  → auth-actions.ts (email, Google token exchange, sign-out)
  → Supabase
  → session-lifecycle.ts → session store → root route guard
```

For Google, `google-sign-in.ts` configures the native SDK when first needed, opens
the account picker, and returns an ID token. Cancellation returns `null` without
contacting Supabase. The auth action exchanges the token for a Supabase session.
Google sign-in is unavailable in the web preview.

Email actions validate and normalize the address. Verification keeps leading zeroes:
`012345` is a six-digit code, not a number. The screen controls the resend countdown;
the Supabase project's rate limit is authoritative. See [setup](../specs/auth.md).

## Session ownership and lifecycle

`supabase.ts` creates the client and chooses storage: browser localStorage on web,
the chunked SecureStore adapter on native. The Zustand store only mirrors Supabase
events for rendering and routing; changing it is not a substitute for signing out.

The root layout starts `startSessionLifecycle()` in an effect and returns its
cleanup. The initial session event releases the loading screen. Later sign-in,
refresh, and sign-out events update the same store. The callback stays synchronous:
Supabase awaits callbacks, so calling an auth operation inside one can deadlock.

On native, the lifecycle starts refresh in the foreground and stops it in the
background or on unmount. Starts and stops are serialized per client because the
SDK starts asynchronously; cleanup or remount must not leave an extra timer running.
On web, Supabase manages browser visibility itself.

## Requests and failure handling

`api.ts` owns endpoints, request bodies, validation, and timeouts.
`authenticated-fetch.ts` reads the session, attaches its token, and sends the request.
On a 401 it refreshes once and retries; a second 401 rejects. Other statuses return
to the caller. Cancellation is checked between steps, but the SDK's token operations
cannot themselves be cancelled by the request's signal. A failed refresh propagates;
this helper does not force sign-out. Supabase events determine routing.

Sign-out forgets Google's account selection on a best-effort basis, then calls
Supabase. A returned error triggers one local-scope attempt. Local scope can still
require network access: an expired session while offline can fail both attempts.
The action then rejects and the Account screen restores its controls. This does
not guarantee offline credential removal.

Deletion first calls the API, which verifies the token and deletes only that user
with the server's secret key. The mobile app then clears its remaining session.
These are separate steps: failed cleanup does not undo deletion. The existing
Account screen reports either failure through its deletion error state.

## Boundaries and verification

`createAuthActions()` accepts the Supabase methods it uses and a small Google
adapter. Tests directly import the operations without loading React Native or
installing custom module loaders. `AuthActionError` marks messages safe to display;
unexpected errors receive generic UI messages. Error subclasses serve as identifiers.

`pnpm test` covers auth actions, cancellation, token refresh/retry, lifecycle cleanup,
real-client session restoration, server verification, and account deletion. Network
boundaries are simulated; tests do not open Google's native sheet or send email.
Also run `pnpm fix`, lint, typecheck, formatting checks, and builds after changes.

Before a native release, verify email sign-in/resend, Google success/cancellation,
restoration after restarting, foreground/background refresh, offline sign-out,
and deletion on a simulator or device.
