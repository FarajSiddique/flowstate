import type { SavedItem } from '@nexui/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { displayItemMeta } from '@/lib/intent-display';
import { colors, fonts } from '@/lib/theme';

// One saved item: a tappable body that opens the edit sheet. Tasks also get a checkbox;
// checking it removes the task from the list (Undo brings it back).
export function TimelineRow({
  item,
  onComplete,
  onOpen,
}: {
  item: SavedItem;
  onComplete: () => void;
  onOpen: () => void;
}) {
  return (
    <View style={styles.row}>
      {item.kind === 'task' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Mark ${item.title} done`}
          hitSlop={10}
          onPress={onComplete}
          style={styles.check}
        />
      ) : (
        <View style={styles.checkSpace} />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the edit form"
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <Text numberOfLines={2} style={styles.title}>
          {item.title}
        </Text>
        <Text style={styles.meta}>{displayItemMeta(item)}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkSpace: { width: 24 },
  body: { flex: 1 },
  pressed: { opacity: 0.7 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
