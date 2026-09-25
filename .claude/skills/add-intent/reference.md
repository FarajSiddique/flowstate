# add-intent file map

## New-item intents (`CREATE_*`, `SEARCH`)

| File                                                       | What to add                                                                                        | Copy from                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `packages/types/src/index.ts`                              | `intentSchema` value, `intentActionSchema` branch, enums, `highlightFieldSchema`, `canCommit` case | the `CREATE_TASK` branch             |
| `apps/api/src/lib/decision-engine/action-candidates.ts`    | new candidate field (optional)                                                                     | `range`, `duration`                  |
| `apps/api/src/lib/decision-engine/action-questions.ts`     | field question and reader (optional)                                                               | `buildFieldQuestions` entries        |
| `apps/api/src/lib/decision-engine/action-builder.ts`       | `FieldSelections`, `*_PREFIX`, `buildIntentAction` and `buildHighlights` cases                     | `CREATE_TASK` cases                  |
| `apps/api/src/lib/decision-engine/jev-decision-engine.ts`  | `questions.intent.criteria`, `ready` examples                                                      | existing criteria lines              |
| `apps/api/src/lib/decision-engine/mock-decision-engine.ts` | `classify` branch, `heuristicSelections`                                                           | the note/search branches             |
| `apps/mobile/src/components/intent-previews.tsx`           | `CARD_COPY`, `*Draft`, `DRAFTS`                                                                    | `taskDraft`                          |
| `apps/mobile/src/lib/item-fields.ts`                       | `FormFields`, `fieldsFromDecision` and `fieldsToAction` cases                                      | `CREATE_TASK` cases                  |
| `apps/mobile/src/components/draft-sheet.tsx`               | `DRAFT_COPY` entry                                                                                 | `CREATE_TASK` entry                  |
| `apps/mobile/src/components/item-form-sheet.tsx`           | `form` fields, `FIELD_MARKERS`                                                                     | `CREATE_TASK` entries                |
| `apps/mobile/src/lib/commit-label.ts`                      | `commitLabel` and `undoMessage` cases                                                              | `CREATE_TASK` cases                  |
| `supabase/migrations/` (new migration)                     | table, RLS, `timeline_items` branch, `record_intent` `CASE` (saved kinds only)                     | `tasks` and its `CREATE_TASK` `when` |
| `tests/intent-contract.test.mjs`                           | schema accept/reject                                                                               | existing kinds                       |
| `tests/action-builder.test.mjs`                            | builder and highlight cases                                                                        | task cases                           |
| `tests/mock-decision-engine.test.mjs`                      | keyword and near-miss                                                                              | note/search cases                    |
| `tests/jev-decision-engine.test.mjs`                       | gateway answer → action                                                                            | existing stubs                       |
| `tests/intent-route.test.mjs`                              | route-level response                                                                               | existing intents                     |
| `tests/intent-entities.test.mjs`                           | entities for the new intent                                                                        | existing cases                       |
| `tests/intent-confidence.test.mjs`                         | preview emphasis if affected                                                                       | existing cases                       |
| `evals/intent-fixtures.json`                               | 4+ fixtures                                                                                        | existing entries                     |

18 files, excluding the two optional candidate rows.

## Change intents (`COMPLETE`, `RESCHEDULE`, `APPEND`)

A change intent acts on a saved item instead of creating one, so it skips candidates,
`action-builder.ts` and the mock's `classify` branch — `findChangeMatch` matches the
phrase before either engine's keyword logic runs — and needs no new table.

| File                                                      | What to add                                                                                                            | Copy from                     |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `packages/types/src/index.ts`                             | `CHANGE_INTENTS`, `TARGET_KINDS` entry, `intentActionSchema` branch (`targetFields` + kind fields), `canCommit` case   | the `RESCHEDULE` branch       |
| `apps/api/src/lib/decision-engine/change-actions.ts`      | `findChangeMatch` pattern, `buildChangeAction` case                                                                    | the `RESCHEDULE` pattern/case |
| `apps/api/src/lib/decision-engine/jev-decision-engine.ts` | `questions.intent.criteria` entry                                                                                      | existing criteria lines       |
| `apps/mobile/src/components/intent-previews.tsx`          | `CHANGE_COPY` entry                                                                                                    | the `RESCHEDULE` entry        |
| `apps/mobile/src/components/change-sheet.tsx`             | `CHANGE_COPY` entry (skip if the intent has no form, like `COMPLETE`)                                                  | the `RESCHEDULE` entry        |
| `apps/mobile/src/components/item-form-sheet.tsx`          | `form` fields (skip if no form)                                                                                        | the `RESCHEDULE` entry        |
| `apps/mobile/src/lib/item-fields.ts`                      | `fieldsFromChange`/`fieldsToChange` cases (skip if no form)                                                            | the `RESCHEDULE` cases        |
| `apps/mobile/src/lib/commit-label.ts`                     | `commitLabel` and `undoMessage` cases                                                                                  | the `RESCHEDULE` cases        |
| `supabase/migrations/` (new migration)                    | `record_intent` `CASE` branch (save `before_values`, apply the update), `undo_intent` `CASE` branch (restore `before`) | the `RESCHEDULE` branches     |
| `tests/change-actions.test.mjs`                           | `findChangeMatch` and `buildChangeAction` cases                                                                        | existing intents              |
| `tests/intent-actions-contract.test.mjs`                  | schema accept/reject, `canCommit` case                                                                                 | existing intents              |
| `tests/intent-events-route.test.mjs`                      | `record_intent` branch                                                                                                 | existing intents              |
| `tests/undo-route.test.mjs`                               | `undo_intent` branch                                                                                                   | existing intents              |
| `evals/intent-fixtures.json`                              | 4+ fixtures, including an ambiguous and a no-match case                                                                | existing entries              |

## Completeness check

Every file that knows about an existing intent should also know about the new one:

```sh
diff <(grep -rln CREATE_TASK apps/api/src apps/mobile/src packages/types/src tests evals | sort) \
     <(grep -rln NEW_INTENT apps/api/src apps/mobile/src packages/types/src tests evals | sort)
```

Replace `NEW_INTENT` with the new name (for a change intent, grep an existing one like
`RESCHEDULE` instead of `CREATE_TASK`). Empty output means every file covers both
intents. For a removal, `grep -rn OLD_INTENT apps packages tests evals` should print
nothing.
