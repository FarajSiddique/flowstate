import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text, View } from 'react-native';

import { ApiError, undoIntentEvent } from '@/lib/api';
import { colors, fonts } from '@/lib/theme';
import { TIMELINE_KEY } from '@/lib/use-timeline';
import {
  clearUndo,
  showUndoStatus,
  STATUS_MS,
  UNDO_MS,
  useUndoStore,
} from '@/stores/use-undo-store';

// Shows what was just saved or changed, with Undo for 8 seconds.
export function UndoToast() {
  const queryClient = useQueryClient();
  const toast = useUndoStore((state) => state.toast);
  const undo = useMutation({
    mutationFn: undoIntentEvent,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TIMELINE_KEY });
      showUndoStatus('Undone');
    },
    onError: (error) => {
      showUndoStatus(
        error instanceof ApiError ? error.message : 'Could not undo. Check your connection.',
      );
    },
  });

  useEffect(() => {
    if (!toast) {
      return;
    }

    AccessibilityInfo.announceForAccessibility(toast.message);
    const timer = setTimeout(
      () => {
        if (useUndoStore.getState().toast?.shownAt === toast.shownAt) {
          clearUndo();
        }
      },
      toast.eventId ? UNDO_MS : STATUS_MS,
    );

    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) {
    return null;
  }

  const { eventId } = toast;

  return (
    <View style={styles.toast}>
      <Text numberOfLines={2} style={styles.message}>
        {toast.message}
      </Text>
      {eventId ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Undo"
          disabled={undo.isPending}
          onPress={() => undo.mutate(eventId)}
          style={({ pressed }) => [styles.undo, (pressed || undo.isPending) && styles.dimmed]}
        >
          <Text style={styles.undoText}>{undo.isPending ? 'Undoing…' : 'Undo'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingLeft: 16,
    paddingRight: 6,
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: colors.ink,
  },
  message: { flex: 1, fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.page },
  undo: { minHeight: 44, minWidth: 44, paddingHorizontal: 12, justifyContent: 'center' },
  undoText: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: colors.page,
    textDecorationLine: 'underline',
  },
  dimmed: { opacity: 0.6 },
});
