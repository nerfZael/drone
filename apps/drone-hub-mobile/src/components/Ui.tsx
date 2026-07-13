import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel,
  busy,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
  destructive?: boolean;
  onCancel(): void;
  onConfirm(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={busy ? undefined : onCancel}
    >
      <View
        style={[
          styles.dialogLayer,
          {
            paddingTop: Math.max(insets.top, 24),
            paddingBottom: Math.max(insets.bottom, 24),
          },
        ]}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close confirmation"
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog}>
          <View style={[styles.dialogMark, destructive && styles.dialogMarkDanger]}>
            <Text style={[styles.dialogMarkText, destructive && styles.dialogMarkTextDanger]}>
              !
            </Text>
          </View>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogMessage}>{message}</Text>
          <View style={styles.dialogActions}>
            <Button tone="quiet" disabled={busy} onPress={onCancel} style={styles.dialogButton}>
              Cancel
            </Button>
            <Button
              tone={destructive ? 'danger' : 'accent'}
              loading={busy}
              onPress={onConfirm}
              style={styles.dialogButton}
            >
              {confirmLabel}
            </Button>
          </View>
        </View>
      </View>
    </Modal>
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
  dialogLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: 'rgba(3, 10, 12, 0.76)',
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    padding: 22,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 16,
  },
  dialogMark: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: colors.accentDark,
    marginBottom: 16,
  },
  dialogMarkDanger: { backgroundColor: '#35191d' },
  dialogMarkText: { color: colors.accent, fontSize: 18, fontWeight: '900' },
  dialogMarkTextDanger: { color: colors.danger },
  dialogTitle: { color: colors.text, fontSize: 21, fontWeight: '800', letterSpacing: -0.4 },
  dialogMessage: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 9 },
  dialogActions: { flexDirection: 'row', gap: 9, marginTop: 22 },
  dialogButton: { flex: 1 },
});
