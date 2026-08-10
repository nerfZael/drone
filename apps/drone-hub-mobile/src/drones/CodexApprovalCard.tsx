import type { CodexApprovalDecision, CodexPendingApproval } from '@drone/assistant-chat';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, Card } from '../components/Ui';
import { colors } from '../theme';

function approvalTitle(approval: CodexPendingApproval): string {
  if (approval.kind === 'file_change') return 'Apply file changes';
  if (approval.kind === 'permissions') return 'Grant additional permissions';
  return 'Run command';
}

export function CodexApprovalCard({
  approval,
  busy,
  disabled = false,
  onResolve,
}: {
  approval: CodexPendingApproval;
  busy?: boolean;
  disabled?: boolean;
  onResolve(decision: CodexApprovalDecision): void;
}) {
  const details = [
    approval.command ? `Command: ${approval.command}` : '',
    approval.cwd ? `Directory: ${approval.cwd}` : '',
    approval.grantRoot ? `Grant root: ${approval.grantRoot}` : '',
    approval.reason ? `Reason: ${approval.reason}` : '',
    approval.permissions ? `Permissions: ${JSON.stringify(approval.permissions)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const supports = (decision: CodexApprovalDecision) =>
    approval.availableDecisions.includes(decision);

  return (
    <Card style={styles.card}>
      <Text style={styles.eyebrow}>Codex approval required</Text>
      <Text style={styles.title}>{approvalTitle(approval)}</Text>
      {details ? <Text style={styles.details}>{details}</Text> : null}
      {approval.detailsTruncated ? (
        <Text style={styles.warning}>
          Some request details were too large to send to this device. Review and approve from the
          desktop app.
        </Text>
      ) : null}
      <View style={styles.actions}>
        {supports('cancel') ? (
          <Button
            tone="quiet"
            disabled={disabled || busy}
            onPress={() => onResolve('cancel')}
            style={styles.button}
          >
            Cancel
          </Button>
        ) : null}
        {supports('decline') ? (
          <Button
            tone="quiet"
            disabled={disabled || busy}
            onPress={() => onResolve('decline')}
            style={styles.button}
          >
            Deny
          </Button>
        ) : null}
        {supports('accept') ? (
          <Button
            disabled={disabled || busy || approval.detailsTruncated}
            onPress={() => onResolve('accept')}
            style={styles.button}
          >
            Approve once
          </Button>
        ) : null}
        {supports('acceptForSession') ? (
          <Button
            disabled={disabled || busy || approval.detailsTruncated}
            onPress={() => onResolve('acceptForSession')}
            style={styles.button}
          >
            Approve session
          </Button>
        ) : null}
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
  warning: { color: colors.warning, fontSize: 11, lineHeight: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  button: { minWidth: '46%', flexGrow: 1 },
});
