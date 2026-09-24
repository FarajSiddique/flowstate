# nexui

A small, typed foundation for an AI-native productivity app. The first product
slice proves **natural-language input → typed intent → deterministic mobile UI**.
Intent classification can use either a local mock or Jev through Vercel AI Gateway.
There is no auth or database functionality.

## Requirements

- Node.js 24 LTS recommended (`nvm use`); minimum 22.13.
- pnpm 10.34.5: `npm install --global pnpm@10.34.5`.
- Expo Go compatible with SDK 57 for device previews, or a configured native
  development environment. A browser is enough to verify the starter end to end.

## Start development

From the repository root:

```bash
pnpm install
cp apps/mobile/.env.example apps/mobile/.env
cp apps/api/.env.example apps/api/.env.local
pnpm dev
```

This starts the API on port **3000** and Expo/Metro on port **8081** through
Turborepo. Open <http://localhost:8081> for the web preview. Expo's terminal output
also provides a URL/QR code for Expo Go. For interactive Expo keyboard shortcuts,
run the apps in separate terminals:

```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:mobile
```

In the Expo terminal, press `i` for iOS, `a` for Android, or `w` for web. You can
also run `pnpm dev:web` to launch the browser preview directly. Stop an existing
Expo process before starting another on port 8081.

The mobile app requests `/api/health`, validates its response with shared Zod,
and displays **API status: Connected**. It rechecks every 15 seconds and offers a
manual check. A small example Zustand store remains available for future local UI
state; health data lives in TanStack Query. Health requests time out after five seconds.

Type a phrase into the Magic Bar. After a short pause, `POST /api/intent` classifies
it, and Expo renders a preview using the shared Zod contract. **Continue** opens a
prefilled form; its final button closes the form without saving anything. Try:

| Phrase                                        | Preview        |
| --------------------------------------------- | -------------- |
| `meet Sarah tomorrow at 2`                    | Schedule Event |
| `remind me to submit my application tomorrow` | Create Task    |
| `write down idea about AI sports coach`       | Create Note    |
| `find my architecture notes`                  | Search         |
| `asdf banana purple`                          | No suggestion  |

The mock parser treats an unqualified `at 2` as **2:00 PM**. It only supports a
small set of phrases and relative dates (`today` and `tomorrow`); those strings
remain display values rather than calendar dates.

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}

curl -X POST http://localhost:3000/api/intent \
  -H 'Content-Type: application/json' \
  -d '{"text":"meet Sarah tomorrow at 2"}'

pnpm lint
pnpm typecheck
pnpm test
pnpm format:check
pnpm format          # apply formatting
pnpm build           # Next.js production build + Expo web export
```

`pnpm build` does not create native binaries. Native packaging can be added when
needed. All workspaces are private, and shared TypeScript source is consumed
directly by Next.js and Expo, so no separate package build/watch process is needed.

## Intent providers

Configure only the API's ignored `apps/api/.env.local`:

```dotenv
AI_PROVIDER=jev
AI_GATEWAY_API_KEY=<your Vercel AI Gateway key>
NEXUI_INTENT_MODEL=typesafe-ai/jev
NEXUI_INTENT_TIMEOUT_MS=3500
```

Restart `pnpm dev:api` after changing configuration. `AI_PROVIDER=mock` (also
the default when unset) preserves the original offline classifier and requires no
key. Any other provider value, missing Jev key/model, or invalid timeout produces
an actionable server log and a generic HTTP 500; configuration mistakes do not
silently switch providers. The timeout accepts integer milliseconds from 1 to
4500, below the unchanged mobile five-second timeout. The model is always read
from configuration; `typesafe-ai` alone is a provider name, not Jev's model ID.

`getDecisionEngine()` selects the implementation behind the same interface.
`JevDecisionEngine` uses native fetch against Vercel's documented
[evaluation API](https://vercel.com/docs/ai-gateway/modalities/evaluation),
`POST https://ai-gateway.vercel.sh/v1/evaluate`. No AI SDK was previously installed;
this integration needs only Zod and the existing Node runtime.

Jev selects among the five intents and assesses whether the input is ready for a
useful preview in one request. It does not generate arbitrary entity strings.
A small local parser copies/normalizes title, person, query, relative day/weekday,
and 12-hour time expressions from the source. Unsupported expressions stay in
editable text; this is not general-purpose entity extraction. Unqualified hours
1–7 retain the starter's PM assumption. Dates remain display strings, without
calendar or timezone resolution.

The Gateway envelope is validated with Zod, then mapped into the unchanged shared
`intentResponseSchema`. Confidence is the lower of classification confidence
(or selected-option probability when Gateway omits confidence) and preview-readiness
probability. This is a conservative display signal, not a calibrated probability
that every extracted field is correct. Mobile thresholds and debounce are unchanged.

Gateway HTTP errors, malformed JSON/output, network failures, and timeouts return
HTTP 200 with `{ intent: 'UNKNOWN', confidence: 0, entities: {} }`. There are no
retries or fallback models. Development logs contain provider, intent, confidence,
latency, and safe error categories/HTTP status; they omit inputs, credentials, and
raw provider responses. Vercel may retain its own Gateway logs independently.

`pnpm test` uses Node's built-in runner and mocks the HTTP boundary; it never calls
Jev. To smoke-test the real path, select `jev`, start the API, and use the curl
command above with all five demo phrases, plus `meet` and `meet Sarah tomorrow`.
Check API terminal timings and Gateway usage; a safe UNKNOWN fallback by itself
is not evidence that a real model request succeeded.

## Device networking and environment

`apps/mobile/.env` contains only public app configuration:

```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3000
```

| Preview target                       | API URL                              |
| ------------------------------------ | ------------------------------------ |
| Browser or iOS simulator on this Mac | `http://localhost:3000`              |
| Android Studio emulator              | `http://10.0.2.2:3000`               |
| Physical phone                       | `http://<your-computer-LAN-IP>:3000` |

For a phone, put both devices on the same network and allow port 3000 through the
computer's firewall. The API binds to `0.0.0.0` for LAN access. `localhost` on a
phone refers to the phone itself. Expo tunneling does not tunnel the API; an API
URL reachable from the device is still required. Restart Expo after changing env.

The localhost default works without env files. Supabase values may remain blank:

```dotenv
# apps/api/.env.local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

`EXPO_PUBLIC_*` is bundled into the app, and `NEXT_PUBLIC_*` is public configuration.
Never use either prefix for secrets. Future server credentials belong only in the
API's environment, without a public prefix. Environment files are ignored by git;
the `.env.example` files are tracked. Turbo passes Gateway configuration only to the API dev task. Do not add Gateway
keys to Expo configuration or any public environment variable.

The credential-free health and intent endpoints allow cross-origin requests for
Expo web. The intent endpoint handles JSON preflight requests. Choose explicit
origins and auth rules when the API handles private user data.

## Structure and extension points

```text
apps/
  mobile/
    src/app/                  # Expo Router Home and root layout
    src/components/           # Intent previews and confirmation form
    src/lib/                  # Validated API client, prediction hook, thresholds
    src/stores/               # Trivial Zustand example
  api/
    src/app/api/health/        # GET /api/health
    src/app/api/intent/        # POST /api/intent
    src/lib/decision-engine/  # Provider factory, mock, Jev, entity parser
    src/lib/supabase/         # Future server client/data access
packages/
  types/src/                  # Shared Zod schemas and inferred contracts
  config/                     # Strict TS, shared ESLint, Prettier
tests/                         # Node tests for contracts, classifier, thresholds
```

- Add future provider implementations in `apps/api/src/lib/decision-engine/` and
  register them in `getDecisionEngine()` there. The route and mobile client
  depend only on the shared contract; provider secrets stay server-side.
- Put future Supabase client factories and data access in
  `apps/api/src/lib/supabase/`. `@supabase/supabase-js` is installed in the API, but
  no client is constructed and no credentials are required today.
- Add shared request/response schemas in `packages/types`. Infer TypeScript types
  from Zod so runtime validation and compile-time contracts remain aligned. Keep
  this package independent of React, server code, and secrets.
- Framework lint presets stay with their apps; shared package rules, formatting,
  and strict TypeScript defaults live in `packages/config`.

Dependency versions follow Expo's SDK 57 compatibility metadata. The scaffold uses
[Expo's built-in monorepo support](https://docs.expo.dev/guides/monorepos/) and the
[Expo Router installation setup](https://docs.expo.dev/router/installation/).
