import type { HighlightField, Intent } from '@nexui/types';
import type { ReactNode } from 'react';
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

import type { FormFields } from '@/lib/item-fields';
import { PRIORITY_OPTIONS, SCOPE_OPTIONS } from '@/lib/intent-display';
import { colors, fonts, markers } from '@/lib/theme';

export interface ItemFormSheetProps {
  layout: Exclude<Intent, 'UNKNOWN'>;
  heading: string;
  actionLabel: string;
  fields: FormFields;
  onChangeField: (key: keyof FormFields, value: string) => void;
  markedFields?: ReadonlySet<HighlightField>;
  error: string | null;
  busy: boolean;
  onSubmit: () => void;
  onClose: () => void;
  children?: ReactNode;
}

// The shared bottom sheet for drafting and editing items. It owns no data or requests.
export function ItemFormSheet({
  layout,
  heading,
  actionLabel,
  fields,
  onChangeField,
  markedFields,
  error,
  busy,
  onSubmit,
  onClose,
  children,
}: ItemFormSheetProps) {
  const label = (text: string, key: keyof FormFields) => {
    const field = FIELD_MARKERS[key];

    return (
      <View style={styles.labelRow}>
        {field && markedFields?.has(field) ? (
          <View style={[styles.swatch, { backgroundColor: markers[field] }]} />
        ) : null}
        <Text style={styles.fieldLabel}>{text}</Text>
      </View>
    );
  };

  const field = (title: string, key: keyof FormFields, multiline = false) => (
    <View style={styles.field} key={key}>
      {label(title, key)}
      <TextInput
        accessibilityLabel={title}
        value={fields[key]}
        onChangeText={(value) => onChangeField(key, value)}
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
              onPress={() => onChangeField(key, option.value)}
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
    COMPLETE: [],
    RESCHEDULE: [field('Date', 'date'), field('Time', 'time')],
    APPEND: [field('Add to note', 'body', true)],
  }[layout];

  // A save in flight must finish (and log its own outcome) before the sheet can close.
  const close = () => {
    if (busy) {
      return;
    }

    onClose();
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
      >
        <Pressable accessibilityLabel="Close form" onPress={close} style={styles.backdrop} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text accessibilityRole="header" style={styles.heading}>
              {heading}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close"
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={close}
            >
              <Text style={styles.close}>Close</Text>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {form}
            {error ? (
              <Text accessibilityLiveRegion="polite" style={styles.error}>
                {error}
              </Text>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy }}
              disabled={busy}
              onPress={onSubmit}
              style={({ pressed }) => [styles.submit, (pressed || busy) && styles.pressed]}
            >
              <Text style={styles.submitText}>{busy ? 'Saving…' : actionLabel}</Text>
            </Pressable>
            {children}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

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
  error: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 20,
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
