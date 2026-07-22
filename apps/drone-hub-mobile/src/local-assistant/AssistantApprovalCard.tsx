import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../components/Ui';
import { colors } from '../theme';
import type { LocalAssistantApproval } from './local-assistant-types';

export type MobileAssistantApproval = Omit<LocalAssistantApproval, 'toolName'> & {
  toolName: string;
};

function approvalDetails(approval: MobileAssistantApproval): string {
  const resolved = approval.args?.resolved ?? approval.args ?? {};
  const target =
    resolved.targetLabel || resolved.droneName || resolved.workspaceName || resolved.targetId;
  const command = String(resolved.command ?? approval.args?.command ?? '').trim();
  const message = String(resolved.message ?? approval.args?.message ?? '').trim();
  const renames = Array.isArray(resolved.renames)
    ? resolved.renames
        .map((rename: any) => {
          const from = String(rename?.from ?? rename?.currentName ?? '').trim();
          const to = String(rename?.to ?? rename?.name ?? '').trim();
          return from && to ? `${from} → ${to}` : to;
        })
        .filter(Boolean)
        .join(', ')
    : '';
  const members = Array.isArray(resolved.drones)
    ? resolved.drones
        .map((drone: any) => String(drone?.name ?? drone?.droneName ?? drone ?? '').trim())
        .filter(Boolean)
        .join(', ')
    : '';
  return [
    target ? `Target: ${target}` : '',
    command ? `Command: ${command}` : '',
    message ? `Message: ${message}` : '',
    renames ? `Changes: ${renames}` : '',
    members ? `Members: ${members}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function AssistantApprovalCard({
  approval,
  busy,
  disabled = false,
  onResolve,
}: {
  approval: MobileAssistantApproval;
  busy?: boolean;
  disabled?: boolean;
  onResolve(approved: boolean): void;
}) {
  const detailsTruncated = approval.args?.truncated === true;
  const details = approvalDetails(approval);
  return (
    <Card style={styles.card}>
      <Text style={styles.eyebrow}>Approval required</Text>
      <Text style={styles.title}>{approval.label || 'Execute command'}</Text>
      {detailsTruncated ? (
        <Text style={styles.warning}>
          Request details are too large to review on this device. Deny this request or review it on
          the Hub.
        </Text>
      ) : details ? (
        <Text style={styles.details}>{details}</Text>
      ) : null}
      <View style={styles.actions}>
        <Button
          tone="quiet"
          disabled={disabled || busy}
          onPress={() => onResolve(false)}
          style={styles.button}
        >
          Deny
        </Button>
        <Button
          disabled={disabled || busy || detailsTruncated}
          onPress={() => onResolve(true)}
          style={styles.button}
        >
          Approve
        </Button>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginBottom: 10, gap: 8 },
  eyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  title: { color: colors.textStrong, fontSize: 14, fontWeight: '800' },
  details: { color: colors.muted, fontFamily: 'monospace', fontSize: 11, lineHeight: 17 },
  warning: { color: colors.warning, fontSize: 12, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 8 },
  button: { flex: 1 },
});
