import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import type { MobileContinuousVoiceMode } from './mobile-continuous-dictation';

export function MobileContinuousVoiceModePicker({
  visible,
  onClose,
  onSelect,
}: {
  visible: boolean;
  onClose(): void;
  onSelect(mode: MobileContinuousVoiceMode): void;
}) {
  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close continuous voice mode picker"
        onPress={onClose}
        style={styles.backdrop}
      >
        <Pressable
          accessible={false}
          onPress={(event) => event.stopPropagation()}
          style={styles.sheet}
        >
          <Text style={styles.title}>Continuous voice</Text>
          <Text style={styles.description}>Choose what happens to each spoken thought.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect('dictation')}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
          >
            <View style={styles.choiceHeader}>
              <Text style={styles.choiceTitle}>Dictation</Text>
              <Text style={styles.recommended}>Recommended</Text>
            </View>
            <Text style={styles.choiceDescription}>
              Keep editable text in this composer until you send it.
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => onSelect('steering')}
            style={({ pressed }) => [styles.choice, pressed && styles.pressed]}
          >
            <Text style={styles.choiceTitle}>Steering</Text>
            <Text style={styles.choiceDescription}>
              Send each completed thought to the assistant immediately.
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.58)',
  },
  sheet: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 28,
    gap: 10,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  description: { color: colors.secondary, fontSize: 12, marginBottom: 2 },
  choice: {
    minHeight: 68,
    padding: 12,
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.controlSurface,
  },
  choiceHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  choiceTitle: { color: colors.text, fontSize: 14, fontWeight: '700' },
  recommended: { color: colors.accent, fontSize: 10, fontWeight: '700' },
  choiceDescription: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  pressed: { opacity: 0.72 },
});
