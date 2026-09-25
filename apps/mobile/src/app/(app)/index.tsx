import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'expo-router';
import {
  isChangeAction,
  isChangeIntent,
  type ChangeAction,
  type IntentAction,
  type IntentDecision,
  type SavedItem,
} from '@nexui/types';
import { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChangeSheet } from '@/components/change-sheet';
import { DraftSheet } from '@/components/draft-sheet';
import { EditSheet } from '@/components/edit-sheet';
import { IntentPreview } from '@/components/intent-previews';
import { MagicBar } from '@/components/magic-bar';
import { TimelineRow } from '@/components/timeline-row';
import { UndoToast } from '@/components/undo-toast';
import { ApiError, getHealth, recordIntentEvent } from '@/lib/api';
import { undoMessage } from '@/lib/commit-label';
import { previewEmphasis } from '@/lib/intent-confidence';
import { submitStep } from '@/lib/submit-decision';
import { colors, fonts } from '@/lib/theme';
import { TIMELINE_KEY, useCompleteItem, useTimeline } from '@/lib/use-timeline';
import { useIntentPrediction } from '@/lib/use-intent-prediction';
import { showUndo } from '@/stores/use-undo-store';

type Sheet =
  | { type: 'draft'; decision: IntentDecision; text: string }
  | { type: 'change'; decision: IntentDecision; action: ChangeAction; text: string }
  | { type: 'edit'; item: SavedItem };

interface Commit {
  decision: IntentDecision;
  action: IntentAction;
  text: string;
}

export default function HomeScreen() {
  const { text, setText, decision, isPredicting, error, resolveNow } = useIntentPrediction();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const timeline = useTimeline();
  const complete = useCompleteItem();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 15_000,
  });
  const queryClient = useQueryClient();
  const commit = useMutation({
    mutationFn: ({ decision: logged, action, text: typed }: Commit) =>
      recordIntentEvent({
        text: typed,
        decision: logged,
        outcome: 'confirmed',
        action,
        via: 'instant',
      }),
    onSuccess: ({ eventId }, { action }) => {
      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      setText('');
      showUndo(eventId, undoMessage(action));
    },
  });
  const requestError = commit.error instanceof ApiError ? commit.error.message : null;
  const commitError = commit.error
    ? (requestError ?? 'Could not save. Check your connection.')
    : null;

  function changeText(value: string) {
    commit.reset();
    setText(value);
  }

  function commitNow(action: IntentAction) {
    if (!decision || commit.isPending) {
      return;
    }

    commit.mutate({ decision, action, text: text.trim() });
  }

  function review(forDecision: IntentDecision, action?: IntentAction) {
    Keyboard.dismiss();

    if (isChangeIntent(forDecision.intent)) {
      const change = action ?? forDecision.action;

      if (change && isChangeAction(change)) {
        setSheet({ type: 'change', decision: forDecision, action: change, text: text.trim() });
      }

      return;
    }

    setSheet({ type: 'draft', decision: forDecision, text: text.trim() });
  }

  // A change that matched nothing becomes a new task draft, prefilled with the phrase.
  function createInstead(phrase: string) {
    if (!decision) {
      return;
    }

    const title = phrase.charAt(0).toUpperCase() + phrase.slice(1);

    Keyboard.dismiss();
    setSheet({
      type: 'draft',
      decision: {
        intent: 'CREATE_TASK',
        confidence: decision.confidence,
        entities: { title },
        action: { kind: 'CREATE_TASK', title, due: null, priority: 'normal' },
      },
      text: text.trim(),
    });
  }

  async function submitFromBar() {
    if (commit.isPending) {
      return;
    }

    const typed = text.trim();
    const ready = await resolveNow();
    const step = submitStep(ready);

    if (!ready?.action || step === 'ignore') {
      return;
    }

    if (step === 'commit') {
      commit.mutate({ decision: ready, action: ready.action, text: typed });

      return;
    }

    review(ready);
  }

  const status = health.isPending ? 'Checking…' : health.isError ? 'Unreachable' : 'Connected';
  const statusColor = health.isPending
    ? colors.faint
    : health.isError
      ? colors.danger
      : colors.success;
  // Only mark up the input when there is a draft on screen to explain.
  const shown = decision && previewEmphasis(decision) !== 'none' ? decision : null;

  let emptyState = <Text style={styles.feedback}>Nothing saved yet. Type a plan above.</Text>;

  if (timeline.isPending) {
    emptyState = <Text style={styles.feedback}>Loading your items…</Text>;
  } else if (timeline.isError) {
    emptyState = (
      <Pressable accessibilityRole="button" onPress={() => void timeline.refetch()}>
        <Text style={styles.error}>Could not load your items. Tap to try again.</Text>
      </Pressable>
    );
  }

  const header = (
    <View>
      <View style={styles.top}>
        <Text accessibilityRole="header" style={styles.brand}>
          nexui
        </Text>
        <View style={styles.topActions}>
          <View style={styles.status}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.statusText, { color: statusColor }]}
            >
              {status}
            </Text>
          </View>
          <Link href="/account" accessibilityRole="button" style={styles.accountLink}>
            Account
          </Link>
        </View>
      </View>
      <Text style={styles.subtitle}>
        Type a plan and press return. Nexui marks the details it picked up.
      </Text>

      <UndoToast />
      <MagicBar
        value={text}
        onChangeText={changeText}
        onSubmit={() => void submitFromBar()}
        highlights={shown?.highlights}
      />

      {isPredicting ? (
        <Text accessibilityLiveRegion="polite" style={styles.feedback}>
          Reading your plan…
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <IntentPreview
        decision={decision}
        busy={commit.isPending}
        error={commitError}
        onCommit={commitNow}
        onReview={(action) => {
          if (decision) {
            review(decision, action);
          }
        }}
        onCreateInstead={createInstead}
      />

      {health.isError ? (
        <View style={styles.offline}>
          <Text style={styles.offlineText}>
            Nexui can’t reach its server. Check that the API is running, then try again.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Check the connection again"
            disabled={health.isFetching}
            onPress={() => void health.refetch()}
            style={({ pressed }) => [styles.retry, (pressed || health.isFetching) && styles.dimmed]}
          >
            <Text style={styles.retryText}>{health.isFetching ? 'Checking…' : 'Check again'}</Text>
          </Pressable>
        </View>
      ) : null}
      <Text accessibilityRole="header" style={styles.sectionLabel}>
        Your items
      </Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <FlatList
        style={styles.list}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        data={timeline.items}
        keyExtractor={(item) => `${item.kind}:${item.id}`}
        ListHeaderComponent={header}
        renderItem={({ item }) => (
          <TimelineRow
            item={item}
            onToggle={() => complete.mutate({ item, completed: item.completedAt === null })}
            onOpen={() => setSheet({ type: 'edit', item })}
          />
        )}
        onEndReachedThreshold={0.5}
        onEndReached={() => {
          if (timeline.hasNextPage && !timeline.isFetchingNextPage) {
            void timeline.fetchNextPage();
          }
        }}
        ListEmptyComponent={emptyState}
        ListFooterComponent={
          timeline.isFetchingNextPage ? (
            <ActivityIndicator accessibilityLabel="Loading more" style={styles.footer} />
          ) : null
        }
      />
      {sheet?.type === 'draft' ? (
        <DraftSheet
          decision={sheet.decision}
          text={sheet.text}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setText('');
          }}
        />
      ) : null}
      {sheet?.type === 'change' ? (
        <ChangeSheet
          decision={sheet.decision}
          action={sheet.action}
          text={sheet.text}
          onClose={() => setSheet(null)}
          onSaved={() => {
            setSheet(null);
            setText('');
          }}
        />
      ) : null}
      {sheet?.type === 'edit' ? (
        <EditSheet item={sheet.item} onClose={() => setSheet(null)} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36 },
  list: { flex: 1, width: '100%', maxWidth: 488, alignSelf: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { fontFamily: fonts.display, fontSize: 30, letterSpacing: -1, color: colors.ink },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  accountLink: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
    paddingVertical: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { fontFamily: fonts.body, fontSize: 13 },
  subtitle: {
    fontFamily: fonts.body,
    fontSize: 16,
    lineHeight: 23,
    color: colors.muted,
    marginTop: 10,
    maxWidth: 340,
  },
  feedback: { fontFamily: fonts.body, color: colors.muted, fontSize: 14, marginTop: 14 },
  error: {
    fontFamily: fonts.body,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 14,
  },
  offline: {
    marginTop: 28,
    padding: 16,
    borderRadius: 16,
    backgroundColor: colors.soft,
    gap: 10,
  },
  offlineText: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  retry: { alignSelf: 'flex-start', paddingVertical: 6 },
  retryText: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: colors.ink,
    textDecorationLine: 'underline',
  },
  dimmed: { opacity: 0.6 },
  sectionLabel: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: colors.faint,
    marginTop: 32,
  },
  footer: { marginVertical: 20 },
});
