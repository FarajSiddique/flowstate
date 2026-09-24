import type { HighlightField, IntentDecision } from '@nexui/types';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  displayDate,
  displayDuration,
  displayLocalDate,
  displayRange,
  displayTime,
  PRIORITY_OPTIONS,
  SCOPE_OPTIONS,
} from '@/lib/intent-display';
import { colors, fonts, markers } from '@/lib/theme';

const FORM_COPY = {
  CREATE_EVENT: { heading: 'New event', action: 'Create event' },
  CREATE_TASK: { heading: 'New task', action: 'Create task' },
  CREATE_NOTE: { heading: 'New note', action: 'Create note' },
  SEARCH: { heading: 'Search', action: 'Search' },
  UNKNOWN: { heading: '', action: '' },
} as const;

type FormFields = Record<
  | 'title'
  | 'date'
  | 'time'
  | 'duration'
  | 'location'
  | 'attendees'
  | 'body'
  | 'query'
  | 'range'
  | 'priority'
  | 'scope',
  string
>;

// Form fields filled from a marked span keep that span's marker color beside their label.
const FIELD_MARKERS: Partial<Record<keyof FormFields, HighlightField>> = {
  date: 'when',
  time: 'when',
  duration: 'duration',
  location: 'location',
  attendees: 'attendees',
  priority: 'priority',
  range: 'range',
};

// Prefill from the typed action draft; legacy entities cover older API responses.
function initialFields({ action, entities }: IntentDecision): FormFields {
  const fields: FormFields = {
    title: entities.title ?? '',
    date: displayDate(entities.date) ?? '',
    time: displayTime(entities.time) ?? '',
    duration: '',
    location: '',
    attendees: '',
    body: '',
    query: entities.query ?? '',
    range: '',
    priority: 'normal',
    scope: 'all',
  };

  switch (action?.kind) {
    case 'CREATE_TASK':
    case 'CREATE_EVENT': {
      const when = action.kind === 'CREATE_TASK' ? action.due : action.start;

      Object.assign(fields, {
        title: action.title,
        date: when ? displayLocalDate(when.date) : '',
        time: displayTime(when?.time ?? undefined) ?? '',
      });
      if (action.kind === 'CREATE_TASK') {
        fields.priority = action.priority;
      } else {
        Object.assign(fields, {
          duration: displayDuration(action.durationMin),
          location: action.location ?? '',
          attendees: action.attendees.join(', '),
        });
      }

      break;
    }

    case 'CREATE_NOTE':
      Object.assign(fields, { title: action.title, body: action.body ?? '' });
      break;
    case 'SEARCH':
      Object.assign(fields, {
        query: action.query,
        scope: action.scope,
        range: displayRange(action.range) ?? '',
      });
      break;
  }

  return fields;
}

export function IntentConfirmationModal({
  decision,
  onClose,
}: {
  decision: IntentDecision;
  onClose: () => void;
}) {
  const [fields, setFields] = useState(() => initialFields(decision));
  const copy = FORM_COPY[decision.intent];
  const marked = new Set(decision.highlights?.map((span) => span.field));
  const label = (text: string, key: keyof FormFields) => {
    const field = FIELD_MARKERS[key];

    return (
      <View style={styles.labelRow}>
        {field && marked.has(field) ? (
          <View style={[styles.swatch, { backgroundColor: markers[field] }]} />
        ) : null}
        <Text style={styles.fieldLabel}>{text}</Text>
      </View>
    );
  };
  const update = (key: keyof FormFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const field = (title: string, key: keyof FormFields, multiline = false) => (
    <View style={styles.field} key={key}>
      {label(title, key)}
      <TextInput
        accessibilityLabel={title}
        value={fields[key]}
        onChangeText={(value) => update(key, value)}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.fieldInput, multiline && styles.multiline]}
        placeholderTextColor={colors.faint}
        selectionColor={colors.ink}
      />
    </View>
  );

  const segmented = (
    title: string,
    key: 'priority' | 'scope',
    options: readonly { value: string; label: string }[],
  ) => (
    <View style={styles.field} key={key}>
      {label(title, key)}
      <View accessibilityRole="radiogroup" accessibilityLabel={title} style={styles.segments}>
        {options.map((option) => {
          const selected = fields[key] === option.value;

          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => update(key, option.value)}
              style={[styles.segment, selected && styles.segmentSelected]}
            >
              <Text style={[styles.segmentText, selected && styles.segmentTextSelected]}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );

  const form = {
    CREATE_TASK: [
      field('Title', 'title'),
      field('Date', 'date'),
      field('Time', 'time'),
      segmented('Priority', 'priority', PRIORITY_OPTIONS),
    ],
    CREATE_EVENT: [
      field('Title', 'title'),
      field('Date', 'date'),
      field('Time', 'time'),
      field('Duration', 'duration'),
      field('Location', 'location'),
      field('People', 'attendees'),
    ],
    CREATE_NOTE: [field('Title', 'title'), field('Note', 'body', true)],
    SEARCH: [
      field('Query', 'query'),
      segmented('Look in', 'scope', SCOPE_OPTIONS),
      field('Dates', 'range'),
    ],
    UNKNOWN: [],
  }[decision.intent];

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable accessibilityLabel="Close form" onPress={onClose} style={styles.backdrop} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>
              {copy.heading}
            </Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose}>
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {form}
            <Pressable
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.submit, pressed && styles.pressed]}
            >
              <Text style={styles.submitText}>{copy.action}</Text>
            </Pressable>
            <Text style={styles.hint}>Preview only. Nothing is saved yet.</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: colors.scrim },
  sheet: {
    maxHeight: '85%',
    backgroundColor: colors.page,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 24,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
    alignSelf: 'center',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 24,
  },
  heading: { fontFamily: fonts.display, fontSize: 28, letterSpacing: -0.6, color: colors.ink },
  close: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.muted },
  field: { marginTop: 20 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  swatch: { width: 14, height: 10, borderRadius: 3 },
  fieldLabel: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.muted },
  fieldInput: {
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: fonts.input,
    fontSize: 17,
    color: colors.ink,
  },
  submit: { backgroundColor: colors.ink, padding: 16, borderRadius: 999, marginTop: 28 },
  submitText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.page, textAlign: 'center' },
  hint: {
    fontFamily: fonts.body,
    textAlign: 'center',
    color: colors.muted,
    fontSize: 13,
    marginTop: 12,
  },
  multiline: { minHeight: 110 },
  segments: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: colors.line,
    borderRadius: 14,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, paddingVertical: 9, borderRadius: 10 },
  segmentSelected: { backgroundColor: colors.ink },
  segmentText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.muted,
    textAlign: 'center',
  },
  segmentTextSelected: { color: colors.page },
  pressed: { opacity: 0.7 },
});
