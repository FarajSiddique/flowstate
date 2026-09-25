# Nexui anchored intelligence: product roadmap

**Status:** proposal for review, 2026-09-24. No code yet. Builds on the approved
[intent actions design](../superpowers/specs/2026-09-24-intent-actions-design.md) (instant saves
with Undo, `COMPLETE` / `RESCHEDULE` / `APPEND`) and replaces the ordering in the
[living interface ideas](living-interface.md) backlog.

> **Nexui adapts relevance, not geography.** Static shell. Adaptive content. Deterministic actions.

The thesis this roadmap exists to test:

> Can Nexui reduce the distance between user intent and completed action while remaining
> predictable and trustworthy?

## 1. Where the app is today

The roadmap assumes more than the app has. These gaps set the order of the work.

| Area          | Today                                                                                 | Gap for this roadmap                                                                                           |
| ------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Layout        | One `Stack` screen: brand row, Magic Bar at the top, draft preview, "Your items" list | No tabs, no destinations, no zones. The shell has to be built before it can be kept stable.                    |
| Intents       | `CREATE_TASK`, `CREATE_EVENT`, `CREATE_NOTE`, `SEARCH`, `UNKNOWN`                     | Change intents are designed but not built. No `OPEN_ITEM`, reminders or time blocking.                         |
| Confirmation  | Preview card, then `DraftSheet` for every draft                                       | Instant saves with Undo are designed. There's no "destination" concept yet.                                    |
| Highlighter   | Source spans marked in the Magic Bar (`highlight-segments.ts`)                        | No rationale for anything the app shows unprompted.                                                            |
| Memory        | `intent_events` logs every confirmed or dismissed draft, with raw text                | No record of opens, views, suggestion outcomes or pins. No retention window.                                   |
| Time          | Wall-clock `date` + `time` + IANA `time_zone`                                         | "Starts in 10 min" can be computed in SQL. Push reminders need a stored instant.                               |
| People        | `attendees text[]` on events, `person` entity in decisions                            | No people list, so "Follow up with Sarah" has nothing to resolve against.                                      |
| External data | None (Google is used only for sign-in)                                                | Free/busy, meeting links and email all need integrations. Until then, reasons like "Free at 2 PM" can mislead. |
| Measurement   | None beyond `intent_events`                                                           | Nothing to validate the thesis with.                                                                           |

## 2. The three layers

### Layer 1: fixed shell

Never moved, hidden, reordered or relabelled by AI.

- Bottom tabs: **Home · Tasks · Calendar · Notes**.
- The Magic Bar, docked above the tab bar on every tab. The keyboard lifts it and nothing else moves.
- Profile/settings, top right of Home.
- Screen hierarchy: each tab is a plain list of the user's items, ordered by rules the user can
  predict (time or last update), and each list can be filtered.

**Recommendation: no "+" tab.** A "+" next to the Magic Bar gives two ways to create, one with
AI and one without, side by side. Instead, focusing an empty Magic Bar shows three fixed
chips: **Task · Event · Note**. Each opens a blank form. The manual path stays one tap away
and sits where the user already looks to create something.

### Layer 2: adaptive zones

A zone has a fixed position, a fixed container style and a minimum height. Its contents
can change, but whether it exists never does.

```text
┌──────────────────────────────────────┐
│ nexui                      [Profile] │  fixed
│ Thursday · Good morning               │  fixed, one line
├──────────────────────────────────────┤
│ ┌──────────────────────────────────┐ │
│ │ FOCUS                            │ │  adaptive: 1 item or quiet state
│ │ Resume Architecture notes      → │ │
│ │ ▌Opened twice today              │ │  ← highlighter reason
│ └──────────────────────────────────┘ │
│ COMING UP                            │  rule-based: next 3 by time
│  10:30  Team sync                    │
│  Due    Send invoice                 │
│ SUGGESTED                            │  adaptive: 0–3 items, quiet row if 0
│  Capture notes from Design review    │
│  ▌Ended 20 min ago                   │
│ PINNED & RECENT                      │  pins first, then pure recency
│  ★ Product roadmap                   │
│  Architecture notes                  │
├──────────────────────────────────────┤
│ ✦ [ What do you want to do?        ] │  fixed Magic Bar
├──────────────────────────────────────┤
│  Home    Tasks    Calendar    Notes  │  fixed tabs
└──────────────────────────────────────┘
```

| Zone            | Who fills it                       | Size | When it's empty                                                          |
| --------------- | ---------------------------------- | ---- | ------------------------------------------------------------------------ |
| Focus           | Ranked candidates (§5.2)           | 1    | Quiet state in the same slot: "Nothing pressing · Next: Team sync 10:30" |
| Coming Up       | **Rules only**: time order         | ≤ 3  | "Nothing scheduled today"                                                |
| Suggested       | Ranked drafts (§5.3)               | 0–3  | One quiet row: "No suggestions right now". The header stays.             |
| Pinned & Recent | **Rules only**: pins, then recency | ≤ 5  | Example Magic Bar phrases for new users                                  |

Coming Up and Recent don't use AI at all, and that's deliberate. Not every zone needs to
adapt, and zones that never change their order give the eye fixed places to land.

### Layer 3: intent surfaces

These are deterministic React Native flows: the preview card, `DraftSheet`, the reschedule
and append forms, search results, and the item editor. AI chooses which surface opens and
fills in its fields. React Native owns everything the user sees and every confirmation.

## 3. Cross-cutting rules

These apply to every feature below. When a feature seems to need an exception, reshape the
feature.

### 3.1 Language goes to the model; ranking uses rules

The LLM is used where the input is language: reading the Magic Bar, and later pulling
mentions out of notes. Home zones are ranked by a **deterministic scoring function** over
structured data (due dates, event times, opens, dismissals). It's cheaper, runs in
milliseconds, can be tested against fixtures, and every score can be explained. This fits
the existing rule that the model picks from server-found candidates and never writes values.

### 3.2 A suggestion is a prebuilt draft

Every suggestion (Focus or Suggested) is one of two things:

- an `IntentAction` built by the server, such as a `RESCHEDULE` for an overdue task or a `CREATE_NOTE` after a meeting;
- an `OPEN` of a saved item.

Accepting a suggestion goes through **the same preview card, `canCommit` check, instant save
with Undo, and `intent_events` row** as typed input, tagged `source: 'suggestion'`. That
gives one way to run actions, one confirmation model and one log. It also means suggestions
can only offer things the Magic Bar can already do, so they can't claim capabilities Nexui
doesn't have.

### 3.3 Reasons come from codes, not generated text

A reason is a typed code with parameters. The phone renders it from a fixed template, so a
rationale can't claim something the data doesn't show.

```ts
type SuggestionReason =
  | { code: 'STARTS_SOON'; minutes: number }
  | { code: 'ENDED_RECENTLY'; minutes: number }
  | { code: 'DUE_SOON'; due: LocalDateTime }
  | { code: 'OVERDUE'; days: number }
  | { code: 'OPENED_RECENTLY'; count: number } // "Opened twice today"
  | { code: 'MENTIONED'; person: string; on: string } // Phase 2
  | { code: 'USUAL_TIME'; dayPart: DayPart } // Phase 2, "Usually done in the morning"
  | { code: 'FREE_WINDOW'; start: string; minutes: number; source: 'nexui' | 'calendar' } // Phase 3
  | { code: 'PINNED' };
```

A unit test checks each reason against the fixture it was computed from. `FREE_WINDOW` is
only shown with `source: 'calendar'`. Before a calendar is connected, "Free at 2 PM" is
often wrong, and a wrong reason does more damage to trust than a missing suggestion.

### 3.4 Confidence and relevance

There are two separate scores. Neither is shown as a number.

| Score                               | Source           | High                                                              | Medium                                                               | Low                                                                                            |
| ----------------------------------- | ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Intent confidence** (typed input) | Model, 0–1       | ≥ 0.85 and `canCommit`: the main button saves instantly with Undo | 0.6–0.85: **Continue** opens the form, plus type-switch chips (§5.6) | < 0.6 or `UNKNOWN`: search results for the text, plus Task/Event/Note chips. Never a dead end. |
| **Relevance** (zones)               | Scoring function | Can take Focus. Shown as a full card with a reason                | Suggested only. Compact row, reason in muted style                   | Not shown. Focus falls back to its quiet state                                                 |

The thresholds match `HIGH_CONFIDENCE` and `MEDIUM_CONFIDENCE`, which move to `@nexui/types`
under the intent actions design.

### 3.5 Stability contract

Adaptive content can still churn. These limits keep it calm:

1. **Nothing reorders while the user is looking.** Zones recompute when the app comes to
   the foreground, when Home regains focus, on pull-to-refresh, and after the user's own
   commit or dismissal. A background refetch never swaps visible content.
2. **Hysteresis.** A new Focus candidate replaces the current one only if it scores at least
   20% higher, or if the current one is no longer valid (completed, event over).
   Time-critical items (an event starting in 15 minutes or less) always win.
3. **Suggestions have a minimum stay.** A suggestion stays until acted on, expired, or
   replaced on the next recompute. It never disappears mid-glance.
4. **Fixed heights.** Empty zones render their quiet state at the zone's minimum height, so
   sections below never jump.
5. **Parity with AI off.** Every zone has a deterministic fallback (Focus shows the next
   item, Suggested shows its quiet row). This is what the app shows when the API is
   unreachable, when the user turns suggestions off, and for new users.

### 3.6 Action risk tiers

These reconcile "the user confirms" with the approved instant-with-Undo design. The tier
decides how an action runs. Model confidence can only move an action to a _stricter_ path,
never a looser one.

| Tier | What                                     | Examples                                                                 | Execution                                                                                            |
| ---- | ---------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| 0    | Read or navigate                         | Search, open item, switch tab                                            | Immediate                                                                                            |
| 1    | Private, reversible, in Nexui            | Create, complete, reschedule, append                                     | Instant with Undo when `canCommit`; otherwise the form                                               |
| 2    | Visible outside Nexui or to other people | Write to Google Calendar, add attendees (sends invites), Apple Reminders | Always an explicit confirmation showing the destination and account; no instant path                 |
| 3    | Irreversible or communicative            | Delete, send an email or Slack message, decline a meeting                | Explicit confirmation, never one-tap from a suggestion, never instant. Nexui drafts; the user sends. |

### 3.7 Muscle-memory review checklist

Every feature spec and PR that touches Home or the Magic Bar answers these:

1. Do the tabs, the Magic Bar and every zone header stay exactly where they were?
2. Is every destination reachable in one tap from any tab, even if the AI is wrong?
3. Does AI only _promote_ items, never hide or remove them?
4. Is low confidence handled by showing less (a quieter UI or nothing)?
5. Is "show nothing" a tested outcome?
6. Does any reordering stay inside a zone?
7. Do pins beat ranking?
8. Do repeated dismissals reduce future suggestions of that kind?
9. Is every tier-2 and tier-3 action confirmed explicitly?
10. Could a daily user notice the change overnight without being told? If so, ship it behind a setting or a one-time notice.
11. Is every rationale produced by a reason code (§3.3)?
12. Does the zone work with AI off (§3.5.5)?

## 4. Feature index

| #   | Feature                               | Phase | Tier |
| --- | ------------------------------------- | ----- | ---- |
| 1   | Anchored shell                        | 1     | 0    |
| 2   | Adaptive Focus card                   | 1     | 0–1  |
| 3   | Suggested actions                     | 1     | 1    |
| 4   | Highlighter rationale and "Why this?" | 1     | –    |
| 5   | Pinned & Recent                       | 1     | 0    |
| 6   | Magic Bar expansion                   | 1 → 3 | 0–2  |
| 7   | Contextual confirmation               | 1 → 3 | 1–3  |
| 8   | User control                          | 1 → 2 | –    |
| 9   | Activity learning                     | 1 → 2 | –    |
| 10  | People and follow-ups (new)           | 2     | 1    |
| 11  | Integrations                          | 3 → 4 | 2–3  |
| 12  | Home modes (evaluated)                | 2     | –    |

## 5. Features

### 5.1 Anchored shell

- **Problem:** Everything lives on one scrolling screen. Adaptive content has no stable
  place, and when the AI misreads something the user has no destination to fall back on.
- **Story:** As a user, I find Tasks, Calendar and Notes in the same place every time, and I
  can type an intent from any of them.
- **Flow:** Four tabs. The Magic Bar is docked on every tab. On Tasks, Calendar or Notes, a
  `SEARCH` draft defaults its scope to that tab's kind and shows a scope chip ("in Notes")
  the user can clear. Focusing an empty bar shows Task/Event/Note chips and the last five
  inputs (kept on the device only).
- **Container:** the shell itself.
- **AI decides:** nothing.
- **AI doesn't decide:** tab order, tab visibility, labels, or where the bar sits.
- **Data:** the existing timeline endpoint with a `kind` filter. Tasks are grouped Overdue /
  Today / Upcoming / No date / Done. Calendar is an agenda list by day (no month grid in the
  MVP). Notes are ordered by last update.
- **Trust:** the manual path is always one tap away.
- **MVP:** Expo Router `Tabs`, reusing `TimelineRow`, `EditSheet` and the docked bar. Home
  shows the zones in their quiet or rules-only state.
- **Later:** a month grid, home-screen widgets, and a two-column iPad layout with the same
  hierarchy.
- **Complexity:** M. Docking the bar above the keyboard needs checking on Android and on web.
- **Dependencies:** none. It can land before or after the intent actions work.
- **Risks:** the docked bar covers list content, so lists need bottom padding. Two creation
  paths if a "+" tab is added later.
- **Metric:** taps from app open to the first committed action, and how often users open a
  tab within 60 seconds of an AI miss (fallback use).

### 5.2 Adaptive Focus card

- **Problem:** The most useful next step is usually obvious from the data, but the user has
  to scan lists to find it.
- **Story:** When I open Nexui, the top card is the one thing I most likely want next, and it
  tells me why in a few words.
- **Flow:** Tap the card to run its action (open the item, or a prebuilt draft through the
  preview card). The overflow menu offers "Not now" and "Why this?".
- **Container:** a fixed card under the greeting.
- **Focus kinds (bounded):**

  ```ts
  type FocusKind =
    | 'UPCOMING_EVENT' // starts within 60 min or is in progress
    | 'OVERDUE_TASK' // open task due before today → RESCHEDULE-to-today draft, or open it
    | 'DUE_SOON_TASK' // high priority, due today or tomorrow
    | 'CAPTURE_NOTES' // event ended in the last 2 h with no linked note → CREATE_NOTE draft
    | 'RESUME_ITEM' // note or task opened ≥ 2 times in 24 h and still open
    | 'PLAN_TOMORROW' // Phase 2: evening, and tomorrow has items or is empty
    | 'FOLLOW_UP' // Phase 2: needs people (§5.10)
    | 'NONE'; // the quiet state
  ```

- **AI decides:** which candidate ranks first (rules and scoring, §3.1), and whether
  anything clears the high-relevance bar.
- **AI doesn't decide:** the card's position or size, or any action outside §3.2.
- **Data:** open tasks with dates, events in the next 24 hours, `ITEM_OPENED` counts (§5.9),
  and dismissals.
- **Trust:** one reason code, in the highlighter style.
- **MVP:** `GET /api/home` returns `{ focus, comingUp, suggested, recent, generatedAt }`,
  computed on request from bounded, indexed queries. It doesn't scan the whole
  `timeline_items` union the way pagination does today. The first four kinds plus `NONE`.
  "Join meeting" becomes "Open event" until calendar integration provides meeting links.
- **Later:** `PLAN_TOMORROW` and `FOLLOW_UP`, per-user weights (§5.9), and a pinned Focus item.
- **Complexity:** M.
- **Dependencies:** the shell, and `ITEM_OPENED` logging for `RESUME_ITEM`.
- **Risks:** the same overdue task sitting in Focus for days feels like nagging. Cap it at
  two consecutive days per item, then demote it to Suggested. A card that flips on every
  visit feels random, which is why §3.5 matters.
- **Metric:** Focus accepted-and-completed within 24 hours, and the "Not now" rate.

### 5.3 Suggested actions

- **Problem:** Useful follow-on steps (notes after a meeting, rescheduling slipped tasks)
  get forgotten because nothing prompts them.
- **Story:** I see up to three small next steps, each with a reason. I can accept one in a
  tap or wave it away, and Nexui remembers that I did.
- **Flow:** Tapping a suggestion opens the preview card with the draft already filled in.
  When `canCommit` is true, one more tap saves it with Undo. Swiping or the overflow menu
  gives **Not now** (hidden for 24 hours) or **Show less like this** (§5.8).
- **Container:** the fixed Suggested section, with 0–3 rows and a quiet row when empty.
- **Suggestion kinds, MVP:** `RESCHEDULE_OVERDUE`, `CAPTURE_NOTES` (when Focus isn't
  already showing it), `RESUME_ITEM` (second place). **Later:** `PREP_FOR_EVENT` (an event
  tomorrow with attendees leads to a "Prep for X" task), `BREAK_DOWN_TASK` (rescheduled
  three or more times: "break it down or drop it?"; dropping is tier 3), and `FOLLOW_UP`.
- **AI decides:** which kinds qualify and their order. Never duplicates Focus.
- **AI doesn't decide:** anything that isn't an existing intent action, or anything outside
  Nexui before Phase 3.
- **Data:** as for Focus, plus a suggestion ledger (§5.9).
- **Trust:** one reason per row, and the draft shows exactly what will change.
- **MVP:** two or three kinds, rule-based expiry (`CAPTURE_NOTES` expires two hours after the event).
- **Later:** learned per-kind weights. Suggestions that come from Gmail or Slack (Phase 4) are drafts only.
- **Complexity:** M. Most of the work reuses the intent actions design.
- **Dependencies:** the intent actions design (the `RESCHEDULE` draft, instant saves with Undo) and §5.9 logging.
- **Risks:** too many cards, which is why the limit is 3 plus 1 Focus. Suggestions that restate what the user can already see.
- **Metric:** acceptance rate, accepted-then-undone rate, and the "Show less" rate per kind.

### 5.4 Highlighter rationale and "Why this?"

- **Problem:** Unprompted content without a reason feels arbitrary. Verbose explanations
  are noise.
- **Story:** Every adaptive item tells me in a few words why it's there. If I want more, one
  tap shows the full reason and the controls to change it.
- **Flow:** The row shows one highlighted reason. "Why this?" (overflow menu or long press)
  opens a small sheet with up to three reasons and the controls from §5.8. Explanation and
  control live in one place.
- **Visual language:** the highlighter means one thing everywhere: _Nexui read this from
  your data_. In the Magic Bar it marks the spans it extracted. On a card it marks the
  reason. Nothing else on screen uses the highlighter style.
- **AI decides:** which reason codes apply.
- **AI doesn't decide:** the wording (a fixed template per code), or whether to show
  confidence numbers (never, except in a debug build).
- **Accessibility:** the highlight isn't carried by color alone (it also has a bar or
  underline). Screen readers read "Reason: due tomorrow".
- **MVP:** reason codes for the Focus and Suggested MVP kinds, plus the sheet.
- **Later:** "Because you usually…" reasons once learning ships, with a link to "What Nexui learned" (§5.9).
- **Complexity:** L.
- **Dependencies:** §3.3.
- **Risks:** reasons that are technically true but useless ("Created 3 days ago"). Only
  codes tied to urgency, context or behavior are allowed.
- **Metric:** "Why this?" open rate (high means the reason isn't clear enough), and trust
  questions in user interviews.

### 5.5 Pinned & Recent (reshaped from "Adaptive Recent")

- **Recommendation:** don't rank Recent by AI. A "Recent" list that isn't in recency order
  breaks the one expectation its label sets. Microsoft's adaptive menus in Office 2000 are
  the well-known cautionary example: they were removed after users couldn't find commands.
  Frequency and urgency already feed Focus (`RESUME_ITEM`) and Suggested, so Recent stays predictable.
- **Problem:** Getting back to what I was just working on takes a tab switch and a scroll.
- **Story:** My pinned items come first, then what I touched most recently, always in that order.
- **Flow:** Up to five rows: pins (★) first, then items opened, edited or created, newest
  first, with duplicates removed. Tapping a row opens the item.
- **Container:** the fixed Pinned & Recent section.
- **AI decides:** nothing.
- **Data:** `ITEM_OPENED` and `updated_at`, and the pins table.
- **MVP:** items only. Recent searches live in the Magic Bar's focused state (§5.1), not here.
- **Later:** a "See all" link to a filtered list.
- **Complexity:** L.
- **Dependencies:** §5.9 logging and §5.8 pins.
- **Metric:** share of opens that come from Pinned & Recent, compared with opens from a tab.

### 5.6 Magic Bar expansion

The Magic Bar should become more capable without becoming a chatbot. Every new capability
maps to an intent surface that already exists, or to one new deterministic surface. Prefer
new entities on an existing intent over a new intent, because fewer intents keep the
classifier accurate.

| Input                                                 | Maps to                                                                                                                                                                 | Phase |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Nexui misread the input                               | **Type-switch chips** at medium confidence: Task · Event · Note, with the predicted type selected. Switching re-maps the title and date without asking the model again. | 1     |
| Nexui has no idea                                     | **No dead end:** search results for the text, plus "Save as note", plus Task/Event/Note chips                                                                           | 1     |
| "done with the report", "move my workout to tomorrow" | `COMPLETE` / `RESCHEDULE` (intent actions design)                                                                                                                       | 0     |
| "open trip notes"                                     | `OPEN_ITEM`, tier 0, reusing the target lookup                                                                                                                          | 1     |
| "what's on tomorrow"                                  | `SEARCH` with `range`, shown as a results list. A question gets a list, never a prose answer.                                                                           | 1     |
| "show me everything related to architecture"          | `SEARCH`: full-text in Phase 1, meaning-based (pgvector) in Phase 2, results grouped by kind                                                                            | 1 → 2 |
| "follow up with Sarah next Friday"                    | `CREATE_TASK` with a `person` entity. Not a new intent. The person resolves against §5.10.                                                                              | 1 → 2 |
| "remind me at 5 to call mom"                          | `CREATE_REMINDER`. Needs a stored instant and push notifications.                                                                                                       | 2     |
| "block two hours tomorrow for deep work"              | `CREATE_EVENT` with a duration and a day but no start. The card offers 2–3 slot chips from a deterministic free-slot finder. Only after a calendar is connected (§3.3). | 3     |
| "dinner Fri 7 and remind me Thu to book"              | Several actions confirmed as one plan (living interface idea 5)                                                                                                         | 4     |

The bar will **not** add: multi-turn chat, prose answers, summaries of your week written
into the bar, or any output that isn't a surface from Layer 3. Each new intent goes through
the `add-intent` skill and gets eval fixtures.

- **Metric:** Magic Bar completion rate, the unknown-intent rate, and how often type-switch chips are used.

### 5.7 Contextual confirmation

- **Problem:** The user can't trust a save when they can't see what Nexui understood or where the result will go.
- **Flow:** the preview card and form show, in this order:

  ```text
  YOU SAID      "follow up with ▌Sarah▐ ▌next Friday▐"   (highlighted spans)
  ACTION        Create task
  PERSON        Sarah
  DATE          Fri, Oct 2
  → Nexui Tasks                                           (destination, small)
  [ Add task ]  Edit
  ```

  The main button's label names the action ("Add task", "Move Dentist to Fri 4:00 PM"), as
  in the intent actions design.

- **Destination:** a one-line footer in Phase 1, when Nexui is the only destination.
  In Phase 3 it becomes a picker that defaults to a per-kind setting ("Events go to:
  Google Calendar · work@…"). It shows the account and, for tier 2, who else will see the
  item ("Sends an invite to Sarah").
- **AI decides:** the intent and the entities.
- **AI doesn't decide:** the destination (a user setting), the tier (§3.6), or whether to
  skip confirmation for tier 2 or 3.
- **MVP:** the spec above on the existing preview card, plus the destination footer.
- **Later:** the destination picker, and a tier-2 confirmation that lists side effects.
- **Complexity:** L now, M in Phase 3.
- **Dependencies:** intent actions design (labels), §5.11.
- **Risks:** the card grows into a form. Show only the fields that are set, and put the rest behind Edit.
- **Metric:** correction rate (fields edited before confirming) and the undo rate for instant saves.

### 5.8 User control

A minimal model with four controls:

| Control                  | Where                                       | Effect                                                                                                                                                   |
| ------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Not now**              | Focus and Suggested overflow menu, or swipe | Hides this suggestion for 24 hours                                                                                                                       |
| **Show less like this**  | "Why this?" sheet                           | Halves the weight of this suggestion kind. The third use in 14 days mutes the kind for 14 days, with a one-time "Muted overdue reminders · Undo" notice. |
| **Pin to Home**          | Item overflow menu or editor                | Adds the item to the top of Pinned & Recent (max 3). "Always show this here" means exactly this.                                                         |
| **Suggestions settings** | Profile → Suggestions                       | A toggle per kind, "Turn off suggestions" (zones fall back to §3.5.5), and "Reset what Nexui learned"                                                    |

Pins attach to _items_, not suggestions. A suggestion is short-lived by design, so pinning one makes no sense.

- **MVP:** Not now, and pinning items. **Phase 2:** Show less, the settings page, reset.
- **Metric:** share of opens from pins compared with adaptive zones, and how many users turn off suggestions.

### 5.9 Activity learning

- **Problem:** Ranking can't improve without knowing what was useful. Collecting behavior
  data out of sight erodes trust.
- **Events (bounded):**

  ```ts
  type ActivityType =
    | 'ITEM_OPENED'
    | 'ITEM_EDITED'
    | 'ITEM_COMPLETED'
    | 'SUGGESTION_SHOWN'
    | 'SUGGESTION_ACCEPTED'
    | 'SUGGESTION_DISMISSED' // + { how: 'not_now' | 'show_less' }
    | 'SUGGESTION_EXPIRED'
    | 'TAB_OPENED'
    | 'UNDO';
  ```

  Magic Bar input and searches are already logged in `intent_events`, so they aren't
  duplicated here.

- **Storage:** an `activity_events` table with IDs and codes only: no titles, no raw text.
  Owner-only RLS as in `persistence.md`. A 90-day rolling retention window. Decide on a
  matching window for the raw text in `intent_events` at the same time.
- **Learning, Phase 1:** counters only (opens in 24 hours, dismissals per kind).
- **Learning, Phase 2:** per-kind acceptance rates (a smoothed ratio, not a model), time of
  day per kind (`USUAL_TIME`), and per-user field defaults (living interface idea 2). Every
  learned rule can be shown in a sentence.
- **Transparency:** a "What Nexui learned" screen lists each learned rule in plain language
  ("You usually plan in the evening", "Overdue reminders are muted"). Each rule can be removed.
- **Guardrails:** rank for _accepted and completed_, never for taps or time in the app. No
  streaks, no guilt-trip copy, no notifications driven by suggestions (§6).
- **Complexity:** M.
- **Dependencies:** none for logging.
- **Risks:** privacy (keep it IDs-only and owner-scoped, and have `security-reviewer` check it), and learning from noise too early.
- **Metric:** acceptance rate trends upward per user over four weeks while the dismissal rate stays flat.

### 5.10 People and follow-ups (new)

- **Problem:** "Follow up with Sarah" and "Mentioned yesterday" need Nexui to know who Sarah
  is. Today a name is just a string.
- **Story:** When I mention someone I've met or talked about before, Nexui knows it's the
  same person and can remind me to follow up.
- **Flow:** Nexui builds a private `people` list from event attendees and the `person`
  entities of confirmed drafts. The Magic Bar uses it as personal candidates (living
  interface idea 1: "coffee w/ sam" becomes _Sam Rivera_). A `FOLLOW_UP` suggestion appears
  when an event with attendee X ended yesterday and no task or note mentioning X exists since.
- **AI decides:** whether a name in the text matches a known person (picked from
  candidates, never generated).
- **AI doesn't decide:** merging two people (the user does that), or contacting anyone (tier 3).
- **Data:** a `people(user_id, display_name, aliases[], source)` table. Contacts join in Phase 3.
- **MVP:** names only, built from Nexui's own data, used for candidates and `FOLLOW_UP`.
- **Complexity:** M.
- **Dependencies:** §5.9, intent actions design.
- **Risks:** two Sarahs. When a match is ambiguous, use the picker from the intent actions design.
- **Metric:** follow-up suggestion acceptance, and correction rate on the `person` field.

### 5.11 Integrations

Principle: **Nexui orchestrates existing tools rather than replacing them.** It reads
enough to rank and resolve, writes only through tier-2 or tier-3 confirmation, and keeps
the learning itself.

| Category                                | Reads                                                    | Writes                                  | Permission                                                                                                                                                                                                                                                       | Confirmation                                                                   | Stays in Nexui                                                                                                           |
| --------------------------------------- | -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| **Google Calendar**, Phase 3 first      | Events and free/busy for the next 14 days; meeting links | Create/move events on a chosen calendar | `calendar.events` is a sensitive scope and needs Google app verification. That needs a verified domain and privacy policy, and Nexui has no domain yet. Background reads need offline access (a server auth code), not just the ID token used for sign-in today. | Tier 2: destination, account, and "Sends invites to…" when there are attendees | Ranking, reasons, the intent log. Cached event IDs, titles and times with a short TTL.                                   |
| **Apple Calendar / Reminders**, Phase 3 | EventKit, **on the device only**                         | Create/complete through EventKit        | iOS permission prompts; a native module (development build, not Expo Go)                                                                                                                                                                                         | Tier 2                                                                         | The server never sees this data. The phone computes free/busy and sends only the slots or candidates each request needs. |
| **Contacts**, Phase 3                   | Names and aliases, on the device                         | None                                    | iOS/Android contacts prompt                                                                                                                                                                                                                                      | –                                                                              | Matching happens against §5.10. Contacts aren't uploaded.                                                                |
| **Gmail**, Phase 4                      | Metadata for threads waiting on the user's reply         | **Drafts only**                         | Read scopes are _restricted_: verification plus an annual third-party security assessment                                                                                                                                                                        | Tier 3. Nexui creates the draft; the user sends it from Gmail                  | "Waiting on you" signals only, not message bodies                                                                        |
| **Slack**, Phase 4                      | Direct messages and mentions waiting on a reply          | Draft or scheduled message              | Slack app OAuth, user token                                                                                                                                                                                                                                      | Tier 3, never auto-sent                                                        | The same "waiting on you" signals                                                                                        |
| **Notes apps**                          | –                                                        | –                                       | Apple Notes has no public API. Notion or Google Docs only if users ask                                                                                                                                                                                           | –                                                                              | Nexui notes stay the default                                                                                             |

Implications:

- **Write through, read on demand.** Avoid full two-way sync in Phase 3. It causes conflicts.
- **A destination is set once per kind** in settings, and the confirmation card shows it.
- **Store external OAuth tokens encrypted on the server.** They never reach the phone or a public env var.
- The Google domain requirement blocks Phase 3. Buy the domain and publish a privacy policy
  during Phase 2 so verification doesn't stall the roadmap.

### 5.12 Home modes (evaluated)

**Recommendation: no named modes (MORNING, WORK, WIND_DOWN…) in the product.**

- A visible mode switch is the "different app overnight" problem in miniature.
- Inferred labels are often wrong (night shifts, weekends, travel), and a wrong label reads as the app judging the user.
- Everything a mode would do is covered by continuous features in the scoring function:
  local hour, day of week, minutes to the next event, and the user's own history.

**What to build instead (Phase 2):** user-declared **Work hours** and **Quiet hours** in
settings. They're explicit, never inferred. They bias ranking (work items rank higher during
work hours) and silence suggestions during quiet hours. If time of day ever appears in the
UI, it appears only as a reason ("Evening · plan tomorrow").

## 6. Rejected and reshaped ideas

| Idea                                                      | Problem                                        | Verdict                                                                                             |
| --------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| One timeline instead of screens (living interface idea 8) | Morphs the layout; removes destinations        | **Reshaped:** tabs stay. Filter-as-you-type lives in search results and in the tab scope chip.      |
| AI-ranked Recent                                          | Unstable navigation                            | **Reshaped** into Pinned & Recent (§5.5)                                                            |
| Visible named Home modes                                  | Over-personalization; the app changes identity | **Rejected**, replaced by declared work and quiet hours (§5.12)                                     |
| Rationales written by the LLM                             | Too much explanation; can be untrue            | **Rejected**, replaced by reason codes (§3.3)                                                       |
| Instant saves to external tools                           | Autonomous execution                           | **Rejected**: tier 2 and above always confirm (§3.6)                                                |
| Auto-sent follow-ups, email or Slack replies              | Autonomous and communicative                   | **Rejected**: Nexui drafts, the user sends                                                          |
| Push notifications for AI suggestions (Phases 1–2)        | Interruption without clear value               | **Deferred.** Push only for reminders the user asked for, and for "starts in 10 min" once opted in. |
| Re-ranking zones live while visible                       | Instability                                    | **Rejected** (§3.5)                                                                                 |
| Answering questions in prose in the Magic Bar             | Chatbot-first                                  | **Rejected**: questions map to search or ranges (§5.6)                                              |
| "Free at 2 PM" before a calendar is connected             | A reason that's often wrong                    | **Deferred** to Phase 3 (§3.3)                                                                      |
| More Home zones (weather, habits, stats)                  | Too many cards; novelty                        | **Rejected** until a metric shows the need                                                          |

## 7. Prioritization

H/M/L. For complexity, trust risk and dependency burden, lower is better.

| Feature                                    | User value    | Differentiation | Complexity | Trust risk | Dependency burden        | Tests the thesis | Priority                        |
| ------------------------------------------ | ------------- | --------------- | ---------- | ---------- | ------------------------ | ---------------- | ------------------------------- |
| 1 Anchored shell                           | H             | L               | M          | L          | L                        | M                | **P1**, enables everything else |
| 6a Type-switch chips, no dead ends         | H             | M               | L          | L          | L                        | H                | **P1**                          |
| 7 Confirmation spec and tiers              | H             | M               | L          | Lowers it  | L                        | H                | **P1**                          |
| 2 Focus card (rules)                       | H             | H               | M          | M          | L                        | H                | **P1**                          |
| 3 Suggested (rules)                        | H             | H               | M          | M          | M                        | H                | **P1**                          |
| 4 Rationale and "Why this?"                | M             | H               | L          | Lowers it  | L                        | H                | **P1**                          |
| 9a Activity logging, metrics views         | L (for users) | –               | M          | M          | L                        | H                | **P1**                          |
| 5 Pinned & Recent                          | M             | L               | L          | L          | L                        | L                | P1 (cheap)                      |
| 8 Controls (full set)                      | M             | M               | L          | Lowers it  | L                        | M                | P2                              |
| 9b Learning                                | M             | M               | M          | M–H        | M                        | M                | P2                              |
| 10 People and follow-ups                   | M             | M               | M          | M          | M                        | M                | P2                              |
| 6b Reminders, `OPEN_ITEM`, semantic search | M             | M               | M          | L          | M                        | M                | P2                              |
| 12 Declared work and quiet hours           | L             | L               | L          | L          | L                        | L                | P2                              |
| 11 Google / Apple calendar                 | H             | M               | H          | H          | H (verification, domain) | M                | P3                              |
| 11 Gmail / Slack                           | M             | H               | H          | H          | H (security assessment)  | L                | P4                              |

## 8. Phased roadmap

**Phase 0: in flight.** The [intent actions design](../superpowers/specs/2026-09-24-intent-actions-design.md):
instant saves with Undo, and `COMPLETE`, `RESCHEDULE`, `APPEND`. Suggested actions reuse all of it.

**Phase 1: core anchored intelligence.** Can the app act first without feeling unstable?

- The shell (§5.1) with the Task/Event/Note chips on the focused bar.
- `GET /api/home` with rule-based Focus, Coming Up, Suggested and Pinned & Recent, the stability contract, and quiet states.
- Reason codes and the "Why this?" sheet. "Not now" and pins.
- Type-switch chips, the no-dead-end fallback, `OPEN_ITEM`, and the destination footer.
- `activity_events` and the SQL views behind the §9 metrics.
- _Why here:_ it's all built from Nexui's own data, with no external permissions, and every piece produces a thesis metric.

**Phase 2: personalization and learning.** Does it get better the more I use it?

- Show less, the settings page, reset, and "What Nexui learned".
- Per-kind weights, `USUAL_TIME`, per-user field defaults, and learning from corrections.
- People and follow-ups, `PLAN_TOMORROW`, `CREATE_REMINDER` with a stored instant and opt-in push, meaning-based search.
- Declared work and quiet hours. Buy a domain and publish a privacy policy (unblocks Phase 3).
- _Why here:_ learning needs Phase 1's logs and a few weeks of real use to learn from.

**Phase 3: connected ecosystem.** Can Nexui be right about my _whole_ day?

- Google Calendar read, then write. EventKit on iOS. Contacts on the device.
- The destination picker and tier-2 confirmation. `FREE_WINDOW` reasons and time-blocking.
- _Why here:_ high value but a heavy dependency burden (verification, native modules). It
  should strengthen a core loop that already works, not rescue one that doesn't.

**Phase 4: cross-app orchestration.** Can one sentence move work across tools?

- Gmail and Slack "waiting on you" suggestions, with tier-3 drafts.
- Several actions confirmed as one plan. Voice, share sheet, widgets and App Intents (living interface idea 9).
- _Why here:_ the highest trust risk and compliance cost. Worth it only after users trust tiers 1 and 2.

## 9. Success metrics

Compute from `intent_events` and `activity_events` with SQL views. No third-party analytics
SDK until one is needed. Targets are starting guesses to revisit after two weeks of data.

**Early validation (Phase 1). Watch these five:**

| Metric                           | Definition                                                                                                       | Starting target    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------ |
| **Intent-to-done time**          | Median from the first keystroke in the bar to a committed action. Needs `inputStartedAt` in the request context. | < 10 s for creates |
| **Magic Bar completion rate**    | Submitted inputs (return or card tap) that end in a committed, not-undone action                                 | > 70%              |
| **Trust errors**                 | Instant saves undone, plus drafts whose fields were edited before confirming                                     | Undo < 5%          |
| **Focus / Suggested usefulness** | Accepted, and the item completed or kept (not undone) within 24 hours, ÷ shown                                   | > 25% Focus        |
| **Weekly active days**           | Days with at least one committed action, per active user, weeks 2–4                                              | ≥ 3                |

**Guardrails:** the dismissal and "Show less" rate per kind, the unknown-intent rate, the
share of users who turn off suggestions, and **fallback use** (opening a tab within 60
seconds of an AI miss, which shows how often the AI was wrong and whether users recovered).

**Later:** pinned vs adaptive opens, and per-user acceptance trends (§5.9).

**Time saved vs navigating manually** is measured in moderated sessions, not telemetry:
five users, a script of ten tasks, compared with the phone's built-in Reminders and Calendar.

## 10. Recommended next three features

1. **Anchored shell and a rule-based Home** (§5.1, §5.2 MVP kinds, §5.5, §3.5), plus
   `ITEM_OPENED` logging. This is the frame every later feature needs. It also moves the
   bar to its permanent place before users build muscle memory around the current top-of-screen bar.
2. **Suggested actions as prebuilt drafts, with reason codes, "Why this?" and "Not now"**
   (§5.3, §5.4, §5.8 MVP). It's the first real test of whether the app can act first while
   staying predictable, and it reuses the Phase 0 save path.
3. **Type-switch chips and the no-dead-end fallback** (§5.6, Phase 1 rows), plus the
   metrics views (§9). This makes the core Magic Bar loop hard to fail and gives the
   numbers to decide on Phase 2.

## 11. Open questions

- Keep the "+" tab from the original sketch, or use the bar chips as recommended (§2)?
- Calendar tab: is an agenda list enough for the MVP, or is a week strip needed?
- Should the web preview get the tab shell, or stay a single screen for demos?
- Retention windows: 90 days for `activity_events` is proposed. What about raw text in `intent_events`?
- When should the domain be bought? It blocks Google verification in Phase 3.
