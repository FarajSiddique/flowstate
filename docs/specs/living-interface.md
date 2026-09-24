# Nexui living interface: feature ideas

**Status:** ideas for review, 2026-09-24. Nothing here is scheduled. Revisit after Supabase persistence (tables, reads, writes) lands.

> Nexui reimagines the mobile interface around human intent, using AI to surface the right action at the right moment—without making users navigate, prompt, or think like a computer.

## Context

Today Nexui turns one line of text into a draft task, event, note or search. The engine only gets `now` and `timeZone`, and nothing is saved. The mission is "the right action at the right moment, without navigating or prompting". To get there, the app needs memory, it needs to act before being asked, and it needs to shrink the steps between an intent and its result. These are ideas to think over, not an implementation plan. They are ordered by how much they depend on each other.

## Foundation: log every intent, not just the saved objects

Add an `intent_events` table alongside `tasks`, `events` and `notes`. Each row holds:

- the raw text
- the engine's response (intent, confidence, action)
- the action the user actually confirmed, or that they dismissed it
- a timestamp and context

Nearly every idea below reads from this log. It also gives you real-user eval fixtures for `evals/`.

## Ideas

### 1. Personal candidates ("it knows _your_ Sam")

`action-candidates.ts` already finds text spans and Jev only picks among them. Add candidates from the user's own data: people they've mentioned before, places they reuse, recurring titles. For example, "coffee w/ sam at the usual" resolves to _Sam Rivera_ at _Blue Bottle, Market St._ This fits the current rule that the model never writes values itself, so hallucination risk stays low.

### 2. Learn from corrections

Compare each predicted action with what the user confirmed. Some things to do with that difference:

- Learn defaults per user (e.g. "meetings are 30 min, not 60"; "'gym' is always 7am").
- Adjust confidence thresholds per user.
- Feed recurring misreads back into the Jev criteria.

Over time the confirmation sheet should show up less and less.

### 3. Commit first, undo later, when confidence is high

Above ~0.9 confidence, plus a track record of the user accepting that kind of action unchanged, skip the modal. Save straight away and show a card saying "Added: Dentist Thu 3pm · Undo". This does the most to meet "without making users think": the app stops asking for confirmation it doesn't need.

### 4. Intents that refer to existing items

New intents that act on saved items: `UPDATE`, `COMPLETE`, `RESCHEDULE`, `APPEND`. Examples: "push the dentist to Friday", "done with the report", "add 'bring charger' to trip notes". The candidates are the user's own saved items. SEARCH also becomes real at this point: Postgres full-text search, then pgvector for meaning-based recall ("that restaurant Ana mentioned"). Use the `add-intent` skill for each one.

### 5. Several actions from one sentence

"Dinner with Ana Fri 7, remind me Thu to book a table" produces an event plus a task linked to it. The response goes from one `action` to `actions[]`, and the sheet shows them as a small plan the user confirms in one go.

### 6. A home screen that suggests before you type

Replace the empty bar with 2–3 suggestions built from the log and the time of day:

- "Monday 9:05 → _Standup note?_"
- "Event ended 10 min ago → _Capture notes from Design review?_"
- "3 tasks overdue → _Reschedule to today?_"

Tapping a suggestion pre-fills the action. This does the most to make the app feel "alive".

### 7. Items that follow up on themselves

Saved items create their own next step:

- Before an event, suggest a prep task.
- After an event, suggest a note.
- A task that gets snoozed repeatedly asks "break this down or drop it?"
- A note that keeps growing suggests turning into a project.

Run these from a scheduled job (Vercel Cron or Supabase cron), and deliver them as push notifications or as suggestions on the home screen from idea 6.

### 8. One timeline instead of screens

Instead of Tasks, Calendar and Notes tabs, show a single time-ordered stream of past, now and upcoming items, grouped by what matters now. It still involves no navigating. The magic bar filters the stream as you type, so typing and searching become one action.

### 9. Input from anywhere

Let people capture intents without opening the app:

- Voice (speech-to-text feeding the same `/api/intent`)
- The iOS share sheet (a screenshot of a flyer becomes an event)
- A lock-screen or home widget
- A Siri Shortcut / App Intent

The engine stays the same; only the entry points change.

### 10. Sync both ways with where the user's data already lives

Google Calendar and Apple Reminders/Calendar, synced in both directions. This adds conflict detection ("you're at _Offsite_ then — pick 5pm instead?") and the chance to read what the user already has on day one, so the app is useful before they've typed much.

## Suggested order

Foundation → 3 (quick win, easy to feel) → 1 + 2 (personalization) → 4 (makes the saved data useful) → 6 + 7 (the app acts first) → 5, 8, 9, 10 when you want to grow.

## Validating a feature once it's picked up

- Add fixtures to `evals/intent-fixtures.json` and compare runs with `pnpm eval:intent --compare`.
- Run the matching reviewer agents: `api-reviewer`, `mobile-reviewer`, and `security-reviewer` for anything touching RLS or personal context sent to the model.
- Smoke-test the flow in Expo, and have `docs-keeper` update `docs/architecture/` once it ships.
