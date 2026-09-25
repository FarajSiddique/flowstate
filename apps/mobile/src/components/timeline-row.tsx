import type { SavedItem } from '@nexui/types';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { displayItemMeta } from '@/lib/intent-display';
import { colors, fonts } from '@/lib/theme';

// One saved item: a completion checkbox and a tappable body that opens the edit sheet.
export function TimelineRow({
  item,
  onToggle,
  onOpen,
}: {
  item: SavedItem;
  onToggle: () => void;
  onOpen: () => void;
}) {
  const done = item.completedAt !== null;

  return (
    <View style={[styles.row, done && styles.done]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${item.title}: ${done ? 'done' : 'not done'}`}
        hitSlop={10}
        onPress={onToggle}
        style={[styles.check, done && styles.checkOn]}
      >
        {done ? <Text style={styles.checkMark}>✓</Text> : null}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens the edit form"
        onPress={onOpen}
        style={({ pressed }) => [styles.body, pressed && styles.pressed]}
      >
        <Text numberOfLines={2} style={[styles.title, done && styles.titleDone]}>
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
  done: { opacity: 0.55 },
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
  checkOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  checkMark: { color: colors.page, fontFamily: fonts.bodyBold, fontSize: 14 },
  body: { flex: 1 },
  pressed: { opacity: 0.7 },
  title: { fontFamily: fonts.bodyBold, fontSize: 16, lineHeight: 22, color: colors.ink },
  titleDone: { textDecorationLine: 'line-through' },
  meta: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
