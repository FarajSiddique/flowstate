# Instant actions and Undo

A high-confidence draft saves itself: no form, no extra tap. This covers both new
items (`CREATE_TASK`, `CREATE_EVENT`, `CREATE_NOTE`) and changes to items the user
already saved (`COMPLETE`, `RESCHEDULE`, `APPEND`). See
[Persistence](persistence.md) for the database side (`record_intent`, `undo_intent`,
grants).

## Follow a commit

```text
Magic Bar (typing)
  → use-intent-prediction.ts (debounced POST /api/intent)
  → IntentPreview / ChangeCard (intent-previews.tsx)
  → return key or the card's main button
  → submit-decision.ts: canCommit(decision)?
      true  → commit at once
      false → open DraftSheet or ChangeSheet
  → POST /api/intent-events (via: 'instant' | 'form')
  → Undo card (undo-toast.tsx, use-undo-store.ts), 8 seconds
  → POST /api/intent-events/:id/undo
```

`canCommit` (`@nexui/types`) is true only above `HIGH_CONFIDENCE` (0.85) and only
when the action is complete: a non-empty title for a create, or a `target` for a
change (plus `to` for `RESCHEDULE`, non-empty `text` for `APPEND`). `SEARCH` never
commits. The same function backs the preview card's button label
(`lib/commit-label.ts`'s `commitLabel`) and the return key.

## Committing on Return

`use-intent-prediction.ts` debounces predictions by 250ms while typing. Return
skips the wait: `resolveNow()` returns the prediction already in flight or already
resolved for the current text, or starts one. A decision for text the user has since
changed is never committed. `submitStep()` (`lib/submit-decision.ts`) then decides:
commit, open the form, or do nothing. A change below the confidence threshold opens
the form (`ChangeSheet`) when it has a target; only a targetless change settles on
the card instead — see below.

On native, `TextInput`'s `submitBehavior="submit"` fires `onSubmitEditing` for
Return. React Native Web ignores `submitBehavior` for multiline inputs and only
calls `onSubmitEditing` when `blurOnSubmit || !multiline`, so the Magic Bar
(`apps/mobile/src/components/magic-bar.tsx`) also installs a web-only `onKeyPress`
handler that calls the same submit callback on a plain Enter and lets Shift+Enter
insert a newline as usual.

## Committing (`app/(app)/index.tsx`)

A single `useMutation(recordIntentEvent)` sends `via: 'instant'`. While it is
pending the card shows a spinner and ignores further presses. On success the app
clears the bar (only if the user hasn't typed something new meanwhile), invalidates
the `['timeline']` query, and shows the Undo card with a message from
`undoMessage()` (e.g. "Added: Call mom · Tomorrow", "Moved Dentist · Fri 4:00 PM").
On failure the text stays and the card shows the error, including the server's 409
message when the target changed underneath the action.

Confirming through `DraftSheet` or `ChangeSheet` sends `via: 'form'` instead;
closing either without confirming logs a `dismissed` event, as before.

## The Undo card

`stores/use-undo-store.ts` holds one `{ undo, message, shownAt } | null`. `undo` is
either `{ type: 'intent', eventId }` for a logged Magic Bar action or
`{ type: 'completion', task }` for a task completed from its checkbox (`null` for a
plain status line). `components/undo-toast.tsx` renders it above the Magic Bar and
announces the message for screen readers; the Undo button has a 44pt touch target.
The card hides after `UNDO_MS` (8 seconds); a newer commit or completion replaces it
outright. Pressing Undo calls `POST /api/intent-events/:id/undo` for a logged action,
or `PATCH /api/items/task/:id` with `{ completed: false }` to reopen a task; either
way it invalidates `['timeline']` and shows a status line ("Undone", or the server's
refusal message) for `STATUS_MS` (2.5 seconds). The store is cleared on sign-out,
next to `queryClient.clear()`.

## Completing a task from its checkbox

Only tasks have a checkbox (`components/timeline-row.tsx`); events and notes don't.
Tapping it skips the Magic Bar entirely: `useCompleteTask` (`lib/use-timeline.ts`)
removes the task from the cached timeline right away, sends
`PATCH /api/items/task/:id` with `{ completed: true }`, and on success shows the
Undo card via `showCompletionUndo`. A refetch already in flight is cancelled first
so it can't race the restored task back out after Undo. On failure the timeline
refetch brings the task back, and a status line explains the failure.

## Finding a change intent's target

The model never writes values into a change — it only points at items the server
already found:

```text
apps/api/src/lib/decision-engine/change-actions.ts: findChangeMatch(text)
  → { intent, phrase, toParsed, text } | null   (regex patterns per intent)
  → shortlistTargets(lookup, match)              (route's TargetLookup)
  → engine picks among the shortlist:
      Jev: a `target` choice question, "none" included; a pick below
           FIELD_CONFIDENCE (0.5) counts as ambiguous
      Mock: exactly one shortlisted title containing the phrase; 0 or 2+ is ambiguous
  → buildChangeAction(match, shortlist, choice, reference) → ChangeAction
      one match      → target set, alternatives empty
      ambiguous      → target null, alternatives holds the shortlist (≤5)
      no match       → both empty
```

`findChangeMatch` recognizes phrases like "done with X", "push X to <when>" and
"add 'Y' to X notes" before any lookup runs — text that matches nothing never
touches the database. The route builds the `TargetLookup` with
`apps/api/src/lib/records/targets.ts`'s `createTargetLookup`, an `ilike` search over
the signed-in user's open (`completed_at is null`) items of the kinds the intent
allows (`TARGET_KINDS`), ranked by closest date then most recently updated, capped
at 5.

On the card (`ChangeCard` in `intent-previews.tsx`), one match commits at once when
`canCommit(decision)` is true; below the threshold the button reads "Continue" and
opens `ChangeSheet` instead. Several matches show "Which one?" with up to five rows;
tapping one sets the target — `lib/change-actions.ts`'s `withTarget` also resolves
`RESCHEDULE`'s `to` against that item's own date/time — and commits at once, since
the spec allows a pick to commit regardless of confidence. No match offers "Create
task '<phrase>'", which opens `DraftSheet` prefilled with the phrase as a title.

## Tests

Node tests cover `canCommit`, `resolveRescheduleTo`, `commit-label` and
`submit-decision` (`tests/commit-flow.test.mjs`), `findChangeMatch` and
`buildChangeAction` (`tests/change-actions.test.mjs`), the target lookup
(`tests/records-targets.test.mjs`), and every `record_intent`/`undo_intent` branch
and refusal at the route level (`tests/intent-events-route.test.mjs`,
`tests/undo-route.test.mjs`). `supabase/tests/rls-smoke.sql` checks that one user
can't undo another's event, delete another's items, or write any `intent_events`
column but `undone_at`.

Smoke-test in Expo (native and the web preview, return key both places): "call mom
tomorrow" → return → Undo; "done with call mom" → Undo; "push dentist to friday 4"
with two dentist items → pick one; "add 'bring charger' to trip notes"; edit an item
within 8 seconds of an instant change, then Undo → "Item was edited, so undo was
skipped".
