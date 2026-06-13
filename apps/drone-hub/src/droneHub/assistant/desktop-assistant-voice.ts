import { playLocalVoiceCue, type LocalVoiceCue } from './local-voice-cues';

const SERVER_LOCAL_VOICE_CUES = new Set<LocalVoiceCue>([
  'wake',
  'sleep',
  'status',
  'unlock',
  'sleeping_off',
]);

const DESKTOP_VOICE_SSE_RECONNECT_BASE_MS = 500;
const DESKTOP_VOICE_SSE_RECONNECT_MAX_MS = 10_000;
const DESKTOP_VOICE_SSE_MAX_RECONNECT_ATTEMPTS = 6;

export type DesktopAssistantVoiceMode = 'off' | 'awake' | 'sleeping' | 'recording' | 'transcribing' | 'error';

export type DesktopAssistantVoiceStatus = {
  ok?: true;
  mode: DesktopAssistantVoiceMode;
  message: string;
  updatedAt?: string;
  level?: number;
  lastApprovalCode?: string;
  suspended?: {
    active: boolean;
    reason: 'clipboard' | null;
    previousMode: DesktopAssistantVoiceMode | null;
    message: string | null;
  };
  supportsWakeWords?: boolean;
  recognizer?: {
    active: boolean;
    backend: string | null;
    error: string | null;
    text?: string | null;
    finalText?: string | null;
    textFinal?: boolean;
    textUpdatedAt?: string | null;
  };
  transcript?: {
    active: boolean;
    status: 'idle' | 'collecting' | 'transcribing' | 'error';
    text: string;
    error: string | null;
    updatedAt: string | null;
  };
  capture?: {
    active: boolean;
    backend: string | null;
    bytes: number;
    level: number;
    error: string | null;
  };
  clipboard?: {
    mode?: 'idle' | 'recording' | 'transcribing' | 'error';
    message?: string;
    error?: string | null;
  };
};

export function isDesktopAssistantVoiceActive(status: DesktopAssistantVoiceStatus): boolean {
  return status.mode !== 'off' && status.mode !== 'error';
}

export function isDesktopAssistantVoiceBusy(status: DesktopAssistantVoiceStatus): boolean {
  return status.mode === 'recording' || status.mode === 'transcribing';
}

export function desktopAssistantVoiceHeardText(status: DesktopAssistantVoiceStatus): string {
  return String(status.recognizer?.text ?? status.recognizer?.finalText ?? '').trim();
}

export function desktopAssistantVoiceControlLabel(status: DesktopAssistantVoiceStatus): string {
  if (status.mode === 'off') return 'Start voice';
  if (status.mode === 'error') return 'Voice error';
  if (status.mode === 'sleeping') return 'Sleep';
  if (status.mode === 'awake') return 'Awake';
  if (status.mode === 'recording') return 'Recording';
  if (status.mode === 'transcribing') return 'Transcribing';
  return 'Voice';
}

export function desktopAssistantVoiceControlTitle(status: DesktopAssistantVoiceStatus): string {
  if (status.mode === 'off' || status.mode === 'error') return 'Start desktop assistant voice';
  if (isDesktopAssistantVoiceBusy(status)) return 'Stop recording';
  if (status.mode === 'sleeping') return 'Wake desktop assistant voice';
  return 'Sleep desktop assistant voice';
}

export const ASSISTANT_DESKTOP_VOICE_TOGGLE_EVENT = 'droneHub:assistantDesktopVoiceToggle';
export const ASSISTANT_DESKTOP_VOICE_STATUS_EVENT = 'droneHub:assistantDesktopVoiceStatus';
export const ASSISTANT_DESKTOP_VOICE_TRANSCRIPT_SEGMENT_EVENT = 'droneHub:assistantDesktopVoiceTranscriptSegment';

let latestStatus: DesktopAssistantVoiceStatus | null = null;
let lastCueKey = '';
let lastCueAt = 0;
let toggleInFlight = false;
let lastToggleAt = 0;
let currentSpeechAudio: HTMLAudioElement | null = null;

function cueForTransition(previous: DesktopAssistantVoiceStatus | null, next: DesktopAssistantVoiceStatus): LocalVoiceCue | null {
  if (!previous) return null;
  if (previous.updatedAt === next.updatedAt && previous.mode === next.mode && previous.message === next.message) return null;
  if (next.mode === 'off' && previous.mode !== 'off') {
    return next.lastApprovalCode === '0000' ? 'sleeping_off' : 'stop_button';
  }
  if ((previous.mode === 'off' || previous.mode === 'error') && next.mode === 'awake') return 'start_button';
  if (previous.mode === 'awake' && next.mode === 'sleeping') return 'sleep';
  if (previous.mode === 'sleeping' && next.mode === 'awake') return next.lastApprovalCode ? 'unlock' : 'wake';
  if ((previous.mode === 'awake' || previous.mode === 'recording') && next.mode === 'sleeping') return 'sleep';
  if (previous.mode === 'awake' && next.mode === 'recording') return 'wake';
  if ((previous.mode === 'recording' || previous.mode === 'transcribing') && next.mode === 'awake') return 'sleep';
  return null;
}

function playCueForStatus(status: DesktopAssistantVoiceStatus): void {
  const cue = cueForTransition(latestStatus, status);
  latestStatus = status;
  if (!cue) return;
  const cueKey = `${cue}:${status.mode}:${status.message}`;
  const now = Date.now();
  if (cueKey === lastCueKey && now - lastCueAt < 250) return;
  lastCueKey = cueKey;
  lastCueAt = now;
  playLocalVoiceCue(cue);
}

function stopDesktopVoiceSpeech(): void {
  if (typeof window === 'undefined') return;
  currentSpeechAudio?.pause();
  if (currentSpeechAudio) {
    currentSpeechAudio.currentTime = 0;
  }
  currentSpeechAudio = null;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
}

function speakDesktopVoiceText(text: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return;
  const trimmed = text.trim();
  if (!trimmed) return;
  currentSpeechAudio?.pause();
  currentSpeechAudio = null;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(trimmed);
  utterance.lang = 'en-US';
  window.speechSynthesis.speak(utterance);
}

function speakDesktopVoiceAudio(audioBase64: string, contentType = 'audio/wav'): void {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') return;
  const trimmed = audioBase64.trim();
  if (!trimmed) return;
  if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  currentSpeechAudio?.pause();
  const audio = new Audio(`data:${contentType};base64,${trimmed}`);
  currentSpeechAudio = audio;
  audio.addEventListener('ended', () => {
    if (currentSpeechAudio === audio) currentSpeechAudio = null;
  });
  audio.play().catch(() => {
    if (currentSpeechAudio === audio) currentSpeechAudio = null;
  });
}

async function requestDesktopVoiceToggle(): Promise<void> {
  const now = Date.now();
  if (toggleInFlight || now - lastToggleAt < 500) return;
  toggleInFlight = true;
  lastToggleAt = now;
  try {
    const response = await fetch('/api/assistant/desktop-voice/toggle', { method: 'POST' });
    if (!response.ok) {
      let message = `Desktop voice toggle failed (${response.status})`;
      try {
        const data = await response.json();
        message = String(data?.error ?? message);
      } catch {
        // keep fallback
      }
      dispatchAssistantDesktopVoiceStatus({ mode: 'error', message });
      return;
    }
    const status = (await response.json()) as DesktopAssistantVoiceStatus;
    dispatchAssistantDesktopVoiceStatus(status);
  } catch (error: any) {
    dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) });
  } finally {
    toggleInFlight = false;
  }
}

async function requestDesktopVoiceStop(): Promise<void> {
  const now = Date.now();
  if (toggleInFlight || now - lastToggleAt < 500) return;
  toggleInFlight = true;
  lastToggleAt = now;
  try {
    const response = await fetch('/api/assistant/desktop-voice/stop', { method: 'POST' });
    if (!response.ok) {
      let message = `Desktop voice stop failed (${response.status})`;
      try {
        const data = await response.json();
        message = String(data?.error ?? message);
      } catch {
        // keep fallback
      }
      dispatchAssistantDesktopVoiceStatus({ mode: 'error', message });
    }
  } catch (error: any) {
    dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) });
  } finally {
    toggleInFlight = false;
  }
}

export function dispatchAssistantDesktopVoiceStop(): void {
  if (typeof window === 'undefined') return;
  stopDesktopVoiceSpeech();
  void requestDesktopVoiceStop();
}

export function dispatchAssistantDesktopVoiceToggle(): void {
  if (typeof window === 'undefined') return;
  if (latestStatus?.mode === 'awake') stopDesktopVoiceSpeech();
  window.dispatchEvent(new CustomEvent(ASSISTANT_DESKTOP_VOICE_TOGGLE_EVENT));
  void requestDesktopVoiceToggle();
}

export function dispatchAssistantDesktopVoiceStatus(status: DesktopAssistantVoiceStatus): void {
  if (typeof window === 'undefined') return;
  if (status.mode === 'off' || status.mode === 'sleeping') stopDesktopVoiceSpeech();
  playCueForStatus(status);
  window.dispatchEvent(new CustomEvent<DesktopAssistantVoiceStatus>(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, { detail: status }));
}

export function dispatchAssistantDesktopVoiceTranscriptSegment(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ASSISTANT_DESKTOP_VOICE_TRANSCRIPT_SEGMENT_EVENT, { detail: text }));
}

export function subscribeAssistantDesktopVoiceStatus(listener: (status: DesktopAssistantVoiceStatus) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    listener((event as CustomEvent<DesktopAssistantVoiceStatus>).detail);
  };
  window.addEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, handler);
  let source: EventSource | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: number | null = null;
  let closed = false;

  const clearReconnectTimer = () => {
    if (reconnectTimer == null) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const attachDesktopVoiceEventSource = (nextSource: EventSource) => {
    nextSource.addEventListener('desktop_voice_status', (event) => {
      try {
        const status = JSON.parse((event as MessageEvent).data);
        dispatchAssistantDesktopVoiceStatus(status);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    nextSource.addEventListener('desktop_voice_transcript_segment', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (text) dispatchAssistantDesktopVoiceTranscriptSegment(text);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    nextSource.addEventListener('desktop_voice_local_cue', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const cue = String(data?.cue ?? '').trim() as LocalVoiceCue;
        if (SERVER_LOCAL_VOICE_CUES.has(cue)) playLocalVoiceCue(cue);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    nextSource.addEventListener('desktop_voice_speak', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const text = String(data?.text ?? '').trim();
        if (text) speakDesktopVoiceText(text);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    nextSource.addEventListener('desktop_voice_speak_audio', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        const audioBase64 = String(data?.audioBase64 ?? '').trim();
        const contentType = String(data?.contentType ?? 'audio/wav').trim() || 'audio/wav';
        if (audioBase64) speakDesktopVoiceAudio(audioBase64, contentType);
      } catch {
        // Ignore malformed event payloads.
      }
    });
    nextSource.onopen = () => {
      reconnectAttempt = 0;
    };
    nextSource.onerror = () => {
      nextSource.close();
      if (closed) return;
      if (reconnectAttempt >= DESKTOP_VOICE_SSE_MAX_RECONNECT_ATTEMPTS) {
        dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: 'Desktop voice event stream disconnected.' });
        return;
      }
      const delayMs = Math.min(
        DESKTOP_VOICE_SSE_RECONNECT_MAX_MS,
        DESKTOP_VOICE_SSE_RECONNECT_BASE_MS * (2 ** reconnectAttempt),
      );
      reconnectAttempt += 1;
      clearReconnectTimer();
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (closed) return;
        connectDesktopVoiceEventSource();
      }, delayMs);
    };
  };

  const connectDesktopVoiceEventSource = () => {
    if (typeof window.EventSource === 'undefined') return;
    source?.close();
    source = new window.EventSource('/api/assistant/desktop-voice/events');
    attachDesktopVoiceEventSource(source);
  };

  if (typeof window.EventSource !== 'undefined') {
    connectDesktopVoiceEventSource();
  } else {
    fetch('/api/assistant/desktop-voice/status')
      .then((response) => response.json())
      .then((status) => dispatchAssistantDesktopVoiceStatus(status))
      .catch((error) => dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) }));
  }
  return () => {
    closed = true;
    clearReconnectTimer();
    window.removeEventListener(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, handler);
    source?.close();
    source = null;
  };
}
