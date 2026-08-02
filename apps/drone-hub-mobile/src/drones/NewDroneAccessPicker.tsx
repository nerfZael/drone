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
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import ShieldCheck from 'lucide-react-native/icons/shield-check';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '../theme';
import type { MobileDroneAgentPermissionMode, MobileDroneApprovalPolicy } from './NewDroneScreen';

export function mobileAccessLabel(value: MobileDroneAgentPermissionMode): string {
  if (value === 'read-only') return 'Read';
  if (value === 'workspace-write') return 'Write';
  return 'Execute';
}

export function mobileApprovalLabel(value: MobileDroneApprovalPolicy): string {
  if (value === 'ask') return 'Ask';
  if (value === 'agent-decides') return 'Decide for me';
  return 'Always allow';
}

export function NewDroneAccessPicker({
  open,
  permissionMode,
  approvalPolicy,
  readOnlySupported,
  approvalsSupported,
  agentIsCodex,
  disabled,
  onOpen,
  onClose,
  onPermissionModeChange,
  onApprovalPolicyChange,
}: {
  open: boolean;
  permissionMode: MobileDroneAgentPermissionMode;
  approvalPolicy: MobileDroneApprovalPolicy;
  readOnlySupported: boolean;
  approvalsSupported: boolean;
  agentIsCodex: boolean;
  disabled?: boolean;
  onOpen(): void;
  onClose(): void;
  onPermissionModeChange(value: MobileDroneAgentPermissionMode): void;
  onApprovalPolicyChange(value: MobileDroneApprovalPolicy): void;
}) {
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const accessOptions: Array<{
    value: MobileDroneAgentPermissionMode;
    label: string;
    detail: string;
    disabled?: boolean;
  }> = [
    {
      value: 'read-only',
      label: 'Read',
      detail: 'Inspect files in a read-only sandbox.',
      disabled: !readOnlySupported,
    },
    {
      value: 'workspace-write',
      label: 'Write',
      detail: 'Write inside the workspace sandbox.',
      disabled: !readOnlySupported,
    },
    { value: 'full-access', label: 'Execute', detail: 'Run with full command access.' },
  ];
  const approvalOptions: Array<{
    value: MobileDroneApprovalPolicy;
    label: string;
    disabled?: boolean;
  }> = [
    { value: 'ask', label: 'Ask', disabled: !approvalsSupported || agentIsCodex },
    ...(agentIsCodex
      ? [{ value: 'agent-decides' as const, label: 'Decide for me', disabled: !approvalsSupported }]
      : []),
    { value: 'never', label: 'Always allow', disabled: !approvalsSupported },
  ];
  const triggerLabel = `${mobileAccessLabel(permissionMode)} · ${mobileApprovalLabel(approvalPolicy)}`;

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Chat access and approvals: ${triggerLabel}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={onOpen}
        style={({ pressed }) => [
          styles.trigger,
          disabled && styles.disabled,
          pressed && styles.pressed,
        ]}
      >
        <ShieldCheck color={colors.accent} size={14} strokeWidth={2} />
        <Text numberOfLines={1} style={styles.triggerText}>
          {triggerLabel}
        </Text>
        <ChevronDown color={colors.accent} size={15} strokeWidth={2.1} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        statusBarTranslucent
        navigationBarTranslucent
        onRequestClose={onClose}
      >
        <View style={styles.layer}>
          <Pressable
            accessibilityLabel="Close chat access picker"
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
          <View
            style={[
              styles.sheet,
              {
                width: Math.min(window.width * 0.94, 390),
                marginBottom: Math.max(insets.bottom + 6, 12),
              },
            ]}
          >
            <View style={styles.header}>
              <Text style={styles.title}>Chat access</Text>
              <Text style={styles.subtitle}>
                Choose what the agent can do and how commands are approved.
              </Text>
            </View>
            <Text style={styles.sectionLabel}>Approvals</Text>
            <View style={styles.approvalChoices}>
              {approvalOptions.map((option) => {
                const active = option.value === approvalPolicy;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{
                      selected: active,
                      disabled: disabled || option.disabled,
                    }}
                    disabled={disabled || option.disabled}
                    onPress={() => {
                      onApprovalPolicyChange(option.value);
                      onClose();
                    }}
                    style={({ pressed }) => [
                      styles.approvalChoice,
                      active && styles.approvalChoiceActive,
                      option.disabled && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.approvalText, active && styles.activeText]}>
                      {option.label}
                    </Text>
                    {active ? <Check color={colors.accent} size={13} strokeWidth={2.7} /> : null}
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.sectionLabel}>Access</Text>
            <ScrollView
              accessibilityRole="radiogroup"
              style={styles.scroll}
              contentContainerStyle={styles.accessList}
            >
              {accessOptions.map((option) => {
                const active = option.value === permissionMode;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: active, disabled: disabled || option.disabled }}
                    disabled={disabled || option.disabled}
                    onPress={() => onPermissionModeChange(option.value)}
                    style={({ pressed }) => [
                      styles.accessChoice,
                      active && styles.accessChoiceActive,
                      option.disabled && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.accessCopy}>
                      <Text style={[styles.accessName, active && styles.activeText]}>
                        {option.label}
                      </Text>
                      <Text style={styles.accessDetail}>{option.detail}</Text>
                    </View>
                    {active ? <Check color={colors.accent} size={16} strokeWidth={2.7} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
            {!readOnlySupported || !approvalsSupported ? (
              <Text style={styles.notice}>
                {!readOnlySupported
                  ? 'This agent supports Execute access only.'
                  : 'Approval choices require Execute access and a supported agent.'}
              </Text>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: {
    minHeight: 34,
    maxWidth: 210,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: colors.controlSurface,
  },
  triggerText: { flexShrink: 1, color: colors.textSecondary, fontSize: 10, fontWeight: '700' },
  layer: { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-end', paddingHorizontal: 10 },
  sheet: {
    maxWidth: '94%',
    maxHeight: '72%',
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
  header: { paddingHorizontal: 13, paddingTop: 12, paddingBottom: 8, gap: 2 },
  title: { color: colors.textStrong, fontSize: 14, fontWeight: '700' },
  subtitle: { color: colors.mutedDim, fontSize: 9, lineHeight: 13 },
  sectionLabel: {
    color: colors.mutedDim,
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    paddingHorizontal: 13,
    paddingTop: 4,
    paddingBottom: 4,
  },
  approvalChoices: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: 8,
    paddingBottom: 7,
  },
  approvalChoice: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  approvalChoiceActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  approvalText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  activeText: { color: colors.accentAlt },
  scroll: { flexGrow: 0 },
  accessList: { paddingHorizontal: 8, paddingBottom: 8, gap: 3 },
  accessChoice: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  accessChoiceActive: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  accessCopy: { flex: 1, minWidth: 0 },
  accessName: { color: colors.text, fontSize: 12, fontWeight: '700' },
  accessDetail: { color: colors.mutedDim, fontSize: 9, lineHeight: 13, marginTop: 1 },
  notice: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    paddingHorizontal: 13,
    paddingTop: 1,
    paddingBottom: 10,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
