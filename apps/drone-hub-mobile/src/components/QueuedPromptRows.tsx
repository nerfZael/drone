import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import { colors } from '../theme';

export type MobileQueuedPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'failed';
  error?: string | null;
  imageCount?: number;
  cancelable?: boolean;
};

export function QueuedPromptRows({
  prompts,
  cancellingId = '',
  onCancel,
}: {
  prompts: MobileQueuedPrompt[];
  cancellingId?: string;
  onCancel?: (promptId: string) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <View>
      {prompts.map((prompt) => {
        const failed = prompt.status === 'failed';
        const pending = prompt.status === 'pending';
        const cancelling = cancellingId === prompt.id;
        const label = failed ? 'Failed' : prompt.status === 'queued' ? 'Queued' : 'Pending';
        if (pending) {
          return (
            <View key={prompt.id} style={styles.pendingMessageGroup}>
              <View style={styles.pendingMessage}>
                {prompt.prompt ? (
                  <Text selectable style={styles.pendingPrompt}>
                    {prompt.prompt}
                  </Text>
                ) : null}
                {prompt.imageCount ? (
                  <Text style={styles.pendingImageCount}>
                    {prompt.imageCount} image{prompt.imageCount === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }
        return (
          <View key={prompt.id} style={[styles.row, failed && styles.rowFailed]}>
            <View style={styles.body}>
              <View style={styles.meta}>
                <Text style={[styles.badge, failed && styles.badgeFailed]}>{label}</Text>
                {prompt.imageCount ? (
                  <Text style={styles.imageCount}>
                    {prompt.imageCount} image{prompt.imageCount === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </View>
              {prompt.prompt ? (
                <Text selectable style={styles.prompt}>
                  {prompt.prompt}
                </Text>
              ) : null}
              {failed && prompt.error ? <Text style={styles.error}>{prompt.error}</Text> : null}
            </View>
            {prompt.cancelable && onCancel ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={failed ? 'Dismiss failed prompt' : 'Cancel queued prompt'}
                accessibilityState={{ disabled: cancelling }}
                disabled={cancelling}
                hitSlop={8}
                onPress={() => onCancel(prompt.id)}
                style={({ pressed }) => [
                  styles.cancel,
                  cancelling && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <X color={failed ? colors.danger : colors.muted} size={15} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignSelf: 'flex-end',
    width: '88%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    borderRadius: 8,
    backgroundColor: colors.accentWash,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 8,
  },
  rowFailed: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  body: { flex: 1, gap: 5 },
  pendingMessageGroup: {
    width: 'auto',
    maxWidth: '86%',
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
    marginHorizontal: 10,
    marginVertical: 7,
  },
  pendingMessage: {
    width: 'auto',
    maxWidth: '100%',
    alignSelf: 'flex-end',
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.surface2,
    borderRadius: 10,
    borderBottomRightRadius: 3,
    backgroundColor: colors.surface1,
  },
  pendingPrompt: { color: colors.textStrong, fontSize: 14, lineHeight: 21 },
  pendingImageCount: { color: colors.muted, fontSize: 10, fontWeight: '700', marginTop: 4 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeFailed: { color: colors.danger },
  imageCount: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  cancel: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
