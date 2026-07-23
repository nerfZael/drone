import React from 'react';
import { Keyboard, Pressable, StyleSheet, Text, type TextInput, View } from 'react-native';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
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
import {
  mobileAssistantComposerExpanded,
  mobileAssistantStopVisible,
} from './assistant-composer-model';

type ComposerIcon = typeof ArrowUp;

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
  onOpenModel,
  modelLabel,
  reasoningLabel,
  running = false,
  sending = false,
  editable = true,
  queueWhileRunning = false,
  showAttachments = true,
  hasAttachments = false,
  onAddAttachment,
  attachmentActionsDisabled = false,
  sendBlocked = false,
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
  onSend(promptOverride?: string): void;
  onStop?(): void;
  onOpenModel(): void;
  modelLabel: string;
  reasoningLabel?: string;
  running?: boolean;
  sending?: boolean;
  editable?: boolean;
  queueWhileRunning?: boolean;
  showAttachments?: boolean;
  hasAttachments?: boolean;
  onAddAttachment?(): void;
  attachmentActionsDisabled?: boolean;
  sendBlocked?: boolean;
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
  const {
    error: voiceError,
    setError: setVoiceError,
    status: voiceStatus,
    durationMillis: voiceDurationMillis,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  } = useSharedMobileChatVoiceRecorder();
  const voiceActive = voiceStatus !== 'idle';
  const voiceActiveRef = React.useRef(voiceActive);
  voiceActiveRef.current = voiceActive;
  const voiceCanPauseOrStop = voiceStatus === 'recording' || voiceStatus === 'paused';
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
  });
  const expanded = mobileAssistantComposerExpanded({
    focused,
    value,
    hasAttachments,
    voiceActive,
    voiceError,
  });
  const showAssistantStop =
    editable &&
    mobileAssistantStopVisible({
      running,
      hasStopAction: Boolean(onStop),
      voiceActive,
    });
  const canSend =
    (Boolean(value.trim()) || hasAttachments || voiceCanPauseOrStop) &&
    !sending &&
    editable &&
    !sendBlocked &&
    !voiceActionInFlight &&
    voiceStatus !== 'starting' &&
    voiceStatus !== 'transcribing';
  const reasoning = assistantReasoningName(String(reasoningLabel ?? '').trim());
  const model = compactAssistantModelName(modelLabel);
  const voiceStatusText = mobileVoiceStatusLabel(voiceStatus);
  const voiceDurationText = formatMobileVoiceDuration(voiceDurationMillis);

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
    void discardRecording();
  }, [discardRecording]);

  const beginVoiceRecording = React.useCallback(async () => {
    suppressInputFocusRef.current = true;
    inputRef.current?.blur();
    setFocused(false);
    Keyboard.dismiss();
    try {
      await startRecording();
    } finally {
      requestAnimationFrame(() => {
        inputRef.current?.blur();
        Keyboard.dismiss();
        suppressInputFocusRef.current = false;
      });
    }
  }, [startRecording]);

  const stopVoiceForAction = React.useCallback(
    async (action: 'append' | 'send'): Promise<string | null> => {
      if (!voiceCanPauseOrStop || voiceActionInFlight) return null;
      const token = voiceActionTokenRef.current + 1;
      voiceActionTokenRef.current = token;
      setVoiceActionInFlight(true);
      try {
        const transcript = await stopRecordingForTranscript();
        if (voiceActionTokenRef.current !== token) return null;
        const currentDraft = valueRef.current;
        const result = resolveMobileVoiceTranscriptDraft({
          draft: currentDraft,
          transcript,
          action,
        });
        if (result.message === currentDraft) {
          setVoiceError((current) => current || 'No speech detected.');
          return null;
        }
        valueRef.current = result.nextDraft;
        if (action === 'append') onChangeText(result.message);
        return result.message;
      } finally {
        if (voiceActionTokenRef.current === token) setVoiceActionInFlight(false);
      }
    },
    [onChangeText, stopRecordingForTranscript, voiceActionInFlight, voiceCanPauseOrStop],
  );

  const stopVoiceAndFillDraft = React.useCallback(async () => {
    const nextDraft = await stopVoiceForAction('append');
    if (nextDraft) {
      suppressInputFocusRef.current = false;
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [stopVoiceForAction]);

  const changeText = React.useCallback(
    (nextValue: string) => {
      valueRef.current = nextValue;
      onChangeText(nextValue);
    },
    [onChangeText],
  );

  const send = React.useCallback(async () => {
    if (!canSend) return;
    if (!voiceActive) {
      setVoiceError('');
      onSend();
      return;
    }
    const nextDraft = await stopVoiceForAction('send');
    if (nextDraft?.trim()) {
      setVoiceError('');
      onSend(nextDraft.trim());
    } else if (hasAttachments) {
      setVoiceError('');
      onSend();
    }
  }, [canSend, hasAttachments, onSend, stopVoiceForAction, voiceActive]);

  return (
    <View style={styles.frame}>
      <View style={[styles.composer, expanded && styles.composerExpanded]}>
        <ThemedTextInput
          ref={inputRef}
          value={value}
          onChangeText={changeText}
          onFocus={(event) => {
            if (suppressInputFocusRef.current || voiceActive) {
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
          showSoftInputOnFocus={!voiceActive}
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
              accessibilityLabel="Record voice message"
              accessibilityState={{ disabled: voiceRecordActionDisabled }}
              disabled={voiceRecordActionDisabled}
              hitSlop={6}
              onPress={() => void beginVoiceRecording()}
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
                <Square color={colors.danger} size={15} strokeWidth={2.2} fill={colors.danger} />
              </Pressable>
            ) : null}
          </>
        ) : null}
        {voiceError || voiceStatusText ? (
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
                  ]}
                />
                <Text accessibilityLiveRegion="polite" style={styles.voiceFeedbackText}>
                  {voiceStatusText}
                </Text>
                <Text accessibilityLabel={`${voiceDurationText} elapsed`} style={styles.voiceTimer}>
                  {voiceDurationText}
                </Text>
              </View>
            )}
          </View>
        ) : null}
        {expanded ? (
          <View style={styles.controls}>
            {voiceStatus === 'idle' ? (
              <>
                {attachmentsEnabled ? (
                  <IconButton
                    label="Add image"
                    icon={Plus}
                    disabled={attachmentActionDisabled}
                    onPress={onAddAttachment!}
                  />
                ) : null}
                <View style={styles.controlSpacer} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose model and reasoning"
                  disabled={!editable || running}
                  onPress={onOpenModel}
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
                  label="Record voice message"
                  icon={Mic}
                  disabled={voiceRecordActionDisabled}
                  onPress={() => void beginVoiceRecording()}
                />
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
                    disabled={!voiceCanPauseOrStop || voiceActionInFlight}
                    onPress={toggleRecordingPause}
                  />
                  <VoiceIconButton
                    label="Stop recording and transcribe"
                    icon={Square}
                    tone="success"
                    disabled={!voiceCanPauseOrStop || voiceActionInFlight}
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
      </View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
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
