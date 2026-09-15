import { MobileCompanionScreenPanel } from './MobileCompanionScreenPanel';
import { MobileCompanionModelPicker } from './MobileCompanionModelPicker';
import React from 'react';
import Svg, { Circle } from 'react-native-svg';
import {
  companionContextUsageLabel,
  companionToolActivityLabel,
  companionCompactionLabel,
  groupCompanionToolActivity,
} from '@drone/assistant-chat';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
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
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import AudioLines from 'lucide-react-native/icons/audio-lines';
import Captions from 'lucide-react-native/icons/captions';
import Ellipsis from 'lucide-react-native/icons/ellipsis';
import Folder from 'lucide-react-native/icons/folder';
import FolderOpen from 'lucide-react-native/icons/folder-open';
import Mic from 'lucide-react-native/icons/mic';
import MicOff from 'lucide-react-native/icons/mic-off';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import Zap from 'lucide-react-native/icons/zap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors } from '../theme';
import { ChatSubscriptionIndicator } from '../drones/ChatSubscriptionIndicator';
import { NativeMarkdown } from './NativeMarkdown';
import { MobileCompanionMenu, type MobileCompanionMenuItem, type MobileCompanionMenuTone } from './MobileCompanionMenu';
import { MobileCompanionProposal } from './MobileCompanionProposal';
import { MobileCompanionWorkspaceModal } from './MobileCompanionWorkspaceModal';
import { useMobileCompanion } from './MobileCompanionContext';
import { useMobileCompanionCurrentWorkspace } from './use-mobile-companion-current-workspace';

type Companion = ReturnType<typeof useMobileCompanion>;
type CompanionStatus = Companion['status'];

function statusLabel(status: CompanionStatus) {
  if (status === 'starting') return 'Starting';
  if (status === 'recording') return 'Listening';
  if (status === 'transcribing') return 'Transcribing';
  if (status === 'working') return 'Working';
  if (status === 'completed') return 'Completed';
  if (status === 'cancelled') return 'Stopped';
  if (status === 'error') return 'Needs attention';
  return 'Idle';
}

/** Live voice owns the headline while it is connected; otherwise the turn status does. */
function headlineLabel(companion: Companion): string {
  const live = companion.live;
  if (companion.checkingVoiceMode) return 'Starting';
  if (companion.status === 'working') return 'Working';
  if (live.status === 'connecting') {
    return 'Connecting';
  }
  if (live.status === 'listening') return live.muted ? 'Muted' : 'Listening';
  if (live.status === 'paused') return 'Paused';
  if (companion.recordingPaused) return 'Paused';
  return statusLabel(companion.status);
}

function statusDotStyle(status: CompanionStatus, liveActive: boolean, recordingPaused: boolean) {
  if (recordingPaused) return styles.dotWarning;
  if (status === 'recording' || status === 'error') return styles.dotDanger;
  if (status === 'starting' || status === 'transcribing') return styles.dotWarning;
  if (status === 'working') return styles.dotAccent;
  if (status === 'completed') return styles.dotOnline;
  if (liveActive) return styles.dotAccent;
  return styles.dotMuted;
}

const headerTone: Record<MobileCompanionMenuTone, { container: object; color: string }> = {
  neutral: { container: {}, color: colors.muted },
  accent: { container: { borderColor: colors.accentBorder, backgroundColor: colors.accentDark }, color: colors.accent },
  success: { container: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark }, color: colors.online },
  danger: { container: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark }, color: colors.danger },
};

function HeaderButton({
  label,
  tone = 'neutral',
  pressed,
  disabled = false,
  loading = false,
  onPress,
  icon: Icon,
}: {
  label: string;
  tone?: MobileCompanionMenuTone;
  pressed?: boolean;
  disabled?: boolean;
  loading?: boolean;
  onPress(): void;
  icon: MobileCompanionMenuItem['icon'];
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, ...(pressed !== undefined ? { selected: pressed } : {}) }}
      disabled={disabled || loading}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed: isPressed }) => [
        styles.headerButton,
        headerTone[tone].container,
        disabled && styles.disabled,
        isPressed && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={headerTone[tone].color} size="small" />
      ) : (
        <Icon color={headerTone[tone].color} size={15} strokeWidth={2.1} />
      )}
    </Pressable>
  );
}

/** A plain ease-out slide: the sheet settles without bouncing. */
const SETTLE = { duration: 220, easing: Easing.out(Easing.cubic) };
/** Space between the sheet and the navigation bar, and between its top edge and the composer. */
const SHEET_GAP = 10;

export function MobileCompanionOverlay() {
  const companion = useMobileCompanion();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [workspaceDeviceId, setWorkspaceDeviceId] = React.useState<string | null>(null);
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [proposalHistoryOpen, setProposalHistoryOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(false);
  const [contextTooltipOpen, setContextTooltipOpen] = React.useState(false);
  const [activityExpanded, setActivityExpanded] = React.useState(false);
  const [transcriptExpanded, setTranscriptExpanded] = React.useState(false);
  const [captionsOpen, setCaptionsOpen] = React.useState(false);
  const [expandedCalls, setExpandedCalls] = React.useState<Set<string>>(() => new Set());
  const [, tick] = React.useState(0);
  const liveActive = companion.live.status === 'connecting' || companion.live.status === 'listening';
  const livePaused = companion.live.status === 'paused';
  const visible = companion.overlayOpen;
  const [sheetHeight, setSheetHeight] = React.useState(0);
  const composerFocused = companion.composerFocused;
  const reportOverlayInset = companion.reportOverlayInset;
  React.useEffect(() => {
    if (!visible) {
      reportOverlayInset(0);
      setCollapsed(false);
      setProposalHistoryOpen(false);
    }
  }, [reportOverlayInset, visible]);
  React.useEffect(() => () => reportOverlayInset(0), [reportOverlayInset]);
  const translateY = useSharedValue(0);
  const close = companion.close;
  const appContext = companion.readAppContext();
  const currentDroneId = typeof appContext?.mainDroneId === 'string' ? appContext.mainDroneId : '';
  const currentWorkspace = useMobileCompanionCurrentWorkspace({
    deviceId: companion.workspaceDeviceId,
    droneId: currentDroneId,
    supported: companion.currentWorkspaceSupported,
    active: menuOpen,
  });

  React.useEffect(() => {
    if (companion.status !== 'working') return;
    const timer = setInterval(() => tick((value) => value + 1), 1_000);
    return () => clearInterval(timer);
  }, [companion.status]);

  React.useEffect(() => {
    if (companion.status === 'idle') {
      setActivityExpanded(false);
      setTranscriptExpanded(false);
      setExpandedCalls(new Set());
    }
  }, [companion.status]);

  React.useEffect(() => {
    if (!visible) {
      setMenuOpen(false);
      setCaptionsOpen(false);
    }
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return;
    translateY.value = 320;
    translateY.value = withTiming(0, SETTLE);
  }, [translateY, visible]);

  React.useEffect(() => {
    if (!visible || menuOpen) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      Keyboard.dismiss();
      void close();
      return true;
    });
    return () => subscription.remove();
  }, [close, menuOpen, visible]);

  const closeMenu = React.useCallback(() => setMenuOpen(false), []);

  const dismiss = React.useCallback(() => {
    Keyboard.dismiss();
    void close();
  }, [close]);

  const resize = React.useCallback((collapse: boolean) => {
    setCollapsed(collapse);
    if (!collapse) Keyboard.dismiss();
  }, []);

  const dragGesture = React.useMemo(
    () =>
      Gesture.Pan()
        .maxPointers(1)
        .activeOffsetY([-10, 10])
        .failOffsetX([-50, 50])
        .onEnd((event) => {
          if (event.translationY > 30 || (event.translationY > 10 && event.velocityY > 500)) {
            runOnJS(resize)(true);
          } else if (event.translationY < -30 || (event.translationY < -10 && event.velocityY < -500)) {
            runOnJS(resize)(false);
          }
        }),
    [resize],
  );
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible && !workspaceDeviceId) return null;

  const status = companion.status;
  const live = companion.live;
  const active = status === 'working';
  const voiceBusy = status === 'starting' || status === 'transcribing' || companion.checkingVoiceMode;
  const recording = status === 'recording' && !liveActive;
  const elapsed = companion.startedAt != null
    ? Math.max(0, (companion.endedAt ?? Date.now()) - companion.startedAt)
    : 0;
  const activityGroups = groupCompanionToolActivity(companion.activity);
  const applyDisabled =
    companion.proposalExecuting ||
    active ||
    voiceBusy ||
    recording ||
    !companion.proposal ||
    companion.proposal.operations.length === 0 ||
    companion.proposalExecution !== null;
  const autoApprove = companion.autoApproveSettings;
  const liveSettings = companion.liveSettings;
  const errors = [companion.error, live.error, liveSettings.error, autoApprove.error].filter(Boolean);
  // Manual collapse persists through streamed replies; composer focus also keeps only the header.
  const showBody = !collapsed && !composerFocused &&
    (activityExpanded || captionsOpen || errors.length > 0 || Boolean(companion.reply) || Boolean(companion.proposal) || Boolean(companion.proposalHistory?.length));
  const openWorkspaces = () => {
    Keyboard.dismiss();
    setWorkspaceDeviceId(companion.workspaceDeviceId);
  };
  const liveBusy = liveSettings.loading || liveSettings.saving || companion.switchingVoice;

  const menuItems: MobileCompanionMenuItem[] = [
    {
      id: 'live',
      section: 'Voice',
      icon: AudioLines,
      label: `Live voice ${liveSettings.enabled ? 'on' : 'off'}`,
      detail: !liveSettings.supported
        ? 'Update the Hub to use Live voice from your phone.'
        : liveSettings.error
          ? liveSettings.error
          : liveActive || livePaused
            ? [live.targetName, live.backendModel].filter(Boolean).join(' · ')
            : 'Two-way voice conversation. Shared with desktop Companion.',
      selected: liveSettings.enabled,
      tone: liveSettings.enabled ? 'accent' : 'neutral',
      disabled: !liveSettings.supported || voiceBusy,
      loading: liveBusy,
      onPress: () => void companion.toggleLiveVoice(),
    },
    ...(liveActive
      ? [
          {
            id: 'mute',
            section: 'Voice',
            icon: live.muted ? MicOff : Mic,
            label: live.muted ? 'Unmute microphone' : 'Mute microphone',
            selected: live.muted,
            tone: live.muted ? 'danger' : 'neutral',
            onPress: live.toggleMute,
          } satisfies MobileCompanionMenuItem,
          {
            id: 'pause-voice',
            section: 'Voice',
            icon: Pause,
            label: 'Stop live voice',
            detail: 'Submitted work continues. Press the headset button to start again.',
            onPress: live.pause,
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...(livePaused
      ? [
          {
            id: 'resume-voice',
            section: 'Voice',
            icon: Play,
            label: 'Start live voice',
            tone: 'accent',
            onPress: () => void live.resume(),
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...(liveActive || livePaused
      ? [
          {
            id: 'end-voice',
            section: 'Voice',
            icon: Square,
            label: 'Release headset controls',
            detail: 'Releases headset controls. Submitted work continues.',
            tone: 'danger',
            onPress: live.stop,
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...(recording
      ? [
          {
            id: 'finish-recording',
            section: 'Voice',
            icon: Square,
            label: 'Finish recording and send',
            tone: 'success',
            onPress: () => void companion.toggle(),
          } satisfies MobileCompanionMenuItem,
          {
            id: 'pause-recording',
            section: 'Voice',
            icon: companion.recordingPaused ? Play : Pause,
            label: companion.recordingPaused ? 'Resume recording' : 'Pause recording',
            tone: companion.recordingPaused ? 'accent' : 'neutral',
            keepOpen: true,
            onPress: companion.toggleRecordingPause,
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...((recording || (voiceBusy && !liveActive && !companion.checkingVoiceMode))
      ? [
          {
            id: 'discard-recording',
            section: 'Voice',
            icon: X,
            label: 'Discard recording',
            tone: 'danger',
            onPress: () => void companion.discardRecording(),
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...(active
      ? [
          {
            id: 'stop-turn',
            section: 'Voice',
            icon: Square,
            label: liveActive ? 'Stop Companion turn and end voice' : 'Stop Companion turn',
            tone: 'danger',
            onPress: () => void companion.cancel(),
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    ...(liveActive || livePaused || live.captions
      ? [
          {
            id: 'captions',
            section: 'Voice',
            icon: Captions,
            label: captionsOpen ? 'Hide voice transcript' : 'Voice transcript',
            keepOpen: false,
            onPress: () => { resize(false); setCaptionsOpen((value) => !value); },
          } satisfies MobileCompanionMenuItem,
        ]
      : []),
    {
      id: 'workspaces',
      section: 'Workspace',
      icon: Folder,
      label: 'Companion workspaces',
      detail: 'Choose which workspaces Companion may read, write, or run commands in.',
      disabled: !companion.workspaceDeviceId,
      onPress: openWorkspaces,
    },
    {
      id: 'current-workspace',
      section: 'Workspace',
      icon: FolderOpen,
      label: currentWorkspace.label,
      detail: currentWorkspace.detail,
      selected: currentWorkspace.granted,
      tone: currentWorkspace.granted ? 'success' : 'neutral',
      disabled: !currentWorkspace.enabled,
      loading: currentWorkspace.busy || (currentWorkspace.loading && !currentWorkspace.current),
      keepOpen: true,
      onPress: () => {
        if (currentWorkspace.current) void currentWorkspace.grant();
        else currentWorkspace.reload();
      },
    },
  ];

  const maxHeight = Math.max(220, Math.min(height - insets.top - 48, height * 0.7));
  // Float above the navigation bar like the desktop card; nothing sits under the phone's buttons.
  const marginBottom = insets.bottom + SHEET_GAP;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      {workspaceDeviceId ? <MobileCompanionWorkspaceModal deviceId={workspaceDeviceId} onClose={() => setWorkspaceDeviceId(null)} /> : null}
      {visible && companion.screen ? <MobileCompanionScreenPanel screen={companion.screen} bottomOffset={sheetHeight + marginBottom + 12} availableHeight={height - sheetHeight - insets.top - insets.bottom - 100} /> : null}
      <Animated.View
        accessibilityLabel="Companion"
        layout={LinearTransition.duration(SETTLE.duration).easing(SETTLE.easing)}
        onLayout={(event) => {
          const sheet = event.nativeEvent.layout.height;
          setSheetHeight(sheet);
          // The chat screen already sits above the system inset; reserve the sheet plus its gaps.
          if (visible) reportOverlayInset(Math.round(sheet + SHEET_GAP));
        }}
        style={[styles.sheet, { maxHeight, marginBottom }, sheetStyle]}
      >
        <View style={styles.sheetInner}>
          <GestureDetector gesture={dragGesture}>
            <View
              style={styles.header}
              accessibilityActions={[{ name: 'expand', label: 'Expand Companion' }, { name: 'collapse', label: 'Collapse Companion' }]}
              onAccessibilityAction={(event) => resize(event.nativeEvent.actionName === 'collapse')}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={active ? 'Working — show tool activity' : 'Show Companion activity'}
                accessibilityState={{ expanded: activityExpanded }}
                hitSlop={8}
                onPress={() => { resize(false); setContextTooltipOpen(false); setActivityExpanded((value) => !value); }}
                style={({ pressed }) => [styles.dotButton, pressed && styles.pressed]}
              >
                {active ? (
                  <ActivityIndicator color={colors.accent} size="small" />
                ) : (
                  <View style={[styles.dot, statusDotStyle(status, liveActive, companion.recordingPaused)]} />
                )}
              </Pressable>
              <View style={styles.headline}>
                {companion.transcript ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={transcriptExpanded ? 'Collapse your message' : 'Expand your message'}
                    accessibilityState={{ expanded: transcriptExpanded }}
                    onPress={() => { resize(false); setTranscriptExpanded((value) => !value); }}
                  >
                    <Text numberOfLines={!collapsed && !composerFocused && transcriptExpanded ? undefined : 1} style={styles.transcript}>
                      {companion.transcript}
                    </Text>
                  </Pressable>
                ) : (
                  <Text accessibilityLiveRegion="polite" numberOfLines={1} style={[styles.title, status === 'error' && styles.titleError]}>
                    {headlineLabel(companion)}
                  </Text>
                )}
              </View>
              <ChatSubscriptionIndicator companion subscriptions={companion.subscriptions ?? []} />
              {liveActive ? (
                <HeaderButton
                  label={live.muted ? 'Unmute microphone' : 'Mute microphone'}
                  tone={live.muted ? 'danger' : 'neutral'}
                  pressed={live.muted}
                  onPress={live.toggleMute}
                  icon={live.muted ? MicOff : Mic}
                />
              ) : null}
              {liveSettings.enabled || liveActive || livePaused ? (
                <HeaderButton
                  label={liveActive ? 'Stop live voice; submitted work continues' : 'Start live voice'}
                  tone={liveActive ? 'danger' : 'accent'}
                  disabled={!liveActive && !livePaused && (liveBusy || voiceBusy || recording || !companion.available)}
                  onPress={() => void companion.toggle()}
                  icon={liveActive ? Square : Play}
                />
              ) : null}
              <HeaderButton
                label={`Auto-approve proposals ${autoApprove.enabled ? 'on' : 'off'}`}
                tone={autoApprove.enabled ? 'success' : 'neutral'}
                pressed={autoApprove.enabled}
                disabled={!companion.available || !autoApprove.supported || companion.proposalExecuting}
                loading={autoApprove.loading || autoApprove.saving}
                onPress={() => void autoApprove.save(!autoApprove.enabled)}
                icon={Zap}
              />
              <HeaderButton
                label="Companion options"
                onPress={() => { Keyboard.dismiss(); setMenuOpen(true); }}
                icon={Ellipsis}
              />
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
          </GestureDetector>

          {showBody ? (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              keyboardShouldPersistTaps="handled"
              nestedScrollEnabled
              showsVerticalScrollIndicator
            >
              {activityExpanded ? (
                <View style={styles.activity} accessibilityLabel="Companion activity">
                  <View style={styles.activitySummary}>
                    <Text style={[styles.activitySummaryText, { flex: 1 }]}>
                      {active ? 'Working' : 'Worked'} for {Math.round(elapsed / 1_000)}s ·{' '}
                      {companion.activity.length} tool {companion.activity.length === 1 ? 'call' : 'calls'}
                    </Text>
                    {companion.contextUsage ? (
                      <Pressable style={styles.contextUsage} accessibilityRole="button" accessibilityState={{ expanded: contextTooltipOpen }} accessibilityLabel={companionContextUsageLabel(companion.contextUsage)} onPress={() => setContextTooltipOpen((value) => !value)} hitSlop={8}>
                        <Svg width={26} height={26} viewBox="0 0 26 26">
                          <Circle cx={13} cy={13} r={10} fill="none" stroke={colors.muted} strokeWidth={3} opacity={0.5} />
                          <Circle cx={13} cy={13} r={10} fill="none" stroke={companion.contextUsage.percent >= 90 ? colors.danger : colors.accent} strokeWidth={3}
                            strokeDasharray={2 * Math.PI * 10} strokeDashoffset={2 * Math.PI * 10 * (1 - Math.min(100, companion.contextUsage.percent) / 100)}
                            rotation={-90} origin="13, 13" />
                        </Svg>
                      </Pressable>
                    ) : null}
                  </View>
                  {contextTooltipOpen && companion.contextUsage ? (
                    <Pressable style={styles.contextTooltip} onPress={() => setContextTooltipOpen(false)} accessibilityLabel="Dismiss context usage">
                      <Text style={styles.contextUsageText}>{companionContextUsageLabel(companion.contextUsage)}</Text>
                    </Pressable>
                  ) : null}
                  {companion.compaction ? (
                    <View style={styles.toolHeader} accessibilityLiveRegion="polite">
                      {companion.compaction.status === 'running' ? (
                        <ActivityIndicator color={colors.accent} size="small" />
                      ) : null}
                      <Text style={[styles.toolName, companion.compaction.status === 'failed' && { color: colors.danger }]}>
                        {companionCompactionLabel(companion.compaction)}
                      </Text>
                    </View>
                  ) : null}
                  {companion.activity.length === 0 ? (
                    <Text style={styles.toolName}>{active ? 'Thinking…' : 'No tool calls yet.'}</Text>
                  ) : null}
                  {activityGroups.map((group) => (
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
                  ))}
                </View>
              ) : null}

              {captionsOpen ? (
                <View accessibilityLabel="Live voice captions" style={styles.captions}>
                  <Text style={styles.captionsLabel}>Voice transcript</Text>
                  <Text selectable style={styles.captionsText}>
                    {live.captions || 'No voice transcript yet.'}
                  </Text>
                </View>
              ) : null}

              {errors.map((message, index) => (
                <Text key={`${index}:${message}`} accessibilityRole="alert" style={styles.errorText}>
                  {message}
                </Text>
              ))}

              {companion.reply ? (
                <View style={styles.reply}>
                  <NativeMarkdown text={companion.reply} />
                </View>
              ) : null}

              {companion.proposals?.length > 1 ? (
                <View accessibilityLabel="Pending proposals">
                  {companion.proposals.map(item => (
                    <Pressable key={item.targetId} accessibilityRole="button"
                      accessibilityState={{ selected: item.targetId === companion.selectedProposalId }}
                      onPress={() => companion.selectProposal(item.targetId)} style={{ paddingVertical: 8 }}>
                      <Text style={{ color: colors.text }}>
                        {item.targetId === companion.selectedProposalId ? '• ' : ''}{item.title} · {item.status}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {companion.proposal ? (
                <MobileCompanionProposal
                  key={companion.selectedProposalId}
                  proposal={companion.proposal}
                  defaultRepoPath={companion.proposalDefaultRepoPath ?? ''}
                  execution={companion.proposalExecution}
                  executing={companion.selectedProposalExecuting}
                  resolveDroneName={companion.resolveDroneName}
                  applyDisabled={applyDisabled}
                  onExecute={() => void companion.executeProposal(companion.selectedProposalId ?? undefined, companion.proposals.find(item => item.targetId === companion.selectedProposalId)?.revision)}
                  onDiscard={() => companion.discardProposal(companion.selectedProposalId ?? undefined, companion.proposals.find(item => item.targetId === companion.selectedProposalId)?.revision)}
                />
              ) : null}
              {companion.proposalHistory?.length ? (
                <View>
                  <Pressable accessibilityRole="button" onPress={() => setProposalHistoryOpen(value => !value)} style={{ paddingVertical: 8 }}>
                    <Text style={{ color: colors.text }}>Execution history</Text>
                  </Pressable>
                  {proposalHistoryOpen ? companion.proposalHistory.map((item, index) => (
                    <View key={`${item.targetId}-${index}`} style={{ paddingVertical: 8 }}>
                      <Text style={{ color: colors.text }}>{item.proposal.title} · {item.execution.ok ? 'Applied' : 'Failed'}</Text>
                      {item.execution.operations.map(operation => (
                        <Text key={operation.id} style={{ color: colors.text }}>{operation.id}: {operation.status}{operation.error ? ` · ${operation.error}` : ''}</Text>
                      ))}
                    </View>
                  )) : null}
                </View>
              ) : null}
            </ScrollView>
          ) : null}
        </View>
      </Animated.View>
      <MobileCompanionMenu visible={menuOpen} items={menuItems} onClose={closeMenu}>
        {menuOpen ? <MobileCompanionModelPicker key={companion.workspaceDeviceId} deviceId={companion.workspaceDeviceId} /> : null}
      </MobileCompanionMenu>
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
    justifyContent: 'flex-end',
  },
  sheet: {
    marginHorizontal: 10,
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.36,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
    elevation: 18,
  },
  sheetInner: { flexShrink: 1, paddingBottom: 4 },
  header: {
    minHeight: 48,
    paddingTop: 6,
    paddingBottom: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 10,
    paddingRight: 6,
  },
  dotButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.mutedDim },
  dotDanger: { backgroundColor: colors.danger },
  dotWarning: { backgroundColor: colors.warning },
  dotAccent: { backgroundColor: colors.accent },
  dotOnline: { backgroundColor: colors.online },
  dotMuted: { backgroundColor: colors.mutedDim },
  headline: { flex: 1, minWidth: 0, justifyContent: 'center', minHeight: 30 },
  title: { color: colors.text, fontSize: 13, fontWeight: '700' },
  titleError: { color: colors.danger },
  transcript: { color: colors.textSecondary, fontSize: 12.5, lineHeight: 17 },
  headerButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.controlSurface,
  },
  closeButton: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { paddingHorizontal: 14, paddingTop: 2, paddingBottom: 10, gap: 10 },
  activity: { gap: 2 },
  activitySummary: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, paddingBottom: 4 },
  contextUsage: { alignItems: 'center', justifyContent: 'center', width: 28, height: 28, marginLeft: 'auto' },
  contextTooltip: { alignSelf: 'flex-end', maxWidth: '100%', padding: 8, borderRadius: 6, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  contextUsageText: { color: colors.muted, fontSize: 9, textAlign: 'right', fontVariant: ['tabular-nums'] },
  activitySummaryText: { color: colors.muted, fontSize: 11, paddingBottom: 4 },
  captions: { gap: 4, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.borderSubtle, backgroundColor: colors.whiteWashSoft },
  captionsLabel: { color: colors.mutedDim, fontSize: 9, fontWeight: '800', letterSpacing: 0.6, textTransform: 'uppercase' },
  captionsText: { color: colors.textSecondary, fontSize: 11.5, lineHeight: 16 },
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
  toolCall: { marginLeft: 4 },
  toolHeader: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toolDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.mutedDim },
  toolName: { flex: 1, color: colors.textSecondary, fontSize: 10.5 },
  toolDetails: { gap: 6, paddingLeft: 13, paddingBottom: 6 },
  toolDetailLabel: { color: colors.mutedDim, fontSize: 8.5, fontWeight: '700' },
  toolDetail: { color: colors.textSecondary, fontFamily: 'monospace', fontSize: 9, lineHeight: 13 },
  errorText: { color: colors.danger, fontSize: 11, lineHeight: 16 },
  reply: { paddingTop: 2 },
  ghostPressed: { backgroundColor: colors.whiteWash },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
