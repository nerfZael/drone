import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import ArrowUp from 'lucide-react-native/icons/arrow-up';
import ChevronDown from 'lucide-react-native/icons/chevron-down';
import Mic from 'lucide-react-native/icons/mic';
import Pause from 'lucide-react-native/icons/pause';
import Play from 'lucide-react-native/icons/play';
import Plus from 'lucide-react-native/icons/plus';
import Square from 'lucide-react-native/icons/square';
import X from 'lucide-react-native/icons/x';
import { colors } from '../theme';
import {
  mergeMobileDraftWithVoiceTranscript,
  mobileVoiceStatusLabel,
} from './mobile-voice-transcription-model';
import { useMobileChatVoiceRecorder } from './use-mobile-chat-voice-recorder';

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
        color={accent ? colors.crust : colors.text}
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
          : colors.text;
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
  maxLength?: number;
  placeholder?: string;
}) {
  const inputRef = React.useRef<TextInput>(null);
  const valueRef = React.useRef(value);
  const voiceActionTokenRef = React.useRef(0);
  const [focused, setFocused] = React.useState(false);
  const [voiceError, setVoiceError] = React.useState('');
  const [voiceActionInFlight, setVoiceActionInFlight] = React.useState(false);
  const handleVoiceError = React.useCallback(
    (message: string) => setVoiceError(message.trim()),
    [],
  );
  const {
    status: voiceStatus,
    startRecording,
    toggleRecordingPause,
    discardRecording,
    stopRecordingForTranscript,
  } = useMobileChatVoiceRecorder({ onError: handleVoiceError });
  const voiceActive = voiceStatus !== 'idle';
  const voiceCanPauseOrStop = voiceStatus === 'recording' || voiceStatus === 'paused';
  const expanded =
    focused || Boolean(value.trim()) || running || voiceActive || Boolean(voiceError);
  const canSend =
    (Boolean(value.trim()) || voiceCanPauseOrStop) &&
    !sending &&
    editable &&
    !voiceActionInFlight &&
    voiceStatus !== 'starting' &&
    voiceStatus !== 'transcribing';
  const reasoning = assistantReasoningName(String(reasoningLabel ?? '').trim());
  const model = compactAssistantModelName(modelLabel);
  const voiceStatusText = mobileVoiceStatusLabel(voiceStatus);

  React.useEffect(() => {
    valueRef.current = value;
  }, [value]);

  React.useEffect(() => {
    if (!focusKey) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusKey]);

  React.useEffect(() => {
    voiceActionTokenRef.current += 1;
    setVoiceActionInFlight(false);
    setVoiceError('');
    void discardRecording();
  }, [discardRecording, voiceResetKey]);

  React.useEffect(
    () => () => {
      voiceActionTokenRef.current += 1;
    },
    [],
  );

  React.useEffect(() => {
    if ((!editable || running || sending) && voiceActive) {
      voiceActionTokenRef.current += 1;
      setVoiceActionInFlight(false);
      void discardRecording();
    }
  }, [discardRecording, editable, running, sending, voiceActive]);

  const discardVoice = React.useCallback(() => {
    voiceActionTokenRef.current += 1;
    setVoiceActionInFlight(false);
    setVoiceError('');
    void discardRecording();
  }, [discardRecording]);

  const stopVoiceAndAppend = React.useCallback(async (): Promise<string | null> => {
    if (!voiceCanPauseOrStop || voiceActionInFlight) return null;
    const token = voiceActionTokenRef.current + 1;
    voiceActionTokenRef.current = token;
    setVoiceActionInFlight(true);
    try {
      const transcript = await stopRecordingForTranscript();
      if (voiceActionTokenRef.current !== token) return null;
      const currentDraft = valueRef.current;
      const nextDraft = mergeMobileDraftWithVoiceTranscript(currentDraft, transcript);
      if (nextDraft === currentDraft) {
        setVoiceError((current) => current || 'No speech detected.');
        return null;
      }
      valueRef.current = nextDraft;
      onChangeText(nextDraft);
      return nextDraft;
    } finally {
      if (voiceActionTokenRef.current === token) setVoiceActionInFlight(false);
    }
  }, [onChangeText, stopRecordingForTranscript, voiceActionInFlight, voiceCanPauseOrStop]);

  const stopVoiceAndFillDraft = React.useCallback(async () => {
    const nextDraft = await stopVoiceAndAppend();
    if (nextDraft) requestAnimationFrame(() => inputRef.current?.focus());
  }, [stopVoiceAndAppend]);

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
    const nextDraft = await stopVoiceAndAppend();
    if (nextDraft?.trim()) {
      setVoiceError('');
      onSend(nextDraft.trim());
    }
  }, [canSend, onSend, stopVoiceAndAppend, voiceActive]);

  return (
    <View style={styles.frame}>
      <View style={[styles.composer, expanded && styles.composerExpanded]}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={changeText}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={editable && (!running || queueWhileRunning)}
          multiline
          maxLength={maxLength}
          placeholder={placeholder}
          placeholderTextColor={colors.muted}
          textAlignVertical="top"
          style={[
            styles.input,
            expanded && styles.inputExpanded,
            !expanded && styles.inputWithCollapsedVoice,
          ]}
        />
        {!expanded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Record voice message"
            accessibilityState={{ disabled: !editable || sending }}
            disabled={!editable || sending}
            hitSlop={6}
            onPress={() => void startRecording()}
            style={({ pressed }) => [
              styles.collapsedVoiceButton,
              (!editable || sending) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Mic color={colors.text} size={17} strokeWidth={2.1} />
          </Pressable>
        ) : null}
        {voiceError || voiceStatusText ? (
          <View style={styles.voiceFeedback}>
            <Text
              accessibilityLiveRegion="polite"
              numberOfLines={2}
              style={[styles.voiceFeedbackText, voiceError && styles.voiceFeedbackError]}
            >
              {voiceError || voiceStatusText}
            </Text>
          </View>
        ) : null}
        {expanded ? (
          <View style={styles.controls}>
            {voiceStatus === 'idle' ? (
              <>
                <IconButton label="Add attachment — coming soon" icon={Plus} onPress={() => {}} />
                <View style={styles.controlSpacer} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Choose model and reasoning"
                  disabled={running}
                  onPress={onOpenModel}
                  style={({ pressed }) => [
                    styles.modelControl,
                    running && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text numberOfLines={1} style={styles.modelLabel}>
                    {model}
                    {reasoning ? ` ${reasoning}` : ''}
                  </Text>
                  <ChevronDown color={colors.accent} size={14} strokeWidth={2.2} />
                </Pressable>
                <IconButton
                  label="Record voice message"
                  icon={Mic}
                  disabled={!editable || running || sending}
                  onPress={() => void startRecording()}
                />
              </>
            ) : (
              <>
                <View style={styles.controlSpacer} />
                <View style={styles.voiceControls}>
                  <VoiceIconButton
                    label="Discard recording"
                    icon={X}
                    tone="danger"
                    disabled={voiceStatus === 'transcribing' || voiceActionInFlight}
                    onPress={discardVoice}
                  />
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
            {running && onStop ? (
              <IconButton label="Stop assistant" icon={Square} onPress={onStop} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    paddingHorizontal: 9,
    paddingTop: 6,
    paddingBottom: 9,
    backgroundColor: colors.background,
  },
  composer: {
    minHeight: 52,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.panelRaised,
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
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
  inputWithCollapsedVoice: { paddingRight: 54 },
  collapsedVoiceButton: {
    position: 'absolute',
    right: 9,
    top: 9,
    width: 34,
    height: 34,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
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
  voiceFeedback: { paddingHorizontal: 12, paddingTop: 5 },
  voiceFeedbackText: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.25,
  },
  voiceFeedbackError: { color: colors.danger, fontWeight: '700', letterSpacing: 0 },
  voiceControls: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  voiceButton: {
    width: 30,
    height: 30,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
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
    backgroundColor: colors.surface1,
  },
  iconButtonAccent: { borderColor: colors.accent, backgroundColor: colors.accent },
  modelControl: {
    minHeight: 32,
    maxWidth: '58%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 5,
    backgroundColor: colors.accentWash,
  },
  modelLabel: { color: colors.muted, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.72 },
});
