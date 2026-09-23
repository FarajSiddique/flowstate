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

import { displayDate, displayTime } from '@/lib/intent-display';

const FORM_COPY = {
  CREATE_EVENT: { heading: 'New Event', action: 'Create Event' },
  CREATE_TASK: { heading: 'New Task', action: 'Create Task' },
  CREATE_NOTE: { heading: 'New Note', action: 'Create Note' },
  SEARCH: { heading: 'Search', action: 'Search' },
  UNKNOWN: { heading: '', action: '' },
} as const;

export function IntentConfirmationModal({
  decision,
  onClose,
}: {
  decision: IntentDecision;
  onClose: () => void;
}) {
  const [fields, setFields] = useState({
    title: decision.entities.title ?? '',
    date: displayDate(decision.entities.date) ?? '',
    time: displayTime(decision.entities.time) ?? '',
    query: decision.entities.query ?? '',
  });
  const copy = FORM_COPY[decision.intent];

  const field = (label: string, key: keyof typeof fields) => (
    <View style={styles.field} key={key}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        value={fields[key]}
        onChangeText={(value) => setFields((current) => ({ ...current, [key]: value }))}
        style={styles.fieldInput}
        placeholderTextColor="#8392A5"
      />
    </View>
  );

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
            {decision.intent === 'SEARCH' ? field('Query', 'query') : field('Title', 'title')}
            {(decision.intent === 'CREATE_EVENT' || decision.intent === 'CREATE_TASK') &&
              field('Date', 'date')}
            {decision.intent === 'CREATE_EVENT' && field('Time', 'time')}
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
  pressed: { opacity: 0.65 },
});
