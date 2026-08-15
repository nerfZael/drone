import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';
import {
  mobileAsapFollowUpTimestampLabel,
  type MobileAsapFollowUp,
} from './mobile-asap-follow-ups';

export function MobileAsapFollowUps({
  followUps,
  renderPrompt,
}: {
  followUps: readonly MobileAsapFollowUp[];
  renderPrompt?: (followUp: MobileAsapFollowUp) => React.ReactElement | null;
}) {
  if (followUps.length === 0) return null;
  return (
    <View style={styles.followUps}>
      {followUps.map((followUp) => {
        const timestamp = mobileAsapFollowUpTimestampLabel(followUp.at);
        const attachmentCount = Math.max(
          0,
          Number(followUp.attachmentCount ?? followUp.attachments?.length) || 0,
        );
        return (
          <View
            key={followUp.id}
            accessible
            accessibilityLabel={`ASAP follow-up${timestamp ? ` sent at ${timestamp}` : ''}`}
            style={styles.followUp}
          >
            <View style={styles.dividerRow}>
              <View style={styles.divider} />
              <Text style={styles.label}>ASAP</Text>
              <View style={styles.divider} />
              {timestamp ? <Text style={styles.timestamp}>{timestamp}</Text> : null}
            </View>
            {followUp.prompt && renderPrompt ? (
              renderPrompt(followUp)
            ) : followUp.prompt ? (
              <Text selectable style={styles.prompt}>
                {followUp.prompt}
              </Text>
            ) : null}
            {followUp.attachments?.length ? (
              <View style={styles.attachments}>
                {followUp.attachments.map((attachment, index) => (
                  <Text
                    key={`${attachment.name}:${index}`}
                    numberOfLines={1}
                    style={styles.attachment}
                  >
                    ▧ {attachment.name}
                  </Text>
                ))}
              </View>
            ) : attachmentCount > 0 ? (
              <Text style={styles.attachmentCount}>
                {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  followUps: { gap: 10 },
  followUp: { gap: 7 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: colors.secondary },
  label: {
    color: colors.secondary,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  timestamp: { color: colors.secondary, fontSize: 9, fontFamily: 'monospace' },
  prompt: { color: colors.userBubbleText, fontSize: 14, lineHeight: 21 },
  attachments: { gap: 3 },
  attachment: { color: colors.secondary, fontSize: 10, fontWeight: '600' },
  attachmentCount: { color: colors.secondary, fontSize: 10, fontWeight: '700' },
});
