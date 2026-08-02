import React from 'react';
import { Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Box from 'lucide-react-native/icons/box';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Monitor from 'lucide-react-native/icons/monitor';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type { MobileDroneCreateRuntime } from './NewDroneScreen';

const RUNTIME_OPTIONS: Array<{
  value: MobileDroneCreateRuntime;
  label: string;
  detail: string;
}> = [
  { value: 'container', label: 'Container', detail: 'Managed, isolated workspace' },
  { value: 'host', label: 'Host', detail: 'Run directly on this hub' },
];

function RuntimeIcon({ runtime, size = 16 }: { runtime: MobileDroneCreateRuntime; size?: number }) {
  const color = runtime === 'host' ? colors.online : colors.accent;
  return runtime === 'host' ? (
    <Monitor color={color} size={size} strokeWidth={2} />
  ) : (
    <Box color={color} size={size} strokeWidth={2} />
  );
}

export function NewDroneRuntimePicker({
  open,
  value,
  disabled,
  localDevice,
  onOpen,
  onClose,
  onSelect,
}: {
  open: boolean;
  value: MobileDroneCreateRuntime;
  disabled?: boolean;
  localDevice?: boolean;
  onOpen(): void;
  onClose(): void;
  onSelect(value: MobileDroneCreateRuntime): void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const current = RUNTIME_OPTIONS.find((option) => option.value === value)!;
  const options = localDevice
    ? RUNTIME_OPTIONS.filter((option) => option.value === 'host')
    : RUNTIME_OPTIONS;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Execution target: ${current.label}`}
        accessibilityState={{ expanded: open, disabled: disabled || localDevice }}
        disabled={disabled || localDevice}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <View style={[styles.iconChip, value === 'host' && styles.hostIconChip]}>
          <RuntimeIcon runtime={value} />
        </View>
        <View style={styles.triggerCopy}>
          <Text style={styles.triggerLabel}>{current.label}</Text>
          <Text numberOfLines={1} style={styles.triggerDetail}>
            {current.detail}
          </Text>
        </View>
        {!localDevice ? <ChevronDown color={colors.accent} size={16} strokeWidth={2.1} /> : null}
      </Pressable>

      <Modal
        visible={open && !localDevice}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onClose}
      >
        <View style={styles.layer}>
          <Pressable
            accessibilityLabel="Close execution target picker"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.sheet,
              {
                width: Math.min(window.width * 0.92, 330),
                marginBottom: Math.max(insets.bottom + 6, 12),
              },
            ]}
          >
            <Text style={styles.title}>Execution target</Text>
            <View style={styles.options} accessibilityRole="radiogroup">
              {options.map((option) => {
                const active = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled }}
                    disabled={disabled}
                    onPress={() => {
                      onSelect(option.value);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.option,
                      active && styles.optionActive,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.iconChip, option.value === 'host' && styles.hostIconChip]}>
                      <RuntimeIcon runtime={option.value} />
                    </View>
                    <View style={styles.optionCopy}>
                      <Text style={[styles.optionLabel, active && styles.activeText]}>
                        {option.label}
                      </Text>
                      <Text style={styles.optionDetail}>{option.detail}</Text>
                    </View>
                    {active ? <Check color={colors.accent} size={16} strokeWidth={2.7} /> : null}
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minWidth: 180,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
  },
  triggerCopy: { flex: 1, minWidth: 0 },
  triggerLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  triggerDetail: { color: colors.mutedDim, fontSize: 9, marginTop: 1 },
  iconChip: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: colors.accentDark,
  },
  hostIconChip: { backgroundColor: colors.onlineDark },
  layer: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: {
    maxWidth: '92%',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  title: {
    color: colors.textStrong,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 13,
    paddingTop: 11,
    paddingBottom: 5,
  },
  options: { paddingHorizontal: 8, paddingBottom: 8 },
  option: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  optionActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  optionCopy: { flex: 1, minWidth: 0 },
  optionLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  optionDetail: { color: colors.mutedDim, fontSize: 9, marginTop: 2 },
  activeText: { color: colors.accentAlt },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
