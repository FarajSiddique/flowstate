---
name: add-intent
description: Use when adding, renaming, or removing a nexui intent or action kind (e.g. "add a CREATE_REMINDER intent", "support expenses in the magic bar", "drop SEARCH"). Walks every place an intent lives — shared contract, candidates, action builder, jev criteria, mock engine, mobile previews and confirmation modal, tests, and eval fixtures — in dependency order.
---

# Add an intent

An intent spans 14 files. Work in this order so each step typechecks against the one before it. [reference.md](reference.md) has the file map and a completeness check.

Before starting, save a baseline: `pnpm -s eval:intent --out $TMPDIR/intent-before.json`.

## 1. Contract — `packages/types/src/index.ts`

- Add the name to `intentSchema`.
- Add a `kind` branch to `intentActionSchema`. Copy the closest existing branch. Use `nullable()` for fields the user may not state, and give enums a default in the builder instead.
- New enum (like `taskPrioritySchema`, `searchScopeSchema`)? Export the schema and the inferred type.
- New highlightable field? Add it to `highlightFieldSchema`.

## 2. Candidates — only for a new extractable field

A candidate is a span in the text that jev can choose (dates, durations, people…). Reuse existing candidate fields when they fit.

- `apps/api/src/lib/decision-engine/action-candidates.ts`: add the field to `ActionCandidates` and populate it in `findActionCandidates`.
- `action-questions.ts`: add the question in `buildFieldQuestions` and read the answer back in `readFieldSelections`.
- `action-builder.ts`: add the field to `FieldSelections`.

## 3. Builder — `action-builder.ts`

- `buildIntentAction`: add a `case` that strips the command prefix (add a `*_PREFIX` regex like `TASK_PREFIX`), picks candidates with `pick`, and applies defaults.
- `buildHighlights`: add a `case` that pushes the highlighted fields.

## 4. jev — `jev-decision-engine.ts`

- Add a `questions.intent.criteria` entry: one line, the category in plain words, then 3 examples in the same `a; b; c.` style as the others.
- Re-read the `ready` criteria. If the new intent's "target" is different (for example, an amount instead of a topic), extend both the `true` and `false` examples.

## 5. Mock — `mock-decision-engine.ts`

- Add a keyword branch in `classify`, ordered so it doesn't capture phrases meant for another intent.
- Add any keyword-driven enums to `heuristicSelections`.

## 6. Mobile

- `apps/mobile/src/components/intent-previews.tsx`: add a `CARD_COPY` entry (the type checks this map), a `*Draft` function copied from the closest existing one, and the entry in `DRAFTS`. **`DRAFTS` is untyped, so check it by hand.**
- `apps/mobile/src/components/intent-confirmation-modal.tsx`: add a `FORM_COPY` entry, add new field names to `FormFields`, add the `case` that seeds the form from the action, and add the field list in `form`. **`FORM_COPY` and `form` are untyped, so check them by hand.** Add `FIELD_MARKERS` for new highlight fields.
- `apps/mobile/src/lib/intent-display.ts`: add a `display*` formatter or `*_OPTIONS` list only for a new field type.
- `apps/mobile/src/lib/intent-confidence.ts`: normally no change. Check it if the new intent needs a different emphasis.

## 7. Tests (`tests/`)

Add cases alongside the existing ones for the neighbouring intent:

- `intent-contract`: the schema accepts the new branch and rejects a mismatched `kind`.
- `action-builder`: prefix stripping, defaults, highlights.
- `mock-decision-engine`: the keyword branch and a near-miss that stays with the other intent.
- `jev-decision-engine`: the gateway answer maps to the new action (stubbed `gatewayFetch`).
- `intent-route`, `intent-entities`, `intent-confidence`: update wherever intents are listed or enumerated.

## 8. Eval fixtures — `evals/intent-fixtures.json`

Add at least 4: a clear phrase, a reworded one, a partial ("still typing") one, and a near-miss that belongs to a neighbouring intent.

## 9. Verify

1. `pnpm typecheck`, which catches gaps in the typed maps. Then `pnpm test`, `pnpm lint`, `pnpm format:check`.
2. `pnpm -s eval:intent --compare $TMPDIR/intent-before.json`: existing intents shouldn't regress. Ask before running `--provider jev` (billed); the `intent-evaluator` agent can run and summarize it.
3. Run the flow in `pnpm dev:web`: type a phrase, then check the preview card, highlights, and confirmation modal.
4. Run the `api-reviewer` and `mobile-reviewer` agents, then `docs-keeper`.

## Remove or rename an intent

Go through the same files in reverse (fixtures and tests → mobile → mock → jev → builder → candidates → contract). Then run the grep in reference.md until it returns nothing for the old name. This is a prototype, so don't keep aliases or compatibility branches for older clients.
