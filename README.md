# flowstate

A small, typed foundation for an AI-native productivity app. This starter proves
**Expo → Next.js API → shared contract**. It has no AI integration, auth, or database
functionality.

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
manual check. A tiny Zustand store counts manual checks in memory; API data lives
only in TanStack Query. Health requests time out after five seconds and retry once.

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}

pnpm lint
pnpm typecheck
pnpm format:check
pnpm format          # apply formatting
pnpm build           # Next.js production build + Expo web export
```

`pnpm build` does not create native binaries. Native packaging can be added when
needed. All workspaces are private, and shared TypeScript source is consumed
directly by Next.js and Expo, so no separate package build/watch process is needed.

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
the `.env.example` files are tracked. Turbo passes public app configuration through
to dev tasks; add any future secret names to its task environment configuration
when those secrets are actually used.

The credential-free health endpoint allows cross-origin GET requests for Expo web.
That header is scoped to health; choose explicit origins and auth rules when real
API routes are added.

## Structure and extension points

```text
apps/
  mobile/
    src/app/                  # Expo Router Home and root layout
    src/lib/                  # Query provider and validated API request
    src/stores/               # Trivial Zustand example
  api/
    src/app/api/health/        # GET /api/health
    src/lib/decision-engine/  # Future AI decision logic
    src/lib/supabase/         # Future server client/data access
packages/
  types/src/                  # Shared Zod schemas and inferred contracts
  config/                     # Strict TS, shared ESLint, Prettier
```

- Put future intent-to-UI decisions in `apps/api/src/lib/decision-engine/`. It
  currently exports only an empty `DecisionEngine` interface. Provider calls and
  provider secrets should stay server-side.
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
