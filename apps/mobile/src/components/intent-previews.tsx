import {
  canCommit,
  isChangeAction,
  isChangeIntent,
  type ChangeAction,
  type ChangeIntent,
  type HighlightField,
  type Intent,
  type IntentAction,
  type IntentDecision,
} from '@nexui/types';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { withTarget } from '@/lib/change-actions';
import { commitLabel } from '@/lib/commit-label';
import { localToday } from '@/lib/form-values';
import { previewEmphasis, type PreviewEmphasis } from '@/lib/intent-confidence';
import {
  displayDate,
  displayDuration,
  displayLocalDateTime,
  displayRange,
  displayTime,
  displayTitle,
  SCOPE_OPTIONS,
} from '@/lib/intent-display';
import { colors, fonts, markers } from '@/lib/theme';

interface DetailRow {
  label: string;
  value: string | null | undefined;
  // Set when the value came from a marked span, so it wears the same marker color.
  field?: HighlightField;
}

interface Draft {
  title: string | undefined;
  rows: DetailRow[];
}

// Intents that preview a new item or a search; change intents get their own card.
type DraftIntent = Exclude<Intent, 'UNKNOWN' | ChangeIntent>;

const CARD_COPY: Record<DraftIntent, { label: string; tentative: string; action: string }> = {
  CREATE_EVENT: { label: 'New event', tentative: 'Maybe a new event', action: 'Review event' },
  CREATE_TASK: { label: 'New task', tentative: 'Maybe a new task', action: 'Review task' },
  CREATE_NOTE: { label: 'New note', tentative: 'Maybe a new note', action: 'Review note' },
  SEARCH: { label: 'Search', tentative: 'Maybe a search', action: 'Search' },
};

// Each draft prefers the typed action and falls back to legacy entities.
function eventDraft({ action, entities }: IntentDecision): Draft {
  if (action?.kind !== 'CREATE_EVENT') {
    return {
      title: entities.title,
      rows: [
        {
          label: 'When',
          value: [displayDate(entities.date), displayTime(entities.time)]
            .filter(Boolean)
            .join(' · '),
        },
        { label: 'With', value: entities.person },
      ],
    };
  }

  return {
    title: action.title || entities.title,
    rows: [
      { label: 'When', value: displayLocalDateTime(action.start), field: 'when' },
      {
        label: 'For',
        value: action.start && displayDuration(action.durationMin),
        field: 'duration',
      },
      { label: 'Where', value: action.location, field: 'location' },
      { label: 'With', value: action.attendees.join(', '), field: 'attendees' },
    ],
  };
}

function taskDraft({ action, entities }: IntentDecision): Draft {
  if (action?.kind !== 'CREATE_TASK') {
    return { title: entities.title, rows: [{ label: 'Due', value: displayDate(entities.date) }] };
  }

  return {
    title: action.title || entities.title,
    rows: [
      { label: 'Due', value: displayLocalDateTime(action.due), field: 'when' },
      {
        label: 'Priority',
        value: action.priority === 'normal' ? null : displayTitle(action.priority),
        field: 'priority',
      },
    ],
  };
}

function noteDraft({ action, entities }: IntentDecision): Draft {
  const note = action?.kind === 'CREATE_NOTE' ? action : null;
  const title = note?.title || entities.title;

  return {
    title: title && displayTitle(title),
    rows: [{ label: 'Note', value: note?.body }],
  };
}

function searchDraft({ action, entities }: IntentDecision): Draft {
  const search = action?.kind === 'SEARCH' ? action : null;
  const query = search?.query || entities.query;
  const scope = SCOPE_OPTIONS.find((option) => option.value === search?.scope);

  return {
    title: query && displayTitle(query),
    rows: [
      { label: 'In', value: search?.scope === 'all' ? null : scope?.label },
      { label: 'Dates', value: displayRange(search?.range ?? null), field: 'range' },
    ],
  };
}

const DRAFTS: Record<DraftIntent, (decision: IntentDecision) => Draft> = {
  CREATE_EVENT: eventDraft,
  CREATE_TASK: taskDraft,
  CREATE_NOTE: noteDraft,
  SEARCH: searchDraft,
};

interface PreviewActions {
  busy: boolean;
  error: string | null;
  onCommit: (action: IntentAction) => void;
  onReview: (action?: IntentAction) => void;
  onCreateInstead: (phrase: string) => void;
}

function CardButtons({
  label,
  tentative,
  busy,
  error,
  onPress,
  onEdit,
}: {
  label: string;
  tentative: boolean;
  busy: boolean;
  error: string | null;
  onPress: () => void;
  onEdit?: () => void;
}) {
  return (
    <View style={styles.buttons}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ busy, disabled: busy }}
        disabled={busy}
        onPress={onPress}
        style={({ pressed }) => [
          styles.button,
          tentative && styles.buttonTentative,
          (pressed || busy) && styles.pressed,
        ]}
      >
        {busy ? (
          <ActivityIndicator color={tentative ? colors.ink : colors.page} />
        ) : (
          <Text style={[styles.buttonText, tentative && styles.buttonTextTentative]}>{label}</Text>
        )}
      </Pressable>
      {onEdit ? (
        <Pressable accessibilityRole="button" disabled={busy} onPress={onEdit} style={styles.edit}>
          <Text style={styles.editText}>Edit</Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

function PreviewCard({
  decision,
  intent,
  emphasis,
  busy,
  error,
  onCommit,
  onReview,
}: PreviewActions & {
  decision: IntentDecision;
  intent: DraftIntent;
  emphasis: PreviewEmphasis;
}) {
  const { title, rows } = DRAFTS[intent](decision);

  if (!title) {
    return null;
  }

  const copy = CARD_COPY[intent];
  const marked = new Set(decision.highlights?.map((span) => span.field));
  const tentative = emphasis === 'medium';
  const commit = canCommit(decision) ? decision.action : undefined;

  return (
    <View style={[styles.card, tentative && styles.cardTentative]}>
      <View style={styles.header}>
        <Text style={styles.kind}>{tentative ? copy.tentative : copy.label}</Text>
        <Text style={styles.kind}>{Math.round(decision.confidence * 100)}% sure</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      {rows.some((row) => row.value) ? (
        <View style={styles.rows}>
          {rows.map((row) =>
            row.value ? (
              <View key={row.label} style={styles.row}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                <View style={styles.rowValue}>
                  <Text
                    numberOfLines={row.label === 'Note' ? 3 : 2}
                    style={[
                      styles.value,
                      row.field &&
                        marked.has(row.field) && {
                          backgroundColor: markers[row.field],
                          ...styles.valueMarked,
                        },
                    ]}
                  >
                    {row.value}
                  </Text>
                </View>
              </View>
            ) : null,
          )}
        </View>
      ) : null}
      {commit ? (
        <CardButtons
          label={commitLabel(commit)}
          tentative={tentative}
          busy={busy}
          error={error}
          onPress={() => onCommit(commit)}
          onEdit={() => onReview()}
        />
      ) : (
        <CardButtons
          label={copy.action}
          tentative={tentative}
          busy={busy}
          error={error}
          onPress={() => onReview()}
        />
      )}
    </View>
  );
}

const CHANGE_COPY: Record<ChangeIntent, { label: string; tentative: string }> = {
  COMPLETE: { label: 'Mark done', tentative: 'Maybe mark done' },
  RESCHEDULE: { label: 'Move', tentative: 'Maybe move' },
  APPEND: { label: 'Add to note', tentative: 'Maybe add to a note' },
};

// Acts on a saved item: one match commits, several ask "Which one?", none offers a new task.
function ChangeCard({
  decision,
  action,
  emphasis,
  busy,
  error,
  onCommit,
  onReview,
  onCreateInstead,
}: PreviewActions & { decision: IntentDecision; action: ChangeAction; emphasis: PreviewEmphasis }) {
  const copy = CHANGE_COPY[action.kind];
  const tentative = emphasis === 'medium';
  const { target } = action;

  function pick(ref: ChangeAction['alternatives'][number]) {
    const picked = withTarget(action, ref, localToday());

    if (picked.kind === 'RESCHEDULE' && !picked.to) {
      onReview(picked);

      return;
    }

    onCommit(picked);
  }

  let body;

  if (target) {
    const needsTime = action.kind === 'RESCHEDULE' && !action.to;
    let detail: string | null = null;

    if (action.kind === 'RESCHEDULE') {
      const now = displayLocalDateTime(target.when);

      detail = now ? `Now: ${now}` : 'Now: unscheduled';
    } else if (action.kind === 'APPEND') {
      detail = `Add: ${action.text}`;
    }

    body = (
      <>
        <Text style={styles.title}>{target.title}</Text>
        {detail ? (
          <Text numberOfLines={3} style={styles.value}>
            {detail}
          </Text>
        ) : null}
        <CardButtons
          label={commitLabel(action)}
          tentative={tentative}
          busy={busy}
          error={error}
          onPress={() => (needsTime ? onReview(action) : onCommit(action))}
          onEdit={action.kind === 'COMPLETE' ? undefined : () => onReview(action)}
        />
      </>
    );
  } else if (action.alternatives.length > 0) {
    body = (
      <>
        <Text style={styles.title}>Which one?</Text>
        <View style={styles.choices}>
          {action.alternatives.map((ref) => (
            <Pressable
              key={`${ref.kind}:${ref.id}`}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => pick(ref)}
              style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
            >
              <Text style={styles.choiceTitle}>{ref.title}</Text>
              <Text style={styles.kind}>
                {displayLocalDateTime(ref.when) ?? displayTitle(ref.kind)}
              </Text>
            </Pressable>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </>
    );
  } else {
    body = (
      <>
        <Text style={styles.value}>{`No open item matches '${action.phrase}'.`}</Text>
        <CardButtons
          label={`Create task "${action.phrase}"`}
          tentative
          busy={false}
          error={null}
          onPress={() => onCreateInstead(action.phrase)}
        />
      </>
    );
  }

  return (
    <View style={[styles.card, tentative && styles.cardTentative]}>
      <View style={styles.header}>
        <Text style={styles.kind}>{tentative ? copy.tentative : copy.label}</Text>
        <Text style={styles.kind}>{Math.round(decision.confidence * 100)}% sure</Text>
      </View>
      {body}
    </View>
  );
}

export function IntentPreview({
  decision,
  ...actions
}: PreviewActions & { decision: IntentDecision | null }) {
  if (!decision || decision.intent === 'UNKNOWN') {
    return null;
  }

  const emphasis = previewEmphasis(decision);

  if (emphasis === 'none') {
    return null;
  }

  if (isChangeIntent(decision.intent)) {
    return decision.action && isChangeAction(decision.action) ? (
      <ChangeCard decision={decision} action={decision.action} emphasis={emphasis} {...actions} />
    ) : null;
  }

  return (
    <PreviewCard decision={decision} intent={decision.intent} emphasis={emphasis} {...actions} />
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 18,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.page,
    gap: 12,
  },
  cardTentative: { borderColor: colors.faint, borderStyle: 'dashed' },
  header: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  kind: { fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  title: {
    fontFamily: fonts.heading,
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: -0.3,
    color: colors.ink,
  },
  rows: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'baseline' },
  rowLabel: { width: 64, fontFamily: fonts.body, fontSize: 14, color: colors.muted },
  rowValue: { flex: 1, alignItems: 'flex-start' },
  value: { fontFamily: fonts.input, fontSize: 16, lineHeight: 22, color: colors.ink },
  valueMarked: { borderRadius: 4, paddingHorizontal: 4, marginHorizontal: -4, overflow: 'hidden' },
  button: {
    paddingVertical: 14,
    borderRadius: 999,
    backgroundColor: colors.ink,
    borderWidth: 2,
    borderColor: colors.ink,
  },
  buttonTentative: { backgroundColor: colors.page },
  buttonText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.page, textAlign: 'center' },
  buttonTextTentative: { color: colors.ink },
  pressed: { opacity: 0.7 },
  buttons: { marginTop: 6, gap: 10 },
  edit: { alignSelf: 'center', minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  editText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  error: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.danger },
  choices: { gap: 8 },
  choice: {
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.line,
  },
  choiceTitle: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.ink },
});
