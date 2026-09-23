import { useQuery } from '@tanstack/react-query';
import type { IntentDecision } from '@flowstate/types';
import { useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IntentConfirmationModal } from '@/components/intent-confirmation-modal';
import { IntentPreview } from '@/components/intent-previews';
import { getHealth } from '@/lib/api';
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
  const statusColor = health.isPending ? '#68788C' : health.isError ? '#B33B35' : '#21764C';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            flowstate
          </Text>
          <Text style={styles.subtitle}>AI-native interfaces, built around intent.</Text>

          <View style={styles.magicBar}>
            <Text style={styles.inputLabel}>YOUR NEXT MOVE</Text>
            <TextInput
              accessibilityLabel="What do you want to do?"
              value={text}
              onChangeText={setText}
              placeholder="What do you want to do?"
              placeholderTextColor="#8997A8"
              multiline
              maxLength={500}
              style={styles.input}
              textAlignVertical="top"
            />
          </View>

          {isPredicting ? (
            <Text accessibilityLiveRegion="polite" style={styles.feedback}>
              Finding the right next step…
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
              if (!decision) return;
              Keyboard.dismiss();
              setSelectedDecision(decision);
            }}
          />

          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              API status: {status}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Check API again"
              disabled={health.isFetching}
              onPress={() => void health.refetch()}
              style={({ pressed }) => [styles.refresh, pressed && styles.dimmed]}
            >
              <Text style={styles.refreshText}>Check again</Text>
            </Pressable>
          </View>
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
  screen: { flex: 1, backgroundColor: '#F6F8FC' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 56, paddingBottom: 36 },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 44, fontWeight: '700', letterSpacing: -2, color: '#182B42' },
  subtitle: { fontSize: 18, lineHeight: 27, color: '#52647B', marginTop: 12, maxWidth: 320 },
  magicBar: {
    marginTop: 42,
    borderWidth: 1,
    borderColor: '#CCD9ED',
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
    shadowColor: '#245CCA',
    shadowOpacity: 0.07,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  inputLabel: { color: '#245CCA', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  input: {
    minHeight: 80,
    maxHeight: 150,
    color: '#182B42',
    fontSize: 19,
    lineHeight: 28,
    marginTop: 13,
  },
  feedback: { color: '#68788C', fontSize: 13, marginTop: 14 },
  error: { color: '#B33B35', fontSize: 13, lineHeight: 20, marginTop: 14 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 48 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { color: '#52647B', fontSize: 13 },
  refresh: { marginLeft: 'auto', paddingVertical: 8 },
  refreshText: { color: '#245CCA', fontSize: 13, fontWeight: '600' },
  dimmed: { opacity: 0.6 },
});
