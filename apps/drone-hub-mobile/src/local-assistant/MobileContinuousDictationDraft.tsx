import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';

export function MobileContinuousDictationDraft({
  active,
  disabled,
  text,
  onPress,
}: {
  active: boolean;
  disabled: boolean;
  text: string;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Edit continuous dictation"
      accessibilityHint="Stops dictation, keeps the text, and opens the keyboard"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.draft,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.label}>{active ? 'Dictating…' : 'Dictation stopped · Tap to edit'}</Text>
      <Text numberOfLines={6} style={styles.text}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  draft: {
    marginHorizontal: 9,
    marginTop: 9,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentWash,
  },
  label: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  text: { color: colors.text, fontSize: 13, lineHeight: 18 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
