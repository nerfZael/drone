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
    target?: 'assistant' | 'patch' | 'clipboard' | null;
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
  realtime?: {
    available: boolean;
    enabled: boolean;
    webRtcSessionId?: string | null;
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
export const ASSISTANT_DESKTOP_VOICE_CLIPBOARD_RESULT_EVENT = 'droneHub:assistantDesktopVoiceClipboardResult';

let latestStatus: DesktopAssistantVoiceStatus | null = null;
let lastCueKey = '';
let lastCueAt = 0;
let toggleInFlight = false;
let realtimeToggleInFlight = false;
let realtimeWebRtcStartInFlight = false;
let realtimeWebRtcStartGeneration = 0;
let realtimeWebRtcBrowserSessionId = '';
let lastToggleAt = 0;
let currentSpeechAudio: HTMLAudioElement | null = null;
let currentRealtimeWebRtc: {
  pc: RTCPeerConnection;
  stream: MediaStream;
  dataChannel: RTCDataChannel;
  audio: HTMLAudioElement;
} | null = null;

function reportDesktopVoiceBrowserEvent(event: string, message?: string): void {
  if (typeof window === 'undefined') return;
  void fetch('/api/assistant/desktop-voice/client-event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ event, message }),
  }).catch(() => {
    // Best-effort diagnostics only.
  });
}

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

function stopDesktopVoiceWebRtc(): void {
  realtimeWebRtcStartGeneration += 1;
  realtimeWebRtcBrowserSessionId = '';
  const session = currentRealtimeWebRtc;
  currentRealtimeWebRtc = null;
  realtimeWebRtcStartInFlight = false;
  if (!session) return;
  try {
    session.dataChannel.close();
  } catch {
    // Ignore close failures.
  }
  for (const track of session.stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Ignore track stop failures.
    }
  }
  try {
    session.pc.close();
  } catch {
    // Ignore close failures.
  }
  try {
    session.audio.pause();
    session.audio.srcObject = null;
    session.audio.remove();
  } catch {
    // Ignore audio cleanup failures.
  }
}

function handleRealtimeDataChannelEvent(raw: string): void {
  try {
    JSON.parse(raw);
  } catch {
    // Ignore malformed realtime event payloads.
  }
}

function sendRealtimeDataChannelEvent(payload: unknown): void {
  const channel = currentRealtimeWebRtc?.dataChannel;
  if (!channel || channel.readyState !== 'open') throw new Error('Realtime voice is not connected.');
  channel.send(JSON.stringify(payload));
}

async function startDesktopVoiceWebRtc(sessionId: string): Promise<void> {
  if (typeof window === 'undefined') return;
  if (currentRealtimeWebRtc || realtimeWebRtcStartInFlight) return;
  const trimmedSessionId = String(sessionId ?? '').trim();
  if (!trimmedSessionId) {
    reportDesktopVoiceBrowserEvent('webrtc-missing-session-id');
    void requestDesktopVoiceCancelRecording('');
    return;
  }
  if (typeof RTCPeerConnection === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    reportDesktopVoiceBrowserEvent('webrtc-unavailable');
    dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: 'WebRTC microphone capture is unavailable in this browser.' });
    void requestDesktopVoiceCancelRecording(trimmedSessionId);
    return;
  }
  const startGeneration = realtimeWebRtcStartGeneration + 1;
  realtimeWebRtcStartGeneration = startGeneration;
  realtimeWebRtcBrowserSessionId = trimmedSessionId;
  const assertWebRtcStartCurrent = () => {
    if (startGeneration !== realtimeWebRtcStartGeneration) throw new Error('WebRTC realtime setup was cancelled.');
  };
  realtimeWebRtcStartInFlight = true;
  let pc: RTCPeerConnection | null = null;
  let stream: MediaStream | null = null;
  let audio: HTMLAudioElement | null = null;
  let dataChannel: RTCDataChannel | null = null;
  try {
    reportDesktopVoiceBrowserEvent('webrtc-start-received');
    stopDesktopVoiceSpeech();
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    reportDesktopVoiceBrowserEvent('webrtc-mic-ready');
    assertWebRtcStartCurrent();
    pc = new RTCPeerConnection();
    audio = document.createElement('audio');
    audio.autoplay = true;
    (audio as any).playsInline = true;
    pc.ontrack = (event) => {
      if (!audio) return;
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      audio.play().catch(() => {});
    };
    for (const track of stream.getAudioTracks()) pc.addTrack(track, stream);
    dataChannel = pc.createDataChannel('oai-events');
    dataChannel.addEventListener('open', () => {
      reportDesktopVoiceBrowserEvent('webrtc-datachannel-open');
      if (latestStatus) dispatchAssistantDesktopVoiceStatus(latestStatus);
    });
    dataChannel.addEventListener('close', () => {
      reportDesktopVoiceBrowserEvent('webrtc-datachannel-close');
      if (latestStatus) dispatchAssistantDesktopVoiceStatus(latestStatus);
    });
    dataChannel.addEventListener('message', (event) => {
      handleRealtimeDataChannelEvent(String(event.data ?? ''));
    });
    const offer = await pc.createOffer();
    reportDesktopVoiceBrowserEvent('webrtc-offer-created');
    assertWebRtcStartCurrent();
    await pc.setLocalDescription(offer);
    assertWebRtcStartCurrent();
    const sdp = offer.sdp ?? pc.localDescription?.sdp ?? '';
    if (!sdp.trim()) throw new Error('WebRTC SDP offer is empty.');
    reportDesktopVoiceBrowserEvent('webrtc-offer-posting');
    const response = await fetch('/api/assistant/desktop-voice/realtime/webrtc-session', {
      method: 'POST',
      headers: {
        'content-type': 'application/sdp',
        'x-drone-desktop-voice-webrtc-session-id': trimmedSessionId,
      },
      body: sdp,
    });
    assertWebRtcStartCurrent();
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(String(payload?.error ?? `WebRTC realtime setup failed (${response.status})`));
    const sdpAnswer = typeof payload?.sdpAnswer === 'string' ? payload.sdpAnswer : '';
    if (!sdpAnswer.trim()) throw new Error('WebRTC realtime setup returned an empty SDP answer.');
    await pc.setRemoteDescription({ type: 'answer', sdp: sdpAnswer });
    assertWebRtcStartCurrent();
    currentRealtimeWebRtc = { pc, stream, dataChannel, audio };
    reportDesktopVoiceBrowserEvent('webrtc-connected');
  } catch (error: any) {
    reportDesktopVoiceBrowserEvent('webrtc-failed', error?.message ?? String(error));
    if (dataChannel) {
      try {
        dataChannel.close();
      } catch {
        // Ignore close failures.
      }
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    if (pc) {
      try {
        pc.close();
      } catch {
        // Ignore close failures.
      }
    }
    if (audio) {
      audio.pause();
      audio.srcObject = null;
      audio.remove();
    }
    if (startGeneration === realtimeWebRtcStartGeneration) {
      dispatchAssistantDesktopVoiceStatus({ mode: 'error', message: error?.message ?? String(error) });
      void requestDesktopVoiceCancelRecording(trimmedSessionId);
    }
  } finally {
    if (startGeneration === realtimeWebRtcStartGeneration) realtimeWebRtcStartInFlight = false;
  }
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

async function requestDesktopVoiceStartRecording(): Promise<void> {
  const now = Date.now();
  if (toggleInFlight || now - lastToggleAt < 500) return;
  toggleInFlight = true;
  lastToggleAt = now;
  try {
    const response = await fetch('/api/assistant/desktop-voice/start-recording', { method: 'POST' });
    if (!response.ok) {
      let message = `Desktop voice recording failed (${response.status})`;
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

export function dispatchAssistantDesktopVoiceStartRecording(): void {
  if (typeof window === 'undefined') return;
  stopDesktopVoiceSpeech();
  void requestDesktopVoiceStartRecording();
}

async function requestDesktopVoiceOff(): Promise<void> {
  const now = Date.now();
  if (toggleInFlight || now - lastToggleAt < 500) return;
  toggleInFlight = true;
  lastToggleAt = now;
  try {
    const response = await fetch('/api/assistant/desktop-voice/off', { method: 'POST' });
    if (!response.ok) {
      let message = `Desktop voice off failed (${response.status})`;
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

async function requestDesktopVoiceCancelRecording(sessionId = realtimeWebRtcBrowserSessionId): Promise<void> {
  try {
    const trimmedSessionId = String(sessionId ?? '').trim();
    const response = await fetch('/api/assistant/desktop-voice/cancel-recording', {
      method: 'POST',
      headers: trimmedSessionId ? { 'x-drone-desktop-voice-webrtc-session-id': trimmedSessionId } : undefined,
    });
    if (!response.ok) {
      let message = `Desktop voice cancel failed (${response.status})`;
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
  }
}

async function requestDesktopVoiceRealtime(enabled: boolean): Promise<void> {
  if (realtimeToggleInFlight) return;
  realtimeToggleInFlight = true;
  try {
    const response = await fetch('/api/assistant/desktop-voice/realtime', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled }),
    });
    if (!response.ok) {
      let message = `Desktop voice realtime toggle failed (${response.status})`;
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
    realtimeToggleInFlight = false;
  }
}

export function dispatchAssistantDesktopVoiceStop(): void {
  if (typeof window === 'undefined') return;
  stopDesktopVoiceSpeech();
  void requestDesktopVoiceStop();
}

export function dispatchAssistantDesktopVoiceOff(): void {
  if (typeof window === 'undefined') return;
  stopDesktopVoiceSpeech();
  stopDesktopVoiceWebRtc();
  void requestDesktopVoiceOff();
}

export function dispatchAssistantDesktopVoiceToggle(): void {
  if (typeof window === 'undefined') return;
  if (latestStatus?.mode === 'awake') stopDesktopVoiceSpeech();
  window.dispatchEvent(new CustomEvent(ASSISTANT_DESKTOP_VOICE_TOGGLE_EVENT));
  void requestDesktopVoiceToggle();
}

export function dispatchAssistantDesktopVoiceRealtimeToggle(): void {
  if (typeof window === 'undefined') return;
  const nextEnabled = latestStatus?.realtime?.enabled !== true;
  void requestDesktopVoiceRealtime(nextEnabled);
}

export function canSendAssistantDesktopVoiceRealtimeText(): boolean {
  return currentRealtimeWebRtc?.dataChannel.readyState === 'open';
}

export function sendAssistantDesktopVoiceRealtimeText(textRaw: string): boolean {
  const text = String(textRaw ?? '').trim();
  if (!text || !canSendAssistantDesktopVoiceRealtimeText()) return false;
  sendRealtimeDataChannelEvent({
    type: 'conversation.item.create',
    item: {
      type: 'message',
      role: 'user',
      content: [{ type: 'input_text', text }],
    },
  });
  sendRealtimeDataChannelEvent({
    type: 'response.create',
    response: { output_modalities: ['audio'] },
  });
  return true;
}

export function dispatchAssistantDesktopVoiceStatus(status: DesktopAssistantVoiceStatus): void {
  if (typeof window === 'undefined') return;
  if (status.mode === 'off' || status.mode === 'sleeping') stopDesktopVoiceSpeech();
  if (status.mode !== 'recording') stopDesktopVoiceWebRtc();
  const webRtcSessionId = String(status.realtime?.webRtcSessionId ?? '').trim();
  if (
    status.mode === 'recording' &&
    status.transcript?.target === 'assistant' &&
    status.realtime?.enabled === true &&
    webRtcSessionId &&
    !currentRealtimeWebRtc &&
    !realtimeWebRtcStartInFlight &&
    realtimeWebRtcBrowserSessionId !== webRtcSessionId
  ) {
    void startDesktopVoiceWebRtc(webRtcSessionId);
  }
  playCueForStatus(status);
  window.dispatchEvent(new CustomEvent<DesktopAssistantVoiceStatus>(ASSISTANT_DESKTOP_VOICE_STATUS_EVENT, { detail: status }));
}

export function dispatchAssistantDesktopVoiceTranscriptSegment(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ASSISTANT_DESKTOP_VOICE_TRANSCRIPT_SEGMENT_EVENT, { detail: text }));
}

export function dispatchAssistantDesktopVoiceClipboardResult(text: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<string>(ASSISTANT_DESKTOP_VOICE_CLIPBOARD_RESULT_EVENT, { detail: text }));
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
    nextSource.addEventListener('desktop_voice_clipboard_result', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        dispatchAssistantDesktopVoiceClipboardResult(String(data?.text ?? ''));
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
    nextSource.addEventListener('desktop_voice_stop_audio', () => {
      stopDesktopVoiceSpeech();
    });
    nextSource.addEventListener('desktop_voice_webrtc_start', (event) => {
      try {
        const data = JSON.parse((event as MessageEvent).data);
        void startDesktopVoiceWebRtc(String(data?.sessionId ?? ''));
      } catch {
        void startDesktopVoiceWebRtc('');
      }
    });
    nextSource.addEventListener('desktop_voice_webrtc_stop', () => {
      stopDesktopVoiceWebRtc();
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
