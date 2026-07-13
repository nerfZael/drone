import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { colors } from '../theme';

export function Card({ children, style }: { children: any; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Label({ children }: { children: string }) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Button({
  children,
  onPress,
  disabled,
  loading,
  tone = 'accent',
  style,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'accent' | 'quiet' | 'danger';
  style?: ViewStyle;
}) {
  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        buttonTones[tone],
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator
          color={tone === 'accent' ? colors.background : colors.text}
          size="small"
        />
      ) : null}
      <Text style={[styles.buttonText, tone === 'accent' && styles.accentButtonText]}>
        {children}
      </Text>
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.error}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export const textStyles: Record<string, TextStyle> = {
  title: { color: colors.text, fontSize: 27, fontWeight: '700', letterSpacing: -0.7 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '700' },
  body: { color: colors.muted, fontSize: 14, lineHeight: 20 },
  mono: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
};

const buttonTones = StyleSheet.create({
  accent: { backgroundColor: colors.accent, borderColor: colors.accent },
  quiet: { backgroundColor: colors.panelRaised, borderColor: colors.border },
  danger: { backgroundColor: '#35191d', borderColor: '#653139' },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 16,
  },
  label: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  button: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 15,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonText: { color: colors.text, fontSize: 13, fontWeight: '700' },
  accentButtonText: { color: colors.background },
  disabled: { opacity: 0.45 },
  pressed: { transform: [{ scale: 0.985 }] },
  error: {
    backgroundColor: '#35191d',
    borderColor: '#653139',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
});
