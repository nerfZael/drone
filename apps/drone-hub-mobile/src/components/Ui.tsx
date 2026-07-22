import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AlertTriangle from 'lucide-react-native/icons/triangle-alert';
import { colors, radii } from '../theme';

type ButtonIcon = React.ComponentType<{
  color?: string;
  size?: number;
  strokeWidth?: number;
}>;

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
  icon: Icon,
  style,
}: {
  children: string;
  onPress(): void;
  disabled?: boolean;
  loading?: boolean;
  tone?: 'accent' | 'quiet' | 'danger';
  icon?: ButtonIcon;
  style?: ViewStyle;
}) {
  const foreground =
    tone === 'accent' ? colors.onAccent : tone === 'danger' ? colors.danger : colors.text;

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
        <ActivityIndicator color={foreground} size="small" />
      ) : Icon ? (
        <Icon color={foreground} size={16} strokeWidth={2.3} />
      ) : null}
      <Text
        style={[
          styles.buttonText,
          tone === 'accent' && styles.accentButtonText,
          tone === 'danger' && styles.dangerButtonText,
        ]}
      >
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
          <View style={styles.dialogHeader}>
            <View style={[styles.dialogMark, destructive && styles.dialogMarkDanger]}>
              <AlertTriangle
                color={destructive ? colors.danger : colors.accent}
                size={20}
                strokeWidth={2.3}
              />
            </View>
            <Text accessibilityRole="header" style={[styles.dialogTitle, styles.dialogHeaderTitle]}>
              {title}
            </Text>
          </View>
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

export function TextInputDialog({
  visible,
  title,
  message,
  value,
  error,
  confirmLabel,
  confirmDisabled,
  busy,
  maxLength,
  onChangeText,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  title: string;
  message: string;
  value: string;
  error?: string | null;
  confirmLabel: string;
  confirmDisabled?: boolean;
  busy?: boolean;
  maxLength?: number;
  onChangeText(value: string): void;
  onCancel(): void;
  onConfirm(): void;
}) {
  const insets = useSafeAreaInsets();
  const canSubmit = Boolean(value.trim()) && !busy && !error && !confirmDisabled;
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
          accessibilityLabel={`Close ${title}`}
          disabled={busy}
          onPress={onCancel}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogMessage}>{message}</Text>
          <TextInput
            autoFocus
            accessibilityLabel={title}
            accessibilityState={{ disabled: Boolean(busy) }}
            value={value}
            maxLength={maxLength}
            editable={!busy}
            selectTextOnFocus
            returnKeyType="done"
            onChangeText={onChangeText}
            onSubmitEditing={() => {
              if (canSubmit) onConfirm();
            }}
            style={styles.dialogInput}
          />
          {typeof maxLength === 'number' ? (
            <Text style={styles.dialogInputCount}>{value.length}/{maxLength}</Text>
          ) : null}
          {error ? (
            <View accessibilityLiveRegion="polite" style={styles.dialogInputError}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}
          <View style={styles.dialogActions}>
            <Button tone="quiet" disabled={busy} onPress={onCancel} style={styles.dialogButton}>
              Cancel
            </Button>
            <Button
              disabled={!canSubmit}
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

export type ContextMenuAction = {
  label: string;
  destructive?: boolean;
  onPress(): void;
};

export function ContextMenu({
  visible,
  title,
  actions,
  onClose,
}: {
  visible: boolean;
  title: string;
  actions: ContextMenuAction[];
  onClose(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <View style={[styles.contextMenuLayer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close message actions"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.contextMenu}>
          <Text style={styles.contextMenuTitle}>{title}</Text>
          {actions.map((action) => (
            <Pressable
              key={action.label}
              accessibilityRole="menuitem"
              onPress={() => {
                onClose();
                action.onPress();
              }}
              style={({ pressed }) => [
                styles.contextMenuAction,
                pressed && styles.contextMenuActionPressed,
              ]}
            >
              <Text
                style={[
                  styles.contextMenuActionText,
                  action.destructive && styles.contextMenuActionDanger,
                ]}
              >
                {action.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={({ pressed }) => [
              styles.contextMenuCancel,
              pressed && styles.contextMenuActionPressed,
            ]}
          >
            <Text style={styles.contextMenuCancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

export const textStyles: Record<string, TextStyle> = {
  title: { color: colors.textStrong, fontSize: 29, fontWeight: '800', letterSpacing: -0.9 },
  heading: { color: colors.text, fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  body: { color: colors.muted, fontSize: 14, lineHeight: 21 },
  mono: { color: colors.muted, fontSize: 11, fontFamily: 'monospace' },
};

const buttonTones = StyleSheet.create({
  accent: { backgroundColor: colors.accent, borderColor: colors.accent },
  quiet: { backgroundColor: 'transparent', borderColor: colors.borderStrong },
  danger: { backgroundColor: colors.dangerDark, borderColor: colors.dangerBorder },
});

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panelRaised,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.large,
    padding: 17,
    shadowColor: colors.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  label: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  button: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  buttonText: { color: colors.text, fontSize: 14, fontWeight: '700', letterSpacing: 0.1 },
  accentButtonText: { color: colors.onAccent },
  dangerButtonText: { color: colors.danger },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  error: {
    backgroundColor: colors.dangerDark,
    borderColor: colors.dangerBorder,
    borderWidth: 1,
    borderRadius: radii.medium,
    padding: 13,
  },
  errorText: { color: colors.danger, fontSize: 13, lineHeight: 18 },
  dialogLayer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.overlay,
  },
  dialog: {
    width: '100%',
    maxWidth: 420,
    borderRadius: radii.xlarge,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    padding: 24,
    shadowColor: colors.shadow,
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
    borderRadius: radii.medium,
    backgroundColor: colors.accentDark,
  },
  dialogMarkDanger: { backgroundColor: colors.dangerDark },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dialogHeaderTitle: { flex: 1, minWidth: 0 },
  dialogTitle: { color: colors.textStrong, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  dialogMessage: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: 9 },
  dialogInput: {
    minHeight: 46,
    marginTop: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radii.medium,
    backgroundColor: colors.background,
    paddingHorizontal: 13,
    color: colors.textStrong,
    fontSize: 15,
  },
  dialogInputCount: {
    alignSelf: 'flex-end',
    marginTop: 6,
    color: colors.mutedDim,
    fontSize: 10,
    fontFamily: 'monospace',
  },
  dialogInputError: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    borderRadius: radii.medium,
    backgroundColor: colors.dangerDark,
    padding: 10,
  },
  dialogActions: { flexDirection: 'row', gap: 9, marginTop: 22 },
  dialogButton: { flex: 1 },
  contextMenuLayer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 12,
    backgroundColor: colors.overlay,
  },
  contextMenu: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: radii.xlarge,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 16,
  },
  contextMenuTitle: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 9,
  },
  contextMenuAction: {
    minHeight: 52,
    justifyContent: 'center',
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  contextMenuActionPressed: { backgroundColor: colors.whiteWash },
  contextMenuActionText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  contextMenuActionDanger: { color: colors.danger },
  contextMenuCancel: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 7,
    borderTopColor: colors.background,
  },
  contextMenuCancelText: { color: colors.textStrong, fontSize: 15, fontWeight: '800' },
});
