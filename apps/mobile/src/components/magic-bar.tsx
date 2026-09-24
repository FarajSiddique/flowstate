import type { IntentHighlight } from '@nexui/types';
import { useEffect, useMemo, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextStyle,
} from 'react-native';

import { highlightSegments } from '@/lib/highlight-segments';
import { colors, fonts, markers } from '@/lib/theme';

// The input sits over a text layer with identical metrics. That layer paints marker
// colors behind the words Nexui used, so the user's own sentence explains the draft.
export function MagicBar({
  value,
  onChangeText,
  highlights,
}: {
  value: string;
  onChangeText: (value: string) => void;
  highlights?: readonly IntentHighlight[];
}) {
  const [focused, setFocused] = useState(false);
  const segments = useMemo(() => highlightSegments(value, highlights), [value, highlights]);
  const marked = segments.some((segment) => segment.field);
  const [opacity] = useState(() => new Animated.Value(0));

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      // Marks fade in when a decision arrives and clear at once when typing resumes.
      if (reduceMotion || !marked) opacity.setValue(marked ? 1 : 0);
      else
        Animated.timing(opacity, {
          toValue: 1,
          duration: 220,
          useNativeDriver: Platform.OS !== 'web',
        }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [marked, opacity]);

  return (
    <View style={[styles.bar, focused && styles.barFocused]}>
      <Animated.Text
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        aria-hidden
        style={[styles.text, styles.markLayer, { opacity }]}
      >
        {segments.map((segment, index) => (
          <Text
            key={index}
            style={segment.field ? { backgroundColor: markers[segment.field] } : undefined}
          >
            {segment.text}
          </Text>
        ))}
      </Animated.Text>
      <TextInput
        accessibilityLabel="What do you want to do?"
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="What do you want to do?"
        placeholderTextColor={colors.faint}
        selectionColor={colors.ink}
        cursorColor={colors.ink}
        multiline
        maxLength={500}
        scrollEnabled={false}
        textAlignVertical="top"
        style={[styles.text, styles.input, webInput]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginTop: 28,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: colors.line,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  barFocused: { borderColor: colors.ink },
  // Both layers must share every metric that affects line wrapping.
  text: {
    fontFamily: fonts.input,
    fontSize: 24,
    lineHeight: 32,
    letterSpacing: -0.3,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
  },
  markLayer: {
    position: 'absolute',
    top: 16,
    left: 18,
    right: 18,
    color: 'transparent',
    zIndex: 0,
  },
  input: {
    minHeight: 96,
    color: colors.ink,
    backgroundColor: 'transparent',
    borderWidth: 0,
    zIndex: 1,
  },
});

// The bar's border already shows focus; drop the browser's ring (not in RN's style types).
const webInput = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;
