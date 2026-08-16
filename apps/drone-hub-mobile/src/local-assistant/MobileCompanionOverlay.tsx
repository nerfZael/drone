import React from 'react';
import {
  companionProposalOperationLabel,
  companionProposalOperationDetails,
  companionToolActivityLabel,
  groupCompanionToolActivity,
} from '@drone/assistant-chat';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Mic from 'lucide-react-native/icons/mic';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';
import { formatMobileVoiceDuration } from './mobile-voice-transcription-model';
import { useMobileCompanion } from './MobileCompanionContext';

function statusLabel(status: ReturnType<typeof useMobileCompanion>['status'], duration: number) {
  if (status === 'starting') return 'Starting microphone…';
  if (status === 'recording') return `Listening · ${formatMobileVoiceDuration(duration)}`;
  if (status === 'transcribing') return 'Transcribing…';
  if (status === 'working') return 'Working…';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'error') return 'Needs attention';
  return '';
}

export function MobileCompanionOverlay() {
  const companion = useMobileCompanion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [activityExpanded, setActivityExpanded] = React.useState(false);
  const [expandedCalls, setExpandedCalls] = React.useState<Set<string>>(() => new Set());
  const [expandedProposalOperations, setExpandedProposalOperations] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [, tick] = React.useState(0);

  React.useEffect(() => {
    if (companion.status !== 'working') return;
    const timer = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [companion.status]);

  React.useEffect(() => {
    if (companion.status === 'idle') {
      setActivityExpanded(false);
      setExpandedCalls(new Set());
      setExpandedProposalOperations(new Set());
    }
  }, [companion.status]);

  React.useEffect(() => {
    setExpandedProposalOperations(new Set());
  }, [companion.proposal]);

  if (companion.status === 'idle') return null;
  const active = companion.status === 'working';
  const elapsed = companion.startedAt
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const showActivity = active || companion.activity.length > 0;
  const activityGroups = groupCompanionToolActivity(companion.activity);
  const completedProposalOperations = companion.proposalExecution?.operations.filter(
    (item) => item.status === 'completed',
  ).length ?? 0;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.layer, { paddingTop: insets.top + 8, paddingHorizontal: 10 }]}
    >
      <View
        style={[
          styles.card,
          { maxHeight: Math.max(180, Math.min(height - insets.top - 20, height * 0.62)) },
        ]}
      >
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.title}>Companion</Text>
            <Text accessibilityLiveRegion="polite" style={styles.status}>
              {statusLabel(companion.status, companion.durationMillis)}
            </Text>
          </View>
          {companion.status === 'recording' ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop Companion recording"
              onPress={() => void companion.toggle()}
              style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
            >
              <Square color={colors.online} size={13} strokeWidth={2.5} />
              <Text style={styles.stopText}>Stop</Text>
            </Pressable>
          ) : companion.status === 'starting' || companion.status === 'transcribing' ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close Companion"
            hitSlop={8}
            onPress={() => void companion.close()}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <X color={colors.muted} size={18} strokeWidth={2.2} />
          </Pressable>
        </View>
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {companion.transcript ? (
            <View style={styles.transcript}>
              <Mic color={colors.muted} size={13} strokeWidth={2} />
              <Text style={styles.transcriptText}>“{companion.transcript}”</Text>
            </View>
          ) : null}
          {showActivity ? (
            <View style={styles.activity}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  activityExpanded ? 'Hide Companion tool calls' : 'Show Companion tool calls'
                }
                accessibilityState={{ expanded: activityExpanded }}
                onPress={() => setActivityExpanded((value) => !value)}
                style={({ pressed }) => [styles.activitySummary, pressed && styles.pressed]}
              >
                {active ? <ActivityIndicator color={colors.accent} size="small" /> : null}
                <Text style={styles.activitySummaryText}>
                  {active ? 'Working' : 'Worked'} · {Math.round(elapsed / 1_000)}s
                  {companion.activity.length > 0
                    ? ` · ${companion.activity.length} tool ${companion.activity.length === 1 ? 'call' : 'calls'}`
                    : ''}
                </Text>
                <ChevronRight
                  color={colors.muted}
                  size={15}
                  strokeWidth={2}
                  style={{ transform: [{ rotate: activityExpanded ? '90deg' : '0deg' }] }}
                />
              </Pressable>
              {activityExpanded
                ? activityGroups.map((group) => (
                    <View key={group.key}>
                      {group.parallel ? (
                        <View
                          accessibilityLabel={`${group.items.length} tool calls ran in parallel`}
                          style={styles.parallelDivider}
                        >
                          <View style={styles.parallelDividerLine} />
                          <Text style={styles.parallelDividerText}>
                            Parallel · {group.items.length}
                          </Text>
                          <View style={styles.parallelDividerLine} />
                        </View>
                      ) : null}
                      {group.items.map((item) => {
                        const expanded = expandedCalls.has(item.callId);
                        return (
                          <View key={item.callId} style={styles.toolCall}>
                            <Pressable
                              accessibilityRole="button"
                              accessibilityState={{ expanded }}
                              onPress={() =>
                                setExpandedCalls((current) => {
                                  const next = new Set(current);
                                  if (next.has(item.callId)) next.delete(item.callId);
                                  else next.add(item.callId);
                                  return next;
                                })
                              }
                              style={({ pressed }) => [
                                styles.toolHeader,
                                pressed && styles.pressed,
                              ]}
                            >
                              <ChevronRight
                                color={colors.mutedDim}
                                size={13}
                                strokeWidth={2}
                                style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                              />
                              <Text numberOfLines={1} style={styles.toolName}>
                                {item.status === 'running'
                                  ? 'Running'
                                  : item.status === 'failed'
                                    ? 'Failed'
                                    : 'Completed'}{' '}
                                · {companionToolActivityLabel(item)}
                              </Text>
                            </Pressable>
                            {expanded ? (
                              <View style={styles.toolDetails}>
                                {item.args !== undefined ? (
                                  <View>
                                    <Text style={styles.toolDetailLabel}>Arguments</Text>
                                    <Text selectable style={styles.toolDetail}>
                                      {JSON.stringify(item.args, null, 2)}
                                    </Text>
                                  </View>
                                ) : null}
                                {item.error !== undefined ? (
                                  <View>
                                    <Text style={styles.toolDetailLabel}>Error</Text>
                                    <Text selectable style={styles.toolDetail}>
                                      {JSON.stringify(item.error, null, 2)}
                                    </Text>
                                  </View>
                                ) : item.result !== undefined ? (
                                  <View>
                                    <Text style={styles.toolDetailLabel}>Result</Text>
                                    <Text selectable style={styles.toolDetail}>
                                      {JSON.stringify(item.result, null, 2)}
                                    </Text>
                                  </View>
                                ) : null}
                              </View>
                            ) : null}
                          </View>
                        );
                      })}
                    </View>
                  ))
                : null}
            </View>
          ) : null}
          {companion.error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{companion.error}</Text>
            </View>
          ) : null}
          {companion.reply ? (
            <View style={styles.reply}>
              <NativeMarkdown text={companion.reply} />
            </View>
          ) : null}
          {companion.proposal ? (
            <View accessibilityLabel="Companion proposal" style={styles.proposal}>
              <View style={styles.proposalHeading}>
                <View style={styles.proposalHeadingCopy}>
                  <Text style={styles.proposalEyebrow}>Proposal</Text>
                  <Text style={styles.proposalTitle}>{companion.proposal.title}</Text>
                </View>
                <Text
                  style={[
                    styles.proposalStatus,
                    companion.proposalExecution?.ok
                      ? styles.proposalStatusSuccess
                      : companion.proposalExecution
                        ? styles.proposalStatusFailure
                        : null,
                  ]}
                >
                  {companion.proposalExecuting
                    ? 'Applying…'
                    : companion.proposalExecution?.ok
                      ? 'Applied'
                      : companion.proposalExecution
                        ? completedProposalOperations > 0 ? 'Partially applied' : 'Apply failed'
                        : 'Review'}
                </Text>
              </View>
              {companion.proposal.summary ? (
                <Text style={styles.proposalSummary}>{companion.proposal.summary}</Text>
              ) : null}
              {companion.proposal.operations.length === 0 ? (
                <Text style={styles.proposalEmpty}>Companion has not added any operations yet.</Text>
              ) : (
                <View style={styles.proposalOperations}>
                  {companion.proposal.operations.map((operation, index) => {
                    const outcome = companion.proposalExecution?.operations.find(
                      (item) => item.id === operation.id,
                    );
                    const details = companionProposalOperationDetails(
                      operation,
                      companion.proposalDefaultRepoPath ?? '',
                    );
                    const detailsExpanded = expandedProposalOperations.has(operation.id);
                    return (
                      <View key={operation.id} style={styles.proposalOperation}>
                        <View style={styles.proposalNumber}>
                          <Text style={styles.proposalNumberText}>{index + 1}</Text>
                        </View>
                        <View style={styles.proposalOperationCopy}>
                          <Text style={styles.proposalOperationText}>
                            {companionProposalOperationLabel(operation)}
                          </Text>
                          {details.length > 0 ? (
                            <>
                              <Pressable
                                accessibilityRole="button"
                                accessibilityState={{ expanded: detailsExpanded }}
                                onPress={() => setExpandedProposalOperations((current) => {
                                  const next = new Set(current);
                                  if (next.has(operation.id)) next.delete(operation.id);
                                  else next.add(operation.id);
                                  return next;
                                })}
                                style={({ pressed }) => [
                                  styles.proposalDetailsToggle,
                                  pressed && styles.pressed,
                                ]}
                              >
                                <Text style={styles.proposalDetailsToggleText}>
                                  {detailsExpanded ? 'Hide details' : 'Review details'}
                                </Text>
                              </Pressable>
                              {detailsExpanded ? (
                                <View style={styles.proposalDetails}>
                                  {details.map((detail) => (
                                    <View key={detail.label} style={styles.proposalDetail}>
                                      <Text style={styles.proposalDetailLabel}>{detail.label}</Text>
                                      <Text selectable style={styles.proposalDetailValue}>
                                        {detail.value}
                                      </Text>
                                    </View>
                                  ))}
                                </View>
                              ) : null}
                            </>
                          ) : null}
                          {outcome ? (
                            <Text
                              style={[
                                styles.proposalOutcome,
                                outcome.status === 'completed'
                                  ? styles.proposalStatusSuccess
                                  : outcome.status === 'failed'
                                    ? styles.proposalStatusFailure
                                    : null,
                              ]}
                            >
                              {outcome.status === 'completed'
                                ? 'Applied'
                                : outcome.status === 'skipped'
                                  ? 'Not run'
                                  : outcome.error || 'Failed'}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
              <View style={styles.proposalActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Discard Companion proposal"
                  disabled={companion.proposalExecuting}
                  onPress={companion.discardProposal}
                  style={({ pressed }) => [
                    styles.proposalDiscard,
                    pressed && styles.pressed,
                    companion.proposalExecuting && styles.disabled,
                  ]}
                >
                  <Text style={styles.proposalDiscardText}>Discard</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Apply Companion proposal"
                  disabled={
                    companion.proposalExecuting ||
                    active ||
                    ['starting', 'recording', 'transcribing'].includes(companion.status) ||
                    companion.proposal.operations.length === 0 ||
                    companion.proposalExecution !== null
                  }
                  onPress={() => void companion.executeProposal()}
                  style={({ pressed }) => [
                    styles.proposalApply,
                    pressed && styles.pressed,
                    (companion.proposalExecuting ||
                      active ||
                      ['starting', 'recording', 'transcribing'].includes(companion.status) ||
                      companion.proposal!.operations.length === 0 ||
                      companion.proposalExecution !== null) && styles.disabled,
                  ]}
                >
                  {companion.proposalExecuting ? (
                    <ActivityIndicator color={colors.onAccent} size="small" />
                  ) : null}
                  <Text style={styles.proposalApplyText}>
                    {companion.proposalExecuting
                      ? 'Applying…'
                      : companion.proposalExecution?.ok
                        ? 'Applied'
                        : companion.proposalExecution
                          ? 'Discard to retry'
                          : 'Apply proposal'}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 200,
    elevation: 30,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panel,
    shadowColor: colors.shadow,
    shadowOpacity: 0.32,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 18,
  },
  header: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  headerCopy: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 14, fontWeight: '700' },
  status: { marginTop: 2, color: colors.muted, fontSize: 11 },
  stopButton: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 11,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
  },
  stopText: { color: colors.online, fontSize: 11, fontWeight: '700' },
  closeButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingBottom: 12 },
  transcript: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  transcriptText: { flex: 1, color: colors.muted, fontSize: 11, lineHeight: 16 },
  proposal: {
    gap: 9,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.sidebarSurfaceInset,
  },
  proposalHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  proposalHeadingCopy: { flex: 1, minWidth: 0 },
  proposalEyebrow: {
    color: colors.mutedDim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  proposalTitle: { marginTop: 2, color: colors.text, fontSize: 13, fontWeight: '700' },
  proposalStatus: { color: colors.mutedDim, fontSize: 9 },
  proposalStatusSuccess: { color: colors.online },
  proposalStatusFailure: { color: colors.danger },
  proposalSummary: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  proposalEmpty: {
    paddingVertical: 10,
    color: colors.mutedDim,
    fontSize: 10,
    textAlign: 'center',
  },
  proposalOperations: { gap: 6 },
  proposalOperation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    padding: 9,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.panelRaised,
  },
  proposalNumber: {
    width: 17,
    height: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.controlSurface,
  },
  proposalNumberText: { color: colors.muted, fontSize: 9 },
  proposalOperationCopy: { flex: 1, minWidth: 0 },
  proposalOperationText: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  proposalDetailsToggle: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 2 },
  proposalDetailsToggleText: { color: colors.accent, fontSize: 9, fontWeight: '600' },
  proposalDetails: {
    gap: 5,
    marginTop: 3,
    paddingLeft: 7,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.borderSubtle,
  },
  proposalDetail: { gap: 1 },
  proposalDetailLabel: { color: colors.mutedDim, fontSize: 8, fontWeight: '700' },
  proposalDetailValue: { color: colors.textSecondary, fontSize: 9, lineHeight: 13 },
  proposalOutcome: { marginTop: 3, color: colors.mutedDim, fontSize: 9 },
  proposalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingTop: 2 },
  proposalDiscard: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 7,
  },
  proposalDiscardText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  proposalApply: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 13,
    borderRadius: 7,
    backgroundColor: colors.accent,
  },
  proposalApplyText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
  disabled: { opacity: 0.45 },
  activity: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderSubtle },
  activitySummary: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingHorizontal: 14,
  },
  activitySummaryText: { flex: 1, color: colors.textSecondary, fontSize: 11 },
  parallelDivider: {
    marginLeft: 14,
    paddingHorizontal: 10,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  parallelDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle,
  },
  parallelDividerText: {
    color: colors.mutedDim,
    fontSize: 8,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  toolCall: { marginLeft: 14, borderLeftWidth: 1, borderLeftColor: colors.borderSubtle },
  toolHeader: {
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
  },
  toolName: { flex: 1, color: colors.textSecondary, fontSize: 10 },
  toolDetails: { gap: 7, paddingBottom: 9 },
  toolDetailLabel: {
    marginHorizontal: 10,
    marginBottom: 3,
    color: colors.mutedDim,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  toolDetail: {
    marginHorizontal: 10,
    padding: 8,
    color: colors.mutedDim,
    fontSize: 9,
    lineHeight: 13,
    fontFamily: 'monospace',
    backgroundColor: colors.sidebarSurfaceInset,
  },
  errorBox: {
    marginHorizontal: 12,
    marginTop: 12,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerDark,
  },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  reply: { paddingHorizontal: 14, paddingTop: 12 },
  pressed: { opacity: 0.68 },
});
