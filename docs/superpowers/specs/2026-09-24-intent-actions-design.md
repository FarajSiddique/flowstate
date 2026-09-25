# Instant actions with Undo, and intents that act on saved items

**Status:** approved in brainstorming, 2026-09-24. Builds on `2026-09-24-persistence-design.md`.

## Why

The app still asks for confirmation on every draft and can only create new items, so it behaves like a todo list. This slice removes the confirmation step when the draft is clearly right, and lets the user change what they already saved by saying so. Together they cover the mission's "without making users navigate": capture and change both take one input.

## Goals and success criteria

- A high-confidence draft is saved when the user presses return or taps the card's main button. An Undo card appears for 8 seconds.
- "done with the report", "push the dentist to Friday at 4" and "add 'bring charger' to trip notes" change the matching saved item, with the same instant-plus-Undo behavior.
- When two or more items match, the user picks one on the card. When none match, the card offers to create one.
- The model never writes values: it picks from server-found candidates, as today.
- Every applied action and every undo is recorded in `intent_events`.

Out of scope: DELETE and RENAME intents, personalized thresholds, undo history beyond the 8-second card, several actions from one sentence.

## Decisions

| Topic                     | Decision                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------- |
| Changes to existing items | Instant with Undo when confident and exactly one item matches                      |
| Undo window               | Undo card for 8 seconds, replaced by the next commit; the server allows 60 seconds |
| New intents               | `COMPLETE`, `RESCHEDULE`, `APPEND`                                                 |
| Commit gesture            | Return key in the Magic Bar, or the preview card's main button                     |
| Finding the target        | Server shortlists the user's open items by title; Jev picks one or "none"          |
| Apply and undo            | Server-side, in single transactions, with a before-snapshot in the log             |

## 1. Contract and decision engine

### `@nexui/types`

`intentSchema` gains `COMPLETE`, `RESCHEDULE` and `APPEND`.

```ts
itemRefSchema = z.object({
  kind: itemKindSchema,            // 'task' | 'event' | 'note'
  id: z.uuid(),
  title: z.string(),
  when: localDateTimeSchema.nullable(), // due date for tasks, start for events, null for notes
});

// Added to intentActionSchema:
{ kind: 'COMPLETE',   target: ItemRef | null, alternatives: ItemRef[] (max 5) }
{ kind: 'RESCHEDULE', target: ItemRef | null, alternatives: ItemRef[] (max 5), to: LocalDateTime | null }
{ kind: 'APPEND',     target: ItemRef | null, alternatives: ItemRef[] (max 5), text: string (1–2000) }
```

`target` and `alternatives` together describe the match:

- **One match:** `target` set, `alternatives` empty.
- **Ambiguous:** `target` null, `alternatives` holds 2–5 items for the picker.
- **No match:** both empty.

Allowed target kinds: `COMPLETE` any kind; `RESCHEDULE` task or event; `APPEND` note. Only items without `completed_at` are candidates.

`canCommit(decision): boolean` lives in `@nexui/types` so the API tests and mobile share it. It is true only when all of these hold:

- `decision.confidence >= HIGH_CONFIDENCE` (0.85; the constant moves from mobile `intent-confidence.ts` to `@nexui/types`, and mobile imports it).
- The action exists and is one of the CREATE_* kinds with a non-empty title, or a change kind with a `target`.
- `RESCHEDULE` has `to`; `APPEND` has non-empty `text`.

SEARCH and UNKNOWN never commit.

### Finding the target phrase

New `apps/api/src/lib/decision-engine/target-phrases.ts`: `findTargetPhrase(text) → { intent, phrase, rest } | null`. A few patterns:

- COMPLETE: "done with X", "finished X", "mark X (as) done/complete", "X is done".
- RESCHEDULE: "push/move/reschedule/shift X to <when>".
- APPEND: "add '<Y>' to X (notes|note)", "append <Y> to X".

Leading articles and "my" are stripped from the phrase. Text that matches no pattern never triggers a database lookup.

### Engine

`DecisionEngine.classifyIntent(input, lookup)`, where `lookup: TargetLookup = { findTargets(phrase: string, kinds: ItemKind[]): Promise<ItemRef[]> }`. The route supplies it; tests pass a fixture lookup.

- When `findTargetPhrase` matches, the engine calls `findTargets` once with the kinds allowed for that intent.
- **Jev:** the three new intents join the intent criteria. The shortlist becomes one more choice question (same shape as the span questions) with a "none" option. A pick below `FIELD_CONFIDENCE` (0.5) is treated as ambiguous: `target` null, `alternatives` = the shortlist. A lookup with one result still goes through the question, so "none" can reject a bad match.
- **Mock:** picks the target only when exactly one shortlisted title contains the phrase (case-insensitive). Two or more gives ambiguous; zero gives no match.
- **`RESCHEDULE.to`** comes from the existing `when` candidate parser. A time with no date keeps the target's current date; a date with no time keeps the target's current time. When the target isn't chosen yet (ambiguous), `to` is computed per alternative on the phone when the user picks (the phone has the alternative's `when`); the shared helper `resolveRescheduleTo(parsed, current)` lives in `@nexui/types` for both sides. The parsed value is sent as `toParsed: { date: string | null, time: string | null } | null` on the action so the phone can resolve it.
- **`APPEND.text`** is the quoted or leading span Y, copied from the input.

The action schema therefore carries `toParsed` on `RESCHEDULE` alongside `to`.

### Evals

Add fixtures to `evals/intent-fixtures.json` for each new intent, including an ambiguous and a no-match case. The eval runner gets a fixture list of saved items to use as its lookup.

## 2. Database and API

### Migration `supabase/migrations/<ts>_intent_actions.sql`

`intent_events` columns:

- `via text null check (via in ('instant', 'form'))`, required when outcome is `confirmed`.
- `before jsonb null`: the columns a change overwrote.
- `after_updated_at timestamptz null`: the item's `updated_at` right after the change or insert.
- `undone_at timestamptz null`.

Checks and permissions:

- The confirmed-action check (and `record_intent`'s validation) accepts `COMPLETE`, `RESCHEDULE` and `APPEND`.
- `grant update (undone_at) on public.intent_events to authenticated`, with an owner-only update policy. Every other column stays append-only.
- `grant delete` on `tasks`, `events` and `notes`, with owner-only delete policies (`user_id = (select auth.uid())`).

`record_intent(..., input_via text)` adds three branches, each in the same transaction as the log row:

- `COMPLETE`: `update ... set completed_at = now() where id = target and completed_at is null`.
- `RESCHEDULE`: tasks set `due_date`/`due_time`; events set `start_date`/`start_time`.
- `APPEND`: notes set `body = coalesce(body || E'\n', '') || text`.

Each saves the overwritten columns in `before` and the new `updated_at` in `after_updated_at`; the log row's `task_id`/`event_id`/`note_id` points at the target. CREATE_* branches also set `after_updated_at`. If the update touches no row (wrong kind, another user's item, already complete, missing), the function raises `NXU01`, which the API maps to 409.

New `undo_intent(input_event_id uuid) returns jsonb`, `security invoker`, `set search_path = ''`:

1. `select ... for update` the log row (RLS limits it to the owner). Missing → raise `NXU04` (404).
2. Refuse with `NXU09` and a reason when: outcome isn't `confirmed`, the action is SEARCH, `undone_at` is set, `created_at < now() - interval '60 seconds'`, or the item's `updated_at` no longer equals `after_updated_at`.
3. CREATE_*: delete the item. Change kinds: restore `before`.
4. Set `undone_at = now()`. Return the item as the timeline `item` JSON, or null when deleted.

### API

- `POST /api/intent`: builds a `TargetLookup` from `getUserClient(accessToken)` and passes it to the engine. New `apps/api/src/lib/records/targets.ts`: an `ilike` title search (LIKE-escaped, as in `searchItems`) over open items of the allowed kinds, ordered by closest date then newest, capped at 5.
- `POST /api/intent-events`: accepts the new actions and a required `via` when outcome is `confirmed`. Response becomes `{ eventId: string, item: SavedItem | null }`. `NXU01` → 409 `That item changed; try again.`
- `POST /api/intent-events/[id]/undo` (new): response `{ item: SavedItem | null }`. `NXU04` → 404 `Not found`. `NXU09` → 409 with one of `Too late to undo`, `Item was edited, so undo was skipped`, `Already undone`, `Nothing to undo`.

### Tests

- Route tests for each new branch and every undo refusal, stubbing Supabase at the network boundary as today.
- Engine tests: `findTargetPhrase` patterns, mock target resolution (one, ambiguous, none), `resolveRescheduleTo`, `canCommit`.
- `supabase/tests/rls-smoke.sql`: user B can't undo A's event, delete A's items, or change a column of A's log row; B can't set any log column other than `undone_at`.

## 3. Mobile

### Preview card (`intent-previews.tsx`)

- When `canCommit(decision)` is true, the main button's label says what will happen: "Add task", "Add event", "Save note", "Mark 'Report' done", "Move Dentist to Fri 4:00 PM", "Add to Trip notes". The labels come from `lib/commit-label.ts`.
- A smaller **Edit** button opens the form: `DraftSheet` for CREATE_*, a date/time-only form for `RESCHEDULE`, a text-only form for `APPEND`. `COMPLETE` has no Edit. Form confirms send `via: 'form'`; closing without confirming logs `dismissed` as today.
- When `canCommit` is false, the button is **Continue** and opens the form, as today.
- **Ambiguous:** "Which one?" with up to five rows (title and date). Tapping one sets the target (and resolves `to` for RESCHEDULE) and commits instantly with Undo.
- **No match:** "No open item matches '<phrase>'" with **Create task "<phrase>"**, which opens `DraftSheet` prefilled.
- SEARCH is unchanged.

### Return key (`magic-bar.tsx`)

Return skips the debounce and requests a prediction at once. A helper `lib/submit-decision.ts` decides, given the latest decision and whether it matches the current text:

- A prediction for the current text is loading → wait for it, then decide.
- `canCommit` → commit instantly.
- Otherwise, a decision with an action → open the form.
- `UNKNOWN` or no action → do nothing.

A decision for older text is never committed.

### Commit flow (`app/(app)/index.tsx`)

Screen code, no generic wrapper. `useMutation(recordIntentEvent)` with `via: 'instant'`. While pending, the card shows a spinner and further presses are ignored. On success: clear the bar, invalidate `['timeline']`, show the Undo card. On failure: keep the text and show the error on the card (409 shows the server message).

### Undo card (`components/undo-toast.tsx`, `stores/undo-store.ts`)

- The Zustand store holds `{ eventId, message, shownAt } | null`. The card sits above the bar with the message ("Added: Call mom · Tomorrow", "Moved Dentist to Fri 4:00 PM") and **Undo**.
- It hides after 8 seconds; a newer commit replaces it.
- Undo runs `undoIntentEvent(eventId)`, invalidates `['timeline']`, then shows "Undone" for about 1.5 seconds. A 409 shows the server's message instead.
- The store is cleared on sign-out, next to `queryClient.clear()`.
- The message is announced to screen readers; Undo has at least a 44pt touch target.

### `lib/api.ts`

`recordIntentEvent` returns `{ eventId, item }`. New `undoIntentEvent(id)`. Both parse responses with the shared schemas.

### Tests

- Node tests for `canCommit`, `resolveRescheduleTo`, `commit-label` and `submit-decision`.
- Expo smoke test:
  - "call mom tomorrow" → return → Undo.
  - "done with call mom" → Undo.
  - "push dentist to friday 4" with two dentist items → pick one.
  - "add 'bring charger' to trip notes".
  - Edit an item within 8 seconds of an instant change, then Undo → "Item was edited, so undo was skipped".
  - The same flows in the web preview with the return key.

## Docs

`docs-keeper` updates `docs/architecture/persistence.md` (undo, the new columns and grants) and adds the intent flow for change intents; `add-intent` skill and `AGENTS.md` if the file count changes; README phrase table.
