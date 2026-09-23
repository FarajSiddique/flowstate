import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getHealth } from '@/lib/api';
import { useDemoStore } from '@/stores/use-demo-store';

export default function HomeScreen() {
  const manualChecks = useDemoStore((state) => state.manualChecks);
  const recordCheck = useDemoStore((state) => state.recordCheck);
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => getHealth(signal),
    refetchInterval: 15_000,
  });

  const status = health.isPending ? 'Checking…' : health.isError ? 'Unreachable' : 'Connected';
  const statusColor = health.isPending ? '#68788C' : health.isError ? '#B33B35' : '#21764C';

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.content}>
          <Text accessibilityRole="header" style={styles.title}>
            flowstate
          </Text>
          <Text style={styles.subtitle}>AI-native interfaces, built around intent.</Text>
          <View style={styles.statusRow}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              API status: {status}
            </Text>
          </View>
          {health.isError && (
            <Text style={styles.error}>
              Unable to reach the API. Check your connection and try again.
            </Text>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: health.isFetching }}
            disabled={health.isFetching}
            onPress={() => {
              recordCheck();
              void health.refetch();
            }}
            style={({ pressed }) => [
              styles.button,
              (pressed || health.isFetching) && styles.dimmed,
            ]}
          >
            <Text style={styles.buttonText}>{health.isFetching ? 'Checking…' : 'Check again'}</Text>
          </Pressable>
          <Text style={styles.caption}>Manual checks: {manualChecks}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F6F8FC' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 28 },
  content: { width: '100%', maxWidth: 420, alignSelf: 'center' },
  title: { fontSize: 48, fontWeight: '700', letterSpacing: -2, color: '#182B42' },
  subtitle: { fontSize: 20, lineHeight: 30, color: '#52647B', marginTop: 16, maxWidth: 320 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 40 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  status: { fontSize: 16, color: '#182B42' },
  error: { fontSize: 14, lineHeight: 22, color: '#B33B35', marginTop: 12 },
  button: {
    marginTop: 24,
    paddingVertical: 14,
    paddingHorizontal: 22,
    borderRadius: 12,
    backgroundColor: '#245CCA',
    alignSelf: 'flex-start',
  },
  buttonText: { fontSize: 16, fontWeight: '600', color: '#FFFFFF' },
  dimmed: { opacity: 0.6 },
  caption: { fontSize: 13, color: '#68788C', marginTop: 16 },
});
