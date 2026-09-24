import { useQuery } from '@tanstack/react-query';
import { Link } from 'expo-router';
import type { IntentDecision } from '@nexui/types';
import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IntentConfirmationModal } from '@/components/intent-confirmation-modal';
import { IntentPreview } from '@/components/intent-previews';
import { MagicBar } from '@/components/magic-bar';
import { getHealth } from '@/lib/api';
import { previewEmphasis } from '@/lib/intent-confidence';
import { colors, fonts } from '@/lib/theme';
import { useIntentPrediction } from '@/lib/use-intent-prediction';

export default function HomeScreen() {
  const { text, setText, decision, isPredicting, error } = useIntentPrediction();
  const [selectedDecision, setSelectedDecision] = useState<IntentDecision | null>(null);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 15_000,
  });

  const status = health.isPending ? 'Checking…' : health.isError ? 'Unreachable' : 'Connected';
  const statusColor = health.isPending
    ? colors.faint
    : health.isError
      ? colors.danger
      : colors.success;
  // Only mark up the input when there is a draft on screen to explain.
  const shown = decision && previewEmphasis(decision) !== 'none' ? decision : null;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
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
          <Text style={styles.subtitle}>Type a plan. Nexui marks the details it picked up.</Text>

          <MagicBar value={text} onChangeText={setText} highlights={shown?.highlights} />

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
            onContinue={() => {
              if (!decision) {
                return;
              }

              Keyboard.dismiss();
              setSelectedDecision(decision);
            }}
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
                style={({ pressed }) => [
                  styles.retry,
                  (pressed || health.isFetching) && styles.dimmed,
                ]}
              >
                <Text style={styles.retryText}>
                  {health.isFetching ? 'Checking…' : 'Check again'}
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      </ScrollView>
      {selectedDecision ? (
        <IntentConfirmationModal
          decision={selectedDecision}
          onClose={() => setSelectedDecision(null)}
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.page },
  scroll: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 28, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 440, alignSelf: 'center' },
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
});
