import React from 'react';
import {
  ASSISTANT_DESKTOP_VOICE_CLIPBOARD_RESULT_EVENT,
  ASSISTANT_DESKTOP_VOICE_STATUS_EVENT,
} from '../assistant/desktop-assistant-voice';
import { playLocalVoiceCue } from '../assistant/local-voice-cues';
import { copyText } from './clipboard';

type ToastFn = (
  message: string,
  title: string,
  tone?: 'success' | 'error',
  opts?: { voiceActive?: boolean; voiceLevel?: number; autoDismissMs?: number | null },
) => string | null;

type UpdateVoiceToastFn = (
  id: string,
  voiceLevel: number,
  patch?: { message?: string; title?: string; tone?: 'success' | 'error'; voiceActive?: boolean },
) => void;

type DesktopVoiceStatus = {
  ok: true;
  clipboardResultText?: string;
  clipboard?: {
    mode?: 'idle' | 'recording' | 'transcribing' | 'error';
    message?: string;
    error?: string | null;
  };
  capture?: {
    level?: number;
  };
};

async function toggleHostClipboardRecording(): Promise<DesktopVoiceStatus> {
  const requestId = createVoiceClipboardRequestId();
  const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const clientUnixMs = Date.now();
  console.debug('[voice-clipboard] clipboard-toggle request', { requestId, clientUnixMs });
  const response = await fetch('/api/assistant/desktop-voice/clipboard-toggle', {
    method: 'POST',
    headers: {
      'x-drone-voice-clipboard-request-id': requestId,
      'x-drone-voice-clipboard-client-unix-ms': String(clientUnixMs),
    },
  });
  const text = await response.text();
  const elapsedMs = Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt);
  console.debug('[voice-clipboard] clipboard-toggle response', { requestId, elapsedMs, ok: response.ok });
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }
  if (!response.ok) throw new Error(String(data?.error ?? `${response.status} ${response.statusText}`));
  return data as DesktopVoiceStatus;
}

function createVoiceClipboardRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useVoiceClipboardRecorder(opts: {
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  showToast: ToastFn;
  updateVoiceToast?: UpdateVoiceToastFn;
}): { toggleVoiceClipboardRecording: () => boolean } {
  const { showToast, updateVoiceToast } = opts;
  const toggleRequestIdRef = React.useRef(0);
  const startCuePlayedRef = React.useRef(false);
  const lastClipboardResultRef = React.useRef<{ text: string; at: number } | null>(null);
  const recordingToastIdRef = React.useRef<string | null>(null);
  const clipboardModeRef = React.useRef<NonNullable<DesktopVoiceStatus['clipboard']>['mode']>('idle');

  const updateRecordingToast = React.useCallback(
    (status: DesktopVoiceStatus) => {
      const id = recordingToastIdRef.current;
      if (!id) return;
      clipboardModeRef.current = status.clipboard?.mode ?? clipboardModeRef.current;
      const level = Math.max(0, Math.min(1, Number(status.capture?.level ?? 0)));
      updateVoiceToast?.(id, level, {
        title: status.clipboard?.mode === 'transcribing' ? 'Voice transcription' : 'Voice recording',
        message: status.clipboard?.message ?? 'Recording from host microphone.',
        tone: status.clipboard?.mode === 'error' ? 'error' : 'success',
        voiceActive: status.clipboard?.mode === 'recording',
      });
    },
    [updateVoiceToast],
  );

  const playRecordingStartCue = React.useCallback(() => {
    if (startCuePlayedRef.current) return;
    startCuePlayedRef.current = true;
    playLocalVoiceCue('clipboard_recording_start');
  }, []);

  const showClipboardStatus = React.useCallback(
    (status: DesktopVoiceStatus) => {
      const mode = status.clipboard?.mode ?? 'idle';
      clipboardModeRef.current = mode;
      if (mode === 'recording') {
        playRecordingStartCue();
        recordingToastIdRef.current = showToast(
          status.clipboard?.message ?? 'Recording from host microphone. Press the shortcut again to stop and copy.',
          'Voice recording ready',
          'success',
          { voiceActive: true, voiceLevel: status.capture?.level ?? 0, autoDismissMs: null },
        );
        return;
      }
      if (mode === 'transcribing') {
        startCuePlayedRef.current = false;
        showToast(status.clipboard?.message ?? 'Transcribing voice recording.', 'Voice transcription', 'success');
        updateRecordingToast(status);
        return;
      }
      if (mode === 'error') {
        startCuePlayedRef.current = false;
        recordingToastIdRef.current = null;
        showToast(status.clipboard?.error ?? status.clipboard?.message ?? 'Voice transcription failed.', 'Voice transcription failed');
      }
    },
    [playRecordingStartCue, showToast, updateRecordingToast],
  );

  const handleClipboardResult = React.useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const now = Date.now();
    const previous = lastClipboardResultRef.current;
    if (previous && previous.text === trimmed && now - previous.at < 5000) return;
    lastClipboardResultRef.current = { text: trimmed, at: now };
    playLocalVoiceCue('clipboard_transcription_success');
    void copyText(trimmed).then((copied) => {
      recordingToastIdRef.current = null;
      clipboardModeRef.current = 'idle';
      startCuePlayedRef.current = false;
      showToast(
        copied ? `Copied ${trimmed.length.toLocaleString()} characters to the clipboard.` : 'Transcription finished, but clipboard access was blocked.',
        copied ? 'Voice transcription copied' : 'Voice transcription ready',
        copied ? 'success' : 'error',
      );
    });
  }, [showToast]);

  const runToggleAction = React.useCallback(async (requestId: number) => {
    console.debug('[voice-clipboard] toggle action started', { requestId, clientUnixMs: Date.now() });
    try {
      const status = await toggleHostClipboardRecording();
      if (requestId !== toggleRequestIdRef.current) return;
      showClipboardStatus(status);
      handleClipboardResult(String(status.clipboardResultText ?? ''));
    } catch (error: any) {
      if (requestId !== toggleRequestIdRef.current) return;
      recordingToastIdRef.current = null;
      clipboardModeRef.current = 'error';
      startCuePlayedRef.current = false;
      showToast(error?.message ?? String(error), 'Voice transcription failed');
    }
  }, [handleClipboardResult, showClipboardStatus, showToast]);

  const toggleVoiceClipboardRecording = React.useCallback((): boolean => {
    if (clipboardModeRef.current === 'recording') {
      clipboardModeRef.current = 'transcribing';
      startCuePlayedRef.current = false;
      showClipboardStatus({
        ok: true,
        clipboard: {
          mode: 'transcribing',
          message: 'Transcribing voice recording.',
          error: null,
        },
      });
    }
    const requestId = toggleRequestIdRef.current + 1;
    toggleRequestIdRef.current = requestId;
    void runToggleAction(requestId);
    return true;
  }, [runToggleAction, showClipboardStatus]);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onStatus = (event: Event) => {
      const status = (event as CustomEvent<DesktopVoiceStatus>).detail;
      clipboardModeRef.current = status.clipboard?.mode ?? clipboardModeRef.current;
      updateRecordingToast(status);
    };
    const onClipboardResult = (event: Event) => {
      handleClipboardResult(String((event as CustomEvent<string>).detail ?? ''));
    };
    window.addEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, onStatus);
    window.addEventListener(ASSISTANT_DESKTOP_VOICE_CLIPBOARD_RESULT_EVENT, onClipboardResult);
    return () => {
      window.removeEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, onStatus);
      window.removeEventListener(ASSISTANT_DESKTOP_VOICE_CLIPBOARD_RESULT_EVENT, onClipboardResult);
    };
  }, [handleClipboardResult, updateRecordingToast]);

  return { toggleVoiceClipboardRecording };
}
