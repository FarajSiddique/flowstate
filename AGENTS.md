# Repository Guidelines

## Project Structure & Module Organization

This pnpm/Turborepo monorepo contains four private workspaces:

- `apps/mobile/src/app/`: Expo Router screens and root layout. API/query helpers live in `src/lib/`; local Zustand stores live in `src/stores/`.
- `apps/api/src/app/`: Next.js App Router pages and routes, including `api/health/route.ts`. Future AI and Supabase code belongs in `src/lib/decision-engine/` and `src/lib/supabase/`.
- `packages/types/src/`: shared Zod schemas and inferred TypeScript contracts, imported through `@nexui/types`.
- `packages/config/`: strict TypeScript defaults, shared ESLint rules, and Prettier configuration.

No dedicated tests or application assets directories exist yet. Keep new assets within their owning app. Keep server code out of shared contracts and mobile imports.

## Build, Test, and Development Commands

Use Node.js 24 (`nvm use`) and pnpm 10.34.5. Run commands from the root:

- `pnpm install`: install workspace dependencies; retain `pnpm-lock.yaml`.
- `pnpm dev`: start API on port 3000 and Expo on 8081.
- `pnpm dev:api` / `pnpm dev:mobile`: start apps separately.
- `pnpm dev:web`: launch Expo's browser preview.
- `pnpm build`: build Next.js and export Expo web; does not build native binaries.
- `pnpm lint` / `pnpm typecheck`: check all applicable workspaces.
- `pnpm format` / `pnpm format:check`: apply or verify formatting.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, semicolons, and trailing commas. Prettier targets 100-character lines; ESLint uses framework presets. Use PascalCase for components/types, camelCase for functions, and kebab-case helper filenames such as `query-provider.tsx`. Preserve framework filenames such as `_layout.tsx` and `route.ts`. Infer shared contracts from Zod. Keep server state in TanStack Query and local UI state in Zustand.

## Testing Guidelines

No automated test runner, test script, or coverage threshold is configured. Run lint, typecheck, formatting checks, and relevant builds before submitting. Smoke-test `GET /api/health` for `{"status":"ok"}`; verify Connected, Unreachable, and recovery states in Expo. When introducing tests, document the runner and command; prefer colocated `*.test.ts(x)` files.

## Commit & Pull Request Guidelines

History currently contains only `init mono repo`; no formal commit convention exists. Use concise imperative subjects. PRs should explain the change, list validation results, link relevant issues, and include screenshots for UI changes. Keep scope focused.

## Security & Configuration

Copy app-local `.env.example` files; never commit secrets. Both `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` are public. Physical devices need the computer's LAN IP in `EXPO_PUBLIC_API_URL`. Supabase and Google credentials are required for sign-in (see `docs/specs/auth.md`). Only the publishable key goes in the mobile app; `SUPABASE_SECRET_KEY` stays in the API.
