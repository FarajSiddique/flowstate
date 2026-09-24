import type { HighlightField, Intent, IntentDecision } from '@nexui/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

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

const CARD_COPY: Record<
  Exclude<Intent, 'UNKNOWN'>,
  { label: string; tentative: string; action: string }
> = {
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

const DRAFTS = {
  CREATE_EVENT: eventDraft,
  CREATE_TASK: taskDraft,
  CREATE_NOTE: noteDraft,
  SEARCH: searchDraft,
};

function PreviewCard({
  decision,
  intent,
  emphasis,
  onContinue,
}: {
  decision: IntentDecision;
  intent: Exclude<Intent, 'UNKNOWN'>;
  emphasis: PreviewEmphasis;
  onContinue: () => void;
}) {
  const { title, rows } = DRAFTS[intent](decision);
  if (!title) {
    return null;
  }
  const copy = CARD_COPY[intent];
  const marked = new Set(decision.highlights?.map((span) => span.field));
  const tentative = emphasis === 'medium';

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
      <Pressable
        accessibilityRole="button"
        onPress={onContinue}
        style={({ pressed }) => [
          styles.button,
          tentative && styles.buttonTentative,
          pressed && styles.pressed,
        ]}
      >
        <Text style={[styles.buttonText, tentative && styles.buttonTextTentative]}>
          {copy.action}
        </Text>
      </Pressable>
    </View>
  );
}

export function IntentPreview({
  decision,
  onContinue,
}: {
  decision: IntentDecision | null;
  onContinue: () => void;
}) {
  if (!decision || decision.intent === 'UNKNOWN') {
    return null;
  }
  const emphasis = previewEmphasis(decision);
  if (emphasis === 'none') {
    return null;
  }
  return (
    <PreviewCard
      decision={decision}
      intent={decision.intent}
      emphasis={emphasis}
      onContinue={onContinue}
    />
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
    marginTop: 6,
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
});
