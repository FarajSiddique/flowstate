import type { IntentDecision } from '@flowstate/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { previewEmphasis, type PreviewEmphasis } from '@/lib/intent-confidence';
import { displayDate, displayTime, displayTitle } from '@/lib/intent-display';

interface PreviewProps {
  decision: IntentDecision;
  emphasis: PreviewEmphasis;
  onContinue: () => void;
}

function PreviewCard({
  label,
  title,
  detail,
  action = 'Continue →',
  emphasis,
  onContinue,
}: {
  label: string;
  title: string;
  detail?: string;
  action?: string;
  emphasis: PreviewEmphasis;
  onContinue: () => void;
}) {
  return (
    <View style={[styles.card, emphasis === 'medium' && styles.subtleCard]}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      <Pressable
        accessibilityRole="button"
        onPress={onContinue}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Text style={styles.actionText}>{action}</Text>
      </Pressable>
    </View>
  );
}

export function EventIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const { title, date, time } = decision.entities;
  if (!title) return null;
  const detail = [displayDate(date), displayTime(time)].filter(Boolean).join(' · ');
  return (
    <PreviewCard
      label="Schedule Event"
      title={title}
      detail={detail}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function TaskIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const { title, date } = decision.entities;
  if (!title) return null;
  return (
    <PreviewCard
      label="Create Task"
      title={title}
      detail={displayDate(date) ?? undefined}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function NoteIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const { title } = decision.entities;
  if (!title) return null;
  return (
    <PreviewCard
      label="Create Note"
      title={displayTitle(title)}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function SearchIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const { query } = decision.entities;
  if (!query) return null;
  return (
    <PreviewCard
      label="Search"
      title={displayTitle(query)}
      action="Search →"
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function IntentPreview({
  decision,
  onContinue,
}: {
  decision: IntentDecision | null;
  onContinue: () => void;
}) {
  if (!decision) return null;
  const emphasis = previewEmphasis(decision);
  if (emphasis === 'none') return null;
  const props = { decision, emphasis, onContinue };

  switch (decision.intent) {
    case 'CREATE_EVENT':
      return <EventIntentPreview {...props} />;
    case 'CREATE_TASK':
      return <TaskIntentPreview {...props} />;
    case 'CREATE_NOTE':
      return <NoteIntentPreview {...props} />;
    case 'SEARCH':
      return <SearchIntentPreview {...props} />;
    case 'UNKNOWN':
      return null;
  }
}

const styles = StyleSheet.create({
  card: {
    marginTop: 20,
    padding: 24,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DCE5F2',
    shadowColor: '#182B42',
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2,
  },
  subtleCard: { backgroundColor: '#F9FBFE', shadowOpacity: 0, elevation: 0 },
  label: { color: '#245CCA', fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },
  title: { color: '#182B42', fontSize: 24, fontWeight: '700', marginTop: 12 },
  detail: { color: '#52647B', fontSize: 16, marginTop: 8 },
  action: { alignSelf: 'flex-start', marginTop: 24, paddingVertical: 9, paddingRight: 12 },
  actionText: { color: '#245CCA', fontSize: 16, fontWeight: '700' },
  pressed: { opacity: 0.6 },
});
