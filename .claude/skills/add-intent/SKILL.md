---
name: add-intent
description: Use when adding, renaming, or removing a nexui intent or action kind (e.g. "add a CREATE_REMINDER intent", "support expenses in the magic bar", "drop SEARCH", "add a SNOOZE change intent"). Walks every place an intent lives — shared contract, candidates, action builder, jev criteria, mock engine, mobile previews and draft sheet, the database, tests, and eval fixtures — in dependency order. Covers both new-item intents and change intents that act on a saved item.
---

# Add an intent

A new-item intent (like `CREATE_TASK`) spans 18 files; work in this order so each step typechecks against the one before it. A change intent (like `COMPLETE`, `RESCHEDULE`, `APPEND` — one that acts on an item the user already saved) touches a different, smaller set — see [Change intents](#change-intents) below. [reference.md](reference.md) has both file maps and a completeness check.

Before starting, save a baseline: `pnpm -s eval:intent --out $TMPDIR/intent-before.json`.

## 1. Contract — `packages/types/src/index.ts`

- Add the name to `intentSchema`.
- Add a `kind` branch to `intentActionSchema`. Copy the closest existing branch. Use `nullable()` for fields the user may not state, and give enums a default in the builder instead.
- New enum (like `taskPrioritySchema`, `searchScopeSchema`)? Export the schema and the inferred type.
- New highlightable field? Add it to `highlightFieldSchema`.
- Add a `case` to `canCommit`'s switch (its `action.kind` switch is exhaustive, so a missing case fails typecheck): whatever makes the action complete enough to save without the form.

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
- `apps/mobile/src/lib/item-fields.ts`: add new field names to `FormFields` and `EMPTY_FIELDS`, the `fieldsFromDecision` case that prefills the sheet from the action, and the `fieldsToAction` case that reads it back (copy `readTask`). A saved kind also needs `fieldsFromItem` and `fieldsToPatch` cases.
- `apps/mobile/src/components/draft-sheet.tsx`: add a `DRAFT_COPY` entry (heading and button label).
- `apps/mobile/src/components/item-form-sheet.tsx`: add the field list in `form`, and `FIELD_MARKERS` for new highlight fields.
- `apps/mobile/src/lib/commit-label.ts`: add a `case` to `commitLabel` (the preview card's button label when `canCommit` is true) and to `undoMessage` (the Undo card's text). Both switches are exhaustive.
- `apps/mobile/src/lib/intent-display.ts`: add a `display*` formatter or `*_OPTIONS` list only for a new field type.
- `apps/mobile/src/lib/intent-confidence.ts`: normally no change. Check it if the new intent needs a different emphasis.

## 7. Database — `supabase/migrations/`

- A new `CREATE_*` kind that saves something needs its own table, RLS policies, a `timeline_items` branch, and a `when` in `record_intent`'s `CASE` (plus an `intent_events` link column). Add these in a new migration (`pnpm db:new <name>`); never edit a pushed one. A kind that saves nothing (like `SEARCH`) falls through the `else` and needs no change.

## 8. Tests (`tests/`)

Add cases alongside the existing ones for the neighbouring intent:

- `intent-contract`: the schema accepts the new branch and rejects a mismatched `kind`.
- `action-builder`: prefix stripping, defaults, highlights.
- `mock-decision-engine`: the keyword branch and a near-miss that stays with the other intent.
- `jev-decision-engine`: the gateway answer maps to the new action (stubbed `gatewayFetch`).
- `intent-route`, `intent-entities`, `intent-confidence`: update wherever intents are listed or enumerated.
- `intent-actions-contract`: the new `canCommit` case. `commit-flow`: the new `commit-label` case.

## 9. Eval fixtures — `evals/intent-fixtures.json`

Add at least 4: a clear phrase, a reworded one, a partial ("still typing") one, and a near-miss that belongs to a neighbouring intent.

## 10. Verify

1. `pnpm typecheck`, which catches gaps in the typed maps. Then `pnpm test`, `pnpm lint`, `pnpm format:check`.
2. `pnpm -s eval:intent --compare $TMPDIR/intent-before.json`: existing intents shouldn't regress. Ask before running `--provider jev` (billed); the `intent-evaluator` agent can run and summarize it.
3. Run the flow in `pnpm dev:web`: type a phrase, then check the preview card, highlights, and draft sheet, and confirm a draft to see it saved.
4. Run the `api-reviewer` and `mobile-reviewer` agents, then `docs-keeper`.

## Change intents

A change intent acts on an item the user already saved (`COMPLETE`, `RESCHEDULE`, `APPEND`) instead of creating one. The model still never writes values — it only picks among items the server finds by title — so a change intent replaces the candidate/builder/mock steps above with a different, smaller set. [reference.md](reference.md#change-intents) has the file map.

- **Contract** (`packages/types/src/index.ts`): add the name to `CHANGE_INTENTS` and its allowed kinds to `TARGET_KINDS`. Add a `kind` branch to `intentActionSchema` that spreads `targetFields` (`phrase`, `target`, `alternatives`) plus whatever the change needs (like `RESCHEDULE`'s `to`/`toParsed`). Add its `canCommit` case.
- **Finding the phrase and building the action** (`apps/api/src/lib/decision-engine/change-actions.ts`): add a regex pattern to `findChangeMatch` (what the user says to name the item and the new value), and a `case` to `buildChangeAction`. Skip step 2 (candidates), step 3 (`action-builder.ts`), and step 5's keyword branch in `classify` — `findChangeMatch` runs before `classify` and short-circuits it for both engines.
- **jev**: same as step 4 above — a `questions.intent.criteria` entry.
- **Mobile**: `intent-previews.tsx` gets a `CHANGE_COPY` entry (`ChangeCard` itself is generic: one match commits, several show "Which one?", none offers to create instead). If the change has a form (`RESCHEDULE` and `APPEND` do; `COMPLETE` doesn't — it has no Edit button), add its `CHANGE_COPY` entry in `change-sheet.tsx`, its field list in `item-form-sheet.tsx`'s `form`, and its `fieldsFromChange`/`fieldsToChange` cases in `item-fields.ts`. Add its `commitLabel`/`undoMessage` cases in `commit-label.ts` either way.
- **Database**: no new table. Add a branch to `record_intent`'s `CASE` in a new migration — save the overwritten columns in `before_values` before the `update`, and set `saved` from the updated row — and a matching branch to `undo_intent`'s `CASE` that restores `before`.
- **Tests**: a case in `tests/change-actions.test.mjs` (`findChangeMatch` and `buildChangeAction`), `tests/intent-actions-contract.test.mjs` (schema and `canCommit`), and a `record_intent`/`undo_intent` branch each in `tests/intent-events-route.test.mjs`/`tests/undo-route.test.mjs`.
- **Eval fixtures**: same as step 9, plus an ambiguous and a no-match case (the mock engine's `mockTargetChoice` needs a fixture list of saved items to shortlist against).

## Remove or rename an intent

Go through the same files in reverse (fixtures and tests → database → mobile → mock → jev → builder → candidates → contract; for a change intent, tests → database → mobile → change-actions.ts → contract). Then run the grep in reference.md until it returns nothing for the old name. This is a prototype, so don't keep aliases or compatibility branches for older clients.
