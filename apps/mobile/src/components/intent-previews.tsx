import type { IntentDecision } from '@flowstate/types';
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
      {detail ? (
        <Text style={styles.detail} numberOfLines={2}>
          {detail}
        </Text>
      ) : null}
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

// Each preview prefers the typed action draft and falls back to legacy entities.
export function EventIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const action = decision.action?.kind === 'CREATE_EVENT' ? decision.action : null;
  const { date, time } = decision.entities;
  const title = action?.title || decision.entities.title;
  if (!title) return null;
  const detail = action
    ? [
        displayLocalDateTime(action.start),
        action.start && displayDuration(action.durationMin),
        action.location,
      ]
    : [displayDate(date), displayTime(time)];
  return (
    <PreviewCard
      label="Schedule Event"
      title={title}
      detail={detail.filter(Boolean).join(' · ')}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function TaskIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const action = decision.action?.kind === 'CREATE_TASK' ? decision.action : null;
  const title = action?.title || decision.entities.title;
  if (!title) return null;
  const detail = action
    ? [
        displayLocalDateTime(action.due),
        action.priority === 'normal' ? null : `${displayTitle(action.priority)} priority`,
      ]
    : [displayDate(decision.entities.date)];
  return (
    <PreviewCard
      label="Create Task"
      title={title}
      detail={detail.filter(Boolean).join(' · ') || undefined}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function NoteIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const action = decision.action?.kind === 'CREATE_NOTE' ? decision.action : null;
  const title = action?.title || decision.entities.title;
  if (!title) return null;
  return (
    <PreviewCard
      label="Create Note"
      title={displayTitle(title)}
      detail={action?.body ?? undefined}
      emphasis={emphasis}
      onContinue={onContinue}
    />
  );
}

export function SearchIntentPreview({ decision, emphasis, onContinue }: PreviewProps) {
  const action = decision.action?.kind === 'SEARCH' ? decision.action : null;
  const query = action?.query || decision.entities.query;
  if (!query) return null;
  const scope = SCOPE_OPTIONS.find((option) => option.value === action?.scope);
  const detail = [action?.scope !== 'all' && scope?.label, displayRange(action?.range ?? null)];
  return (
    <PreviewCard
      label="Search"
      title={displayTitle(query)}
      detail={detail.filter(Boolean).join(' · ') || undefined}
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
