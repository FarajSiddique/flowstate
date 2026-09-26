# Nexui anchored shell: implementation spec

Status: ready to build, 26 September 2026. This spec replaces the "Magic Bar docked on every
tab, no + tab" design in [anchored-intelligence.md](anchored-intelligence.md) §2 and §5.1, and
narrows §5.2 and §5.4 as described in [Changes to other specs](#changes-to-other-specs).

Visual reference: [mockups/anchored-shell.html](mockups/anchored-shell.html). Open it in a
browser; it is clickable. The mockup's text parsing and data are fake. Where the mockup and
this spec disagree, this spec wins.

## Goal

Move the app from one scrolling screen to a stable five-tab shell that feels alive without
moving under the user's thumb. The product promise stays the same: turn intent into action
with as little friction as possible.

Three ideas drive every decision here:

1. **Fixed places, changing contents.** Tabs, headers, the + button and each Home zone stay
   where they are. Only what is inside a zone changes, and never while the user is looking
   at it (anchored-intelligence §3.5).
2. **Nexui shows its reading.** Every draft shows which words Nexui read, what it did with
   them, and one plain sentence on why it picked that type. Values that came from a default
   say so.
3. **The data gives the screen its shape.** Events are blocks sized by their length, free
   time is visible, tasks are light lines, notes are cards. Liveliness comes from this and
   from motion that answers the user's actions, never from decoration.

## Decisions already made

These were settled with the owner. Don't reopen them in the implementation.

| Topic            | Decision                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tab order        | Home · Tasks · (+) · Calendar · Notes                                                                                                                                                                                               |
| Way in to create | The + tab is the only way into the Magic Bar. No tab has a docked bar. Home shows a hint row that opens the same + sheet.                                                                                                           |
| Saving           | Unchanged from Phase 0. At high confidence (`canCommit`), the draft card's main button and Return save at once and show Undo. Below that, the button is "Check details" and opens the form. Writes outside Nexui are out of scope.  |
| Current tab      | Sets defaults only (kind for unclear input, date for undated input). It never limits what can be created.                                                                                                                           |
| Completed tasks  | Leave every list immediately (already shipped; see [instant-actions.md](../architecture/instant-actions.md)).                                                                                                                       |
| Yellow           | Brand accent as well as the highlighter: main buttons, the active tab, the edge of suggestion cards, the Return key. Highlights stay distinguishable through labels and the marker shape (see [Visual language](#visual-language)). |
| Background       | Paper tinted toward the ink's violet, with white cards.                                                                                                                                                                             |
| Calendar         | Week strip above one continuous agenda. No month grid.                                                                                                                                                                              |
| Platform         | iOS and Android first. Expo web is the owner's local test harness: it must not break, but it gets no special design work.                                                                                                           |

## Out of scope

- Connected calendars, email, contacts, or any write outside Nexui (anchored-intelligence
  §5.11, Phase 3).
- Learning from behavior, people as a first-class entity, pins (Phase 2).
- A month grid, widgets, iPad layout, dark mode.
- Changes to the decision-engine prompt or model. No new intents.
- Persisting "Not now" dismissals across app restarts (that needs `activity_events`,
  roadmap item 2). Session-only is fine for this work.

## Slices

Build in this order. Each slice is one reviewable PR that leaves the app working. Run the
full check list in [Verification](#verification) at the end of every slice.

| Slice | What ships                                                                         | Main risk                                        |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| A     | Visual tokens, tab shell, + sheet hosting today's Magic Bar flow                   | Sheet and keyboard behavior on Android           |
| B     | Explained draft card, type-switch chips, tab defaults, save and check-off feedback | Keeping "saves exactly what was previewed" true  |
| C     | Calendar tab and `GET /api/agenda`                                                 | Agenda layout rules and scroll-linked week strip |
| D     | Home zones and `GET /api/home` with rule-based suggestions                         | Zone stability (no reorder while visible)        |

Tasks and Notes tabs arrive in slice A as filtered lists and are restyled in slice B.

---

## Slice A: tokens, shell and the + sheet

### Visual tokens

Extend `apps/mobile/src/lib/theme.ts`. Keep existing names working until every screen has
moved, then delete the old `page` usage (prototype: no compatibility layer is needed after
the move).

```ts
export const colors = {
  paper: '#F2F0F6', // screen background
  card: '#FFFFFF', // cards, sheets, tab bar
  ink: '#1E1A2B',
  muted: '#5B5670',
  faint: '#8A859C',
  soft: '#F6F4FA', // chips, avatar circles, input fill inside white sheets
  line: '#E4E0EC',
  accent: '#FFE45C', // main buttons, active tab, suggestion edge
  accentInk: '#1E1A2B', // text on accent
  success: '#1D7A52',
  danger: '#B3322C',
  scrim: 'rgba(30, 26, 43, 0.38)',
} as const;
```

`markers` stays as it is. Yellow `when` and `accent` are the same hex on purpose.

### Navigation

Current: `app/(app)/_layout.tsx` is a `Stack` with `index.tsx` (everything) and
`account.tsx`.

Target:

```
app/(app)/_layout.tsx          Stack: (tabs) group, compose, account
app/(app)/(tabs)/_layout.tsx   Tabs: home, tasks, plus, calendar, notes
app/(app)/(tabs)/index.tsx     Home
app/(app)/(tabs)/tasks.tsx
app/(app)/(tabs)/plus.tsx      placeholder route, never shown
app/(app)/(tabs)/calendar.tsx
app/(app)/(tabs)/notes.tsx
app/(app)/compose.tsx          the + sheet
app/(app)/account.tsx          unchanged, pushed from Home's gear
```

- The + tab uses `tabBarButton` to render its own pressable that calls
  `router.push('/compose')`. Pressing it never switches tabs. Give it
  `accessibilityLabel="New task, event or note"`.
- `compose` is presented as a sheet over everything, including the tab bar:
  `presentation: 'formSheet'` with `sheetAllowedDetents: 'fitToContents'` where
  `react-native-screens` supports it, `presentation: 'modal'` otherwise. Check Android
  first; if the form sheet misbehaves with the keyboard there, use `modal` on Android.
- The route accepts optional params `text` (prefill, used by Home) and `from` (the tab it was
  opened from). Read the current tab from the navigation state rather than trusting `from`
  alone.
- Tab bar: white, rounded top corners (22), no top border. Active tab shows a 46×30 yellow
  pill behind its icon; inactive icons and labels use `faint`. The + button is a 56×42 ink
  rounded rectangle (radius 15) with a white plus. Labels stay visible on every tab.
- `UndoToast` moves to `app/(app)/_layout.tsx` so it floats above the tab bar on every
  screen and is not hidden by the compose sheet closing.

### What moves where

`app/(app)/index.tsx` today holds the Magic Bar, `IntentPreview`, the draft, change and edit
sheets, the timeline list, health status and Undo. Split it:

| Today in `index.tsx`                                                                                                              | Goes to                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Magic Bar, `useIntentPrediction`, `IntentPreview`, commit mutation, `DraftSheet`, `ChangeSheet`, `createInstead`, `submitFromBar` | `compose.tsx`. Keep the flow readable top to bottom there; don't hide it behind a generic action wrapper (AGENTS.md).   |
| Timeline list with `TimelineRow` and `EditSheet`                                                                                  | Tasks and Notes tabs (filtered by kind), later Calendar                                                                 |
| Health status label                                                                                                               | Account screen shows Connected / Unreachable. Every tab shows a banner only when unreachable (`connection-banner.tsx`). |
| `UndoToast`                                                                                                                       | `(app)/_layout.tsx`                                                                                                     |

When a commit succeeds, the sheet closes, the list for that item's kind is invalidated, and
the Undo card shows as it does today.

### The + sheet, empty state

- The bar is focused on open and the keyboard is up.
- A context line at the top says what the defaults are, for example "From Calendar. Events
  with no date go on Sat 26 Sep." On Home it reads "Type anything. Nexui works out what it
  is." Cancel on the right.
- Under the bar: up to five recent inputs, most recent first, kept on the device only (a small
  Zustand store; losing them on restart is acceptable). Tapping one fills the bar.
- Pinned above the keyboard: a chip row, "Blank: Task · Event · Note". Each opens
  `DraftSheet` with an empty draft of that kind, built the way `createInstead` builds one in
  `index.tsx` today, with tab defaults filled in. The chip for the current tab's kind shows
  a small plus.
- Swipe down, Cancel, or the Android back button closes the sheet and keeps nothing.

### Tasks and Notes tabs (first version)

- Header: large title (Bricolage 800, 32) left; ⌕ button (40×40 white circle) right. The ⌕
  opens a filter field under the header that filters what is loaded, as you type, by title,
  body, location and attendees. Closing it clears the filter.
- Tasks: open tasks grouped Today (due today or overdue) · Upcoming · No date, sorted by due
  date and time. Overdue rows say "Overdue since Fri".
- Notes: newest first.
- Both reuse `TimelineRow` and `EditSheet` in slice A. Slice B restyles the rows.

### API for slice A

- `GET /api/tasks`: open tasks for the signed-in user, ordered `due` ascending with no-date
  last, then `created_at` descending. Limit 300, no cursor (a prototype limit; say so in the
  route's doc comment). Response `{ items: SavedTask[] }`.
- `GET /api/timeline?kind=note`: add an optional `kind` to `timelineQuerySchema` and pass it
  through a new `kind_filter` argument on `timeline_page` (new migration; replace the
  function, don't keep the old signature).

Follow `apps/api/AGENTS.md`: the route order, shared response helpers, safe errors, route
tests.

---

## Slice B: the explained draft and save feedback

### Draft card layout

The card replaces today's `IntentPreview` card for create intents. Change and search intents
get the same frame (kind line, why line, labeled rows, buttons) with their existing content.

```
┌──────────────────────────────────────────┐
│ ▭ Event                                  │  kind icon + label (Bricolage 700, 15)
│ An event, because it has a time, a       │  why line (13, muted), one sentence
│ person and a place.                      │
│                                          │
│ What      Lunch                          │  title (Bricolage 700, 18)
│ When      ▓Fri 2 Oct▓, ▓1 pm▓            │  marker stroke = came from the words
│ Who       ▓Sam▓                          │
│ Where     ▓Lilia▓                        │
│ How long  1 hr (default)                 │  plain + muted source = a default
│                                          │
│                     [ Edit ] [Add event] │  Edit = secondary, Add = accent
└──────────────────────────────────────────┘
 It's a  (Task) [Event] (Note)                  type chips, above the keyboard
```

Rules:

- **Rows** are a two-column list: label (12.5, bold, `faint`, 74 wide) and value. Labels per
  kind: task What / Due / Who / Priority; event What / When / Who / Where / How long; note
  What. Show a row only when it has a value, except When/Due, which always shows (with
  "No date" if empty).
- **Marked values** (the value came from a highlight span) use `MarkerChip`: the value text
  on a marker-colored stroke. **Default values** show plain, followed by the source in muted
  text: "(today)", "(selected day)", "(default)". **Missing** values show "No date" or are
  hidden.
- **Why line**: a fixed template, chosen by `draftReason()` from the intent, the confidence
  band and which fields were marked. No generated text (anchored-intelligence §3.1, §3.3).
  Templates:

  | Case                                | Text                                                                            |
  | ----------------------------------- | ------------------------------------------------------------------------------- |
  | Event with marked time/people/place | "An event, because it has {a time, a person and a place}." (list what's marked) |
  | Event with none of those            | "An event on {day}. No time was given, so it's all day."                        |
  | Task with a due date                | "A to-do, due {today / tomorrow / Fri 2 Oct}."                                  |
  | Task without a date                 | "A to-do with no date. It waits in Tasks."                                      |
  | Note                                | "Saved as a note. Nothing gets scheduled."                                      |
  | Below `HIGH_CONFIDENCE`             | "Nexui isn't sure what this is. Pick a type below, or check the details."       |
  | Change intents                      | "Changes {target title}." plus the existing target wording                      |

  Screen readers read the kind line, then the why line, then each row as "When: Friday 2
  October, 1 pm, from what you typed" or "How long: 1 hour, default".

- **Kind line**: at high confidence "Task" / "Event" / "Note". Below it, "Probably a task" /
  "Probably an event".
- **Buttons**: high confidence shows Edit (opens `DraftSheet` prefilled, as "Review" does
  today) and the accent main button "Add task" / "Add event" / "Add note". Below high
  confidence there is one button, "Check details", which opens `DraftSheet`. Return does
  what the main button does. The button label and the Undo message use the same verb: "Add
  event" → "Added event: Lunch, Fri 2 Oct".

### Type-switch chips

- With text in the bar, the chip row reads "It's a Task · Event · Note" with the current
  kind selected.
- Tapping another kind re-maps the draft on the phone without asking the model again:
  `switchDraftKind(decision, kind)` keeps the title and the when value, drops fields the new
  kind doesn't have (place and length for a task), and treats the result as high confidence
  because the user chose it. Highlights for dropped fields disappear from the bar.
- Change intents (`COMPLETE`, `RESCHEDULE`, `APPEND`) and `SEARCH` show no type chips; they
  keep today's "create instead" path.

### Tab defaults

`applyTabDefaults(decision, context)` runs on the phone after each decision arrives and
before the card renders. The action it returns is the action that gets committed, so the
card and the saved item always match.

| Opened from | Unclear input (`UNKNOWN`, or below confidence) | Event with no date | Task with no date |
| ----------- | ---------------------------------------------- | ------------------ | ----------------- |
| Home        | Task                                           | Today              | No date           |
| Tasks       | Task                                           | Today              | No date           |
| Calendar    | Event                                          | Selected day       | Selected day      |
| Notes       | Note                                           | Today              | No date           |

Fields filled this way are recorded as defaulted, so the card shows their source and they
are not marked.

### Marker shape

`MarkerChip` (new component) draws the highlighter for a value standing on its own (draft
rows, row metadata). A `View` behind the text covers the middle 72% of the line height, with
uneven corner radii (about 4/7/5/6) so it reads as a marker stroke and not as a yellow
button. Inline spans inside the Magic Bar keep today's rectangular `Text` background:
React Native can't round nested text backgrounds. Every marked value on screen has a text
label or sits in a known place (the bar), so color is never the only cue.

### Row shapes

Restyle `TimelineRow` into three shapes (split into `task-row.tsx`, `event-block.tsx`,
`note-card.tsx` if that reads better):

- **Task line**: no card, on the paper. 24px checkbox (radius 8, 2px `faint` border),
  title in regular weight, one metadata line ("Due tomorrow", "Overdue since Fri").
- **Event block**: white card (radius 16) with the start time in a 46px column (Bricolage 700,
  15; "am/pm" below in 11). Height grows with length:
  `clamp(58, durationMin × 1.4, 160)` points. Metadata: "until 2:30 pm", place. Attendees
  show as up to three 26px initial circles on the right.
- **Note card**: white card (radius 16), title in Bricolage 700, up to four lines of body.
  Notes tab lays them out in two columns.

### Save and check-off feedback

- **Saving**: the sheet closes, a light haptic fires (`expo-haptics`, `ImpactFeedbackStyle.Light`;
  add it with `npx expo install expo-haptics`), and the new row appears where it belongs if
  that list is on screen. For 2.6 s the row gets a 2px ink ring and its marked fields wear
  their marker colors, then both fade over 1.4 s. Store the fresh item's id and marked fields
  in a small Zustand store (`use-fresh-store.ts`) that clears itself.
- If the item doesn't belong on the current tab, the Undo card adds a **Show** button that
  switches to that tab and scrolls to the row.
- **Check-off**: the checkbox fills ink with a tick (150 ms), a success haptic fires, then the
  row folds away (height to 0 over 260 ms, Reanimated `exiting` plus `LinearTransition` on
  the list). The Undo card appears. Undo brings the row back in place.
- **Reduced motion** (`useReducedMotion()` from Reanimated): no fold or fade; the row simply
  goes, and the fresh ring shows without fading.

No other motion. No confetti, no animated backgrounds, nothing that moves by itself.

---

## Slice C: Calendar

### API

`GET /api/agenda?from=YYYY-MM-DD&to=YYYY-MM-DD`

- Range inclusive, at most 42 days, `from <= to`; otherwise 400 with a safe message.
- Returns `{ items: SavedItem[] }`: events whose start date is in range, and open tasks
  whose due date is in range. Notes never. Sorted by date, then all-day and untimed first,
  then time.
- Add `agendaQuerySchema` and `agendaResponseSchema` to `@nexui/types`, and the query to
  `apps/api/src/lib/records/queries.ts`. Use the user's client so RLS applies.
- The phone loads the visible range in pages of five weeks (the week before the current one
  through four weeks ahead), with TanStack Query keys per range.

### Layout

```
Calendar                              [⌕]
September 2026                      ‹  ›
┌──────────────────────────────────────┐
│ M   T   W   T   F  (S)  S            │  white card; today ringed; selected filled ink
│ 21  22  23  24  25 [26] 27           │  dots: filled = events, ring = tasks due (max 3)
│ •   •       •       •••  ∘           │
└──────────────────────────────────────┘
4 things left today. Next: Call with Dad at 2 pm.     summary for the selected day

Today  Sat 26 September                         sticky day header
  ☐  Renew passport photo    Due                task lines first
 ┌ 9:30  Farmers market      until 10:30 am ┐   past blocks at 55% opacity
 └──────────────────────────────────────────┘
10:40 ●──────────────────────────────────────   now line
  ┄┄ 3 hr 20 min free ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄   free time of 60 min or more
 ┌ 2 pm  Call with Dad       until 2:30 pm  ┐
```

Rules, all in a pure function `buildAgenda(items, range, now)` in
`apps/mobile/src/lib/agenda.ts` that returns sections for a `SectionList`:

- **Days**: one section per day with items. Today always gets a section, even if empty
  ("Nothing planned. Tap + to add something."). A run of empty days collapses into one
  dashed row: "Sat 3 to Sun 4 Oct, Nothing planned" (or a single date).
- **Order in a day**: task lines, then all-day events, then timed events by start.
- **Now line**: on today only, before the first event that starts at or after now; at the
  end if none do. Moves each minute while the screen is focused.
- **Free time**: on today and future days, between the end of one timed event (or now, on
  today) and the start of the next, when the gap is 60 minutes or more: "2 hr 30 min free".
  Overlapping events never produce a gap. No free-time row before the first event on future
  days or after the last one.
- **Past**: blocks that ended before now, and all of previous days, show at 55% opacity. A
  block in progress gets a 2px ink ring.
- **Day summary** (`daySummary(items, day, now)`, fixed templates):
  - Today: "{n} things left today." + "Next: {title} at {time}." or "No more events today."
    ({n} counts open tasks due today plus events not yet ended.)
  - Other days: "{2 events, 1 due}." + "First: {title} at {time}." ("Started with" for past
    days).
  - Empty: "Nothing planned." + "Tap + to add something."

### Behavior

- Tapping a day in the strip selects it and scrolls the agenda so that day's header sits at
  the top. ‹ › move a week and keep the same weekday selected. Swiping the strip does the
  same (optional in this slice).
- Scrolling the agenda updates the selected day (use `onViewableItemsChanged` on section
  headers) and moves the strip to that week. It never scrolls the agenda in response.
- A **Today** pill appears next to ⌕ whenever the selected day isn't today.
- The ⌕ filter hides days with no match, and turns off free-time rows and collapsing while
  active. With no match: "Nothing in Calendar matches "x". Notes and undated tasks are in
  their own tabs."
- Tapping a block or task opens `EditSheet`. The checkbox completes the task (slice B
  behavior).
- Opening + from Calendar passes the selected day as the default date.

---

## Slice D: Home

### Layout

Zones in this fixed order, each with a fixed heading. Nothing reorders while the screen is
visible; new data applies on the next focus or pull-to-refresh (§3.5).

```
Saturday 26 September                     [⚙]    date (13, bold, muted) + gear → /account
Good morning                                      greeting by local hour: morning < 12,
                                                  afternoon < 18, evening
Today                             Open Calendar
┌──────────────────────────────────────────┐
│ 3 things left today.                     │    daySummary(today)
│ Next: Call with Dad at 2 pm.             │
│ ☐ Renew passport photo   Due today       │    up to 4 rows, then "and 2 more in Calendar"
│ 2 pm  Call with Dad                      │
└──────────────────────────────────────────┘
Nexui suggests
┌▌ Email landlord about the radiator ──────┐    yellow left edge, reason line with an info
│  ⓘ Overdue since Friday.                 │    icon, action (accent) + Not now
│  [Move to today]  Not now                │
└──────────────────────────────────────────┘    two slots; the zone keeps two slots' height
Recent                                            last 3 created or updated items
[+] Try typing "follow up with Sarah fri"         hint row → /compose?text=…
```

### Suggestions

`GET /api/home` returns `{ today: SavedItem[], suggestions: Suggestion[], recent:
SavedItem[], generatedAt }`. Suggestions come from a pure, tested function
`rankSuggestions(input, now)` in `apps/api/src/lib/home/suggestions.ts`: fixed rules, fixed
order, at most four returned. The phone shows the first two that the user hasn't dismissed
this session.

```ts
// @nexui/types
export const suggestionCodeSchema = z.enum([
  'OVERDUE_TASK', // open task due before today
  'UPCOMING_EVENT', // starts within 60 min, or in progress
  'DUE_SOON_TASK', // high priority, due today or tomorrow
  'CAPTURE_NOTES', // event with attendees ended in the last 2 h
]);

export const suggestionSchema = z.object({
  key: z.string(), // `${code}:${itemId}`, stable across refreshes
  code: suggestionCodeSchema,
  item: savedItemSchema,
  action: intentActionSchema.nullable(), // prebuilt draft, or null for "open"
});
```

| Code             | Reason (fixed template on the phone)     | Action button | What it does                                                        |
| ---------------- | ---------------------------------------- | ------------- | ------------------------------------------------------------------- |
| `OVERDUE_TASK`   | "Overdue since {weekday}."               | Move to today | `RESCHEDULE` to today, saved at once with Undo                      |
| `UPCOMING_EVENT` | "Starts at {time}." / "Happening now."   | Open          | Opens `EditSheet` for the event                                     |
| `DUE_SOON_TASK`  | "Due {today / tomorrow}. High priority." | Mark done     | `COMPLETE`, saved at once with Undo                                 |
| `CAPTURE_NOTES`  | "Ended at {time}, with {names}."         | Add a note    | Opens `/compose?text=note: {title}, ` so the user finishes the note |

- Ranking order: `UPCOMING_EVENT` (in progress or next), `OVERDUE_TASK` (oldest first),
  `DUE_SOON_TASK`, `CAPTURE_NOTES`. Ties: earlier time first, then id.
- Actions that save go through `recordIntentEvent` like any instant commit, with the button
  label as the logged text. Add `source: z.enum(['magic_bar', 'suggestion'])` to
  `intentEventRequestSchema` (default `magic_bar`) and a matching column on `intent_events`,
  so metrics can separate them (§5.3).
- **Not now** removes the card for this session (Zustand) and pulls the next candidate into
  the slot on the next render. It is not persisted yet.
- **Empty zone**: a dashed box with "Nothing needs you right now. Suggestions show up here
  when something is overdue or coming up." The zone keeps the height of two cards either
  way, so the Recent heading doesn't jump.
- The mockup shows a "notes for tonight's dinner" suggestion before the event so there is
  something to see at 10:40. Build the rule in the table, not the mockup's version.

### Hint row

A white row at the end of Home: "Try typing" + an example. Examples come from a fixed list
that rotates by one after each commit ("follow up with Sarah fri", "coffee with Maya tue at
9am", "note: ideas for the cabin trip"). Tapping it opens the + sheet with the example as
the text, so the draft card shows right away. It is not an input and never takes focus on
Home.

---

## Visual language

- **Surfaces**: paper background; white cards and sheets; `soft` for chips and fields inside
  white sheets; `line` only for dashed empty states and the sheet's chip divider.
- **Radii by role**: cards 16–18, sheets 26 (top), chips 19 (pill), buttons 11–13, checkbox 8. Don't give everything the same radius.
- **Type**: Bricolage Grotesque for headings, times, titles in cards and the bar (500 in the
  bar, 700 for titles and times, 800 for screen titles and day headers). Atkinson Hyperlegible
  for body, labels and metadata. Sizes: screen title 32, day header 18, summary 17–19, row
  title 15.5–16, metadata 13, labels 12.5. Support Dynamic Type: no fixed heights on rows
  except the event block's minimum.
- **Yellow**: `accent` for the main action on a surface (one per card or sheet), the active
  tab pill, the suggestion edge and the Return key. The highlighter uses the marker shape
  (`MarkerChip`) and always has a label or known place. Never put accent and a marker side by
  side on the same value.
- **Motion** (the full list): sheet rise and drop, fresh-row ring and fade, check-off tick and
  fold, Undo card rise, suggestion card enter. All off or instant under reduced motion.
- **Haptics**: light impact on save, success on check-off. Nothing else.

## States to cover

For each tab and the sheet: loading (skeleton rows in the real shapes, not spinners, except
pagination), empty (the invitation text above), error (what failed and "Tap to try again"),
offline (the unreachable banner), below-confidence draft, edit, success (fresh row), and Undo.
The + sheet also needs "Reading your plan…" while predicting, and the existing commit error
text under the card.

## Contracts summary

| Change                        | Where                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `GET /api/tasks`              | new route, `records/queries.ts`, types                                        |
| `kind` on `GET /api/timeline` | `timelineQuerySchema`, `timeline_page(kind_filter)` migration                 |
| `GET /api/agenda?from&to`     | new route, `agendaQuerySchema`, `agendaResponseSchema`                        |
| `GET /api/home`               | new route, `apps/api/src/lib/home/`, `homeResponseSchema`, `suggestionSchema` |
| `source` on intent events     | `intentEventRequestSchema`, `intent_events.source` column, `record_intent`    |

No change to `intentResponseSchema`. The why line is built on the phone from the action and
the highlights that already exist. A later improvement (not in these slices) could add a
deterministic "cue" span (the words that decided the type, like "follow up"), built the way
`action-builder.ts` builds the priority span today, so the why line can quote them.

## File plan

| File                                                                     | Slice   | Change                                                       |
| ------------------------------------------------------------------------ | ------- | ------------------------------------------------------------ |
| `apps/mobile/src/lib/theme.ts`                                           | A       | New tokens                                                   |
| `apps/mobile/src/app/(app)/_layout.tsx`                                  | A       | Stack with `(tabs)`, `compose`, `account`; hosts `UndoToast` |
| `apps/mobile/src/app/(app)/(tabs)/_layout.tsx`                           | A       | `Tabs` with the custom + button                              |
| `apps/mobile/src/app/(app)/(tabs)/{index,tasks,plus,calendar,notes}.tsx` | A–D     | Screens (Calendar and Home are placeholders until C and D)   |
| `apps/mobile/src/app/(app)/compose.tsx`                                  | A, B    | The + sheet; moves the Magic Bar flow out of `index.tsx`     |
| `apps/mobile/src/components/connection-banner.tsx`                       | A       | Unreachable banner                                           |
| `apps/mobile/src/components/tab-header.tsx`                              | A       | Title, tools, ⌕ filter field                                 |
| `apps/mobile/src/stores/use-recent-inputs.ts`                            | A       | Last five inputs, device only                                |
| `apps/mobile/src/components/intent-previews.tsx`                         | B       | Draft card layout, rows, why line, buttons                   |
| `apps/mobile/src/components/marker-chip.tsx`                             | B       | Marker stroke                                                |
| `apps/mobile/src/lib/draft-reason.ts`                                    | B       | `draftReason()`                                              |
| `apps/mobile/src/lib/draft-kind.ts`                                      | B       | `switchDraftKind()`, `applyTabDefaults()`                    |
| `apps/mobile/src/components/{task-row,event-block,note-card}.tsx`        | B       | Row shapes (replace `timeline-row.tsx`)                      |
| `apps/mobile/src/stores/use-fresh-store.ts`                              | B       | Fresh item id and marked fields                              |
| `apps/mobile/src/lib/agenda.ts`                                          | C       | `buildAgenda()`, `daySummary()`                              |
| `apps/mobile/src/components/week-strip.tsx`                              | C       | Strip, dots, arrows                                          |
| `apps/api/src/app/api/{tasks,agenda,home}/route.ts`                      | A, C, D | Routes                                                       |
| `apps/api/src/lib/records/queries.ts`                                    | A, C    | Task and agenda queries                                      |
| `apps/api/src/lib/home/suggestions.ts`                                   | D       | `rankSuggestions()`                                          |
| `packages/types/src/index.ts`                                            | A–D     | Schemas listed above                                         |
| `supabase/migrations/*`                                                  | A, D    | `timeline_page` kind filter; `intent_events.source`          |

## Verification

Every slice:

- `pnpm fix`, then `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm format:check`. Revert
  `apps/api/next-env.d.ts` if typecheck rewrites it.
- New Node tests in `tests/` for every pure function: `draftReason`, `switchDraftKind`,
  `applyTabDefaults`, `buildAgenda` (gaps, overlaps, now line, empty runs, filter), `daySummary`,
  `rankSuggestions` (each code, order, ties, the four-item cap). Route tests for each new route
  (auth, validation, RLS client used, response shape). Contract tests for the new schemas.
- Reviewers: `mobile-reviewer` for app changes, `api-reviewer` for API and types,
  `security-reviewer` for new routes and the migration. Then `docs-keeper`.
- Smoke test in Expo on iOS and Android (web must still load): open + from each tab, save a
  clear input, save an unclear one through "Check details", switch type with a chip, Undo,
  tick a task, filter each tab, go offline and back.
- Muscle-memory check (anchored-intelligence §3.7): tabs, + button, headers and Home zone
  headings stay put across every state above.

## Acceptance criteria

1. A returning user finds Home, Tasks, +, Calendar and Notes in the same places every time,
   and no tab shows a Magic Bar.
2. - opens the sheet with the keyboard up from every tab. The context line names the defaults
     for that tab.
3. A high-confidence draft saves in one tap or Return, shows Undo, and saves exactly what the
   card showed, defaults included. Below high confidence nothing saves without the form.
4. Every value on the draft card has a label. Marked values came from the typed words;
   defaults name their source; the why line is one sentence from a fixed template.
5. Type chips change the draft's kind without a new model call.
6. A saved item appears highlighted where it belongs, or the Undo card offers Show.
7. A ticked task animates away (or leaves at once under reduced motion) and Undo restores it.
8. Calendar shows events as blocks sized by length, free time of an hour or more, the now
   line, collapsed empty days, and a summary for the selected day. The strip follows the
   scroll.
9. Home shows Today, Nexui suggests (at most two, each with a reason and one action), Recent
   and the hint row, in that order, and none of them moves while visible.
10. No external service is contacted.

## Changes to other specs

Update these when slice A merges (`docs-keeper` can do it):

- **anchored-intelligence.md §2, Layer 1**: tabs are Home · Tasks · (+) · Calendar · Notes;
  remove the docked bar and the "no + tab" recommendation; the + sheet is the only entry and
  holds the Task/Event/Note chips. Update the Home diagram and zone table to Today · Nexui
  suggests · Recent · hint row (Focus becomes the first suggestion slot).
- **§5.1**: point to this spec; Tasks groups become Today / Upcoming / No date (Done is gone;
  completed tasks leave lists).
- **§5.2**: the Focus card is the first "Nexui suggests" slot; `GET /api/home` returns
  `today`, `suggestions`, `recent`.
- **§5.4**: yellow is also the brand accent; the highlighter stays distinguishable through the
  marker shape and labels.
- **§11 open questions**: close "+ tab vs bar chips", "agenda list vs week strip", "whether web
  preview gets tabs" (it gets the same tabs, no extra work).
