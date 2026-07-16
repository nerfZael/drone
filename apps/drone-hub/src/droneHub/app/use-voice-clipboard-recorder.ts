import React from 'react';
import { useChatVoiceRecorder } from '../chat/use-chat-voice-recorder';
import { copyText } from './clipboard';

type ToastFn = (
  message: string,
  title: string,
  tone?: 'success' | 'error',
  opts?: { voiceActive?: boolean; voiceLevel?: number; autoDismissMs?: number | null },
) => string | null;

export function useVoiceClipboardRecorder(opts: {
  showToast: ToastFn;
}): { toggleVoiceClipboardRecording: () => boolean } {
  const { showToast } = opts;
  const onError = React.useCallback(
    (message: string) => {
      if (message.trim()) showToast(message, 'Voice transcription failed', 'error');
    },
    [showToast],
  );
  const { status, startRecording, stopRecordingForTranscript } = useChatVoiceRecorder({ onError });

  const toggleVoiceClipboardRecording = React.useCallback((): boolean => {
    if (status === 'idle') {
      void startRecording().then((started) => {
        if (!started) return;
        showToast(
          'Recording from your microphone. Press the shortcut again to stop, transcribe, and copy.',
          'Voice recording',
          'success',
          { voiceActive: true, autoDismissMs: null },
        );
      });
      return true;
    }
    if (status !== 'recording' && status !== 'paused') return true;

    showToast('Transcribing voice recording.', 'Voice transcription', 'success');
    void stopRecordingForTranscript().then(async (transcript) => {
      const text = transcript.trim();
      if (!text) return;
      const copied = await copyText(text);
      showToast(
        copied
          ? `Copied ${text.length.toLocaleString()} characters to the clipboard.`
          : 'Transcription finished, but clipboard access was blocked.',
        copied ? 'Voice transcription copied' : 'Voice transcription ready',
        copied ? 'success' : 'error',
      );
    });
    return true;
  }, [showToast, startRecording, status, stopRecordingForTranscript]);

  return { toggleVoiceClipboardRecording };
}
