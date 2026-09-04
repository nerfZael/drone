import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
  onDestinationPress(destination: MobileDictationDestination): void | Promise<void>;
}) {
  const [destinationMenuOpen, setDestinationMenuOpen] = React.useState(false);
  const recordingActive =
    recordingStatus === 'starting' ||
    recordingStatus === 'recording' ||
    recordingStatus === 'paused' ||
    recordingStatus === 'stopped';
  const controlsDisabled = finalizing || networkSending;
  const sendDisabled =
    controlsDisabled ||
    (!value.trim() && !recordingActive && pendingCount === 0 && !failedTranscriptionError);
  const recordDisabled = controlsDisabled || (!recordingActive && microphoneUnavailable);
  const message = failedTranscriptionError || error || notice;
  const messageIsError = Boolean(failedTranscriptionError || error);

  const send = (destination: MobileDictationDestination) => {
    if (sendDisabled) return;
    setDestinationMenuOpen(false);
    void onDestinationPress(destination);
  };

  return (
    <View style={styles.container}>
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
        <ThemedTextInput
          accessibilityLabel="Dictation draft"
          value={value}
          onChangeText={onChangeText}
          editable={!controlsDisabled}
          maxLength={MOBILE_DICTATION_MAX_CHARS}
          multiline
          textAlignVertical="top"
          placeholder="Your recordings and notes will appear here…"
          placeholderTextColor={colors.mutedDim}
          style={styles.editor}
        />
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
              (recordingStatus !== 'recording' && recordingStatus !== 'paused') || controlsDisabled
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Send dictation to ${droneName}, ${chatName}`}
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
              Current chat
            </Text>
          </Pressable>
        </View>
      </View>

      {destinationMenuOpen ? (
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
    </View>
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
  header: { minHeight: 26, flexDirection: 'row', alignItems: 'center', gap: 4 },
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
