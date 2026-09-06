import React from 'react';
import {
  companionProposalOperationLabel,
  companionProposalOperationDetails,
  companionToolActivityLabel,
  groupCompanionToolActivity,
} from '@drone/assistant-chat';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ChevronRight from 'lucide-react-native/icons/chevron-right';
import Mic from 'lucide-react-native/icons/mic';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import { NativeMarkdown } from './NativeMarkdown';
import { formatMobileVoiceDuration } from './mobile-voice-transcription-model';
import { useMobileCompanion } from './MobileCompanionContext';

type CompanionStatus = ReturnType<typeof useMobileCompanion>['status'];

function statusLabel(status: CompanionStatus, duration: number, elapsed: number) {
  if (status === 'starting') return 'Starting microphone…';
  if (status === 'recording') return `Listening · ${formatMobileVoiceDuration(duration)}`;
  if (status === 'transcribing') return 'Transcribing…';
  if (status === 'working') return `Working · ${Math.round(elapsed / 1_000)}s`;
  if (status === 'completed') return 'Done';
  if (status === 'cancelled') return 'Cancelled';
  if (status === 'error') return 'Needs attention';
  return '';
}

function statusDotStyle(status: CompanionStatus) {
  if (status === 'recording' || status === 'error') return styles.dotDanger;
  if (status === 'starting' || status === 'transcribing') return styles.dotWarning;
  if (status === 'working') return styles.dotAccent;
  if (status === 'completed') return styles.dotOnline;
  return styles.dotMuted;
}

const SPRING = { damping: 24, stiffness: 240 };

export function MobileCompanionOverlay() {
  const companion = useMobileCompanion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [draft, setDraft] = React.useState('');
  const [submitError, setSubmitError] = React.useState('');
  const [submitting, setSubmitting] = React.useState(false);
  const [activityExpanded, setActivityExpanded] = React.useState(false);
  const [expandedCalls, setExpandedCalls] = React.useState<Set<string>>(() => new Set());
  const [expandedProposalOperations, setExpandedProposalOperations] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [, tick] = React.useState(0);
  const visible = companion.status !== 'idle';
  const translateY = useSharedValue(0);
  const sheetHeight = useSharedValue(320);
  const close = companion.close;

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
      setSubmitError('');
    }
  }, [companion.status]);

  React.useEffect(() => {
    setExpandedProposalOperations(new Set());
  }, [companion.proposal]);

  React.useEffect(() => {
    if (!visible) return;
    translateY.value = 320;
    translateY.value = withSpring(0, SPRING);
  }, [translateY, visible]);

  React.useEffect(() => {
    if (!visible) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      void close();
      return true;
    });
    return () => subscription.remove();
  }, [close, visible]);

  const dismiss = React.useCallback(() => {
    Keyboard.dismiss();
    void close();
  }, [close]);

  const dragGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetY(10)
        .failOffsetX([-50, 50])
        .failOffsetY(-14)
        .onUpdate((event) => {
          translateY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          const shouldDismiss =
            event.translationY > sheetHeight.value * 0.35 ||
            (event.translationY > 40 && event.velocityY > 1_100);
          if (shouldDismiss) {
            translateY.value = withTiming(
              sheetHeight.value + 40,
              { duration: 180, easing: Easing.in(Easing.quad) },
              (finished) => {
                if (finished) runOnJS(dismiss)();
              },
            );
          } else {
            translateY.value = withSpring(0, SPRING);
          }
        })
        .onFinalize((_event, success) => {
          if (!success) translateY.value = withSpring(0, SPRING);
        }),
    [dismiss, sheetHeight, translateY],
  );
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  const status = companion.status;
  const active = status === 'working';
  const voiceBusy = status === 'starting' || status === 'transcribing';
  const recording = status === 'recording';
  const elapsed = companion.startedAt
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const showActivity = active || companion.activity.length > 0;
  const activityGroups = groupCompanionToolActivity(companion.activity);
  const completedProposalOperations =
    companion.proposalExecution?.operations.filter((item) => item.status === 'completed').length ??
    0;
  const inputLocked = active || voiceBusy || recording || submitting || companion.proposalExecuting;
  const canSend = Boolean(draft.trim()) && !inputLocked;
  const micDisabled = active || voiceBusy || submitting || companion.proposalExecuting;
  const applyDisabled =
    companion.proposalExecuting ||
    active ||
    voiceBusy ||
    recording ||
    !companion.proposal ||
    companion.proposal.operations.length === 0 ||
    companion.proposalExecution !== null;

  const submit = async () => {
    const text = draft.trim();
    if (!text || inputLocked) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      const result = await companion.submitText(text);
      if (!result.ok) {
        setSubmitError(result.error);
        return;
      }
      setDraft('');
    } finally {
      setSubmitting(false);
    }
  };

  const maxHeight = Math.max(220, Math.min(height - insets.top - 48, height * 0.7));

  return (
    <KeyboardAvoidingView
      pointerEvents="box-none"
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.layer}
    >
      <Animated.View
        onLayout={(event) => {
          sheetHeight.value = event.nativeEvent.layout.height;
        }}
        style={[
          styles.sheet,
          { maxHeight, paddingBottom: Math.max(insets.bottom, 10) },
          sheetStyle,
        ]}
      >
        <GestureDetector gesture={dragGesture}>
          <View>
            <View style={styles.header}>
              <View style={[styles.dot, statusDotStyle(status)]} />
              <Text style={styles.title}>Companion</Text>
              <Text
                accessibilityLiveRegion="polite"
                numberOfLines={1}
                style={[styles.status, status === 'error' && styles.statusError]}
              >
                {statusLabel(status, companion.durationMillis, elapsed)}
              </Text>
              {active ? <ActivityIndicator color={colors.accent} size="small" /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={active ? 'Stop Companion' : 'Close Companion'}
                hitSlop={8}
                onPress={dismiss}
                style={({ pressed }) => [styles.closeButton, pressed && styles.ghostPressed]}
              >
                <X color={colors.muted} size={17} strokeWidth={2.2} />
              </Pressable>
            </View>
          </View>
        </GestureDetector>

        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator
        >
          {companion.transcript ? (
            <View style={styles.transcriptRow}>
              <View style={styles.transcriptBubble}>
                <Text style={styles.transcriptText}>{companion.transcript}</Text>
              </View>
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
                <ChevronRight
                  color={colors.muted}
                  size={14}
                  strokeWidth={2}
                  style={{ transform: [{ rotate: activityExpanded ? '90deg' : '0deg' }] }}
                />
                <Text style={styles.activitySummaryText}>
                  {companion.activity.length > 0
                    ? `${companion.activity.length} tool ${companion.activity.length === 1 ? 'call' : 'calls'}`
                    : 'Thinking…'}
                </Text>
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
                              <View
                                style={[
                                  styles.toolDot,
                                  item.status === 'running' && styles.dotAccent,
                                  item.status === 'failed' && styles.dotDanger,
                                  item.status === 'completed' && styles.dotOnline,
                                ]}
                              />
                              <Text numberOfLines={1} style={styles.toolName}>
                                {companionToolActivityLabel(item)}
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

          {companion.error || submitError ? (
            <Text style={styles.errorText}>{companion.error || submitError}</Text>
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
                        ? completedProposalOperations > 0
                          ? 'Partially applied'
                          : 'Apply failed'
                        : 'Review'}
                </Text>
              </View>
              {companion.proposal.summary ? (
                <Text style={styles.proposalSummary}>{companion.proposal.summary}</Text>
              ) : null}
              {companion.proposal.operations.length === 0 ? (
                <Text style={styles.proposalEmpty}>
                  Companion has not added any operations yet.
                </Text>
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
                                onPress={() =>
                                  setExpandedProposalOperations((current) => {
                                    const next = new Set(current);
                                    if (next.has(operation.id)) next.delete(operation.id);
                                    else next.add(operation.id);
                                    return next;
                                  })
                                }
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
                  disabled={applyDisabled}
                  onPress={() => void companion.executeProposal()}
                  style={({ pressed }) => [
                    styles.proposalApply,
                    pressed && styles.pressed,
                    applyDisabled && styles.disabled,
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

        <View style={styles.footer}>
          <ThemedTextInput
            accessibilityLabel="Message Companion"
            value={draft}
            onChangeText={setDraft}
            editable={!inputLocked}
            multiline
            maxLength={8_000}
            placeholder={
              recording
                ? 'Listening…'
                : active
                  ? 'Companion is working…'
                  : companion.reply
                    ? 'Reply to Companion'
                    : 'Ask Companion'
            }
            placeholderTextColor={colors.secondary}
            textAlignVertical="center"
            style={[styles.input, inputLocked && styles.inputLocked]}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={recording ? 'Stop recording' : 'Talk to Companion'}
            accessibilityState={{ disabled: micDisabled }}
            disabled={micDisabled}
            hitSlop={4}
            onPress={() => void companion.toggle()}
            style={({ pressed }) => [
              styles.ghostButton,
              micDisabled && styles.disabled,
              pressed && styles.ghostPressed,
            ]}
          >
            {voiceBusy ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : recording ? (
              <Square color={colors.danger} fill={colors.danger} size={15} strokeWidth={2} />
            ) : (
              <Mic color={colors.textSecondary} size={18} strokeWidth={2.2} />
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send to Companion"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            hitSlop={4}
            onPress={() => void submit()}
            style={({ pressed }) => [
              styles.sendButton,
              !canSend && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {submitting ? (
              <ActivityIndicator color={colors.onAccent} size="small" />
            ) : (
              <ArrowUp color={colors.onAccent} size={18} strokeWidth={2.6} />
            )}
          </Pressable>
        </View>
      </Animated.View>
    </KeyboardAvoidingView>
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
    justifyContent: 'flex-end',
  },
  sheet: {
    width: '100%',
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderTopColor: colors.accentBorder,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 18,
  },
  header: {
    minHeight: 44,
    paddingTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.mutedDim },
  dotDanger: { backgroundColor: colors.danger },
  dotWarning: { backgroundColor: colors.warning },
  dotAccent: { backgroundColor: colors.accent },
  dotOnline: { backgroundColor: colors.online },
  dotMuted: { backgroundColor: colors.mutedDim },
  title: { color: colors.text, fontSize: 13, fontWeight: '700' },
  status: { minWidth: 0, flex: 1, color: colors.muted, fontSize: 11 },
  statusError: { color: colors.danger },
  closeButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10, gap: 10 },
  transcriptRow: { alignItems: 'flex-end' },
  transcriptBubble: {
    maxWidth: '88%',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderBottomRightRadius: 4,
    borderWidth: 1,
    borderColor: colors.userBubbleBorder,
    backgroundColor: colors.userBubble,
  },
  transcriptText: { color: colors.userBubbleText, fontSize: 12.5, lineHeight: 18 },
  activity: { gap: 2 },
  activitySummary: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activitySummaryText: { flex: 1, color: colors.muted, fontSize: 11 },
  parallelDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginLeft: 20,
    paddingVertical: 4,
  },
  parallelDividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
  },
  parallelDividerText: { color: colors.mutedDim, fontSize: 9, fontWeight: '700' },
  toolCall: { marginLeft: 20 },
  toolHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedDim },
  toolName: { flex: 1, color: colors.textSecondary, fontSize: 10.5 },
  toolDetails: { gap: 6, paddingLeft: 13, paddingBottom: 6 },
  toolDetailLabel: { color: colors.mutedDim, fontSize: 8.5, fontWeight: '700' },
  toolDetail: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 9, lineHeight: 13 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  reply: { paddingTop: 2 },
  proposal: {
    gap: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.accentWash,
  },
  proposalHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  proposalHeadingCopy: { flex: 1, minWidth: 0 },
  proposalEyebrow: {
    color: colors.accent,
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  proposalTitle: { marginTop: 2, color: colors.text, fontSize: 13, fontWeight: '700' },
  proposalStatus: { color: colors.mutedDim, fontSize: 9.5, fontWeight: '600' },
  proposalStatusSuccess: { color: colors.online },
  proposalStatusFailure: { color: colors.danger },
  proposalSummary: { color: colors.muted, fontSize: 11, lineHeight: 16 },
  proposalEmpty: { color: colors.mutedDim, fontSize: 11 },
  proposalOperations: { gap: 6 },
  proposalOperation: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  proposalNumber: {
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9,
    backgroundColor: colors.controlSurface,
  },
  proposalNumberText: { color: colors.muted, fontSize: 9, fontWeight: '700' },
  proposalOperationCopy: { flex: 1, minWidth: 0 },
  proposalOperationText: { color: colors.textSecondary, fontSize: 11, lineHeight: 15 },
  proposalDetailsToggle: { alignSelf: 'flex-start', marginTop: 4, paddingVertical: 2 },
  proposalDetailsToggleText: { color: colors.accent, fontSize: 9.5, fontWeight: '600' },
  proposalDetails: { gap: 6, marginTop: 6 },
  proposalDetail: { gap: 1 },
  proposalDetailLabel: { color: colors.mutedDim, fontSize: 8.5, fontWeight: '700' },
  proposalDetailValue: { color: colors.textSecondary, fontSize: 9.5, lineHeight: 13 },
  proposalOutcome: { marginTop: 3, color: colors.mutedDim, fontSize: 9.5 },
  proposalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 6, paddingTop: 2 },
  proposalDiscard: {
    minHeight: 32,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  proposalDiscardText: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  proposalApply: {
    minHeight: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  proposalApplyText: { color: colors.onAccent, fontSize: 11, fontWeight: '700' },
  footer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingLeft: 10,
    paddingRight: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderSubtle,
  },
  input: {
    minWidth: 0,
    flex: 1,
    minHeight: 36,
    maxHeight: 108,
    paddingHorizontal: 8,
    paddingVertical: 8,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  inputLocked: { opacity: 0.6 },
  ghostButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  ghostPressed: { backgroundColor: colors.whiteWash },
  sendButton: {
    width: 36,
    height: 36,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
