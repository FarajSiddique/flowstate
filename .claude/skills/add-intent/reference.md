# add-intent file map

| File                                                       | What to add                                                                      | Copy from                     |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------- |
| `packages/types/src/index.ts`                              | `intentSchema` value, `intentActionSchema` branch, enums, `highlightFieldSchema` | the `CREATE_TASK` branch      |
| `apps/api/src/lib/decision-engine/action-candidates.ts`    | new candidate field (optional)                                                   | `range`, `duration`           |
| `apps/api/src/lib/decision-engine/action-questions.ts`     | field question and reader (optional)                                             | `buildFieldQuestions` entries |
| `apps/api/src/lib/decision-engine/action-builder.ts`       | `FieldSelections`, `*_PREFIX`, `buildIntentAction` and `buildHighlights` cases   | `CREATE_TASK` cases           |
| `apps/api/src/lib/decision-engine/jev-decision-engine.ts`  | `questions.intent.criteria`, `ready` examples                                    | existing criteria lines       |
| `apps/api/src/lib/decision-engine/mock-decision-engine.ts` | `classify` branch, `heuristicSelections`                                         | the note/search branches      |
| `apps/mobile/src/components/intent-previews.tsx`           | `CARD_COPY`, `*Draft`, `DRAFTS`                                                  | `taskDraft`                   |
| `apps/mobile/src/components/intent-confirmation-modal.tsx` | `FORM_COPY`, `FormFields`, seed `case`, `form` fields, `FIELD_MARKERS`           | `CREATE_TASK` entries         |
| `tests/intent-contract.test.mjs`                           | schema accept/reject                                                             | existing kinds                |
| `tests/action-builder.test.mjs`                            | builder and highlight cases                                                      | task cases                    |
| `tests/mock-decision-engine.test.mjs`                      | keyword and near-miss                                                            | note/search cases             |
| `tests/jev-decision-engine.test.mjs`                       | gateway answer → action                                                          | existing stubs                |
| `tests/intent-route.test.mjs`                              | route-level response                                                             | existing intents              |
| `tests/intent-entities.test.mjs`                           | entities for the new intent                                                      | existing cases                |
| `tests/intent-confidence.test.mjs`                         | preview emphasis if affected                                                     | existing cases                |
| `evals/intent-fixtures.json`                               | 4+ fixtures                                                                      | existing entries              |

## Completeness check

Every file that knows about an existing intent should also know about the new one:

```sh
diff <(grep -rln CREATE_TASK apps/api/src apps/mobile/src packages/types/src tests evals | sort) \
     <(grep -rln NEW_INTENT apps/api/src apps/mobile/src packages/types/src tests evals | sort)
```

Replace `NEW_INTENT` with the new name. Empty output means every file covers both intents. For a removal, `grep -rn OLD_INTENT apps packages tests evals` should print nothing.
