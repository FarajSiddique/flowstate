# Repository Guidelines

## Project Structure & Module Organization

This pnpm/Turborepo monorepo contains four private workspaces:

- `apps/mobile/src/app/`: Expo Router screens and root layout. API/query helpers live in `src/lib/`; local Zustand stores live in `src/stores/`.
- `apps/api/src/app/`: Next.js App Router pages and routes, including `api/health/route.ts`. AI, Supabase, and shared response code belongs in `src/lib/decision-engine/`, `src/lib/supabase/`, and `src/lib/http/`. API-specific rules live in `apps/api/AGENTS.md`.
- `packages/types/src/`: shared Zod schemas and inferred TypeScript contracts, imported through `@nexui/types`.
- `packages/config/`: strict TypeScript defaults, shared ESLint rules, and Prettier configuration.

`tests/` contains Node tests; `docs/architecture/` contains short guides to current behavior. Keep new assets within their owning app. Keep server code out of shared contracts and mobile imports.

## Build, Test, and Development Commands

Use Node.js 24 (`nvm use`) and pnpm 10.34.5. Run commands from the root:

- `pnpm install`: install workspace dependencies; retain `pnpm-lock.yaml`.
- `pnpm dev`: start API on port 3000 and Expo on 8081.
- `pnpm dev:api` / `pnpm dev:mobile`: start apps separately.
- `pnpm dev:web`: launch Expo's browser preview.
- `pnpm build`: build Next.js and export Expo web; does not build native binaries.
- `pnpm lint` / `pnpm typecheck`: check all applicable workspaces.
- `pnpm test`: run the Node test suite.
- `pnpm lint:fix`: apply ESLint fixes across the workspaces.
- `pnpm fix`: apply ESLint fixes, then Prettier formatting.
- `pnpm format` / `pnpm format:check`: apply or verify formatting.

## Coding Style & Naming Conventions

Use strict TypeScript, two-space indentation, single quotes, semicolons, and trailing commas. Prettier targets 100-character lines; ESLint uses framework presets. Use PascalCase for components/types, camelCase for functions, and kebab-case helper filenames such as `query-provider.tsx`. Preserve framework filenames such as `_layout.tsx` and `route.ts`. Infer shared contracts from Zod. Keep server state in TanStack Query and local UI state in Zustand.

Always use braces and multiline bodies for `if`, `else`, `for`, `while`, and `do` statements, including one-statement guards. ESLint's `curly: ['error', 'all']` requires braces; Prettier formats the blocks. Do not disable the rule to keep a single-line statement.

Shared layout rules live in `packages/config/eslint-style.js`. Leave a blank line before `return`, after a block (`if`, `try`, loops), and after a group of declarations. `pnpm lint:fix` adds these blank lines automatically.

Claude Code runs `.claude/hooks/format.sh` after every edit. The hook runs Prettier, then ESLint `--fix` in the file's owning workspace, and reports any errors ESLint can't fix back to Claude.

After code changes, run `pnpm fix`, inspect the diff for unrelated changes, then run `pnpm lint` and `pnpm format:check` before handing off. Keep formatting-only changes separate from behavioral edits when practical. These instructions apply to Codex and Claude Code; `CLAUDE.md` imports this file.

Prefer `async`/`await` with `try`/`catch`. Expand nested ternaries and conditional object spreads; keep simple ternaries, `map`/`filter`, and `??` defaults when readable. Prefer functions; use classes only for meaningful state/lifecycle ownership or standard error subclasses. Give exported functions explicit parameter and return types, infer obvious local types, and name complex shapes. Continue deriving shared contracts from Zod.

Keep each flow readable from top to bottom. Extract helpers for distinct responsibilities and keep them nearby unless reuse or a platform boundary warrants a separate module. Avoid generic action wrappers that hide a screen's operation and error handling. Add short summaries and useful examples for domain logic; keep inline comments sparse and explain the broader flow in `docs/architecture/`.

This is a prototype: API and mobile contracts can change together. Do not add backward-compatibility paths for hypothetical older clients. Preserve intended user behavior unless the task calls for a behavior change.

## Testing Guidelines

`pnpm test` uses Node's built-in runner with TypeScript stripping and runs `tests/*.test.mjs`. No coverage threshold is configured. Test observable behavior at external boundaries; prefer direct imports and explicit dependencies over module-loader mocks. Run tests, lint, typecheck, formatting checks, and relevant builds before submitting. Smoke-test the affected user flow; for networking changes, verify `GET /api/health` returns `{"status":"ok"}` and check Connected, Unreachable, and recovery states in Expo. Auth ownership and native smoke checks are documented in `docs/architecture/authentication.md`.

## Commit & Pull Request Guidelines

Use concise imperative subjects. PRs should explain the change, list validation results, link relevant issues, and include screenshots for UI changes. Keep scope focused.

## Security & Configuration

Copy app-local `.env.example` files; never commit secrets. Both `EXPO_PUBLIC_*` and `NEXT_PUBLIC_*` are public. Physical devices need the computer's LAN IP in `EXPO_PUBLIC_API_URL`. Supabase and Google credentials are required for sign-in (see `docs/specs/auth.md`). Only the publishable key goes in the mobile app; `SUPABASE_SECRET_KEY` stays in the API.
