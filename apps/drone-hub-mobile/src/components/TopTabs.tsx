import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme';

type TopTabIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

export type TopTabOption<T extends string> = {
  value: T;
  label: string;
  icon?: TopTabIcon;
};

export function TopTabs<T extends string>({
  value,
  options,
  disabled = false,
  style,
  onChange,
}: {
  value: T;
  options: Array<TopTabOption<T>>;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  onChange(value: T): void;
}) {
  return (
    <View style={[styles.tabs, style]}>
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active, disabled }}
            disabled={disabled}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.tab,
              active && styles.tabActive,
              disabled && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {Icon ? (
              <Icon
                color={active ? colors.accent : colors.text}
                size={14}
                strokeWidth={active ? 2.4 : 2}
              />
            ) : null}
            <Text style={[styles.tabText, active && styles.tabTextActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    minHeight: 46,
    flexDirection: 'row',
    backgroundColor: colors.panel,
  },
  tab: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.accent,
    backgroundColor: colors.accentWash,
  },
  tabText: {
    color: colors.text,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  tabTextActive: { color: colors.accent },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.72 },
});
