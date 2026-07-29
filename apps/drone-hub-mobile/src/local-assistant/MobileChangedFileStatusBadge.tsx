import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import type { MobileChangedFileStatusTone } from './mobile-diff-review-model';

export function MobileChangedFileStatusBadge({
  tone,
  code,
  label,
}: {
  tone: MobileChangedFileStatusTone;
  code: string;
  label?: string;
}) {
  return (
    <View style={[styles.badge, badgeTone[tone]]}>
      <Text style={[styles.text, textTone[tone]]}>{label ? `${code} · ${label}` : code}</Text>
    </View>
  );
}

const badgeTone = StyleSheet.create({
  success: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  warning: { borderColor: colors.warningBorder, backgroundColor: colors.warningDark },
  danger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  accent: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark },
  neutral: { borderColor: colors.borderStrong, backgroundColor: colors.surface0 },
});

const textTone = StyleSheet.create({
  success: { color: colors.online },
  warning: { color: colors.warning },
  danger: { color: colors.danger },
  accent: { color: colors.accent },
  neutral: { color: colors.muted },
});

const styles = StyleSheet.create({
  badge: {
    minWidth: 24,
    minHeight: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 5,
    paddingHorizontal: 5,
  },
  text: { fontSize: 8, fontFamily: 'monospace', fontWeight: '800' },
});
