import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import GitBranch from 'lucide-react-native/icons/git-branch';
import { colors } from '../theme';

export function DroneBranchIndicator({ branch: branchRaw }: { branch?: string | null }) {
  const branch = String(branchRaw ?? '').trim();
  if (!branch) return null;

  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Current branch: ${branch}`}
      style={styles.indicator}
    >
      <GitBranch color={colors.mutedDim} size={15} strokeWidth={2} />
      <Text numberOfLines={1} style={styles.label}>
        {branch}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  indicator: {
    minHeight: 32,
    maxWidth: '46%',
    flexShrink: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 5,
  },
  label: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '600',
  },
});
