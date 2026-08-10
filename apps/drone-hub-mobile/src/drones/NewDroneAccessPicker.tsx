import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Check from 'lucide-react-native/icons/check';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import { colors } from '../theme';
import { AnchoredPickerPopover } from './AnchoredPickerPopover';
import type { MobileDroneAgentPermissionMode, MobileDroneApprovalPolicy } from './NewDroneScreen';

export function mobileAccessLabel(value: MobileDroneAgentPermissionMode): string {
  if (value === 'read-only') return 'Read';
  if (value === 'workspace-write') return 'Write';
  return 'Execute';
}

export function mobileApprovalLabel(value: MobileDroneApprovalPolicy): string {
  if (value === 'ask') return 'Ask';
  if (value === 'agent-decides') return 'Decide';
  return 'Never ask';
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
  const window = useWindowDimensions();
  const [accessOpen, setAccessOpen] = React.useState(false);
  React.useEffect(() => {
    if (open) setAccessOpen(false);
  }, [open]);

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
    { value: 'ask', label: 'Ask', disabled: !approvalsSupported },
    ...(agentIsCodex
      ? [{ value: 'agent-decides' as const, label: 'Decide for me', disabled: !approvalsSupported }]
      : []),
    { value: 'never', label: 'Never ask', disabled: !approvalsSupported },
  ];
  const triggerLabel = `${mobileAccessLabel(permissionMode)} · ${mobileApprovalLabel(approvalPolicy)}`;

  return (
    <AnchoredPickerPopover
      open={open}
      onClose={onClose}
      width={Math.min(window.width - 36, 310)}
      anchorStyle={[styles.root, open && styles.rootOpen]}
      menuStyle={styles.menu}
      trigger={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Chat access and approvals: ${triggerLabel}`}
          accessibilityState={{ expanded: open, disabled }}
          disabled={disabled}
          hitSlop={4}
          onPress={open ? onClose : onOpen}
          style={({ pressed }) => [
            styles.trigger,
            disabled && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text numberOfLines={1} style={styles.triggerText}>
            {triggerLabel}
          </Text>
          <ChevronDown
            color={colors.accent}
            size={15}
            strokeWidth={2.1}
            style={open ? styles.chevronOpen : undefined}
          />
        </Pressable>
      }
    >
      {!accessOpen ? (
        <>
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
                    active && styles.choiceActive,
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
        </>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: accessOpen }}
        onPress={() => setAccessOpen((value) => !value)}
        style={({ pressed }) => [styles.accessToggle, pressed && styles.pressed]}
      >
        <Text style={styles.accessToggleText}>{mobileAccessLabel(permissionMode)}</Text>
        <ChevronDown
          color={colors.accent}
          size={15}
          strokeWidth={2.1}
          style={accessOpen ? styles.chevronOpen : undefined}
        />
      </Pressable>

      {accessOpen ? (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.accessList}>
          {accessOptions.map((option) => {
            const active = option.value === permissionMode;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ checked: active, disabled: disabled || option.disabled }}
                disabled={disabled || option.disabled}
                onPress={() => {
                  onPermissionModeChange(option.value);
                  setAccessOpen(false);
                }}
                style={({ pressed }) => [
                  styles.accessChoice,
                  active && styles.choiceActive,
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
                {active ? <Check color={colors.accent} size={15} strokeWidth={2.7} /> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      {!readOnlySupported || !approvalsSupported ? (
        <Text style={styles.notice}>
          {!readOnlySupported
            ? 'This agent supports Execute access only.'
            : 'Approval choices require Execute access and a supported agent.'}
        </Text>
      ) : null}
    </AnchoredPickerPopover>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', flexShrink: 0, zIndex: 1 },
  rootOpen: { zIndex: 30 },
  trigger: {
    minHeight: 32,
    maxWidth: 200,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
  },
  triggerText: { flexShrink: 1, color: colors.textSecondary, fontSize: 11, fontWeight: '600' },
  chevronOpen: { transform: [{ rotate: '180deg' }] },
  menu: {
    maxHeight: 350,
    overflow: 'hidden',
    padding: 7,
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
  sectionLabel: {
    color: colors.mutedDim,
    fontSize: 8,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.55,
    paddingHorizontal: 6,
    paddingTop: 1,
    paddingBottom: 4,
  },
  approvalChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, paddingBottom: 6 },
  approvalChoice: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  approvalText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  choiceActive: { backgroundColor: colors.accentDark },
  activeText: { color: colors.accentAlt },
  accessToggle: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 9,
    borderRadius: 8,
    backgroundColor: colors.controlSurface,
  },
  accessToggleText: { color: colors.text, fontSize: 11, fontWeight: '600' },
  scroll: { flexGrow: 0 },
  accessList: { paddingTop: 5, gap: 2 },
  accessChoice: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
  },
  accessCopy: { flex: 1, minWidth: 0 },
  accessName: { color: colors.text, fontSize: 11, fontWeight: '700' },
  accessDetail: { color: colors.mutedDim, fontSize: 9, lineHeight: 12, marginTop: 1 },
  notice: {
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    paddingHorizontal: 6,
    paddingTop: 6,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
