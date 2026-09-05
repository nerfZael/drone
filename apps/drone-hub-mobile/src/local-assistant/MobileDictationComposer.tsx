import React from 'react';
import {
  ActivityIndicator,
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
import Bot from 'lucide-react-native/icons/bot';
import ChevronUp from 'lucide-react-native/icons/chevron-up';
import Copy from 'lucide-react-native/icons/copy';
import Layers from 'lucide-react-native/icons/layers';
import MessageSquarePlus from 'lucide-react-native/icons/message-square-plus';
import Mic from 'lucide-react-native/icons/mic';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Send from 'lucide-react-native/icons/send';
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
];

export function MobileDictationComposerPreview({
  primaryActionLabel = 'Current chat',
  showDestinationMenu = true,
}: {
  primaryActionLabel?: string;
  showDestinationMenu?: boolean;
} = {}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, styles.statusDotReady]} />
          <Text style={styles.statusText}>Ready to record</Text>
        </View>
        <ComposerIconButton
          label="Discard and close dictation"
          icon={X}
          onPress={() => undefined}
        />
      </View>

      <View style={styles.editorFrame} />

      <View style={styles.bottomToolbar}>
        <View style={styles.recordingControls}>
          <RecordingButton
            label="Discard current recording"
            icon={X}
            tone="danger"
            disabled
            onPress={() => undefined}
          />
          <RecordingButton
            label="Pause recording"
            icon={Pause}
            disabled
            onPress={() => undefined}
          />
          <View style={styles.recordButton}>
            <Mic color={colors.onAccent} size={20} strokeWidth={2.2} />
          </View>
        </View>
        <View style={styles.toolbarSpacer} />
        <View style={styles.sendControls}>
          {showDestinationMenu ? (
            <View style={[styles.destinationMenuButton, styles.disabled]}>
              <ChevronUp color={colors.accent} size={16} strokeWidth={2.2} />
            </View>
          ) : null}
          <View style={[styles.currentChatButton, styles.disabled]}>
            <Send color={colors.onAccent} size={16} strokeWidth={2.3} />
            <Text style={styles.currentChatLabel} numberOfLines={1}>
              {primaryActionLabel}
            </Text>
          </View>
        </View>
      </View>
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
  primaryActionLabel = 'Current chat',
  primaryActionAccessibilityLabel,
  primaryActionDisabled = false,
  showDestinationMenu = true,
  standalone = true,
  morphToComposer = false,
  morphTargetHeight = 92,
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
  primaryActionLabel?: string;
  primaryActionAccessibilityLabel?: string;
  primaryActionDisabled?: boolean;
  showDestinationMenu?: boolean;
  standalone?: boolean;
  morphToComposer?: boolean;
  morphTargetHeight?: number;
}) {
  const [destinationMenuOpen, setDestinationMenuOpen] = React.useState(false);
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
  const message = failedTranscriptionError || error || notice;
  const messageIsError = Boolean(failedTranscriptionError || error);
  const dismissY = useSharedValue(0);
  const cardHeight = useSharedValue(177);
  const dismissStartHeight = useSharedValue(177);

  const close = React.useCallback(() => {
    void onClose();
  }, [onClose]);
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
    setDestinationMenuOpen(false);
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
          styles.container,
          styles.cardContainer,
          standalone && styles.standaloneContainer,
          morphToComposer && styles.morphContainer,
          dismissStyle,
        ]}
      >
        <View style={styles.header}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                recordingStatus === 'paused' && styles.statusDotPaused,
                !recordingActive && styles.statusDotReady,
                Boolean(error) && styles.statusDotError,
              ]}
            />
            <Text style={styles.statusText}>
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
              <Text style={styles.pendingText}>{pendingCount} transcribing</Text>
            ) : null}
          </View>
          <ComposerIconButton
            label="Discard and close dictation"
            icon={X}
            disabled={controlsDisabled}
            onPress={() => void onClose()}
          />
        </View>

        <View style={styles.editorFrame}>
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
              placeholder="Your recordings and notes will appear here…"
              placeholderTextColor={colors.mutedDim}
              style={styles.editor}
            />
          </GestureDetector>
        </View>

        {message ? (
          <View style={[styles.messageRow, messageIsError && styles.messageRowError]}>
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
        ) : null}

        <View style={styles.bottomToolbar}>
          <View style={styles.recordingControls}>
            <RecordingButton
              label="Discard current recording"
              icon={X}
              tone="danger"
              disabled={!recordingActive || controlsDisabled}
              onPress={() => void onCancelRecording()}
            />
            <RecordingButton
              label={recordingStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
              icon={recordingStatus === 'paused' ? Play : Pause}
              disabled={
                (recordingStatus !== 'recording' && recordingStatus !== 'paused') ||
                controlsDisabled
              }
              onPress={onTogglePause}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recordingActive ? 'Stop and transcribe' : 'Start recording'}
              accessibilityState={{ disabled: recordDisabled }}
              disabled={recordDisabled}
              onPress={() => void onToggleRecording()}
              style={({ pressed }) => [
                styles.recordButton,
                recordingActive && styles.stopButton,
                recordDisabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {recordingStatus === 'starting' ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : recordingActive ? (
                <Square color={colors.onAccent} fill={colors.onAccent} size={17} strokeWidth={2} />
              ) : (
                <Mic color={colors.onAccent} size={20} strokeWidth={2.2} />
              )}
            </Pressable>
          </View>
          <View style={styles.toolbarSpacer} />
          <View style={styles.sendControls}>
            {showDestinationMenu ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Show other dictation destinations"
                accessibilityState={{ expanded: destinationMenuOpen, disabled: controlsDisabled }}
                disabled={controlsDisabled}
                onPress={() => setDestinationMenuOpen((current) => !current)}
                style={({ pressed }) => [
                  styles.destinationMenuButton,
                  controlsDisabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <ChevronUp color={colors.accent} size={16} strokeWidth={2.2} />
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                primaryActionAccessibilityLabel ?? `Send dictation to ${droneName}, ${chatName}`
              }
              accessibilityState={{ disabled: sendDisabled }}
              disabled={sendDisabled}
              onPress={() => send('current-chat')}
              style={({ pressed }) => [
                styles.currentChatButton,
                sendDisabled && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {networkSending ? (
                <ActivityIndicator color={colors.onAccent} size="small" />
              ) : (
                <Send color={colors.onAccent} size={16} strokeWidth={2.3} />
              )}
              <Text style={styles.currentChatLabel} numberOfLines={1}>
                {primaryActionLabel}
              </Text>
            </Pressable>
          </View>
        </View>

        {showDestinationMenu && destinationMenuOpen ? (
          <View style={styles.destinationMenu}>
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
                onPress={() => send(destination)}
                style={({ pressed }) => [
                  styles.destinationMenuItem,
                  sendDisabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <Icon color={colors.accent} size={15} strokeWidth={2.2} />
                <Text style={styles.destinationMenuLabel} numberOfLines={1}>
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

function ComposerIconButton({
  label,
  icon: Icon,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: typeof X;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={9}
      onPress={onPress}
      style={({ pressed }) => [
        styles.headerButton,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={colors.muted} size={14} strokeWidth={2} />
    </Pressable>
  );
}

function RecordingButton({
  label,
  icon: Icon,
  tone = 'default',
  disabled = false,
  onPress,
}: {
  label: string;
  icon: typeof X;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [
        styles.recordingButton,
        tone === 'danger' && styles.recordingButtonDanger,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        color={tone === 'danger' ? colors.danger : colors.textSecondary}
        size={18}
        strokeWidth={2.1}
      />
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
  if (input.recordingStatus === 'starting') return 'Starting…';
  if (input.recordingStatus === 'recording' || input.recordingStatus === 'paused') {
    const state = input.recordingStatus === 'paused' ? 'Paused' : 'Recording';
    return `${state} · ${formatMobileVoiceDuration(input.recordingDurationMillis)}`;
  }
  if (input.recordingStatus === 'stopped') return 'Stopping…';
  if (input.recordingStatus === 'transcribing' || input.pendingCount > 0) {
    return `${input.pendingCount || 1} transcribing`;
  }
  if (input.microphoneUnavailable) return 'Microphone in use';
  return 'Ready to record';
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    flexShrink: 0,
    gap: 5,
    paddingHorizontal: 5,
    paddingTop: 5,
    paddingBottom: 6,
    borderTopWidth: 1,
    borderTopColor: colors.accentBorder,
    backgroundColor: colors.panelRaised,
  },
  cardContainer: {
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  standaloneContainer: {
    marginHorizontal: 9,
    marginTop: 6,
    marginBottom: 8,
  },
  morphContainer: { overflow: 'hidden' },
  header: {
    minHeight: 26,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statusRow: { minWidth: 0, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.danger },
  statusDotPaused: { backgroundColor: colors.warning },
  statusDotReady: { backgroundColor: colors.accent },
  statusDotError: { backgroundColor: colors.danger },
  statusText: { color: colors.textSecondary, fontSize: 8.5, fontFamily: 'monospace' },
  pendingText: { color: colors.accent, fontSize: 8.5, fontWeight: '700' },
  headerButton: {
    width: 26,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
  },
  editorFrame: {
    height: 90,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    backgroundColor: colors.background,
    overflow: 'hidden',
  },
  editor: {
    minHeight: 88,
    flex: 1,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 7,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  messageRow: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    borderRadius: 7,
    backgroundColor: colors.warningDark,
  },
  messageRowError: { backgroundColor: colors.dangerDark },
  messageText: { minWidth: 0, flex: 1, color: colors.warning, fontSize: 9 },
  messageTextError: { color: colors.danger },
  messageAction: { paddingHorizontal: 3, paddingVertical: 6 },
  messageActionText: { color: colors.accent, fontSize: 9, fontWeight: '800' },
  recordingControls: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  recordingButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.controlSurface,
  },
  recordingButtonDanger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  recordButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    backgroundColor: colors.accent,
  },
  stopButton: { backgroundColor: colors.danger },
  bottomToolbar: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  toolbarSpacer: { flex: 1 },
  sendControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  destinationMenuButton: {
    width: 34,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.controlSurface,
  },
  currentChatButton: {
    minWidth: 124,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  currentChatLabel: { color: colors.onAccent, fontSize: 10, fontWeight: '800' },
  destinationMenu: {
    position: 'absolute',
    right: 5,
    bottom: 51,
    zIndex: 10,
    elevation: 8,
    width: 244,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    padding: 5,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.panel,
  },
  destinationMenuItem: {
    width: '49.1%',
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    borderRadius: 7,
    backgroundColor: colors.controlSurface,
  },
  destinationMenuLabel: { minWidth: 0, color: colors.text, fontSize: 9.5, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
