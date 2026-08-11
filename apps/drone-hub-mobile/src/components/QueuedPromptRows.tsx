import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import X from 'lucide-react-native/icons/x';
import Square from 'lucide-react-native/icons/square';
import MessageSquarePlus from 'lucide-react-native/icons/message-square-plus';
import {
  agentRunFailurePresentation,
  normalizePromptQueueInterruption,
  parseEventNotificationPrompt,
  resolveChatQueueActionPresentation,
  stoppedRunDetail,
  type AgentPlan,
  type AgentRunFailurePresentation,
  type PromptQueueInterruption,
  type PromptQueueInterruptionResolution,
  type SendInNewChatQueueAction,
} from '@drone/assistant-chat';
import { colors } from '../theme';
import { MobileEventNotification } from '../drones/MobileEventNotification';

export type MobileQueuedPrompt = {
  id: string;
  prompt: string;
  status: 'queued' | 'pending' | 'stopped' | 'failed';
  error?: string | null;
  attachmentCount?: number;
  imageCount?: number;
  cancelable?: boolean;
  startedAt?: string;
  agentPlan?: AgentPlan;
  delivered?: boolean;
  queueInterruption?: PromptQueueInterruption;
  action?: SendInNewChatQueueAction;
};

export function MobileAgentFailureDetails({
  error,
  failure: providedFailure,
  hasSavedProgress = false,
  queueInterruption,
  resolving = false,
  onResolve,
}: {
  error?: string | null;
  failure?: AgentRunFailurePresentation;
  hasSavedProgress?: boolean;
  queueInterruption?: PromptQueueInterruption;
  resolving?: boolean;
  onResolve?: (resolution: PromptQueueInterruptionResolution) => void;
}) {
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const failure = providedFailure ?? agentRunFailurePresentation(error);
  return (
    <View style={styles.interruptedCopy}>
      <Text style={styles.interruptedSummary}>
        {failure.summary}{' '}
        {queueInterruption?.state === 'blocked'
          ? 'Queued and steering prompts are paused so they cannot run out of turn. Send a message when you are ready to continue.'
          : queueInterruption?.state === 'continuing'
            ? 'Your follow-up is queued. Later prompts remain paused until it finishes.'
            : queueInterruption?.state === 'continued'
              ? 'Your follow-up finished. Queued prompts can run normally.'
              : queueInterruption?.state === 'skipped'
                ? 'This response was skipped. Queued prompts can run normally.'
                : hasSavedProgress
                  ? 'Completed steps and any file changes are preserved. Send a follow-up to continue when you’re connected.'
                  : 'Send a follow-up to try again when you’re connected.'}
      </Text>
      {queueInterruption?.state === 'blocked' && onResolve ? (
        <View style={styles.interruptionActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip interrupted response and run queued prompts"
            disabled={resolving}
            onPress={() => onResolve('skip')}
            style={({ pressed }) => [
              styles.interruptionTextButton,
              resolving && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.interruptionText}>
              {resolving ? 'Working…' : 'Skip and run queued'}
            </Text>
          </Pressable>
        </View>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={detailsOpen ? 'Hide technical details' : 'Show technical details'}
        accessibilityState={{ expanded: detailsOpen }}
        onPress={() => setDetailsOpen((value) => !value)}
        style={({ pressed }) => pressed && styles.pressed}
      >
        <Text style={styles.technicalToggle}>
          {detailsOpen ? 'Hide technical details' : 'Technical details'}
        </Text>
      </Pressable>
      {detailsOpen ? (
        <Text selectable style={styles.technicalError}>
          {failure.technicalMessage}
        </Text>
      ) : null}
    </View>
  );
}

export function QueuedPromptRows({
  prompts,
  cancellingId = '',
  onCancel,
  creatingId = '',
  onCreateNow,
  resolvingInterruptionId = '',
  onResolveInterruption,
}: {
  prompts: MobileQueuedPrompt[];
  cancellingId?: string;
  onCancel?: (promptId: string) => void;
  creatingId?: string;
  onCreateNow?: (promptId: string) => void;
  resolvingInterruptionId?: string;
  onResolveInterruption?: (promptId: string, resolution: PromptQueueInterruptionResolution) => void;
}) {
  if (prompts.length === 0) return null;
  return (
    <View>
      {prompts.map((prompt) => {
        const eventNotification = parseEventNotificationPrompt(prompt.prompt);
        if (eventNotification) {
          return <MobileEventNotification key={prompt.id} notification={eventNotification} />;
        }
        const attachmentCount = Math.max(
          0,
          Number(prompt.attachmentCount ?? prompt.imageCount) || 0,
        );
        const failed = prompt.status === 'failed';
        const stopped = prompt.status === 'stopped';
        const pending = prompt.status === 'pending';
        const cancelling = cancellingId === prompt.id;
        const creating = creatingId === prompt.id;
        const actionPresentation = resolveChatQueueActionPresentation(prompt.action, prompt.status);
        const interrupted =
          failed && !actionPresentation && agentRunFailurePresentation(prompt.error).recoverable;
        const queueInterruption = normalizePromptQueueInterruption(prompt.queueInterruption);
        const label = failed
          ? interrupted
            ? 'Interrupted'
            : 'Failed'
          : prompt.status === 'queued'
            ? 'Queued'
            : 'Pending';
        if (actionPresentation) {
          return (
            <View
              key={prompt.id}
              style={[styles.row, styles.actionRow, failed && styles.rowFailed]}
            >
              <View style={styles.actionIcon}>
                <MessageSquarePlus color={failed ? colors.danger : colors.accent} size={17} />
              </View>
              <View style={styles.body}>
                <Text style={[styles.badge, failed && styles.badgeFailed]}>
                  {actionPresentation.label}
                </Text>
                {prompt.prompt ? (
                  <Text selectable style={styles.prompt}>
                    {prompt.prompt}
                  </Text>
                ) : null}
                {failed && prompt.error ? <Text style={styles.error}>{prompt.error}</Text> : null}
                {actionPresentation.canExecuteNow || actionPresentation.canCancel ? (
                  <View style={styles.actionButtons}>
                    {actionPresentation.canExecuteNow && onCreateNow ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Create new chat now"
                        accessibilityState={{ disabled: creating || cancelling }}
                        disabled={creating || cancelling}
                        onPress={() => onCreateNow(prompt.id)}
                        style={({ pressed }) => [
                          styles.createNow,
                          (creating || cancelling) && styles.disabled,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.createNowText}>
                          {creating ? 'Creating…' : 'Create now'}
                        </Text>
                      </Pressable>
                    ) : null}
                    {actionPresentation.canCancel && onCancel ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel queued new chat"
                        disabled={creating || cancelling}
                        onPress={() => onCancel(prompt.id)}
                        style={({ pressed }) => [
                          styles.cancelTextButton,
                          pressed && styles.pressed,
                        ]}
                      >
                        <Text style={styles.cancelText}>
                          {cancelling ? 'Canceling…' : 'Cancel'}
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>
          );
        }
        if (pending) {
          return (
            <View key={prompt.id} style={styles.pendingMessageGroup}>
              <View style={styles.pendingMessage}>
                {prompt.prompt ? (
                  <Text selectable style={styles.pendingPrompt}>
                    {prompt.prompt}
                  </Text>
                ) : null}
                {attachmentCount ? (
                  <Text style={styles.pendingImageCount}>
                    {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        }
        if (stopped) {
          return (
            <View key={prompt.id} style={styles.stoppedGroup}>
              {!prompt.delivered ? (
                <View style={styles.pendingMessageGroup}>
                  <View style={styles.pendingMessage}>
                    {prompt.prompt ? (
                      <Text selectable style={styles.pendingPrompt}>
                        {prompt.prompt}
                      </Text>
                    ) : null}
                    {attachmentCount ? (
                      <Text style={styles.pendingImageCount}>
                        {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              <View
                accessible
                accessibilityLabel={`Run stopped. ${stoppedRunDetail(prompt.error)}`}
                style={styles.stoppedNotice}
              >
                <View style={styles.stoppedIcon}>
                  <Square color={colors.warning} fill={colors.warning} size={9} strokeWidth={2} />
                </View>
                <View style={styles.stoppedCopy}>
                  <Text style={styles.stoppedTitle}>Run stopped</Text>
                  <Text style={styles.stoppedDetail}>{stoppedRunDetail(prompt.error)}</Text>
                </View>
              </View>
            </View>
          );
        }
        return (
          <View
            key={prompt.id}
            style={[styles.row, failed && (interrupted ? styles.rowInterrupted : styles.rowFailed)]}
          >
            <View style={styles.body}>
              <View style={styles.meta}>
                <Text
                  style={[
                    styles.badge,
                    failed && (interrupted ? styles.badgeInterrupted : styles.badgeFailed),
                  ]}
                >
                  {label}
                </Text>
                {attachmentCount ? (
                  <Text style={styles.imageCount}>
                    {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
                  </Text>
                ) : null}
              </View>
              {prompt.prompt && !prompt.delivered ? (
                <Text selectable style={styles.prompt}>
                  {prompt.prompt}
                </Text>
              ) : null}
              {interrupted ? (
                <MobileAgentFailureDetails
                  error={prompt.error}
                  queueInterruption={queueInterruption}
                  resolving={resolvingInterruptionId === prompt.id}
                  onResolve={
                    onResolveInterruption
                      ? (resolution) => onResolveInterruption(prompt.id, resolution)
                      : undefined
                  }
                />
              ) : failed && prompt.error ? (
                <Text style={styles.error}>{prompt.error}</Text>
              ) : null}
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
                <X
                  color={interrupted ? colors.warning : failed ? colors.danger : colors.muted}
                  size={15}
                  strokeWidth={2.2}
                />
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
  rowInterrupted: { borderColor: colors.warningBorder, backgroundColor: colors.warningDark },
  actionRow: { borderColor: colors.accentBorder, backgroundColor: colors.surface1 },
  actionIcon: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
    backgroundColor: colors.accentWash,
  },
  actionButtons: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  createNow: {
    borderRadius: 6,
    backgroundColor: colors.accent,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  createNowText: { color: colors.surface0, fontSize: 11, fontWeight: '800' },
  cancelTextButton: { paddingHorizontal: 8, paddingVertical: 7 },
  cancelText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  body: { flex: 1, gap: 5 },
  stoppedGroup: { width: '100%' },
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
  stoppedNotice: {
    maxWidth: '88%',
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 10,
    marginVertical: 7,
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: 8,
    backgroundColor: colors.warningDark,
    paddingHorizontal: 11,
    paddingVertical: 9,
  },
  stoppedIcon: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.warningBorder,
    borderRadius: 12,
    backgroundColor: colors.surface0,
  },
  stoppedCopy: { flex: 1, minWidth: 0 },
  stoppedTitle: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  stoppedDetail: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  badge: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  badgeFailed: { color: colors.danger },
  badgeInterrupted: { color: colors.warning },
  imageCount: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  prompt: { color: colors.text, fontSize: 14, lineHeight: 20 },
  error: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  interruptedCopy: { gap: 5 },
  interruptedSummary: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  technicalToggle: { color: colors.warning, fontSize: 10, fontWeight: '700' },
  technicalError: {
    maxHeight: 120,
    color: colors.mutedDim,
    fontFamily: 'monospace',
    fontSize: 9,
    lineHeight: 14,
  },
  interruptionActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  interruptionTextButton: { paddingHorizontal: 6, paddingVertical: 7 },
  interruptionText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
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
