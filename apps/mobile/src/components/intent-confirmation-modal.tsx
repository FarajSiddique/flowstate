import type { IntentDecision } from '@flowstate/types';
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

const FORM_COPY = {
  CREATE_EVENT: { heading: 'New Event', action: 'Create Event' },
  CREATE_TASK: { heading: 'New Task', action: 'Create Task' },
  CREATE_NOTE: { heading: 'New Note', action: 'Create Note' },
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
      if (action.kind === 'CREATE_TASK') fields.priority = action.priority;
      else
        Object.assign(fields, {
          duration: displayDuration(action.durationMin),
          location: action.location ?? '',
          attendees: action.attendees.join(', '),
        });
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
  const update = (key: keyof FormFields, value: string) =>
    setFields((current) => ({ ...current, [key]: value }));

  const field = (label: string, key: keyof FormFields, multiline = false) => (
    <View style={styles.field} key={key}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={fields[key]}
        onChangeText={(value) => update(key, value)}
        multiline={multiline}
        textAlignVertical={multiline ? 'top' : 'center'}
        style={[styles.fieldInput, multiline && styles.multiline]}
        placeholderTextColor="#8392A5"
      />
    </View>
  );

  const segmented = (
    label: string,
    key: 'priority' | 'scope',
    options: readonly { value: string; label: string }[],
  ) => (
    <View style={styles.field} key={key}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segments}>
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
            <Text style={styles.hint}>Preview only · Nothing is saved yet</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(19, 37, 61, 0.34)' },
  sheet: {
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 28,
    paddingBottom: 36,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#CDD7E6',
    alignSelf: 'center',
    marginTop: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 28,
  },
  heading: { color: '#182B42', fontSize: 28, fontWeight: '700' },
  close: { color: '#52647B', fontSize: 15, fontWeight: '600' },
  field: { marginTop: 24 },
  fieldLabel: { color: '#52647B', fontSize: 13, fontWeight: '700', marginBottom: 8 },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#DCE5F2',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#182B42',
    fontSize: 17,
  },
  submit: { backgroundColor: '#245CCA', padding: 17, borderRadius: 14, marginTop: 30 },
  submitText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hint: { textAlign: 'center', color: '#8392A5', fontSize: 12, marginTop: 14 },
  multiline: { minHeight: 110 },
  segments: {
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: '#DCE5F2',
    borderRadius: 12,
    padding: 3,
    gap: 3,
  },
  segment: { flex: 1, paddingVertical: 10, borderRadius: 9 },
  segmentSelected: { backgroundColor: '#245CCA' },
  segmentText: { color: '#52647B', fontSize: 14, fontWeight: '600', textAlign: 'center' },
  segmentTextSelected: { color: '#FFFFFF' },
  pressed: { opacity: 0.65 },
});
