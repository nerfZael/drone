import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { colors } from '../theme';
import type { MobileContinuousVoiceStatus } from './mobile-continuous-voice-lifecycle';

export function MobileContinuousDictationDraft({
  status,
  disabled,
  text,
  onPress,
}: {
  status: MobileContinuousVoiceStatus;
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
      <Text style={styles.label}>{mobileContinuousDictationDraftLabel(status)}</Text>
      <Text numberOfLines={6} style={styles.text}>
        {text}
      </Text>
    </Pressable>
  );
}

function mobileContinuousDictationDraftLabel(status: MobileContinuousVoiceStatus): string {
  if (status === 'starting') return 'Starting dictation…';
  if (status === 'paused') return 'Dictation paused · Tap to edit';
  if (status === 'recovering') return 'Dictation reconnecting…';
  if (status === 'stopping') return 'Finishing dictation…';
  if (status === 'error') return 'Dictation needs attention · Tap to edit';
  if (status === 'idle') return 'Dictation stopped · Tap to edit';
  return 'Dictating…';
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
