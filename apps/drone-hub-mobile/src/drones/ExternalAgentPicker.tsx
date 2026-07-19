import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Check from 'lucide-react-native/icons/check';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';

export type ExternalAgentPickerOption = {
  id: string;
  label: string;
  detail: string;
};

export function ExternalAgentPicker({
  open,
  value,
  options,
  disabled = false,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: string;
  options: ExternalAgentPickerOption[];
  disabled?: boolean;
  onClose(): void;
  onSelect(value: string): void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const sheetWidth = Math.min(window.width * 0.92, 390);

  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.layer}>
        <Pressable accessibilityLabel="Close external agent picker" onPress={onClose} style={StyleSheet.absoluteFill} />
        <View
          accessibilityRole="radiogroup"
          style={[
            styles.sheet,
            { width: sheetWidth, marginBottom: Math.max(insets.bottom + 6, 12) },
          ]}
        >
          <View style={styles.header}>
            <Text style={styles.title}>External agent</Text>
            <Text style={styles.subtitle}>Choose the coding agent for this drone.</Text>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list}>
            {options.map((option) => {
              const active = option.id === value;
              return (
                <Pressable
                  key={option.id}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: active, disabled }}
                  disabled={disabled}
                  onPress={() => onSelect(option.id)}
                  style={({ pressed }) => [
                    styles.option,
                    active && styles.optionActive,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.optionCopy}>
                    <Text style={[styles.optionLabel, active && styles.activeText]}>
                      {option.label}
                    </Text>
                    <Text style={styles.optionDetail}>{option.detail}</Text>
                  </View>
                  {active ? <Check color={colors.accent} size={17} strokeWidth={2.8} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  layer: {
    flex: 1,
    alignItems: 'flex-end',
    justifyContent: 'flex-end',
    paddingHorizontal: 10,
  },
  sheet: {
    maxWidth: '92%',
    maxHeight: '72%',
    overflow: 'hidden',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.55,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 18,
  },
  header: { paddingHorizontal: 16, paddingTop: 15, paddingBottom: 11, gap: 3 },
  title: { color: colors.textStrong, fontSize: 17, fontWeight: '800' },
  subtitle: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  scroll: { flexGrow: 0 },
  list: { paddingHorizontal: 12, paddingBottom: 12, gap: 6 },
  option: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: colors.panelRaised,
  },
  optionActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  optionCopy: { flex: 1, minWidth: 0, gap: 2 },
  optionLabel: { color: colors.text, fontSize: 13, fontWeight: '800' },
  optionDetail: { color: colors.muted, fontSize: 10, lineHeight: 14 },
  activeText: { color: colors.accentAlt },
  pressed: { opacity: 0.72 },
});
