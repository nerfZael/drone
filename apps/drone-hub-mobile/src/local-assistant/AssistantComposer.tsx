import React from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextInput,
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
  type SharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import AudioLines from 'lucide-react-native/icons/audio-lines';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Mic from 'lucide-react-native/icons/mic';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { ThemedTextInput } from '../components/ThemedTextInput';
import { colors } from '../theme';
import {
  formatMobileVoiceDuration,
  mobileVoiceRecordActionDisabled,
  mobileVoiceStatusLabel,
  resolveMobileVoiceTranscriptDraft,
} from './mobile-voice-transcription-model';
import { useSharedMobileChatVoiceRecorder } from './MobileChatVoiceRecorderContext';
import { useMobileCompanion } from './MobileCompanionContext';
import { useMobileTranscriptionQueue } from './use-mobile-transcription-queue';
import { MobileContinuousVoiceModePicker } from './MobileContinuousVoiceModePicker';
import {
  MobileDictationComposer,
  MobileDictationComposerPreview,
  mobileDictationComposerHeight,
} from './MobileDictationComposer';
import type { MobileContinuousVoiceMode } from './mobile-continuous-dictation';
import {
  useMobileComposerContinuousVoice,
  type MobileComposerSend,
} from './use-mobile-composer-continuous-voice';
import { mobileContinuousVoiceStatusLabel } from './use-mobile-continuous-voice';
import {
  mobileAssistantComposerCollapsesOnBack,
  mobileAssistantComposerExpanded,
  mobileAssistantComposerSwipeProgress,
  mobileAssistantComposerSwipeStartsVoice,
  mobileAssistantStopVisible,
} from './assistant-composer-model';

type ComposerIcon = typeof ArrowUp;

function useSwipeUpVoiceGesture({
  enabled,
  onSwipeUp,
  onActivate,
  onArm,
  onSettle,
  progress,
  includeNativeGesture = false,
}: {
  enabled: boolean;
  onSwipeUp(): void;
  onActivate(): void;
  /** The swipe crossed the threshold; onSwipeUp follows once the animation lands. */
  onArm(): void;
  onSettle(): void;
  progress: SharedValue<number>;
  includeNativeGesture?: boolean;
}) {
  return React.useMemo(() => {
    const panGesture = Gesture.Pan()
      .enabled(enabled)
      .maxPointers(1)
      .activeOffsetY(-8)
      .failOffsetX([-80, 80])
      .failOffsetY(18)
      .shouldCancelWhenOutside(false)
      .onBegin(() => cancelAnimation(progress))
      .onStart(() => runOnJS(onActivate)())
      .onUpdate((event) => {
        progress.value = mobileAssistantComposerSwipeProgress({
          translationX: event.translationX,
          translationY: event.translationY,
          velocityY: event.velocityY,
        });
      })
      .onEnd((event) => {
        if (
          mobileAssistantComposerSwipeStartsVoice({
            translationX: event.translationX,
            translationY: event.translationY,
            velocityY: event.velocityY,
          })
        ) {
          runOnJS(onArm)();
          progress.value = withTiming(
            1,
            { duration: 90, easing: Easing.out(Easing.quad) },
            (finished) => {
              if (!finished) return;
              runOnJS(onSwipeUp)();
              progress.value = withDelay(120, withTiming(0, { duration: 140 }));
            },
          );
        } else {
          progress.value = withTiming(0, {
            duration: 180,
            easing: Easing.out(Easing.quad),
          });
        }
      })
      .onFinalize((_event, success) => {
        if (!success) progress.value = withTiming(0, { duration: 140 });
        runOnJS(onSettle)();
      });
    return includeNativeGesture ? Gesture.Simultaneous(panGesture, Gesture.Native()) : panGesture;
  }, [enabled, includeNativeGesture, onActivate, onArm, onSettle, onSwipeUp, progress]);
}

function SwipeUpVoiceComposer({
  enabled,
  usesChatDictation,
  gesture,
  progress,
  children,
  style,
}: {
  enabled: boolean;
  usesChatDictation: boolean;
  gesture: React.ComponentProps<typeof GestureDetector>['gesture'];
  progress: SharedValue<number>;
  children: React.ComponentProps<typeof View>['children'];
  style: React.ComponentProps<typeof Animated.View>['style'];
}) {
  React.useEffect(() => {
    if (!enabled) progress.value = withTiming(0, { duration: 120 });
  }, [enabled, progress]);

  const targetHeight = mobileDictationComposerHeight({ showDestinations: usesChatDictation });
  const composerStyle = useAnimatedStyle(() => ({
    minHeight: interpolate(progress.value, [0, 1], [52, targetHeight]),
    transform: [
      { translateY: interpolate(progress.value, [0, 1], [0, -3]) },
      { scale: interpolate(progress.value, [0, 1], [1, 0.995]) },
    ],
  }));
  const previewStyle = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.08, 0.7, 1], [0, 0.12, 0.94, 1]),
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[style, composerStyle]}>
        {children}
        <Animated.View
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          style={[styles.swipeVoicePreview, previewStyle]}
        >
          <MobileDictationComposerPreview showDestinationMenu={usesChatDictation} />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function compactAssistantModelName(value: string): string {
  const name = value.trim();
  if (!/^gpt(?:[-_\s]|$)/i.test(name)) return name.replace(/[-_]+/g, ' ');
  const parts = name
    .replace(/^gpt[-_\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((part, index) =>
      index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`,
    )
    .join(' ');
}

export function assistantReasoningName(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1).toLowerCase()}` : '';
}

function IconButton({
  label,
  icon: Icon,
  accent = false,
  disabled = false,
  onPress,
}: {
  label: string;
  icon: ComposerIcon;
  accent?: boolean;
  disabled?: boolean;
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={6}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        accent && styles.iconButtonAccent,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon
        color={accent ? colors.onAccent : colors.textSecondary}
        size={17}
        strokeWidth={accent ? 2.6 : 2.1}
      />
    </Pressable>
  );
}

function VoiceIconButton({
  label,
  icon: Icon,
  tone = 'default',
  disabled = false,
  onPress,
}: {
  label: string;
  icon: ComposerIcon;
  tone?: 'default' | 'danger' | 'success' | 'paused';
  disabled?: boolean;
  onPress(): void;
}) {
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'success'
        ? colors.online
        : tone === 'paused'
          ? colors.accent
          : colors.textSecondary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      hitSlop={7}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.voiceButton,
        tone === 'danger' && styles.voiceButtonDanger,
        tone === 'success' && styles.voiceButtonSuccess,
        tone === 'paused' && styles.voiceButtonPaused,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Icon color={color} size={16} strokeWidth={2.2} />
    </Pressable>
  );
}

export function AssistantComposer({
  focusKey,
  voiceResetKey,
  value,
  onChangeText,
  onSend,
  onStop,
  onOpenDictation,
  onDictationPrestart,
  onDictationPrestartCancel,
  onOpenModel,
  modelLabel,
  reasoningLabel,
  running = false,
  sending = false,
  editable = true,
  queueWhileRunning = false,
  continuousVoiceEnabled = true,
  showAttachments = true,
  hasAttachments = false,
  onAddAttachment,
  leadingControl,
  attachmentActionsDisabled = false,
  sendBlocked = false,
  alwaysExpanded = false,
  footer,
  onInputFocus,
  onInputBlur,
  maxLength = 32_000,
  placeholder = 'Ask the assistant…',
}: {
  focusKey?: string;
  voiceResetKey?: string;
  value: string;
  onChangeText(value: string): void;
  onSend: MobileComposerSend;
  onStop?(): void;
  onOpenDictation?(): void;
  /** Called as soon as a swipe-up is recognised so recording can begin early. */
  onDictationPrestart?(): void;
  /** Called when a recognised swipe-up is abandoned before opening dictation. */
  onDictationPrestartCancel?(): void;
  onOpenModel(): void;
  modelLabel: string;
  reasoningLabel?: string;
  running?: boolean;
  sending?: boolean;
  editable?: boolean;
  queueWhileRunning?: boolean;
  continuousVoiceEnabled?: boolean;
  showAttachments?: boolean;
  hasAttachments?: boolean;
  onAddAttachment?(): void;
  leadingControl?: React.ReactNode;
  attachmentActionsDisabled?: boolean;
  sendBlocked?: boolean;
  alwaysExpanded?: boolean;
  footer?: any;
  onInputFocus?(target: number): void;
  onInputBlur?(): void;
  maxLength?: number;
  placeholder?: string;
}) {
  const inputRef = React.useRef<TextInput>(null);
  const valueRef = React.useRef(value);
  const suppressInputFocusRef = React.useRef(false);
  const voiceActionTokenRef = React.useRef(0);
  const [focused, setFocused] = React.useState(false);
  const [voiceActionInFlight, setVoiceActionInFlight] = React.useState(false);
  const [continuousModePickerOpen, setContinuousModePickerOpen] = React.useState(false);
  const [restingComposerHeight, setRestingComposerHeight] = React.useState(92);
  const companion = useMobileCompanion();
  const {
    error: sharedVoiceError,
    setError: setVoiceError,
    session: voiceSession,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    finishRecording,
    continuousVoice,
    continuousDictation,
  } = useSharedMobileChatVoiceRecorder();
  const companionUsingVoice = voiceSession.kind === 'companion';
  const voiceError = companion.status === 'idle' ? sharedVoiceError : '';
  const voiceStatus = voiceSession.kind === 'single-shot' ? voiceSession.status : ('idle' as const);
  const voiceDurationMillis = voiceSession.kind === 'single-shot' ? voiceSession.durationMillis : 0;
  const targetKey = String(voiceResetKey ?? '').trim();
  const voiceActive = voiceStatus !== 'idle';
  // Finished clips transcribe in parallel while the user keeps recording; their
  // text lands in the draft in recording order.
  const appendVoiceTranscript = React.useCallback(
    (transcript: string) => {
      const result = resolveMobileVoiceTranscriptDraft({
        draft: valueRef.current,
        transcript,
        action: 'append',
      });
      valueRef.current = result.nextDraft;
      onChangeText(result.message);
    },
    [onChangeText],
  );
  const transcriptionQueue = useMobileTranscriptionQueue({
    onTranscript: appendVoiceTranscript,
    onNotice: setVoiceError,
    onError: setVoiceError,
  });
  // While a swipe-up is in progress the recorder may already be running
  // (started early so no speech is lost); the card only appears once the swipe
  // completes.
  const [swipeUpActive, setSwipeUpActive] = React.useState(false);
  const localRecorderOpen =
    !onOpenDictation && (voiceActive || transcriptionQueue.hasClips) && !swipeUpActive;
  const voiceRecordAccessibilityLabel =
    voiceSession.kind === 'continuous'
      ? 'Continuous voice is using the microphone'
      : companionUsingVoice
        ? 'Companion is using the microphone'
        : onOpenDictation
          ? 'Open dictation draft'
          : 'Record voice message';
  const voiceActiveRef = React.useRef(voiceActive);
  voiceActiveRef.current = voiceActive;
  const voiceCanPause = voiceStatus === 'recording' || voiceStatus === 'paused';
  const voiceCanStop = voiceCanPause || voiceStatus === 'stopped';
  const attachmentsEnabled = showAttachments && Boolean(onAddAttachment);
  const attachmentActionDisabled =
    attachmentActionsDisabled ||
    !editable ||
    sending ||
    voiceActive ||
    (running && !queueWhileRunning);
  const voiceRecordActionDisabled = mobileVoiceRecordActionDisabled({
    editable,
    sending,
    running,
    queueWhileRunning,
    microphoneAvailable: voiceSession.kind === 'idle' && voiceSession.microphoneAvailable,
  });
  const {
    state: continuousSession,
    actionInFlight: continuousActionInFlight,
    startBlocked: continuousVoiceActionDisabled,
    start: startContinuousVoice,
    finish: finishContinuousVoice,
    togglePause: toggleContinuousVoicePause,
    cancel: cancelContinuousVoice,
    sendDictation,
  } = useMobileComposerContinuousVoice({
    targetKey,
    valueRef,
    onChangeText,
    onSend,
    onError: setVoiceError,
    startBlocked: !continuousVoiceEnabled || voiceRecordActionDisabled || voiceActive,
    session: voiceSession,
    continuousVoice,
    continuousDictation,
  });
  const continuousVoiceOwned = continuousSession.owned;
  const continuousVoiceElsewhere = continuousSession.elsewhere;
  const continuousDictationOwned = continuousSession.kind === 'dictation';
  const continuousVoiceMode = continuousSession.mode;
  const expanded =
    alwaysExpanded ||
    mobileAssistantComposerExpanded({
      focused,
      value,
      hasAttachments,
      voiceActive,
      voiceError,
    }) ||
    continuousVoiceOwned ||
    continuousDictationOwned;
  const showAssistantStop =
    editable &&
    mobileAssistantStopVisible({
      running,
      hasStopAction: Boolean(onStop),
      voiceActive,
    });
  const canSend =
    (Boolean(value.trim()) || hasAttachments || voiceCanStop || transcriptionQueue.hasClips) &&
    !sending &&
    editable &&
    !sendBlocked &&
    !voiceActionInFlight &&
    voiceStatus !== 'starting' &&
    voiceStatus !== 'transcribing' &&
    !continuousActionInFlight;
  const reasoning = assistantReasoningName(String(reasoningLabel ?? '').trim());
  const model = compactAssistantModelName(modelLabel);
  const voiceStatusText = mobileVoiceStatusLabel(voiceStatus);
  const voiceDurationText = formatMobileVoiceDuration(voiceDurationMillis);
  const continuousStatusText = mobileContinuousVoiceStatusLabel(
    continuousSession.status,
    continuousSession.pendingCount,
    continuousVoiceMode,
  );
  const continuousDurationText = formatMobileVoiceDuration(continuousSession.durationMillis);

  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  React.useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() => {
      if (valueRef.current.trim() && !suppressInputFocusRef.current && !voiceActiveRef.current)
        inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  React.useEffect(() => {
    if (valueRef.current.trim()) return;
    suppressInputFocusRef.current = true;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    const frame = requestAnimationFrame(() => {
      suppressInputFocusRef.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [voiceResetKey]);

  React.useEffect(() => {
    if (!voiceActive) return;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
  }, [voiceActive]);

  const previousRunningRef = React.useRef(running);
  React.useEffect(() => {
    const startedRunning = running && !previousRunningRef.current;
    previousRunningRef.current = running;
    if (!startedRunning || valueRef.current.trim() || hasAttachments || voiceActiveRef.current)
      return;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
  }, [hasAttachments, running]);

  React.useEffect(
    () => () => {
      voiceActionTokenRef.current += 1;
    },
    [],
  );

  const discardVoice = React.useCallback(() => {
    voiceActionTokenRef.current += 1;
    setVoiceActionInFlight(false);
    setVoiceError('');
    void discardRecording('single-shot');
  }, [discardRecording]);

  const beginVoiceRecording = React.useCallback(async () => {
    suppressInputFocusRef.current = true;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    try {
      await startRecording('single-shot');
    } finally {
      requestAnimationFrame(() => {
        inputRef.current?.blur();
        Keyboard.dismiss();
        suppressInputFocusRef.current = false;
      });
    }
  }, [startRecording]);

  const activateVoiceRecording = React.useCallback(() => {
    if (voiceRecordActionDisabled) return;
    if (!onOpenDictation) {
      if (!voiceActiveRef.current) void beginVoiceRecording();
      return;
    }
    // The swipe can leave the input focused on release; make sure the keyboard
    // never shows while the dictation card takes over.
    suppressInputFocusRef.current = true;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    onOpenDictation();
    requestAnimationFrame(() => {
      suppressInputFocusRef.current = false;
    });
  }, [beginVoiceRecording, onOpenDictation, voiceRecordActionDisabled]);
  // While a swipe-up is in progress the input must not take focus or raise the
  // keyboard, otherwise Android briefly shows it before dictation opens.
  const swipeUpSettleTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const swipeUpArmedRef = React.useRef(false);
  const prestartDictation = React.useCallback(() => {
    if (voiceRecordActionDisabled) return;
    if (onOpenDictation) onDictationPrestart?.();
    else if (!voiceActiveRef.current) void beginVoiceRecording();
  }, [beginVoiceRecording, onDictationPrestart, onOpenDictation, voiceRecordActionDisabled]);
  const cancelPrestartedDictation = React.useCallback(() => {
    if (onOpenDictation) onDictationPrestartCancel?.();
    else if (voiceActiveRef.current) discardVoice();
  }, [discardVoice, onDictationPrestartCancel, onOpenDictation]);
  const beginSwipeUp = React.useCallback(() => {
    if (swipeUpSettleTimerRef.current) clearTimeout(swipeUpSettleTimerRef.current);
    swipeUpSettleTimerRef.current = null;
    swipeUpArmedRef.current = false;
    setSwipeUpActive(true);
    prestartDictation();
  }, [prestartDictation]);
  const armSwipeUp = React.useCallback(() => {
    swipeUpArmedRef.current = true;
  }, []);
  const settleSwipeUp = React.useCallback(() => {
    if (!swipeUpArmedRef.current) cancelPrestartedDictation();
    if (swipeUpSettleTimerRef.current) clearTimeout(swipeUpSettleTimerRef.current);
    swipeUpSettleTimerRef.current = setTimeout(() => {
      swipeUpSettleTimerRef.current = null;
      setSwipeUpActive(false);
    }, 260);
  }, [cancelPrestartedDictation]);
  React.useEffect(
    () => () => {
      if (swipeUpSettleTimerRef.current) clearTimeout(swipeUpSettleTimerRef.current);
    },
    [],
  );
  const swipeVoiceProgress = useSharedValue(0);
  const swipeUpVoiceGesture = useSwipeUpVoiceGesture({
    enabled: !voiceRecordActionDisabled,
    onSwipeUp: activateVoiceRecording,
    onActivate: beginSwipeUp,
    onArm: armSwipeUp,
    onSettle: settleSwipeUp,
    progress: swipeVoiceProgress,
  });
  const swipeUpVoiceInputGesture = useSwipeUpVoiceGesture({
    enabled: !voiceRecordActionDisabled,
    onSwipeUp: activateVoiceRecording,
    onActivate: beginSwipeUp,
    onArm: armSwipeUp,
    onSettle: settleSwipeUp,
    progress: swipeVoiceProgress,
    includeNativeGesture: true,
  });

  const beginContinuousVoice = React.useCallback(
    async (mode: MobileContinuousVoiceMode) => {
      setContinuousModePickerOpen(false);
      suppressInputFocusRef.current = true;
      inputRef.current?.blur();
      setFocused(false);
      Keyboard.dismiss();
      try {
        await startContinuousVoice(mode);
      } finally {
        requestAnimationFrame(() => {
          suppressInputFocusRef.current = false;
        });
      }
    },
    [startContinuousVoice],
  );

  // Pickers opened from the composer hide the keyboard on Android; that must
  // not read as a back press that collapses the (still relevant) composer.
  const keepExpandedUntilRef = React.useRef(0);
  const keepExpandedThroughPicker = React.useCallback(() => {
    keepExpandedUntilRef.current = Date.now() + 900;
  }, []);

  const openContinuousVoiceModePicker = React.useCallback(() => {
    keepExpandedThroughPicker();
    inputRef.current?.blur();
    Keyboard.dismiss();
    setContinuousModePickerOpen(true);
  }, [keepExpandedThroughPicker]);

  const finishVoiceIntoQueue = React.useCallback(async () => {
    if (!voiceCanStop) return;
    const clip = await finishRecording('single-shot');
    if (clip) transcriptionQueue.enqueue(clip);
  }, [finishRecording, transcriptionQueue.enqueue, voiceCanStop]);

  const stopVoiceAndFillDraft = finishVoiceIntoQueue;

  const toggleLocalRecording = React.useCallback(async () => {
    if (voiceCanStop) {
      await finishVoiceIntoQueue();
      return;
    }
    if (voiceStatus !== 'idle') return;
    await beginVoiceRecording();
  }, [beginVoiceRecording, finishVoiceIntoQueue, voiceCanStop, voiceStatus]);

  const changeText = React.useCallback(
    (nextValue: string) => {
      valueRef.current = nextValue;
      onChangeText(nextValue);
    },
    [onChangeText],
  );

  const send = React.useCallback(async () => {
    if (!canSend) return;
    if (await sendDictation()) return;
    if (!voiceActive && !transcriptionQueue.hasClips) {
      setVoiceError('');
      onSend();
      return;
    }
    // Sending never drops speech: stop the live recording, wait for every
    // queued transcription to land in the draft, then send the whole draft.
    const token = voiceActionTokenRef.current + 1;
    voiceActionTokenRef.current = token;
    setVoiceActionInFlight(true);
    try {
      await finishVoiceIntoQueue();
      const complete = await transcriptionQueue.awaitAll();
      if (voiceActionTokenRef.current !== token) return;
      if (!complete) {
        setVoiceError('A transcription failed. Retry or discard it before sending.');
        return;
      }
      const draft = valueRef.current.trim();
      if (draft) {
        setVoiceError('');
        valueRef.current = '';
        onSend(draft);
      } else if (hasAttachments) {
        setVoiceError('');
        onSend();
      } else {
        setVoiceError((current) => current || 'No speech detected.');
      }
    } finally {
      if (voiceActionTokenRef.current === token) setVoiceActionInFlight(false);
    }
  }, [
    canSend,
    finishVoiceIntoQueue,
    hasAttachments,
    onSend,
    sendDictation,
    setVoiceError,
    transcriptionQueue,
    voiceActive,
  ]);

  const discardVoiceAndQueue = React.useCallback(() => {
    discardVoice();
    transcriptionQueue.clear();
  }, [discardVoice, transcriptionQueue.clear]);

  const collapseEmptyComposer = React.useCallback(() => {
    inputRef.current?.blur();
    setFocused(false);
    setVoiceError('');
    Keyboard.dismiss();
  }, [setVoiceError]);
  const collapsesOnBack = mobileAssistantComposerCollapsesOnBack({
    focused,
    value,
    hasAttachments,
    voiceActive,
    alwaysExpanded,
  });

  React.useEffect(() => {
    if (!collapsesOnBack) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      collapseEmptyComposer();
      return true;
    });
    return () => subscription.remove();
  }, [collapseEmptyComposer, collapsesOnBack]);

  React.useEffect(() => {
    if (Platform.OS !== 'android' || !collapsesOnBack) return;
    const subscription = Keyboard.addListener('keyboardDidHide', () => {
      if (Date.now() < keepExpandedUntilRef.current) return;
      collapseEmptyComposer();
    });
    return () => subscription.remove();
  }, [collapseEmptyComposer, collapsesOnBack]);

  return (
    <View style={styles.frame}>
      <View style={localRecorderOpen && styles.localRecorderStack}>
        <View
          pointerEvents={localRecorderOpen ? 'none' : 'auto'}
          onLayout={(event) => {
            const nextHeight = event.nativeEvent.layout.height;
            if (nextHeight > 0 && Math.abs(nextHeight - restingComposerHeight) > 0.5)
              setRestingComposerHeight(nextHeight);
          }}
          style={localRecorderOpen && styles.localRecorderBackdrop}
        >
          <SwipeUpVoiceComposer
            enabled={!voiceRecordActionDisabled}
            usesChatDictation={Boolean(onOpenDictation)}
            gesture={swipeUpVoiceGesture}
            progress={swipeVoiceProgress}
            style={[
              styles.composer,
              expanded && styles.composerExpanded,
              Boolean(leadingControl) && styles.composerWithLeadingControl,
            ]}
          >
            <GestureDetector gesture={swipeUpVoiceInputGesture}>
              <ThemedTextInput
                ref={inputRef}
                value={value}
                onChangeText={changeText}
                onFocus={(event) => {
                  if (suppressInputFocusRef.current || voiceActive || swipeUpActive) {
                    inputRef.current?.blur();
                    Keyboard.dismiss();
                    return;
                  }
                  setFocused(true);
                  onInputFocus?.(event.nativeEvent.target);
                }}
                onBlur={() => {
                  setFocused(false);
                  onInputBlur?.();
                }}
                editable={editable && (!running || queueWhileRunning) && !voiceActive}
                showSoftInputOnFocus={!voiceActive && !swipeUpActive}
                multiline
                maxLength={maxLength}
                placeholder={placeholder}
                placeholderTextColor={colors.secondary}
                textAlignVertical="top"
                style={[
                  styles.input,
                  expanded && styles.inputExpanded,
                  !expanded &&
                    (attachmentsEnabled
                      ? styles.inputWithCollapsedVoice
                      : styles.inputWithCollapsedVoiceOnly),
                  !expanded && showAssistantStop && styles.inputWithCollapsedStop,
                ]}
              />
            </GestureDetector>
            {!expanded ? (
              <>
                {attachmentsEnabled ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Add image"
                    accessibilityState={{ disabled: attachmentActionDisabled }}
                    disabled={attachmentActionDisabled}
                    hitSlop={6}
                    onPress={onAddAttachment}
                    style={({ pressed }) => [
                      styles.collapsedAddButton,
                      attachmentActionDisabled && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Plus color={colors.textSecondary} size={17} strokeWidth={2.1} />
                  </Pressable>
                ) : null}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={voiceRecordAccessibilityLabel}
                  accessibilityState={{ disabled: voiceRecordActionDisabled }}
                  disabled={voiceRecordActionDisabled}
                  hitSlop={6}
                  onPress={activateVoiceRecording}
                  style={({ pressed }) => [
                    styles.collapsedVoiceButton,
                    showAssistantStop && styles.collapsedVoiceButtonWithStop,
                    voiceRecordActionDisabled && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Mic color={colors.textSecondary} size={17} strokeWidth={2.1} />
                </Pressable>
                {showAssistantStop ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Stop assistant"
                    hitSlop={6}
                    onPress={() => onStop?.()}
                    style={({ pressed }) => [styles.collapsedStopButton, pressed && styles.pressed]}
                  >
                    <Square
                      color={colors.danger}
                      size={15}
                      strokeWidth={2.2}
                      fill={colors.danger}
                    />
                  </Pressable>
                ) : null}
              </>
            ) : null}
            {!localRecorderOpen &&
            (voiceError || voiceStatusText || (continuousVoiceOwned && continuousStatusText)) ? (
              <View style={styles.voiceFeedback}>
                {voiceError ? (
                  <Text
                    accessibilityLiveRegion="polite"
                    numberOfLines={2}
                    style={[styles.voiceFeedbackText, styles.voiceFeedbackError]}
                  >
                    {voiceError}
                  </Text>
                ) : (
                  <View style={styles.voiceStatusRow}>
                    <View
                      style={[
                        styles.voiceStatusDot,
                        voiceStatus === 'paused' && styles.voiceStatusDotPaused,
                        voiceStatus === 'transcribing' && styles.voiceStatusDotTranscribing,
                        continuousVoiceOwned &&
                          continuousSession.status === 'speech' &&
                          styles.voiceStatusDotSpeech,
                        continuousVoiceOwned &&
                          continuousSession.status === 'error' &&
                          styles.voiceStatusDotError,
                      ]}
                    />
                    <Text accessibilityLiveRegion="polite" style={styles.voiceFeedbackText}>
                      {continuousVoiceOwned ? continuousStatusText : voiceStatusText}
                    </Text>
                    <Text
                      accessibilityLabel={`${continuousVoiceOwned ? continuousDurationText : voiceDurationText} elapsed`}
                      style={styles.voiceTimer}
                    >
                      {continuousVoiceOwned ? continuousDurationText : voiceDurationText}
                    </Text>
                  </View>
                )}
              </View>
            ) : null}
            {expanded ? (
              <View style={styles.controls}>
                {(localRecorderOpen || voiceStatus === 'idle') && !continuousVoiceOwned ? (
                  <>
                    {attachmentsEnabled ? (
                      <IconButton
                        label="Add image"
                        icon={Plus}
                        disabled={attachmentActionDisabled}
                        onPress={() => {
                          keepExpandedThroughPicker();
                          onAddAttachment!();
                        }}
                      />
                    ) : null}
                    {leadingControl}
                    <View style={styles.controlSpacer} />
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Choose model and reasoning"
                      disabled={!editable || running}
                      onPress={() => {
                        keepExpandedThroughPicker();
                        onOpenModel();
                      }}
                      style={({ pressed }) => [
                        styles.modelControl,
                        (!editable || running) && styles.disabled,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text numberOfLines={1} style={styles.modelLabel}>
                        {model}
                        {reasoning ? ` ${reasoning}` : ''}
                      </Text>
                      <ChevronDown color={colors.secondary} size={14} strokeWidth={2.2} />
                    </Pressable>
                    <IconButton
                      label={
                        continuousVoiceElsewhere
                          ? 'Continuous voice is active in another chat'
                          : 'Choose continuous voice mode'
                      }
                      icon={AudioLines}
                      disabled={continuousVoiceActionDisabled}
                      onPress={openContinuousVoiceModePicker}
                    />
                    <IconButton
                      label={voiceRecordAccessibilityLabel}
                      icon={Mic}
                      disabled={voiceRecordActionDisabled}
                      onPress={activateVoiceRecording}
                    />
                  </>
                ) : continuousVoiceOwned ? (
                  <>
                    <VoiceIconButton
                      label={
                        continuousVoiceMode === 'dictation'
                          ? 'Cancel continuous dictation and keep transcribed text'
                          : 'Cancel continuous voice and discard unsent audio'
                      }
                      icon={X}
                      tone="danger"
                      disabled={continuousActionInFlight && continuousSession.status !== 'starting'}
                      onPress={() => void cancelContinuousVoice()}
                    />
                    <View style={styles.controlSpacer} />
                    <View style={styles.voicePrimaryControls}>
                      <VoiceIconButton
                        label={`${continuousSession.status === 'paused' || continuousSession.status === 'error' ? 'Resume' : 'Pause'} ${continuousVoiceMode}`}
                        icon={
                          continuousSession.status === 'paused' ||
                          continuousSession.status === 'error'
                            ? Play
                            : Pause
                        }
                        tone={
                          continuousSession.status === 'paused' ||
                          continuousSession.status === 'error'
                            ? 'paused'
                            : 'default'
                        }
                        disabled={
                          continuousActionInFlight ||
                          continuousSession.status === 'starting' ||
                          continuousSession.status === 'stopping'
                        }
                        onPress={() => void toggleContinuousVoicePause()}
                      />
                      <VoiceIconButton
                        label={
                          continuousVoiceMode === 'dictation'
                            ? 'Stop continuous dictation and keep text'
                            : 'Stop continuous voice after pending thoughts are sent'
                        }
                        icon={Square}
                        tone="success"
                        disabled={
                          continuousActionInFlight ||
                          continuousSession.status === 'starting' ||
                          continuousSession.status === 'stopping' ||
                          continuousSession.status === 'error'
                        }
                        onPress={() => void finishContinuousVoice()}
                      />
                    </View>
                  </>
                ) : (
                  <>
                    <VoiceIconButton
                      label="Discard recording"
                      icon={X}
                      tone="danger"
                      disabled={voiceStatus === 'transcribing' || voiceActionInFlight}
                      onPress={discardVoice}
                    />
                    <View style={styles.controlSpacer} />
                    <View style={styles.voicePrimaryControls}>
                      <VoiceIconButton
                        label={voiceStatus === 'paused' ? 'Resume recording' : 'Pause recording'}
                        icon={voiceStatus === 'paused' ? Play : Pause}
                        tone={voiceStatus === 'paused' ? 'paused' : 'default'}
                        disabled={!voiceCanPause || voiceActionInFlight}
                        onPress={() => toggleRecordingPause('single-shot')}
                      />
                      <VoiceIconButton
                        label="Stop recording and transcribe"
                        icon={Square}
                        tone="success"
                        disabled={!voiceCanStop || voiceActionInFlight}
                        onPress={() => void stopVoiceAndFillDraft()}
                      />
                    </View>
                  </>
                )}
                {showAssistantStop ? (
                  <IconButton label="Stop assistant" icon={Square} onPress={() => onStop?.()} />
                ) : null}
                {!running || queueWhileRunning ? (
                  <IconButton
                    label="Send message"
                    icon={ArrowUp}
                    accent
                    disabled={!canSend}
                    onPress={() => void send()}
                  />
                ) : null}
              </View>
            ) : null}
          </SwipeUpVoiceComposer>
        </View>
        {localRecorderOpen ? (
          <MobileDictationComposer
            value={value}
            deviceName=""
            droneName="New drone"
            chatName=""
            recordingStatus={voiceStatus}
            recordingDurationMillis={voiceDurationMillis}
            pendingCount={transcriptionQueue.pendingCount}
            error={voiceError}
            notice=""
            failedTranscriptionError={transcriptionQueue.failedClip?.error}
            finalizing={voiceActionInFlight}
            networkSending={sending}
            microphoneUnavailable={false}
            onChangeText={changeText}
            onClose={discardVoiceAndQueue}
            onToggleRecording={toggleLocalRecording}
            onTogglePause={() => toggleRecordingPause('single-shot')}
            onCancelRecording={discardVoice}
            onRetryFailedTranscription={() => {
              setVoiceError('');
              transcriptionQueue.retryFailed();
            }}
            onDiscardFailedTranscription={() => {
              setVoiceError('');
              transcriptionQueue.discardFailed();
            }}
            onPrimaryPress={send}
            primaryActionAccessibilityLabel="Send recording"
            primaryActionDisabled={!canSend}
            showDestinationMenu={false}
            standalone={false}
            morphToComposer
            morphTargetHeight={restingComposerHeight}
            placeholder={placeholder}
          />
        ) : null}
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
      <MobileContinuousVoiceModePicker
        visible={continuousModePickerOpen}
        onClose={() => setContinuousModePickerOpen(false)}
        onSelect={(mode) => void beginContinuousVoice(mode)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 8,
    backgroundColor: colors.background,
  },
  localRecorderStack: { position: 'relative' },
  localRecorderBackdrop: { position: 'absolute', top: 0, right: 0, left: 0 },
  composer: {
    minHeight: 52,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.composerBorder,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
    overflow: 'hidden',
  },
  composerExpanded: { borderRadius: 7, borderColor: colors.accentBorder },
  composerWithLeadingControl: { overflow: 'visible' },
  swipeVoicePreview: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    overflow: 'hidden',
  },
  input: {
    minHeight: 50,
    maxHeight: 132,
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 11,
  },
  inputExpanded: { minHeight: 44, paddingTop: 12, paddingBottom: 0 },
  inputWithCollapsedVoice: { paddingLeft: 54, paddingRight: 54 },
  inputWithCollapsedVoiceOnly: { paddingLeft: 16, paddingRight: 54 },
  inputWithCollapsedStop: { paddingRight: 97 },
  collapsedAddButton: {
    position: 'absolute',
    left: 9,
    top: 9,
    width: 34,
    height: 34,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedVoiceButton: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 34,
    height: 34,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collapsedVoiceButtonWithStop: { right: 52 },
  collapsedStopButton: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 34,
    height: 34,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    backgroundColor: colors.dangerDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controls: {
    minHeight: 47,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingBottom: 9,
  },
  controlSpacer: { flex: 1 },
  voiceFeedback: { paddingHorizontal: 12, paddingTop: 5, paddingBottom: 8 },
  voiceStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  voiceStatusDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.danger },
  voiceStatusDotPaused: { backgroundColor: colors.warning },
  voiceStatusDotTranscribing: { backgroundColor: colors.accent },
  voiceStatusDotSpeech: { backgroundColor: colors.online },
  voiceStatusDotError: { backgroundColor: colors.danger },
  voiceFeedbackText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.25,
  },
  voiceFeedbackError: { color: colors.danger, fontWeight: '600', letterSpacing: 0 },
  voiceTimer: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 11,
    fontWeight: '400',
    fontVariant: ['tabular-nums'],
  },
  voicePrimaryControls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  voiceButton: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
  },
  voiceButtonDanger: { borderColor: colors.dangerBorder, backgroundColor: colors.dangerDark },
  voiceButtonSuccess: { borderColor: colors.onlineBorder, backgroundColor: colors.onlineDark },
  voiceButtonPaused: { borderColor: colors.accentBorder, backgroundColor: colors.accentWash },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.controlSurface,
  },
  iconButtonAccent: { borderColor: colors.accent, backgroundColor: colors.accent },
  footer: { paddingTop: 8, paddingBottom: 6 },
  modelControl: {
    minHeight: 32,
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
  },
  modelLabel: { color: colors.secondary, fontSize: 11, fontWeight: '500', flexShrink: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
