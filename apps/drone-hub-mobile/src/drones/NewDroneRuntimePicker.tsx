import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Box from 'lucide-react-native/icons/box';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Monitor from 'lucide-react-native/icons/monitor';
import { colors } from '../theme';
import { AnchoredPickerPopover } from './AnchoredPickerPopover';
import type { MobileDroneCreateRuntime } from './NewDroneScreen';

const RUNTIME_OPTIONS: Array<{
  value: MobileDroneCreateRuntime;
  label: string;
  detail: string;
}> = [
  { value: 'container', label: 'Container', detail: 'Isolated workspace' },
  { value: 'host', label: 'Host', detail: 'This hub' },
];

export function RuntimeIcon({
  runtime,
  size = 15,
}: {
  runtime: MobileDroneCreateRuntime;
  size?: number;
}) {
  const color = runtime === 'host' ? colors.online : colors.accent;
  return runtime === 'host' ? (
    <Monitor color={color} size={size} strokeWidth={2} />
  ) : (
    <Box color={color} size={size} strokeWidth={2} />
  );
}

export function DroneRuntimeIndicator({ runtime }: { runtime: MobileDroneCreateRuntime }) {
  const label = runtime === 'host' ? 'Host' : 'Container';

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Execution target: ${label}`}
      style={styles.indicator}
    >
      <RuntimeIcon runtime={runtime} />
      <Text numberOfLines={1} style={styles.triggerLabel}>
        {label}
      </Text>
    </View>
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
  const current = RUNTIME_OPTIONS.find((option) => option.value === value)!;
  const options = localDevice
    ? RUNTIME_OPTIONS.filter((option) => option.value === 'host')
    : RUNTIME_OPTIONS;

  return (
    <AnchoredPickerPopover
      open={open && !localDevice}
      onClose={onClose}
      width={220}
      align="left"
      anchorStyle={[styles.root, open && styles.rootOpen]}
      menuStyle={styles.menu}
      trigger={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Execution target: ${current.label}`}
          accessibilityState={{ expanded: open, disabled: disabled || localDevice }}
          disabled={disabled || localDevice}
          hitSlop={4}
          onPress={open ? onClose : onOpen}
          style={({ pressed }) => [
            styles.trigger,
            (disabled || localDevice) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <RuntimeIcon runtime={value} />
          <Text numberOfLines={1} style={styles.triggerLabel}>
            {current.label}
          </Text>
          {!localDevice ? (
            <ChevronDown
              color={colors.accent}
              size={15}
              strokeWidth={2.1}
              style={open ? styles.chevronOpen : undefined}
            />
          ) : null}
        </Pressable>
      }
    >
      <View accessibilityRole="radiogroup">
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
              <RuntimeIcon runtime={option.value} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionLabel, active && styles.activeText]}>
                  {option.label}
                </Text>
                <Text style={styles.optionDetail}>{option.detail}</Text>
              </View>
              {active ? <Check color={colors.accent} size={15} strokeWidth={2.7} /> : null}
            </Pressable>
          );
        })}
      </View>
    </AnchoredPickerPopover>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', zIndex: 1 },
  rootOpen: { zIndex: 30 },
  trigger: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 7,
  },
  indicator: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  triggerLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  menu: {
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 14,
  },
  option: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 8,
  },
  optionActive: { backgroundColor: colors.accentDark },
  optionCopy: { flex: 1, minWidth: 0 },
  optionLabel: { color: colors.text, fontSize: 12, fontWeight: '700' },
  optionDetail: { color: colors.mutedDim, fontSize: 9, marginTop: 1 },
  activeText: { color: colors.accentAlt },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
