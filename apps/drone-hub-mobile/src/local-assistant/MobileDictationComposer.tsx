import React from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  type TextInput as NativeTextInput,
  type TextInputScrollEvent,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  Easing,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import Bot from 'lucide-react-native/icons/bot';
import Copy from 'lucide-react-native/icons/copy';
import Layers from 'lucide-react-native/icons/layers';
import MessageSquarePlus from 'lucide-react-native/icons/message-square-plus';
import Mic from 'lucide-react-native/icons/mic';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import type { MobileDictationDestination } from './mobile-dictation-types';
import { MOBILE_DICTATION_MAX_CHARS } from './mobile-dictation-storage';
import {
  mobileDictationDismissDistance,
  mobileDictationDismissProgress,
  mobileDictationShouldDismiss,
} from './mobile-dictation-dismiss';
import {
  formatMobileVoiceDuration,
  type MobileVoiceRecordingStatus,
} from './mobile-voice-transcription-model';

type DestinationAction = {
  destination: Exclude<MobileDictationDestination, 'current-chat'>;
  label: string;
  icon: typeof Bot;
};

const DESTINATION_ACTIONS: DestinationAction[] = [
  { destination: 'root-drone', label: 'Root drone', icon: Bot },
  { destination: 'group-drone', label: 'Group drone', icon: Layers },
  { destination: 'new-chat', label: 'New chat', icon: MessageSquarePlus },
  { destination: 'clone-chat', label: 'Clone chat', icon: Copy },
  { destination: 'companion', label: 'Companion', icon: Sparkles },
];

const EDITOR_HEIGHT = 92;
const CONTROLS_ROW_HEIGHT = 44;
const DESTINATION_ROW_HEIGHT = 46;
const CARD_PADDING_BOTTOM = 4;

/** Resting height of the dictation card (excluding standalone margins). */
export function mobileDictationComposerHeight({
  showDestinations,
}: {
  showDestinations: boolean;
}): number {
  return (
    EDITOR_HEIGHT +
    CONTROLS_ROW_HEIGHT +
    (showDestinations ? DESTINATION_ROW_HEIGHT : 0) +
    CARD_PADDING_BOTTOM +
    2
  );
}

export function MobileDictationComposerPreview({
  showDestinationMenu = true,
}: {
  showDestinationMenu?: boolean;
} = {}) {
  return (
    <View style={[styles.card, styles.previewCard]}>
      <View style={styles.editorArea} />
      <View style={styles.controlsRow}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, styles.statusDotReady]} />
          <Text style={styles.statusText}>Ready</Text>
        </View>
        <GhostButton label="Discard current recording" icon={X} tone="danger" disabled />
        <View style={styles.controlsSpacer} />
        <View style={styles.rightControls}>
          <GhostButton label="Pause recording" icon={Pause} disabled />
          <View style={styles.primaryButton}>
            <Mic color={colors.onAccent} size={18} strokeWidth={2.3} />
          </View>
          <View style={styles.sendDivider} />
          <View style={[styles.primaryButton, styles.disabled]}>
            <ArrowUp color={colors.onAccent} size={18} strokeWidth={2.6} />
          </View>
        </View>
      </View>
      {showDestinationMenu ? (
        <View style={styles.destinationRow}>
          {DESTINATION_ACTIONS.map(({ destination, label, icon: Icon }) => (
            <View key={destination} style={[styles.destinationButton, styles.disabled]}>
              <Icon color={colors.muted} size={14} strokeWidth={2.1} />
              <Text style={styles.destinationLabel} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function MobileDictationComposer({
  value,
  deviceName,
  droneName,
  chatName,
  groupName,
  recordingStatus,
  recordingDurationMillis,
  pendingCount,
  error,
  notice,
  failedTranscriptionError,
  finalizing,
  networkSending,
  microphoneUnavailable,
  onChangeText,
  onClose,
  onToggleRecording,
  onTogglePause,
  onCancelRecording,
  onRetryFailedTranscription,
  onDiscardFailedTranscription,
  onDestinationPress,
  onPrimaryPress,
  primaryActionAccessibilityLabel,
  primaryActionDisabled = false,
  showDestinationMenu = true,
  standalone = true,
  morphToComposer = false,
  morphTargetHeight = 92,
  placeholder = 'Ask the agent',
}: {
  value: string;
  deviceName: string;
  droneName: string;
  chatName: string;
  groupName?: string | null;
  recordingStatus: MobileVoiceRecordingStatus;
  recordingDurationMillis: number;
  pendingCount: number;
  error: string;
  notice: string;
  failedTranscriptionError?: string;
  finalizing: boolean;
  networkSending: boolean;
  microphoneUnavailable: boolean;
  onChangeText(value: string): void;
  onClose(): void | Promise<void>;
  onToggleRecording(): void | Promise<void>;
  onTogglePause(): void;
  onCancelRecording(): void | Promise<void>;
  onRetryFailedTranscription(): void;
  onDiscardFailedTranscription(): void;
  onDestinationPress?(destination: MobileDictationDestination): void | Promise<void>;
  onPrimaryPress?(): void | Promise<void>;
  primaryActionAccessibilityLabel?: string;
  primaryActionDisabled?: boolean;
  showDestinationMenu?: boolean;
  standalone?: boolean;
  morphToComposer?: boolean;
  morphTargetHeight?: number;
  placeholder?: string;
}) {
  const [editorAtTop, setEditorAtTop] = React.useState(true);
  const editorAtTopRef = React.useRef(true);
  const editorRef = React.useRef<NativeTextInput>(null);
  const suppressEditorFocusRef = React.useRef(false);
  const focusSuppressionTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingActive =
    recordingStatus === 'starting' ||
    recordingStatus === 'recording' ||
    recordingStatus === 'paused' ||
    recordingStatus === 'stopped';
  const controlsDisabled = finalizing || networkSending;
  const sendDisabled =
    controlsDisabled ||
    primaryActionDisabled ||
    (!value.trim() && !recordingActive && pendingCount === 0 && !failedTranscriptionError);
  const recordDisabled = controlsDisabled || (!recordingActive && microphoneUnavailable);
  const pauseDisabled =
    (recordingStatus !== 'recording' && recordingStatus !== 'paused') || controlsDisabled;
  const message = failedTranscriptionError || error || notice;
  const messageIsError = Boolean(failedTranscriptionError || error);
  const restingHeight = mobileDictationComposerHeight({ showDestinations: showDestinationMenu });
  const dismissY = useSharedValue(0);
  const cardHeight = useSharedValue(restingHeight);
  const dismissStartHeight = useSharedValue(restingHeight);

  const close = React.useCallback(() => {
    void onClose();
  }, [onClose]);

  React.useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!controlsDisabled) close();
      return true;
    });
    return () => subscription.remove();
  }, [close, controlsDisabled]);

  const beginDismissGesture = React.useCallback(() => {
    if (focusSuppressionTimerRef.current) clearTimeout(focusSuppressionTimerRef.current);
    focusSuppressionTimerRef.current = null;
    suppressEditorFocusRef.current = true;
    editorRef.current?.blur();
    Keyboard.dismiss();
  }, []);
  const finishDismissGesture = React.useCallback(() => {
    if (focusSuppressionTimerRef.current) clearTimeout(focusSuppressionTimerRef.current);
    focusSuppressionTimerRef.current = setTimeout(() => {
      suppressEditorFocusRef.current = false;
      focusSuppressionTimerRef.current = null;
    }, 220);
  }, []);

  React.useEffect(
    () => () => {
      if (focusSuppressionTimerRef.current) clearTimeout(focusSuppressionTimerRef.current);
    },
    [],
  );

  const createDismissGesture = React.useCallback(
    () =>
      Gesture.Pan()
        .enabled(!controlsDisabled)
        .maxPointers(1)
        .activeOffsetY(12)
        .failOffsetX([-60, 60])
        .failOffsetY(-14)
        .shouldCancelWhenOutside(false)
        .onBegin(() => {
          cancelAnimation(dismissY);
          dismissStartHeight.value = cardHeight.value;
        })
        .onStart(() => runOnJS(beginDismissGesture)())
        .onUpdate((event) => {
          dismissY.value = Math.max(0, event.translationY);
        })
        .onEnd((event) => {
          if (
            mobileDictationShouldDismiss({
              translationX: event.translationX,
              translationY: event.translationY,
              velocityY: event.velocityY,
              cardHeight: dismissStartHeight.value,
            })
          ) {
            dismissY.value = withTiming(
              morphToComposer
                ? mobileDictationDismissDistance(dismissStartHeight.value)
                : Math.max(240, dismissStartHeight.value + 32),
              { duration: 180, easing: Easing.in(Easing.quad) },
              (finished) => {
                if (finished) runOnJS(close)();
              },
            );
          } else {
            dismissY.value = withSpring(0, { damping: 22, stiffness: 260 });
          }
        })
        .onFinalize((_event, success) => {
          if (!success) dismissY.value = withSpring(0, { damping: 22, stiffness: 260 });
          runOnJS(finishDismissGesture)();
        }),
    [
      beginDismissGesture,
      cardHeight,
      close,
      controlsDisabled,
      dismissStartHeight,
      dismissY,
      finishDismissGesture,
      morphToComposer,
    ],
  );
  const dismissGesture = React.useMemo(createDismissGesture, [createDismissGesture]);
  const editorDismissGesture = React.useMemo(() => {
    const nativeGesture = Gesture.Native().disallowInterruption(!editorAtTop);
    return editorAtTop
      ? Gesture.Simultaneous(createDismissGesture(), nativeGesture)
      : nativeGesture;
  }, [createDismissGesture, editorAtTop]);
  const dismissStyle = useAnimatedStyle(() => {
    const progress = mobileDictationDismissProgress({
      translationX: 0,
      translationY: dismissY.value,
      cardHeight: dismissStartHeight.value,
    });
    if (morphToComposer) {
      return {
        height:
          progress > 0
            ? interpolate(
                progress,
                [0, 1],
                [dismissStartHeight.value, Math.max(52, morphTargetHeight)],
              )
            : undefined,
        opacity: interpolate(progress, [0, 0.18, 1], [1, 0.96, 0]),
        transform: [{ scale: interpolate(progress, [0, 1], [1, 0.99]) }],
      };
    }
    return {
      opacity: interpolate(progress, [0, 1], [1, 0.68]),
      transform: [
        { translateY: dismissY.value },
        { scale: interpolate(progress, [0, 1], [1, 0.985]) },
      ],
    };
  });

  const send = (destination: MobileDictationDestination) => {
    if (sendDisabled) return;
    if (destination === 'current-chat' && onPrimaryPress) void onPrimaryPress();
    else void onDestinationPress?.(destination);
  };

  const handleEditorScroll = React.useCallback((event: TextInputScrollEvent) => {
    const nextEditorAtTop = event.nativeEvent.contentOffset.y <= 1;
    if (nextEditorAtTop === editorAtTopRef.current) return;
    editorAtTopRef.current = nextEditorAtTop;
    setEditorAtTop(nextEditorAtTop);
  }, []);

  return (
    <GestureDetector gesture={dismissGesture}>
      <Animated.View
        onLayout={(event) => {
          if (dismissY.value > 0) return;
          cardHeight.value = event.nativeEvent.layout.height;
          dismissStartHeight.value = event.nativeEvent.layout.height;
        }}
        style={[
          styles.card,
          recordingActive && styles.cardRecording,
          standalone && styles.standaloneCard,
          morphToComposer && styles.morphCard,
          dismissStyle,
        ]}
      >
        <View style={styles.editorArea}>
          <GestureDetector gesture={editorDismissGesture}>
            <ThemedTextInput
              ref={editorRef}
              accessibilityLabel="Dictation draft"
              value={value}
              onChangeText={onChangeText}
              onFocus={() => {
                if (!suppressEditorFocusRef.current) return;
                editorRef.current?.blur();
                Keyboard.dismiss();
              }}
              onScroll={handleEditorScroll}
              editable={!controlsDisabled}
              maxLength={MOBILE_DICTATION_MAX_CHARS}
              multiline
              textAlignVertical="top"
              placeholder={placeholder}
              placeholderTextColor={colors.secondary}
              style={styles.editor}
            />
          </GestureDetector>
          {message ? (
            <View pointerEvents="box-none" style={styles.messageOverlay}>
              <View style={styles.messagePill}>
                <Text
                  style={[styles.messageText, messageIsError && styles.messageTextError]}
                  numberOfLines={2}
                >
                  {message}
                </Text>
                {failedTranscriptionError ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Retry failed transcription"
                      disabled={controlsDisabled}
                      onPress={onRetryFailedTranscription}
                      style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}
                    >
                      <Text style={styles.messageActionText}>Retry</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Discard failed transcription"
                      disabled={controlsDisabled}
                      onPress={onDiscardFailedTranscription}
                      style={({ pressed }) => [styles.messageAction, pressed && styles.pressed]}
                    >
                      <Text style={styles.messageActionText}>Discard</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            </View>
          ) : null}
        </View>

        <View style={styles.controlsRow}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                recordingStatus === 'paused' && styles.statusDotPaused,
                !recordingActive && styles.statusDotReady,
                Boolean(error) && styles.statusDotError,
              ]}
            />
            <Text accessibilityLiveRegion="polite" style={styles.statusText} numberOfLines={1}>
              {mobileDictationStatusLabel({
                recordingStatus,
                recordingDurationMillis,
                pendingCount,
                finalizing,
                networkSending,
                microphoneUnavailable,
              })}
            </Text>
            {recordingActive && pendingCount > 0 ? (
              <Text style={styles.pendingText} numberOfLines={1}>
                · {pendingCount} transcribing
              </Text>
            ) : null}
          </View>
          <GhostButton
            label="Discard current recording"
            icon={X}
            tone="danger"
            disabled={!recordingActive || controlsDisabled}
            onPress={() => void onCancelRecording()}
          />
          <View style={styles.controlsSpacer} />
          <View style={styles.rightControls}>
            <GhostButton
              label={recordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
              icon={recordingStatus === 'paused' ? Play : Pause}
              tone={recordingStatus === 'paused' ? 'accent' : 'default'}
              disabled={pauseDisabled}
              onPress={onTogglePause}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recordingActive ? 'Stop and transcribe' : 'Start recording'}
              accessibilityState={{ disabled: recordDisabled }}
              disabled={recordDisabled}
              hitSlop={4}
              onPress={() => void onToggleRecording()}
              style={({ pressed }) => [
                recordingActive ? styles.ghostButton : styles.primaryButton,
                recordDisabled && styles.disabled,
                pressed && (recordingActive ? styles.ghostButtonPressed : styles.pressed),
              ]}
            >
              {recordingActive ? (
                <Square color={colors.danger} fill={colors.danger} size={15} strokeWidth={2} />
              ) : (
                <Mic color={colors.onAccent} size={18} strokeWidth={2.3} />
              )}
            </Pressable>
            <View style={styles.sendDivider} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                primaryActionAccessibilityLabel ?? `Send dictation to ${droneName}, ${chatName}`
              }
              accessibilityState={{ disabled: sendDisabled }}
              disabled={sendDisabled}
              hitSlop={4}
              onPress={() => send('current-chat')}
              style={({ pressed }) => [
                styles.primaryButton,
                sendDisabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {networkSending ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : (
                <ArrowUp color={colors.onAccent} size={18} strokeWidth={2.6} />
              )}
            </Pressable>
          </View>
        </View>

        {showDestinationMenu ? (
          <View style={styles.destinationRow}>
            {DESTINATION_ACTIONS.map(({ destination, label, icon: Icon }) => (
              <Pressable
                key={destination}
                accessibilityRole="button"
                accessibilityState={{ disabled: sendDisabled }}
                disabled={sendDisabled}
                accessibilityLabel={destinationAccessibilityLabel({
                  destination,
                  deviceName,
                  droneName,
                  chatName,
                  groupName,
                })}
                hitSlop={4}
                onPress={() => send(destination)}
                style={({ pressed }) => [
                  styles.destinationButton,
                  sendDisabled && styles.disabled,
                  pressed && styles.destinationButtonPressed,
                ]}
              >
                <Icon color={colors.muted} size={14} strokeWidth={2.1} />
                <Text style={styles.destinationLabel} numberOfLines={1}>
                  {label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

function GhostButton({
  label,
  icon: Icon,
  tone = 'default',
  disabled = false,
  onPress,
}: {
  label: string;
  icon: typeof X;
  tone?: 'default' | 'danger' | 'accent';
  disabled?: boolean;
  onPress?(): void;
}) {
  const color =
    tone === 'danger' ? colors.danger : tone === 'accent' ? colors.accent : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={({ pressed }) => [
        styles.ghostButton,
        disabled && styles.disabled,
        pressed && styles.ghostButtonPressed,
      ]}
    >
      <Icon color={color} size={18} strokeWidth={2.2} />
    </Pressable>
  );
}

function destinationAccessibilityLabel(input: {
  destination: MobileDictationDestination;
  deviceName: string;
  droneName: string;
  chatName: string;
  groupName?: string | null;
}): string {
  if (input.destination === 'current-chat') {
    return `Send dictation to ${input.droneName}, ${input.chatName}`;
  }
  if (input.destination === 'root-drone') {
    return `Send dictation to a new root drone on ${input.deviceName}`;
  }
  if (input.destination === 'group-drone') {
    return `Send dictation to a new drone in ${input.groupName?.trim() || 'the ungrouped section'}`;
  }
  if (input.destination === 'new-chat') {
    return `Send dictation to a new chat in ${input.droneName}`;
  }
  if (input.destination === 'companion') {
    return 'Send dictation to Companion';
  }
  return `Send dictation to a clone of the current chat in ${input.droneName}`;
}

function mobileDictationStatusLabel(input: {
  recordingStatus: MobileVoiceRecordingStatus;
  recordingDurationMillis: number;
  pendingCount: number;
  finalizing: boolean;
  networkSending: boolean;
  microphoneUnavailable: boolean;
}): string {
  if (input.networkSending) return 'Sending…';
  if (input.finalizing) {
    return input.pendingCount > 0
      ? `Finishing ${input.pendingCount} transcription${input.pendingCount === 1 ? '' : 's'}…`
      : 'Preparing to send…';
  }
  // 'starting' and 'stopped' last a few frames; showing their own labels reads
  // as a flicker, so they borrow the neighbouring state's label instead.
  if (input.recordingStatus === 'starting' || input.recordingStatus === 'recording') {
    return formatMobileVoiceDuration(input.recordingDurationMillis);
  }
  if (input.recordingStatus === 'paused') {
    return `Paused · ${formatMobileVoiceDuration(input.recordingDurationMillis)}`;
  }
  if (
    input.recordingStatus === 'stopped' ||
    input.recordingStatus === 'transcribing' ||
    input.pendingCount > 0
  ) {
    return input.pendingCount > 1 ? `${input.pendingCount} transcribing` : 'Transcribing…';
  }
  if (input.microphoneUnavailable) return 'Microphone in use';
  return 'Ready';
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    flexShrink: 0,
    paddingBottom: CARD_PADDING_BOTTOM,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.composerBorder,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  cardRecording: { borderColor: colors.accentBorder },
  previewCard: { flex: 1 },
  standaloneCard: {
    marginHorizontal: 9,
    marginTop: 6,
    marginBottom: 8,
  },
  morphCard: { overflow: 'hidden' },
  editorArea: { height: EDITOR_HEIGHT, overflow: 'hidden' },
  editor: {
    flex: 1,
    minHeight: EDITOR_HEIGHT,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  messageOverlay: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    left: 8,
    alignItems: 'flex-start',
  },
  messagePill: {
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: colors.panel,
  },
  messageText: {
    minWidth: 0,
    flexShrink: 1,
    color: colors.warning,
    fontSize: 10,
    fontWeight: '600',
  },
  messageTextError: { color: colors.danger },
  messageAction: { paddingHorizontal: 2, paddingVertical: 4 },
  messageActionText: { color: colors.accent, fontSize: 10, fontWeight: '800' },
  controlsRow: {
    height: CONTROLS_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingLeft: 14,
    paddingRight: 6,
  },
  controlsSpacer: { flex: 1, minWidth: 8 },
  statusRow: { minWidth: 0, flexShrink: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  statusDotPaused: { backgroundColor: colors.warning },
  statusDotReady: { backgroundColor: colors.accent },
  statusDotError: { backgroundColor: colors.danger },
  statusText: {
    flexShrink: 1,
    color: colors.textSecondary,
    fontFamily: 'monospace',
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  pendingText: { flexShrink: 1, color: colors.accent, fontSize: 10, fontWeight: '700' },
  rightControls: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ghostButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  ghostButtonPressed: { backgroundColor: colors.whiteWash },
  primaryButton: {
    width: 36,
    height: 36,
    marginLeft: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent,
  },
  sendDivider: {
    width: 1,
    height: 20,
    marginHorizontal: 8,
    backgroundColor: colors.borderStrong,
    opacity: 0.55,
  },
  destinationRow: {
    height: DESTINATION_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 6,
  },
  destinationButton: {
    flex: 1,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
    paddingHorizontal: 2,
    borderRadius: 7,
  },
  destinationButtonPressed: { backgroundColor: colors.whiteWash },
  destinationLabel: {
    maxWidth: '100%',
    color: colors.muted,
    fontSize: 9,
    fontWeight: '600',
    textAlign: 'center',
  },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
