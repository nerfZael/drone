import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { createRequire } from 'node:module';
import { existsSync, promises as fs } from 'node:fs';
import crypto from 'node:crypto';

import { type DesktopVoiceClipboardMode, type DesktopVoiceCue, type DesktopVoiceMode } from './desktop-voice-behavior';
import { PcmRingBuffer } from './pcm-ring-buffer';
import { managedDesktopVoiceModelDirSync } from './desktop-voice-models';
import {
  VOICE_APPROVAL_SETTINGS_DEFAULT,
  VOICE_TRANSCRIPTION_SETTINGS_DEFAULT,
  type VoiceApprovalSettings,
  type VoiceRealtimeProvider,
  type VoiceTranscriptionFinalMode,
  type VoiceTranscriptionSettings,
} from './hub-settings';
import { ApprovalCodeRecognizer, type ApprovalCodeUpdate } from './voice-approval-code';
import {
  hasTranscriptContent,
  normalizeTranscriptWhitespace,
  pcm16leRms,
  pcm16leToWav,
  PromptSpeechSegmenter,
  stripCommands,
  type PromptSpeechSegment,
} from './voice-transcription-segmenter';

type CaptureCommand = {
  label: string;
  command: string;
  args: string[];
};

type ClipboardRecorderKind = 'arecord' | 'pw-record' | 'ffmpeg';

type ClipboardRecorderCommand = CaptureCommand & {
  kind: ClipboardRecorderKind;
  tmp: string;
};

type ClipboardAudioRecorderSnapshot = {
  active: boolean;
  backend: string | null;
  tmp: string | null;
  error: string | null;
  firstDataElapsedMs?: number | null;
  lastObservedSize?: number | null;
};

type ClipboardAudioRecorder = {
  snapshot: () => ClipboardAudioRecorderSnapshot;
  start: () => Promise<void>;
  stop: (tailPadMs: number) => Promise<Buffer>;
  cancel: () => void;
};

type VoiceClipboardTrace = {
  requestId?: string;
  clientUnixMs?: number;
  apiReceivedUnixMs?: number;
};

type DesktopVoiceCaptureTarget = 'assistant' | 'patch' | 'clipboard';
type DesktopVoiceRealtimeTransport = 'websocket' | 'webrtc';

export type DesktopVoiceRealtimeSession = {
  appendPcm: (pcm: Buffer) => void | Promise<void>;
  stop: () => Promise<void>;
  cancel: () => Promise<void>;
  sendText?: (text: string) => void | Promise<void>;
};

export type DesktopVoiceRealtimeCallbacks = {
  onUserTranscript: (text: string) => void | Promise<void>;
  onUserTranscriptDelta?: (delta: { text: string; itemId?: string; responseId?: string }) => void | Promise<void>;
  onUserSpeechStarted: () => void | Promise<void>;
  onAssistantTranscript: (text: string) => void | Promise<void>;
  onAssistantTranscriptDelta?: (delta: { text: string; itemId?: string; responseId?: string }) => void | Promise<void>;
  onAssistantAudio: (audio: { wav: Buffer; text: string }) => void | Promise<void>;
  onStatus: (message: string) => void | Promise<void>;
  onError: (message: string) => void | Promise<void>;
  onClose: () => void | Promise<void>;
};

type DesktopVoiceStatus = {
  ok: true;
  mode: DesktopVoiceMode;
  message: string;
  updatedAt: string;
  suspended: {
    active: boolean;
    reason: 'clipboard' | null;
    previousMode: DesktopVoiceMode | null;
    message: string | null;
  };
  supportsWakeWords: boolean;
  recognizer: {
    active: boolean;
    backend: string | null;
    error: string | null;
    text: string | null;
    finalText: string | null;
    textFinal: boolean;
    textUpdatedAt: string | null;
  };
  transcript: {
    active: boolean;
    target: DesktopVoiceCaptureTarget | null;
    status: 'idle' | 'collecting' | 'transcribing' | 'error';
    text: string;
    error: string | null;
    updatedAt: string | null;
  };
  clipboard: {
    mode: DesktopVoiceClipboardMode;
    message: string;
    text?: string;
    error: string | null;
  };
  clipboardResultText?: string;
  lastApprovalCode?: string;
  realtime: {
    available: boolean;
    enabled: boolean;
    provider: VoiceRealtimeProvider;
    ready: boolean;
    webRtcSessionId: string | null;
  };
  capture: {
    active: boolean;
    backend: string | null;
    bytes: number;
    level: number;
    error: string | null;
  };
};

type DesktopVoiceEvent = {
  type: 'desktop_voice_status';
  status: DesktopVoiceStatus;
} | {
  type: 'desktop_voice_local_cue';
  cue: DesktopVoiceCue;
} | {
  type: 'desktop_voice_clipboard_result';
  text: string;
} | {
  type: 'desktop_voice_transcript_segment';
  text: string;
} | {
  type: 'desktop_voice_speak';
  text: string;
} | {
  type: 'desktop_voice_speak_audio';
  text: string;
  contentType: 'audio/wav';
  audioBase64: string;
} | {
  type: 'desktop_voice_stop_audio';
} | {
  type: 'desktop_voice_webrtc_start';
  sessionId: string;
} | {
  type: 'desktop_voice_webrtc_stop';
};

type DesktopVoiceServiceOptions = {
  transcribeWav: (wav: Buffer) => Promise<{ text: string; model: string }>;
  submitAssistantPrompt: (prompt: string) => Promise<void>;
  startRealtimeAssistant?: (callbacks: DesktopVoiceRealtimeCallbacks) => Promise<DesktopVoiceRealtimeSession>;
  realtimeWebRtcAvailable?: boolean | (() => boolean);
  realtimeProvider?: () => VoiceRealtimeProvider;
  cancelRealtimeWebRtcAssistant?: () => Promise<void>;
  realtimeWebRtcStartTimeoutMs?: number;
  startChatPatch?: () => Promise<void>;
  submitChatPatch?: (prompt: string) => Promise<void>;
  abortChatPatch?: () => Promise<void>;
  synthesizeSpeechWav?: (text: string) => Promise<Buffer>;
  clipboardRecorder?: ClipboardAudioRecorder;
  voiceTranscription?: VoiceTranscriptionSettings;
  realtimeAssistantEnabled?: boolean;
};

const VOSK_WAKE_GRAMMAR = [
  'hey sebastian',
  'hay sebastian',
  'hey',
  'hay',
  'sebastian',
  'patch me in',
  'patch',
  'can you transcribe',
  'transcribe',
  'go to sleep',
  'go',
  'to',
  'sleep',
  'status',
  'state us',
  'state is',
  'status check',
  'check status',
  'approval',
  'code',
  'approval code',
  'zero',
  'oh',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  '[unk]',
] as const;
const REALTIME_ASSISTANT_RETRY_SUPPRESSION_MS = 8_000;

function formatDigitsForSpeech(code: string): string {
  const words: Record<string, string> = {
    '0': 'zero',
    '1': 'one',
    '2': 'two',
    '3': 'three',
    '4': 'four',
    '5': 'five',
    '6': 'six',
    '7': 'seven',
    '8': 'eight',
    '9': 'nine',
  };
  return String(code ?? '').split('').map((digit) => words[digit] ?? digit).join(' ').trim();
}

function promptTextFromCommand(rawText: string, command: ReturnType<typeof stripCommands>): string {
  if (command.lock && hasTranscriptContent(command.text)) return normalizeTranscriptWhitespace(rawText);
  return command.text.trim();
}

function normalizeGrammarPhrase(phrase: string): string {
  return String(phrase ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(' ');
}

function triggerGrammarEntries(phrase: string): string[] {
  const normalized = normalizeGrammarPhrase(phrase);
  const words = normalized.split(/\s+/).filter(Boolean);
  return normalized ? [normalized, ...words] : [];
}

function splitEnvCaptureCommand(raw: string): CaptureCommand | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return { label: 'custom', command: process.env.SHELL || '/bin/sh', args: ['-lc', trimmed] };
}

function defaultCaptureCommands(): CaptureCommand[] {
  const custom = splitEnvCaptureCommand(String(process.env.DRONE_DESKTOP_VOICE_CAPTURE_CMD ?? ''));
  if (custom) return [custom];
  if (process.platform === 'darwin') {
    return [
      { label: 'ffmpeg-avfoundation', command: 'ffmpeg', args: ['-hide_banner', '-loglevel', 'error', '-f', 'avfoundation', '-i', ':0', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'] },
    ];
  }
  if (process.platform === 'linux') {
    return [
      { label: 'parecord', command: 'parecord', args: ['--raw', '--format=s16le', '--rate=16000', '--channels=1'] },
      { label: 'arecord', command: 'arecord', args: ['-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'raw'] },
      { label: 'ffmpeg-pulse', command: 'ffmpeg', args: ['-hide_banner', '-loglevel', 'error', '-f', 'pulse', '-i', 'default', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'] },
    ];
  }
  return [];
}

function commandAvailable(command: string, args: string[] = ['--version']): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore' });
  return !result.error;
}

function positiveIntEnvValue(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function clipboardTailPadMs(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_CLIPBOARD_TAIL_PAD_MS', 400);
}

function clipboardMinWavBytes(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_CLIPBOARD_MIN_WAV_BYTES', 2_000);
}

function clipboardPrewarmEnabled(): boolean {
  const raw = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PREWARM ?? '1').trim().toLowerCase();
  return raw !== '0' && raw !== 'false' && raw !== 'no';
}

function clipboardPreRollMs(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_CLIPBOARD_PREROLL_MS', 1_200);
}

function promptPreRollMs(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_PROMPT_PREROLL_MS', 1_500);
}

function desktopVoiceEventReplayLimit(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_EVENT_REPLAY_LIMIT', 64);
}

function realtimeWebRtcStartTimeoutMs(): number {
  return positiveIntEnvValue('DRONE_DESKTOP_VOICE_WEBRTC_START_TIMEOUT_MS', 12_000);
}

function pcmBytesForMs(ms: number, sampleRateHz = 16_000, channels = 1): number {
  return Math.max(0, Math.round(sampleRateHz * channels * 2 * ms / 1000));
}

function wavDurationMs(wav: Buffer): number {
  if (wav.byteLength <= 44) return 0;
  return Math.round(((wav.byteLength - 44) / (16_000 * 2)) * 1000);
}

async function fileSizeOrNull(filePath: string): Promise<number | null> {
  try {
    return (await fs.stat(filePath)).size;
  } catch {
    return null;
  }
}

function clipboardRecorderStartDelayMs(kind: ClipboardRecorderKind): number {
  if (kind === 'ffmpeg') return 200;
  return 150;
}

function selectedClipboardRecorder(): ClipboardRecorderKind {
  const raw = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_RECORDER ?? '').trim().toLowerCase();
  if (raw === 'pw' || raw === 'pipewire') return 'pw-record';
  if (raw === 'pw-record' || raw === 'arecord' || raw === 'ffmpeg') return raw;
  if (process.platform === 'linux') {
    if (commandAvailable('arecord')) return 'arecord';
    if (commandAvailable('pw-record', ['--help'])) return 'pw-record';
    if (commandAvailable('ffmpeg')) return 'ffmpeg';
  }
  return 'ffmpeg';
}

function buildClipboardRecorderCommand(tmp: string): ClipboardRecorderCommand {
  const kind = selectedClipboardRecorder();
  if (process.platform === 'linux' && kind === 'arecord') {
    const device = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_ALSA_DEVICE ?? process.env.SUPASCRIBE_ALSA_DEVICE ?? '').trim();
    return {
      kind,
      label: 'clipboard-arecord',
      command: 'arecord',
      args: [...(device ? ['-D', device] : []), '-q', '-f', 'S16_LE', '-r', '16000', '-c', '1', '-t', 'wav', tmp],
      tmp,
    };
  }
  if (process.platform === 'linux' && kind === 'pw-record') {
    const target = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PW_TARGET ?? '').trim();
    return {
      kind,
      label: 'clipboard-pw-record',
      command: 'pw-record',
      args: [...(target ? ['--target', target] : []), '--rate', '16000', '--channels', '1', tmp],
      tmp,
    };
  }

  const loglevel = desktopVoiceDebugEnabled() ? 'info' : 'error';
  const common = ['-y', '-hide_banner', '-loglevel', loglevel, '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', '-f', 'wav', tmp];
  if (process.platform === 'darwin') {
    return {
      kind: 'ffmpeg',
      label: 'clipboard-ffmpeg-avfoundation',
      command: 'ffmpeg',
      args: ['-f', 'avfoundation', '-i', ':0', ...common],
      tmp,
    };
  }
  if (process.platform === 'win32') {
    const device = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_DSHOW_DEVICE ?? 'audio=default');
    return {
      kind: 'ffmpeg',
      label: 'clipboard-ffmpeg-dshow',
      command: 'ffmpeg',
      args: ['-f', 'dshow', '-i', device, ...common],
      tmp,
    };
  }
  if (process.platform === 'linux') {
    const input = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_FFMPEG_INPUT ?? 'pulse').trim() || 'pulse';
    if (input === 'alsa') {
      const device = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_ALSA_DEVICE ?? process.env.SUPASCRIBE_ALSA_DEVICE ?? 'default');
      return {
        kind: 'ffmpeg',
        label: 'clipboard-ffmpeg-alsa',
        command: 'ffmpeg',
        args: ['-f', 'alsa', '-thread_queue_size', '4096', '-ar', '16000', '-i', device, ...common],
        tmp,
      };
    }
    const source = String(process.env.DRONE_DESKTOP_VOICE_CLIPBOARD_PULSE_SOURCE ?? process.env.SUPASCRIBE_PULSE_SOURCE ?? 'default');
    return {
      kind: 'ffmpeg',
      label: 'clipboard-ffmpeg-pulse',
      command: 'ffmpeg',
      args: ['-f', input, '-thread_queue_size', '4096', '-ar', '16000', '-i', source, ...common],
      tmp,
    };
  }
  throw new Error(`No clipboard recorder is configured for ${process.platform}.`);
}

function commandDisplay(command: CaptureCommand): string {
  return [command.command, ...command.args].join(' ');
}

function normalizeLevel(rms: number): number {
  const normalized = Math.max(0, Math.min(1, (rms - 0.003) / 0.08));
  return Math.sqrt(normalized);
}

const requireForDesktopVoice = createRequire(__filename);

function envPath(name: string): string | null {
  const value = String(process.env[name] ?? '').trim();
  return value ? path.resolve(value.replace(/^~(?=$|\/)/, os.homedir())) : null;
}

function existingEnvPath(name: string): string | null {
  const value = envPath(name);
  return value && existsSync(value) ? value : null;
}

function hasRequiredVoskModelFiles(modelDir: string): boolean {
  return existsSync(path.join(modelDir, 'am', 'final.mdl')) &&
    existsSync(path.join(modelDir, 'graph', 'HCLr.fst')) &&
    existsSync(path.join(modelDir, 'graph', 'Gr.fst')) &&
    existsSync(path.join(modelDir, 'conf', 'model.conf'));
}

function resolveBundledVoskModelDir(): string | null {
  const candidates = [
    managedDesktopVoiceModelDirSync(),
    path.resolve(__dirname, '..', 'assets', 'vosk-model-en-us'),
    path.resolve(__dirname, '..', '..', '..', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
    path.resolve(process.cwd(), 'apps', 'voice-stream', 'android', 'app', 'src', 'main', 'assets', 'model-en-us'),
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => hasRequiredVoskModelFiles(candidate)) ?? null;
}

function resolveVoskModelDir(): string | { error: string } {
  const explicit = existingEnvPath('DRONE_DESKTOP_VOICE_VOSK_MODEL_DIR');
  if (explicit) {
    if (hasRequiredVoskModelFiles(explicit)) return explicit;
    return { error: `Vosk model files were not found in ${explicit}. Expected the Android-style model directory with am/final.mdl, graph/HCLr.fst, graph/Gr.fst, and conf/model.conf.` };
  }
  const bundled = resolveBundledVoskModelDir();
  if (bundled) return bundled;
  return {
    error: 'Bundled Vosk trigger model was not found. Rebuild Drone Hub or set DRONE_DESKTOP_VOICE_VOSK_MODEL_DIR to an Android-style Vosk model directory.',
  };
}

function desktopVoiceDebugEnabled(): boolean {
  const raw = String(process.env.DRONE_DESKTOP_VOICE_DEBUG ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function desktopVoiceLog(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) console.log(`[desktop-voice] ${message}`, meta);
  else console.log(`[desktop-voice] ${message}`);
}

function desktopVoiceWarn(message: string, meta?: Record<string, unknown>): void {
  if (meta && Object.keys(meta).length > 0) console.warn(`[desktop-voice] ${message}`, meta);
  else console.warn(`[desktop-voice] ${message}`);
}

type VoskModel = { free: () => void };
type VoskRecognizer = {
  acceptWaveform: (pcm: Buffer) => boolean;
  partialResult: () => { partial?: string };
  result: () => { text?: string };
  reset: () => void;
  free: () => void;
};

class VoskCommandRecognizer extends EventEmitter {
  private model: VoskModel | null = null;
  private recognizer: VoskRecognizer | null = null;
  private error: string | null = null;
  private backend: string | null = null;
  private lastText = '';
  private lastEmittedText: string | null = null;
  private lastFinalText: string | null = null;
  private lastTextFinal = false;
  private lastTextUpdatedAt: string | null = null;
  private approvalTriggerPhrase = VOICE_APPROVAL_SETTINGS_DEFAULT.triggerPhrase;

  snapshot(): DesktopVoiceStatus['recognizer'] {
    return {
      active: Boolean(this.recognizer),
      backend: this.backend,
      error: this.error,
      text: this.lastEmittedText,
      finalText: this.lastFinalText,
      textFinal: this.lastTextFinal,
      textUpdatedAt: this.lastTextUpdatedAt,
    };
  }

  start(): void {
    if (this.recognizer) return;
    const modelDir = resolveVoskModelDir();
    if (typeof modelDir !== 'string') {
      this.error = modelDir.error;
      desktopVoiceWarn('recognizer unavailable', { error: this.error });
      this.emit('error-state', this.error);
      return;
    }
    try {
      const vosk = requireForDesktopVoice('vosk') as {
        setLogLevel?: (level: number) => void;
        Model: new (modelPath: string) => VoskModel;
        Recognizer: new (params: { model: VoskModel; sampleRate: number; grammar: string[] }) => VoskRecognizer;
      };
      vosk.setLogLevel?.(desktopVoiceDebugEnabled() ? 0 : -1);
      const model = new vosk.Model(modelDir);
      const grammar = this.grammar();
      const recognizer = new vosk.Recognizer({
        model,
        sampleRate: 16_000,
        grammar,
      });
      this.model = model;
      this.recognizer = recognizer;
      this.backend = 'vosk:constrained-grammar';
      this.lastText = '';
      this.lastEmittedText = null;
      this.lastFinalText = null;
      this.lastTextFinal = false;
      this.lastTextUpdatedAt = null;
      this.error = null;
      desktopVoiceLog('recognizer started', {
        backend: this.backend,
        modelDir,
        grammar,
      });
      this.emit('ready');
    } catch (error: any) {
      this.recognizer = null;
      this.model = null;
      this.backend = null;
      this.error = error?.code === 'MODULE_NOT_FOUND'
        ? 'vosk is not installed. Run `bun install` and restart Drone Hub.'
        : `Vosk recognizer failed to start: ${error?.message ?? String(error)}`;
      desktopVoiceWarn('recognizer start failed', { error: this.error });
      this.emit('error-state', this.error);
    }
  }

  setApprovalTriggerPhrase(phrase: string): void {
    const next = normalizeGrammarPhrase(phrase) || VOICE_APPROVAL_SETTINGS_DEFAULT.triggerPhrase;
    if (next === this.approvalTriggerPhrase) return;
    this.approvalTriggerPhrase = next;
    if (!this.recognizer) return;
    this.stop();
    this.start();
  }

  private grammar(): string[] {
    const extra = triggerGrammarEntries(this.approvalTriggerPhrase);
    return Array.from(new Set([...VOSK_WAKE_GRAMMAR, ...extra]));
  }

  stop(): void {
    if (this.recognizer) desktopVoiceLog('recognizer stopped', { backend: this.backend });
    try {
      this.recognizer?.free();
    } catch {
      // ignore
    }
    try {
      this.model?.free();
    } catch {
      // ignore
    }
    this.recognizer = null;
    this.model = null;
    this.backend = null;
    this.lastText = '';
    this.lastEmittedText = null;
    this.lastFinalText = null;
    this.lastTextFinal = false;
    this.lastTextUpdatedAt = null;
  }

  write(pcm: Buffer): void {
    const recognizer = this.recognizer;
    if (!recognizer || pcm.byteLength < 2) return;
    try {
      const endpoint = recognizer.acceptWaveform(pcm);
      const text = endpoint
        ? String(recognizer.result().text ?? '').trim().toLowerCase()
        : String(recognizer.partialResult().partial ?? '').trim().toLowerCase();
      if (text && text !== this.lastText) {
        this.lastText = text;
        this.lastEmittedText = text;
        this.lastTextFinal = endpoint;
        this.lastTextUpdatedAt = new Date().toISOString();
        if (endpoint) this.lastFinalText = text;
        if (endpoint || desktopVoiceDebugEnabled()) {
          desktopVoiceLog(endpoint ? 'recognizer final text' : 'recognizer partial text', { text });
        }
        this.emit('text', text, endpoint);
      }
      if (endpoint) {
        if (text) {
          this.lastEmittedText = text;
          this.lastFinalText = text;
          this.lastTextFinal = true;
          this.lastTextUpdatedAt = new Date().toISOString();
          desktopVoiceLog('recognizer endpoint text', { text });
          this.emit('text', text, true);
        }
        recognizer.reset();
        this.lastText = '';
      }
    } catch (error: any) {
      this.error = `Vosk recognizer failed while decoding: ${error?.message ?? String(error)}`;
      this.stop();
      desktopVoiceWarn('recognizer decode failed', { error: this.error });
      this.emit('error-state', this.error);
    }
  }
}

class HostMicrophoneCapture extends EventEmitter {
  private child: ChildProcess | null = null;
  private backend: string | null = null;
  private bytes = 0;
  private level = 0;
  private error: string | null = null;
  private stopped = true;
  private startupTimer: NodeJS.Timeout | null = null;
  private candidates: CaptureCommand[] = [];
  private candidateIndex = 0;
  private candidateStartedAt = 0;

  snapshot(): DesktopVoiceStatus['capture'] {
    return {
      active: Boolean(this.child),
      backend: this.backend,
      bytes: this.bytes,
      level: this.level,
      error: this.error,
    };
  }

  start(): void {
    if (this.child) return;
    this.stopped = false;
    this.bytes = 0;
    this.level = 0;
    this.error = null;
    this.candidates = defaultCaptureCommands();
    this.candidateIndex = 0;
    this.startNextCandidate();
  }

  stop(): void {
    this.stopped = true;
    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
    const child = this.child;
    this.child = null;
    const backend = this.backend;
    this.backend = null;
    if (!child) return;
    child.removeAllListeners();
    child.stdout?.removeAllListeners();
    child.stderr?.removeAllListeners();
    try {
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }, 800).unref();
    } catch {
      // ignore
    }
    desktopVoiceLog('host mic capture stopped', { backend });
    this.emit('change');
  }

  private startNextCandidate(): void {
    if (this.stopped) return;
    const candidate = this.candidates[this.candidateIndex];
    if (!candidate) {
      this.error = this.candidates.length === 0
        ? `No host microphone capture backend is configured for ${os.platform()}. Set DRONE_DESKTOP_VOICE_CAPTURE_CMD.`
        : 'No host microphone capture backend started successfully.';
      desktopVoiceWarn('host mic capture unavailable', { error: this.error });
      this.emit('error-state', this.error);
      this.emit('change');
      return;
    }
    this.candidateIndex += 1;
    this.backend = candidate.label;
    this.candidateStartedAt = Date.now();
    let stderr = '';
    let receivedAudio = false;
    try {
      const child = spawn(candidate.command, candidate.args, { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      child.stdout?.on('data', (chunk: Buffer) => {
        if (!receivedAudio) {
          desktopVoiceLog('host mic capture first audio', {
            backend: candidate.label,
            elapsedMs: Date.now() - this.candidateStartedAt,
            bytes: chunk.length,
          });
        }
        receivedAudio = true;
        this.bytes += chunk.length;
        this.level = normalizeLevel(pcm16leRms(chunk));
        this.emit('audio', chunk);
        this.emit('change');
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8');
        if (stderr.length > 2000) stderr = stderr.slice(-2000);
      });
      child.on('error', (error) => {
        if (this.child !== child) return;
        this.child = null;
        this.error = `${candidate.label}: ${error.message}`;
        desktopVoiceWarn('host mic capture backend error', { backend: candidate.label, error: this.error });
        this.startNextCandidate();
      });
      child.on('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        const detail = stderr.trim() || `exit ${code ?? signal ?? 'unknown'}`;
        this.error = `${candidate.label}: ${detail}`;
        if (this.stopped) {
          desktopVoiceLog('host mic capture backend exited after stop', { backend: candidate.label, detail });
          this.emit('change');
          return;
        }
        if (!receivedAudio) {
          desktopVoiceWarn('host mic capture backend produced no audio', { backend: candidate.label, detail });
          this.startNextCandidate();
        } else {
          desktopVoiceWarn('host mic capture backend exited', { backend: candidate.label, detail });
          this.emit('error-state', this.error);
          this.emit('change');
        }
      });
      this.startupTimer = setTimeout(() => {
        this.startupTimer = null;
        if (this.child === child && !receivedAudio) {
          try {
            child.kill('SIGTERM');
          } catch {
            // exit handler tries the next candidate
          }
        }
      }, 1000);
      this.startupTimer.unref();
      this.error = null;
      this.emit('change');
      desktopVoiceLog('host mic capture started', { backend: candidate.label, command: commandDisplay(candidate) });
    } catch (error: any) {
      this.child = null;
      this.error = `${candidate.label}: ${error?.message ?? String(error)}`;
      desktopVoiceWarn('host mic capture spawn failed', { backend: candidate.label, error: this.error });
      this.startNextCandidate();
    }
  }
}

class ClipboardWavRecorder implements ClipboardAudioRecorder {
  private child: ChildProcess | null = null;
  private command: ClipboardRecorderCommand | null = null;
  private error: string | null = null;
  private stderr = '';
  private startedAtMs = 0;
  private firstDataElapsedMs: number | null = null;
  private firstDataProbeTimer: NodeJS.Timeout | null = null;
  private lastObservedSize: number | null = null;

  snapshot(): ClipboardAudioRecorderSnapshot {
    return {
      active: Boolean(this.child),
      backend: this.command?.label ?? null,
      tmp: this.command?.tmp ?? null,
      error: this.error,
      firstDataElapsedMs: this.firstDataElapsedMs,
      lastObservedSize: this.lastObservedSize,
    };
  }

  async start(): Promise<void> {
    if (this.child) return;
    const tmp = path.join(os.tmpdir(), `drone-voice-clipboard-${process.pid}-${Date.now()}.wav`);
    const command = buildClipboardRecorderCommand(tmp);
    this.command = command;
    this.stderr = '';
    this.error = null;
    this.startedAtMs = Date.now();
    this.firstDataElapsedMs = null;
    this.lastObservedSize = null;
    desktopVoiceLog('clipboard wav recorder start requested', {
      backend: command.label,
      command: commandDisplay(command),
    });
    this.startFirstDataProbe(command);

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve();
      };
      const child = spawn(command.command, command.args, {
        stdio: [command.kind === 'ffmpeg' ? 'pipe' : 'ignore', 'ignore', 'pipe'],
      });
      this.child = child;
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8');
        if (desktopVoiceDebugEnabled()) process.stderr.write(`[${command.label}] ${text}`);
        this.stderr += text;
        if (this.stderr.length > 4_000) this.stderr = this.stderr.slice(-4_000);
      });
      child.on('error', (error) => {
        this.child = null;
        this.error = `${command.label}: ${error.message}`;
        finish(new Error(this.error));
      });
      child.on('exit', (code, signal) => {
        if (this.child !== child) return;
        this.child = null;
        const detail = this.stderr.trim() || `exit ${code ?? signal ?? 'unknown'}`;
        this.error = `${command.label}: ${detail}`;
        if (settled) {
          desktopVoiceWarn('clipboard wav recorder exited before stop', { backend: command.label, detail });
          return;
        }
        finish(new Error(`Clipboard recorder failed to start: ${detail}`));
      });
      setTimeout(() => {
        if (settled) return;
        if (child.exitCode !== null) {
          const detail = this.stderr.trim() || `exit ${child.exitCode}`;
          this.child = null;
          this.error = `${command.label}: ${detail}`;
          finish(new Error(`Clipboard recorder failed to start: ${detail}`));
          return;
        }
        desktopVoiceLog('clipboard wav recorder started', {
          backend: command.label,
          elapsedMs: Date.now() - this.startedAtMs,
          file: command.tmp,
        });
        finish();
      }, clipboardRecorderStartDelayMs(command.kind)).unref();
    });
  }

  async stop(tailPadMs: number): Promise<Buffer> {
    const child = this.child;
    const command = this.command;
    if (!child || !command) throw new Error('Clipboard recorder is not active.');
    const stoppedAt = Date.now();
    this.child = null;
    try {
      await this.stopChild(child, command, tailPadMs);
      const stat = await fs.stat(command.tmp);
      if (!stat.size || stat.size < clipboardMinWavBytes()) {
        throw new Error(`Recorded WAV was too small (${stat.size} bytes).`);
      }
      const wav = await fs.readFile(command.tmp);
      desktopVoiceLog('clipboard wav recorder stopped', {
        backend: command.label,
        elapsedMs: Date.now() - stoppedAt,
        recordingWallMs: this.startedAtMs ? Date.now() - this.startedAtMs : null,
        wavDurationMs: wavDurationMs(wav),
        bytes: wav.byteLength,
      });
      return wav;
    } finally {
      await fs.unlink(command.tmp).catch(() => {});
      this.command = null;
      this.stderr = '';
      this.startedAtMs = 0;
      this.stopFirstDataProbe();
    }
  }

  cancel(): void {
    const child = this.child;
    const command = this.command;
    this.child = null;
    this.command = null;
    this.stderr = '';
    this.startedAtMs = 0;
    this.firstDataElapsedMs = null;
    this.lastObservedSize = null;
    this.stopFirstDataProbe();
    this.error = null;
    if (!child || !command) return;
    desktopVoiceLog('clipboard wav recorder cancelled', { backend: command.label, file: command.tmp });
    child.removeAllListeners('error');
    child.removeAllListeners('exit');
    child.removeAllListeners('close');
    try {
      child.kill('SIGINT');
    } catch {
      // ignore
    }
    setTimeout(() => {
      if (!child.killed) {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
      }
    }, 500).unref();
    void fs.unlink(command.tmp).catch(() => {});
  }

  private async stopChild(child: ChildProcess, command: ClipboardRecorderCommand, tailPadMs: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let stopTimer: NodeJS.Timeout | null = null;
      let interruptTimer: NodeJS.Timeout | null = null;
      let terminateTimer: NodeJS.Timeout | null = null;
      let killTimer: NodeJS.Timeout | null = null;
      let timeoutTimer: NodeJS.Timeout | null = null;
      const clearTimers = () => {
        if (stopTimer) clearTimeout(stopTimer);
        if (interruptTimer) clearTimeout(interruptTimer);
        if (terminateTimer) clearTimeout(terminateTimer);
        if (killTimer) clearTimeout(killTimer);
        if (timeoutTimer) clearTimeout(timeoutTimer);
        stopTimer = null;
        interruptTimer = null;
        terminateTimer = null;
        killTimer = null;
        timeoutTimer = null;
      };
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        if (error) reject(error);
        else resolve();
      };
      const childExited = () => child.exitCode !== null || child.signalCode != null;
      const sendSignal = (signal: NodeJS.Signals) => {
        if (settled || childExited()) return;
        try {
          child.kill(signal);
        } catch {
          // ignore
        }
      };
      child.on('close', (code, signal) => {
        const detail = this.stderr.trim() || `exit ${code ?? signal ?? 'unknown'}`;
        if (code === 0) return finish();
        if (command.kind === 'arecord' && /Interrupted system call|Aborted by signal|SIGINT|terminated/i.test(detail)) return finish();
        if (command.kind === 'arecord' && code === 1 && this.firstDataElapsedMs != null) return finish();
        if (command.kind === 'pw-record' && (code === 1 || /interrupted|SIGINT|terminated|ctrl\+c/i.test(detail))) return finish();
        if (command.kind === 'ffmpeg' && (/Output #0/i.test(detail) || /size=/i.test(detail))) return finish();
        return finish(new Error(`${command.label} exited ${code ?? signal ?? 'unknown'}: ${detail}`));
      });

      const sendStop = () => {
        if (command.kind === 'ffmpeg' && child.stdin && !child.stdin.destroyed) {
          try {
            child.stdin.write('q');
            child.stdin.end();
            return;
          } catch {
            // fall through to signal
          }
        }
        sendSignal('SIGINT');
      };
      const tailMs = Math.max(0, tailPadMs);
      stopTimer = setTimeout(sendStop, tailMs);
      interruptTimer = setTimeout(() => sendSignal('SIGINT'), tailMs + 800);
      terminateTimer = setTimeout(() => sendSignal('SIGTERM'), tailMs + 2_000);
      killTimer = setTimeout(() => sendSignal('SIGKILL'), tailMs + 4_000);
      timeoutTimer = setTimeout(() => {
        const detail = this.stderr.trim() || 'recorder did not exit after stop signals';
        finish(new Error(`${command.label} stop timed out: ${detail}`));
      }, tailMs + 6_000);
      stopTimer.unref();
      interruptTimer.unref();
      terminateTimer.unref();
      killTimer.unref();
      timeoutTimer.unref();
    });
  }

  private startFirstDataProbe(command: ClipboardRecorderCommand): void {
    this.stopFirstDataProbe();
    const startedAtMs = this.startedAtMs;
    const probe = async () => {
      if (this.command !== command || this.firstDataElapsedMs != null) return;
      const size = await fileSizeOrNull(command.tmp);
      this.lastObservedSize = size;
      if (size != null && size > 44) {
        this.firstDataElapsedMs = Date.now() - startedAtMs;
        desktopVoiceLog('clipboard wav recorder first file data', {
          backend: command.label,
          elapsedMs: this.firstDataElapsedMs,
          size,
          file: command.tmp,
        });
      }
    };
    this.firstDataProbeTimer = setInterval(() => void probe(), 25);
    this.firstDataProbeTimer.unref?.();
    void probe();
  }

  private stopFirstDataProbe(): void {
    if (!this.firstDataProbeTimer) return;
    clearInterval(this.firstDataProbeTimer);
    this.firstDataProbeTimer = null;
  }
}

export const __desktopVoiceTestInternals = {
  ClipboardWavRecorder,
};

export class DesktopVoiceService {
  private readonly events = new EventEmitter();
  private readonly capture = new HostMicrophoneCapture();
  private readonly recognizer = new VoskCommandRecognizer();
  private readonly approvalRecognizer = new ApprovalCodeRecognizer();
  private approvalFinalizeTimer: NodeJS.Timeout | null = null;
  private desktopSubscriberCount = 0;
  private desktopStartSessionId = 0;
  private mode: DesktopVoiceMode = 'off';
  private message = 'Desktop voice is off.';
  private updatedAt = new Date().toISOString();
  private lastApprovalCode = '';
  private lastCommandAt = new Map<string, number>();
  private promptChunks: Buffer[] = [];
  private readonly promptSegmenter = new PromptSpeechSegmenter();
  private promptSegments: PromptSpeechSegment[] = [];
  private promptTranscribing = false;
  private promptCaptureTarget: DesktopVoiceCaptureTarget | null = null;
  private promptTranscriptText = '';
  private promptTranscriptError: string | null = null;
  private promptTranscriptUpdatedAt: string | null = null;
  private realtimeSession: DesktopVoiceRealtimeSession | null = null;
  private realtimeStarting = false;
  private realtimeTransport: DesktopVoiceRealtimeTransport | null = null;
  private readonly clipboardRecorder: ClipboardAudioRecorder;
  private clipboardSessionId = 0;
  private clipboardRecordingStartedAtMs = 0;
  private clipboardRecordingRequestId: string | null = null;
  private clipboardChunks: Buffer[] = [];
  private clipboardStartedCapture = false;
  private clipboardPreRollChunks: Buffer[] = [];
  private clipboardPreRollBytes = 0;
  private readonly promptPreRollBuffer = new PcmRingBuffer(pcmBytesForMs(promptPreRollMs()));
  private readonly eventReplayBuffer: Exclude<DesktopVoiceEvent, { type: 'desktop_voice_status' }>[] = [];
  private clipboardMode: DesktopVoiceClipboardMode = 'idle';
  private clipboardMessage = 'Voice transcription is idle.';
  private clipboardError: string | null = null;
  private clipboardStartSuppressedUntil = 0;
  private desktopVoiceSuspensionReason: 'clipboard' | null = null;
  private desktopVoiceSuspendedMode: DesktopVoiceMode | null = null;
  private desktopVoiceSuspendedMessage: string | null = null;
  private promptCommandSuppressedUntil = 0;
  private approvalSettings: VoiceApprovalSettings = VOICE_APPROVAL_SETTINGS_DEFAULT;
  private voiceTranscriptionFinalMode: VoiceTranscriptionFinalMode = VOICE_TRANSCRIPTION_SETTINGS_DEFAULT.finalMode;
  private realtimeAssistantEnabled = false;
  private realtimeWebRtcStartTimer: NodeJS.Timeout | null = null;
  private realtimeWebRtcBrowserSessionId: string | null = null;

  constructor(private readonly opts: DesktopVoiceServiceOptions) {
    this.clipboardRecorder = opts.clipboardRecorder ?? new ClipboardWavRecorder();
    this.voiceTranscriptionFinalMode = opts.voiceTranscription?.finalMode ?? VOICE_TRANSCRIPTION_SETTINGS_DEFAULT.finalMode;
    this.realtimeAssistantEnabled = opts.realtimeAssistantEnabled === true;
    this.capture.on('change', () => this.emitChange());
    this.capture.on('audio', (chunk: Buffer) => this.handleAudio(chunk));
    this.capture.on('error-state', (message) => {
      const text = String(message || 'Host microphone capture failed.');
      if (this.clipboardMode === 'recording') {
        this.clipboardMode = 'error';
        this.clipboardError = text;
        this.clipboardMessage = `Voice transcription failed: ${text}`;
        this.clipboardChunks = [];
        this.clipboardStartedCapture = false;
      }
      if (this.mode !== 'off') {
        this.mode = 'error';
        this.message = text;
      }
      this.touch();
      this.emitChange();
    });
    this.recognizer.on('ready', () => {
      if (this.mode === 'awake') this.message = 'Awake: waiting for hey Sebastian.';
      if (this.mode === 'sleeping') this.message = this.sleepingMessage();
      this.touch();
      this.emitChange();
    });
    this.recognizer.on('text', (text: string, final: boolean) => this.handleRecognizedText(text, final));
    this.recognizer.on('error-state', (message) => {
      this.message = `Local wake model unavailable: ${message}`;
      this.touch();
      this.emitChange();
    });
  }

  snapshot(): DesktopVoiceStatus {
    return {
      ok: true,
      mode: this.mode,
      message: this.message,
      updatedAt: this.updatedAt,
      suspended: {
        active: this.desktopVoiceSuspensionReason != null,
        reason: this.desktopVoiceSuspensionReason,
        previousMode: this.desktopVoiceSuspendedMode,
        message: this.desktopVoiceSuspensionReason === 'clipboard'
          ? 'Desktop voice is suspended during voice transcription.'
          : null,
      },
      supportsWakeWords: this.recognizer.snapshot().active,
      recognizer: this.recognizer.snapshot(),
      transcript: {
        active: this.mode === 'recording' || this.mode === 'transcribing',
        target: this.mode === 'recording' || this.mode === 'transcribing' ? this.promptCaptureTarget : null,
        status: this.promptTranscriptError
          ? 'error'
          : this.promptTranscribing
            ? 'transcribing'
            : this.mode === 'recording' && this.promptSegmenter.hasOpenSpeech
              ? 'collecting'
              : 'idle',
        text: this.promptTranscriptText,
        error: this.promptTranscriptError,
        updatedAt: this.promptTranscriptUpdatedAt,
      },
      clipboard: {
        mode: this.clipboardMode,
        message: this.clipboardMessage,
        error: this.clipboardError,
      },
      ...(this.lastApprovalCode ? { lastApprovalCode: this.lastApprovalCode } : {}),
      realtime: {
        available: Boolean(this.opts.startRealtimeAssistant || this.realtimeWebRtcAvailable()),
        enabled: this.realtimeAssistantEnabled,
        provider: this.realtimeProvider(),
        ready: Boolean(this.realtimeSession?.sendText),
        webRtcSessionId:
          this.mode === 'recording' &&
          this.promptCaptureTarget === 'assistant' &&
          this.realtimeTransport === 'webrtc'
            ? this.realtimeWebRtcBrowserSessionId
            : null,
      },
      capture: this.capture.snapshot(),
    };
  }

  setApprovalSettings(settings: VoiceApprovalSettings): DesktopVoiceStatus {
    this.approvalSettings = { ...settings };
    this.recognizer.setApprovalTriggerPhrase(settings.triggerPhrase);
    this.approvalRecognizer.configure({
      triggerPhrase: settings.triggerPhrase,
      minDigits: settings.minDigits,
      maxDigits: settings.maxDigits,
      stableMs: settings.stableMs,
      collectTimeoutMs: settings.collectTimeoutMs,
      duplicateCooldownMs: settings.duplicateCooldownMs,
    });
    if (this.mode === 'sleeping') this.message = this.sleepingMessage();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  setVoiceTranscriptionSettings(settings: VoiceTranscriptionSettings): DesktopVoiceStatus {
    this.voiceTranscriptionFinalMode = settings.finalMode;
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  setRealtimeAssistantEnabled(enabled: boolean): DesktopVoiceStatus {
    this.realtimeAssistantEnabled = enabled === true && Boolean(this.opts.startRealtimeAssistant || this.realtimeWebRtcAvailable());
    if (!this.realtimeAssistantEnabled) void this.cancelRealtimeSession();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  async sendRealtimeText(textRaw: string): Promise<boolean> {
    const text = String(textRaw ?? '').trim();
    const session = this.realtimeSession;
    if (!text || !session?.sendText) return false;
    await session.sendText(text);
    return true;
  }

  async stopRealtimeAssistantSession(): Promise<void> {
    const active = Boolean(this.realtimeSession || this.realtimeStarting);
    if (!active) return;
    if (this.mode === 'recording' && this.promptCaptureTarget === 'assistant') {
      await this.stopRealtimeRecordingFromTranscript();
      return;
    }
    await this.cancelRealtimeSession();
  }

  createRealtimeAssistantCallbacks(): DesktopVoiceRealtimeCallbacks {
    return {
      onUserTranscript: async (text) => {
        await this.handleRealtimeUserTranscript(text);
      },
      onUserSpeechStarted: async () => {
        this.handleRealtimeUserSpeechStarted();
      },
      onAssistantTranscript: async (text) => {
        this.handleRealtimeAssistantTranscript(text);
      },
      onAssistantAudio: async (audio) => {
        this.handleRealtimeAssistantAudio(audio);
      },
      onStatus: async (message) => {
        this.handleRealtimeStatus(message);
      },
      onError: async (message) => {
        this.handleRealtimeError(message);
      },
      onClose: async () => {
        this.handleRealtimeClosed();
      },
    };
  }

  subscribe(listener: (event: DesktopVoiceEvent) => void): () => void {
    this.desktopSubscriberCount += 1;
    this.events.on('event', listener);
    listener({ type: 'desktop_voice_status', status: this.snapshot() });
    for (const event of this.eventReplayBuffer) listener(event);
    return () => {
      this.events.off('event', listener);
      this.desktopSubscriberCount = Math.max(0, this.desktopSubscriberCount - 1);
    };
  }

  async speak(text: string): Promise<boolean> {
    const trimmed = String(text ?? '').trim();
    if (!trimmed || this.desktopSubscriberCount <= 0) {
      desktopVoiceWarn('desktop voice speak skipped', {
        reason: !trimmed ? 'empty_text' : 'no_desktop_subscriber',
        textChars: trimmed.length,
        desktopSubscriberCount: this.desktopSubscriberCount,
      });
      return false;
    }
    if (this.opts.synthesizeSpeechWav) {
      const wav = await this.opts.synthesizeSpeechWav(trimmed);
      desktopVoiceLog('desktop voice speak audio emitted', {
        textChars: trimmed.length,
        audioBytes: wav.byteLength,
        desktopSubscriberCount: this.desktopSubscriberCount,
      });
      this.emitDesktopVoiceEvent({
        type: 'desktop_voice_speak_audio',
        text: trimmed,
        contentType: 'audio/wav',
        audioBase64: wav.toString('base64'),
      } satisfies DesktopVoiceEvent);
      return true;
    }
    desktopVoiceLog('desktop voice speak text emitted', {
      textChars: trimmed.length,
      desktopSubscriberCount: this.desktopSubscriberCount,
    });
    this.emitDesktopVoiceEvent({ type: 'desktop_voice_speak', text: trimmed } satisfies DesktopVoiceEvent);
    return true;
  }

  toggle(): DesktopVoiceStatus {
    if (this.desktopVoiceSuspensionReason) return this.snapshot();
    if (this.mode === 'off' || this.mode === 'error') return this.start();
    if (this.mode === 'recording' || this.mode === 'transcribing') {
      void this.abortPromptRecordingFromTranscript();
      return this.snapshot();
    }
    if (this.mode === 'awake') return this.enterSleeping();
    if (this.mode === 'sleeping') return this.enterAwake();
    return this.snapshot();
  }

  async startAssistantRecordingNow(): Promise<DesktopVoiceStatus> {
    if (this.desktopVoiceSuspensionReason) return this.snapshot();
    if (this.mode === 'recording' || this.mode === 'transcribing') return this.snapshot();
    if (this.mode === 'off' || this.mode === 'error') {
      this.start();
    } else if (this.mode === 'sleeping') {
      this.enterAwake();
    } else {
      this.ensureRecognitionActive();
    }
    await this.startPromptRecording('assistant');
    return this.snapshot();
  }

  start(): DesktopVoiceStatus {
    desktopVoiceLog('desktop voice start requested');
    const sessionId = ++this.desktopStartSessionId;
    this.mode = 'awake';
    this.message = 'Awake: waiting for hey Sebastian.';
    this.lastApprovalCode = '';
    this.resetApprovalCollection();
    this.touch();
    this.emitChange();
    setImmediate(() => {
      if (this.desktopStartSessionId !== sessionId || (this.mode !== 'awake' && this.mode !== 'sleeping')) return;
      this.ensureRecognitionActive();
    });
    return this.snapshot();
  }

  private enterSleeping(): DesktopVoiceStatus {
    this.desktopStartSessionId += 1;
    this.mode = 'sleeping';
    this.message = this.sleepingMessage();
    this.lastApprovalCode = '';
    this.ensureRecognitionActive();
    this.resetApprovalCollection();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  private enterAwake(): DesktopVoiceStatus {
    this.mode = 'awake';
    this.message = 'Awake: waiting for hey Sebastian.';
    this.lastApprovalCode = '';
    this.ensureRecognitionActive();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  private ensureRecognitionActive(): void {
    this.recognizer.start();
    this.capture.start();
  }

  stop(message = 'Desktop voice is off.'): DesktopVoiceStatus {
    desktopVoiceLog('desktop voice stop requested', { message });
    this.desktopStartSessionId += 1;
    void this.cancelRealtimeSession();
    this.capture.stop();
    this.recognizer.stop();
    this.clearDesktopVoiceSuspension();
    this.mode = 'off';
    this.message = message;
    this.promptChunks = [];
    this.promptPreRollBuffer.clear();
    this.resetApprovalCollection();
    this.resetPromptTranscription();
    this.promptCaptureTarget = null;
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  async cancelActiveRecording(): Promise<DesktopVoiceStatus> {
    if (this.mode === 'recording' || this.mode === 'transcribing') {
      await this.abortPromptRecordingFromTranscript();
    }
    return this.snapshot();
  }

  markRealtimeWebRtcAssistantConnected(): void {
    if (this.realtimeTransport !== 'webrtc' || this.mode !== 'recording' || this.promptCaptureTarget !== 'assistant') return;
    this.clearRealtimeWebRtcStartupTimer();
    desktopVoiceLog('realtime assistant WebRTC connected');
    this.message = 'Awake: realtime assistant is listening.';
    this.touch();
    this.emitChange();
  }

  currentRealtimeWebRtcBrowserSessionId(): string | null {
    return this.realtimeWebRtcBrowserSessionId;
  }

  isCurrentRealtimeWebRtcBrowserSession(sessionIdRaw: unknown): boolean {
    const expected = this.realtimeWebRtcBrowserSessionId;
    const received = String(sessionIdRaw ?? '').trim();
    return Boolean(expected && received && received === expected);
  }

  async toggleClipboardRecording(trace: VoiceClipboardTrace = {}): Promise<DesktopVoiceStatus> {
    const serviceReceivedAtMs = Date.now();
    desktopVoiceLog('voice clipboard toggle entered service', {
      requestId: trace.requestId ?? null,
      mode: this.clipboardMode,
      clientToServiceMs: trace.clientUnixMs ? serviceReceivedAtMs - trace.clientUnixMs : null,
      apiToServiceMs: trace.apiReceivedUnixMs ? serviceReceivedAtMs - trace.apiReceivedUnixMs : null,
    });
    if (this.mode === 'recording' || this.mode === 'transcribing') {
      this.clipboardMode = 'error';
      this.clipboardError = 'Desktop assistant voice is actively recording.';
      this.clipboardMessage = 'Voice transcription is unavailable while desktop assistant voice is recording.';
      this.touch();
      this.emitChange();
      return this.snapshot();
    }
    if (this.clipboardMode === 'recording') {
      if (!this.clipboardRecorder.snapshot().active) {
        this.clipboardMode = 'error';
        this.clipboardError = 'Clipboard microphone recorder is not active.';
        this.clipboardMessage = `Voice transcription failed: ${this.clipboardError}`;
        this.resumeDesktopVoiceAfterClipboard();
        this.touch();
        this.emitChange();
        return this.snapshot();
      }
      const clipboardResultText = await this.stopClipboardRecording();
      return {
        ...this.snapshot(),
        ...(clipboardResultText ? { clipboardResultText } : {}),
      };
    }
    if (this.clipboardMode === 'transcribing') return this.snapshot();
    if (Date.now() < this.clipboardStartSuppressedUntil) {
      desktopVoiceLog('voice clipboard recording start suppressed after cancel');
      return this.snapshot();
    }
    const requestedAt = Date.now();
    const sessionId = ++this.clipboardSessionId;
    this.clipboardRecordingRequestId = trace.requestId ?? null;
    desktopVoiceLog('voice clipboard recording start requested', {
      requestId: trace.requestId ?? null,
      clientToStartMs: trace.clientUnixMs ? requestedAt - trace.clientUnixMs : null,
    });
    this.clipboardMode = 'recording';
    this.clipboardMessage = 'Starting voice transcription recorder.';
    this.clipboardError = null;
    this.suspendDesktopVoiceForClipboard();
    this.touch();
    this.emitChange();
    try {
      await this.clipboardRecorder.start();
      if (this.clipboardSessionId !== sessionId || this.clipboardMode !== 'recording') return this.snapshot();
      this.clipboardMessage = 'Voice transcription recording.';
      this.clipboardRecordingStartedAtMs = Date.now();
      desktopVoiceLog('voice clipboard recording armed', {
        requestId: trace.requestId ?? null,
        elapsedMs: Date.now() - requestedAt,
        clientToArmedMs: trace.clientUnixMs ? Date.now() - trace.clientUnixMs : null,
        recorder: this.clipboardRecorder.snapshot(),
      });
      this.touch();
      this.emitChange();
    } catch (error: any) {
      if (this.clipboardSessionId !== sessionId) return this.snapshot();
      this.clipboardMode = 'error';
      this.clipboardError = error?.message ?? String(error);
      this.clipboardMessage = `Voice transcription failed: ${this.clipboardError}`;
      this.resumeDesktopVoiceAfterClipboard();
      this.touch();
      this.emitChange();
    }
    return this.snapshot();
  }

  cancelClipboardRecording(message = 'Voice transcription cancelled.'): DesktopVoiceStatus {
    this.clipboardSessionId += 1;
    this.clipboardRecordingStartedAtMs = 0;
    this.clipboardRecordingRequestId = null;
    this.clipboardStartSuppressedUntil = Date.now() + 800;
    if (this.clipboardMode !== 'recording') return this.snapshot();
    desktopVoiceLog('voice clipboard recording cancelled', {
      recorder: this.clipboardRecorder.snapshot(),
    });
    this.clipboardRecorder.cancel();
    this.clipboardMode = 'idle';
    this.clipboardMessage = message;
    this.clipboardError = null;
    this.resumeDesktopVoiceAfterClipboard();
    this.touch();
    this.emitChange();
    return this.snapshot();
  }

  private handleAudio(chunk: Buffer): void {
    const listening =
      this.mode !== 'off' &&
      this.mode !== 'error' &&
      this.mode !== 'recording' &&
      this.mode !== 'transcribing' &&
      this.clipboardMode !== 'recording' &&
      this.clipboardMode !== 'transcribing';
    if (listening) {
      this.recognizer.write(chunk);
      this.promptPreRollBuffer.push(chunk);
    }
    if (this.mode === 'recording') {
      if (this.promptCaptureTarget === 'assistant' && (this.realtimeSession || this.realtimeStarting)) {
        if (this.realtimeSession) {
          void Promise.resolve(this.realtimeSession.appendPcm(chunk)).catch((error) => {
            desktopVoiceWarn('realtime assistant audio append failed', { error: error?.message ?? String(error) });
          });
        } else {
          this.promptChunks.push(Buffer.from(chunk));
        }
        return;
      }
      this.promptChunks.push(chunk);
      this.enqueuePromptSegments(this.promptSegmenter.append(chunk));
      if (this.promptSegmenter.hasOpenSpeech) this.emitChange();
    }
  }

  private handleRecognizedText(text: string, _final: boolean): void {
    if (this.mode === 'off' || this.mode === 'error') return;
    this.touch();
    this.emitChange();
    if (this.mode === 'recording' || this.mode === 'transcribing') {
      desktopVoiceLog('recognizer command ignored while recording', { text, mode: this.mode });
      return;
    }

    const approvalUpdate = this.approvalRecognizer.accept(text, Date.now());
    this.handleApprovalUpdate(approvalUpdate);
    if (this.approvalRecognizer.isCollecting) {
      this.scheduleApprovalFinalize();
      return;
    }
    if (approvalUpdate.type !== 'none') {
      return;
    }
    if (this.mode === 'sleeping') return;

    const command = stripCommands(text);
    if (
      Date.now() < this.promptCommandSuppressedUntil &&
      (command.status || command.wake || command.patch || command.clipboard)
    ) {
      return;
    }
    if (command.lock && this.mode === 'awake' && this.shouldAcceptCommand('lock:phrase', 1800)) {
      this.enterSleepingMode();
      return;
    }
    if (command.status && this.mode === 'awake' && this.shouldAcceptCommand('status', 1000)) {
      this.message = 'Awake: status OK.';
      this.touch();
      this.emitChange();
      this.emitLocalCue('status');
      return;
    }
    if (command.wake && this.mode === 'awake' && this.shouldAcceptCommand('wake', 1500)) {
      void this.startPromptRecording('assistant');
      return;
    }
    if (command.patch && this.mode === 'awake' && this.shouldAcceptCommand('patch', 1500)) {
      void this.startPromptRecording('patch');
      return;
    }
    if (command.clipboard && this.mode === 'awake' && this.shouldAcceptCommand('clipboard', 1500)) {
      void this.startPromptRecording('clipboard');
      return;
    }
  }

  private scheduleApprovalFinalize(): void {
    if (this.approvalFinalizeTimer) clearTimeout(this.approvalFinalizeTimer);
    this.approvalFinalizeTimer = setTimeout(() => {
      this.approvalFinalizeTimer = null;
      this.handleApprovalUpdate(this.approvalRecognizer.flush(Date.now()));
      if (this.approvalRecognizer.isCollecting && this.mode !== 'off' && this.mode !== 'error') this.scheduleApprovalFinalize();
    }, this.approvalSettings.finalizeCheckIntervalMs);
    this.approvalFinalizeTimer.unref?.();
  }

  private resetApprovalCollection(): void {
    if (this.approvalFinalizeTimer) {
      clearTimeout(this.approvalFinalizeTimer);
      this.approvalFinalizeTimer = null;
    }
    this.approvalRecognizer.reset();
  }

  private handleApprovalUpdate(update: ApprovalCodeUpdate): void {
    if (update.type === 'none') return;
    if (update.type === 'collecting') {
      if (update.partialCode) {
        this.message = this.mode === 'sleeping' ? `Unlock: ${update.partialCode}` : `Approval: ${update.partialCode}`;
      } else {
        this.message = this.mode === 'sleeping' ? 'Unlock code...' : 'Approval code...';
      }
      this.touch();
      this.emitChange();
      return;
    }
    if (update.type === 'cancelled') {
      this.message = 'Approval cancelled.';
      this.touch();
      this.emitChange();
      return;
    }
    this.handleApprovalCode(update.code);
  }

  private handleApprovalCode(code: string): void {
    if (!this.shouldAcceptCommand(`approval:${code}`, 1800)) return;
    this.lastApprovalCode = code;
    if (this.mode === 'sleeping') {
      if (code === this.approvalSettings.unlockCode) {
        this.mode = 'awake';
        this.message = 'Awake: waiting for hey Sebastian.';
        this.emitLocalCue('unlock');
      } else if (code === this.approvalSettings.lockedOffCode) {
        this.emitLocalCue('sleeping_off');
        this.stop('Desktop voice is off.');
        return;
      } else {
        this.message = 'Sleep: code ignored.';
      }
      this.touch();
      this.emitChange();
      return;
    }
    if (code === this.approvalSettings.lockedOffCode) {
      this.emitLocalCue('sleeping_off');
      this.stop('Desktop voice is off.');
      return;
    }
    this.message = `Approval code detected: ${code}`;
    this.emitLocalCue('status');
    this.touch();
    this.emitChange();
  }

  private enterSleepingMode(): void {
    void this.cancelRealtimeSession();
    this.mode = 'sleeping';
    this.message = this.sleepingMessage();
    this.promptChunks = [];
    this.promptSegments = [];
    this.promptPreRollBuffer.clear();
    this.resetApprovalCollection();
    this.resetPromptTranscription();
    this.promptCaptureTarget = null;
    this.emitLocalCue('sleep');
    this.touch();
    this.emitChange();
  }

  private sleepingMessage(): string {
    return `Sleep: say ${this.approvalSettings.triggerPhrase} ${formatDigitsForSpeech(this.approvalSettings.unlockCode)} to wake, or ${formatDigitsForSpeech(this.approvalSettings.lockedOffCode)} to turn off.`;
  }

  private async startPromptRecording(target: DesktopVoiceCaptureTarget): Promise<void> {
    if (target === 'assistant' && this.realtimeAssistantEnabled && this.realtimeWebRtcAvailable()) {
      await this.startRealtimeWebRtcAssistantRecording();
      return;
    }
    if (target === 'assistant' && this.opts.startRealtimeAssistant && this.realtimeAssistantEnabled) {
      await this.startRealtimeAssistantRecording();
      return;
    }
    if (target === 'patch') {
      try {
        await this.opts.startChatPatch?.();
      } catch (error: any) {
        this.message = `Patch-in failed: ${error?.message ?? String(error)}`;
        this.touch();
        this.emitChange();
        return;
      }
    }
    this.mode = 'recording';
    this.message =
      target === 'patch'
        ? 'Awake: patching into current drone chat.'
        : target === 'clipboard'
          ? 'Awake: recording clipboard transcription.'
        : 'Awake: recording assistant voice prompt.';
    this.promptChunks = [];
    this.seedPromptRecordingFromPreRoll();
    this.resetPromptTranscription();
    this.promptCaptureTarget = target;
    this.emitLocalCue('wake');
    this.touch();
    this.emitChange();
  }

  private realtimeProvider(): VoiceRealtimeProvider {
    return this.opts.realtimeProvider?.() === 'native' ? 'native' : 'openai';
  }

  private realtimeWebRtcAvailable(): boolean {
    const available = this.opts.realtimeWebRtcAvailable;
    return typeof available === 'function' ? available() : available === true;
  }

  private async startRealtimeAssistantRecording(): Promise<void> {
    const startRealtimeAssistant = this.opts.startRealtimeAssistant;
    if (!startRealtimeAssistant || this.realtimeSession || this.realtimeStarting) return;
    this.realtimeTransport = 'websocket';
    this.mode = 'recording';
    this.message = 'Awake: starting realtime assistant.';
    this.promptChunks = [];
    this.promptChunks.push(...this.promptPreRollBuffer.drain());
    this.resetPromptTranscription();
    this.promptCaptureTarget = 'assistant';
    this.realtimeStarting = true;
    this.emitLocalCue('wake');
    this.touch();
    this.emitChange();

    try {
      const session = await startRealtimeAssistant(this.createRealtimeAssistantCallbacks());
      if (!this.realtimeStarting || this.mode !== 'recording' || this.promptCaptureTarget !== 'assistant') {
        await session.cancel();
        return;
      }
      this.realtimeSession = session;
      this.realtimeStarting = false;
      const buffered = this.promptChunks;
      this.promptChunks = [];
      for (const chunk of buffered) {
        await Promise.resolve(session.appendPcm(chunk));
      }
      this.message = 'Awake: realtime assistant is listening.';
      this.touch();
      this.emitChange();
    } catch (error: any) {
      this.realtimeStarting = false;
      this.realtimeTransport = null;
      this.realtimeSession = null;
      this.promptChunks = [];
      this.promptCaptureTarget = null;
      this.mode = 'awake';
      this.message = `Realtime assistant failed: ${error?.message ?? String(error)}`;
      desktopVoiceWarn('realtime assistant start failed', { error: error?.message ?? String(error) });
      this.suppressPromptCommandsBriefly(REALTIME_ASSISTANT_RETRY_SUPPRESSION_MS);
      this.touch();
      this.emitChange();
    }
  }

  private async startRealtimeWebRtcAssistantRecording(): Promise<void> {
    if (this.realtimeSession || this.realtimeStarting) return;
    this.realtimeTransport = 'webrtc';
    this.realtimeSession = {
      appendPcm: () => {},
      stop: async () => {},
      cancel: async () => {},
    };
    this.mode = 'recording';
    this.message = 'Awake: starting realtime assistant.';
    this.promptChunks = [];
    this.promptPreRollBuffer.drain();
    this.resetPromptTranscription();
    this.promptCaptureTarget = 'assistant';
    this.realtimeWebRtcBrowserSessionId = crypto.randomUUID();
    this.emitLocalCue('wake');
    desktopVoiceLog('realtime assistant WebRTC browser setup requested', {
      timeoutMs: this.opts.realtimeWebRtcStartTimeoutMs ?? realtimeWebRtcStartTimeoutMs(),
      sessionId: this.realtimeWebRtcBrowserSessionId,
    });
    this.emitDesktopVoiceEvent({
      type: 'desktop_voice_webrtc_start',
      sessionId: this.realtimeWebRtcBrowserSessionId,
    } satisfies DesktopVoiceEvent);
    this.startRealtimeWebRtcStartupTimer();
    this.touch();
    this.emitChange();
  }

  private startRealtimeWebRtcStartupTimer(): void {
    this.clearRealtimeWebRtcStartupTimer();
    const timeoutMs = this.opts.realtimeWebRtcStartTimeoutMs ?? realtimeWebRtcStartTimeoutMs();
    this.realtimeWebRtcStartTimer = setTimeout(() => {
      this.realtimeWebRtcStartTimer = null;
      void this.handleRealtimeWebRtcStartupTimeout();
    }, timeoutMs);
    this.realtimeWebRtcStartTimer.unref?.();
  }

  private clearRealtimeWebRtcStartupTimer(): void {
    if (!this.realtimeWebRtcStartTimer) return;
    clearTimeout(this.realtimeWebRtcStartTimer);
    this.realtimeWebRtcStartTimer = null;
  }

  private async handleRealtimeWebRtcStartupTimeout(): Promise<void> {
    if (this.realtimeTransport !== 'webrtc' || this.mode !== 'recording' || this.promptCaptureTarget !== 'assistant') return;
    desktopVoiceWarn('realtime assistant WebRTC browser setup timed out');
    await this.cancelRealtimeSession();
    this.promptChunks = [];
    this.resetPromptTranscription();
    this.promptCaptureTarget = null;
    this.realtimeWebRtcBrowserSessionId = null;
    this.mode = 'awake';
    this.message = 'Awake: realtime assistant WebRTC setup timed out.';
    this.suppressPromptCommandsBriefly(REALTIME_ASSISTANT_RETRY_SUPPRESSION_MS);
    this.touch();
    this.emitChange();
  }

  private handleRealtimeUserSpeechStarted(): void {
    this.emitDesktopVoiceEvent({ type: 'desktop_voice_stop_audio' } satisfies DesktopVoiceEvent);
    if (this.mode === 'recording' && this.promptCaptureTarget === 'assistant') {
      this.message = 'Awake: realtime assistant is listening.';
      this.touch();
      this.emitChange();
    }
  }

  private async handleRealtimeUserTranscript(textRaw: string): Promise<void> {
    const text = normalizeTranscriptWhitespace(textRaw);
    if (!hasTranscriptContent(text)) return;
    const command = stripCommands(text);
    if (this.realtimeAssistantEnabled && this.mode === 'recording' && this.promptCaptureTarget === 'assistant' && command.sleep) {
      await this.stopRealtimeRecordingFromTranscript();
      return;
    }
    this.promptTranscriptText = this.promptTranscriptText ? `${this.promptTranscriptText}\n${text}` : text;
    this.promptTranscriptUpdatedAt = new Date().toISOString();
    this.emitDesktopVoiceEvent({ type: 'desktop_voice_transcript_segment', text } satisfies DesktopVoiceEvent);
    this.touch();
    this.emitChange();
    if (this.realtimeAssistantEnabled) return;
    try {
      await this.opts.submitAssistantPrompt(text);
    } catch (error: any) {
      desktopVoiceWarn('realtime assistant transcript submit failed', { error: error?.message ?? String(error) });
      this.message = `Realtime transcript submit failed: ${error?.message ?? String(error)}`;
      this.touch();
      this.emitChange();
    }
  }

  private async stopRealtimeRecordingFromTranscript(): Promise<void> {
    await this.cancelRealtimeSession();
    this.promptChunks = [];
    this.promptSegments = [];
    this.promptSegmenter.reset();
    this.promptTranscribing = false;
    this.promptTranscriptText = '';
    this.promptCaptureTarget = null;
    this.mode = 'awake';
    this.message = 'Awake: realtime assistant stopped.';
    this.suppressPromptCommandsBriefly();
    this.touch();
    this.emitChange();
  }

  private handleRealtimeAssistantTranscript(textRaw: string): void {
    const text = normalizeTranscriptWhitespace(textRaw);
    if (!hasTranscriptContent(text)) return;
    this.message = 'Awake: realtime assistant responded.';
    this.touch();
    this.emitChange();
  }

  private handleRealtimeAssistantAudio(audio: { wav: Buffer; text: string }): void {
    if (!audio.wav || audio.wav.byteLength <= 0) return;
    this.emitDesktopVoiceEvent({
      type: 'desktop_voice_speak_audio',
      text: normalizeTranscriptWhitespace(audio.text),
      contentType: 'audio/wav',
      audioBase64: audio.wav.toString('base64'),
    } satisfies DesktopVoiceEvent);
  }

  private handleRealtimeStatus(messageRaw: string): void {
    const message = normalizeTranscriptWhitespace(messageRaw);
    if (!message || this.mode !== 'recording' || this.promptCaptureTarget !== 'assistant') return;
    if (this.realtimeTransport === 'webrtc') this.clearRealtimeWebRtcStartupTimer();
    this.message = `Awake: ${message.charAt(0).toLowerCase()}${message.slice(1)}`;
    this.touch();
    this.emitChange();
  }

  private handleRealtimeError(messageRaw: string): void {
    const message = normalizeTranscriptWhitespace(messageRaw) || 'OpenAI Realtime failed.';
    this.clearRealtimeWebRtcStartupTimer();
    if (this.realtimeTransport === 'webrtc') this.emitDesktopVoiceEvent({ type: 'desktop_voice_webrtc_stop' } satisfies DesktopVoiceEvent);
    this.realtimeSession = null;
    this.realtimeStarting = false;
    this.realtimeTransport = null;
    this.realtimeWebRtcBrowserSessionId = null;
    this.promptChunks = [];
    this.promptCaptureTarget = null;
    this.mode = 'awake';
    this.message = `Realtime assistant failed: ${message}`;
    desktopVoiceWarn('realtime assistant error', { error: message });
    this.suppressPromptCommandsBriefly(REALTIME_ASSISTANT_RETRY_SUPPRESSION_MS);
    this.touch();
    this.emitChange();
  }

  private handleRealtimeClosed(): void {
    this.clearRealtimeWebRtcStartupTimer();
    if (this.realtimeTransport === 'webrtc') this.emitDesktopVoiceEvent({ type: 'desktop_voice_webrtc_stop' } satisfies DesktopVoiceEvent);
    this.realtimeSession = null;
    this.realtimeStarting = false;
    this.realtimeTransport = null;
    this.realtimeWebRtcBrowserSessionId = null;
    this.promptChunks = [];
    if (this.mode === 'recording' && this.promptCaptureTarget === 'assistant') {
      desktopVoiceWarn('realtime assistant closed while recording');
      this.mode = 'awake';
      this.message = 'Awake: realtime assistant ended.';
      this.promptCaptureTarget = null;
      this.suppressPromptCommandsBriefly(REALTIME_ASSISTANT_RETRY_SUPPRESSION_MS);
      this.touch();
      this.emitChange();
    }
  }

  private resetPromptTranscription(): void {
    this.promptSegmenter.reset();
    this.promptSegments = [];
    this.promptTranscribing = false;
    this.promptTranscriptText = '';
    this.promptTranscriptError = null;
    this.promptTranscriptUpdatedAt = null;
  }

  private enqueuePromptSegments(segments: PromptSpeechSegment[]): void {
    if (segments.length === 0) return;
    for (const segment of segments) {
      this.promptSegments.push(segment);
      desktopVoiceLog('queued prompt transcript segment', {
        sequence: segment.sequence,
        reason: segment.reason,
        audioMs: segment.audioMs,
        speechMs: segment.speechMs,
        trailingSilenceMs: segment.trailingSilenceMs,
      });
    }
    this.processPromptTranscriptQueue();
  }

  private processPromptTranscriptQueue(): void {
    if (this.promptTranscribing || this.promptSegments.length === 0 || this.mode !== 'recording') return;
    const segment = this.promptSegments.shift()!;
    this.promptTranscribing = true;
    this.message = 'Awake: transcribing speech segment.';
    this.touch();
    this.emitChange();
    void this.transcribePromptSegment(segment);
  }

  private async transcribePromptSegment(segment: PromptSpeechSegment): Promise<void> {
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(segment.pcm));
      const command = stripCommands(result.text);
      const text = promptTextFromCommand(result.text, command);
      const ignoreEmptyPatchSleep =
        this.promptCaptureTarget === 'patch' &&
        !hasTranscriptContent(this.promptTranscriptText) &&
        !hasTranscriptContent(text);
      const sleep = command.sleep && !ignoreEmptyPatchSleep;
      const abort = command.abort;
      desktopVoiceLog('prompt transcript segment', {
        sequence: segment.sequence,
        model: result.model,
        sleep,
        abort,
        sleepIgnored: ignoreEmptyPatchSleep && command.sleep,
        rawText: result.text,
        text,
      });
      if (abort && this.mode === 'recording' && this.shouldAcceptCommand('abort:transcript', 1200)) {
        this.promptTranscriptError = null;
        this.promptTranscribing = false;
        await this.abortPromptRecordingFromTranscript();
        return;
      }
      if (command.lock && !hasTranscriptContent(text) && this.mode === 'recording' && this.shouldAcceptCommand('lock:phrase', 1800)) {
        this.promptTranscriptError = null;
        this.promptTranscribing = false;
        this.enterSleepingMode();
        return;
      }
      if (hasTranscriptContent(text)) {
        this.promptTranscriptText = this.promptTranscriptText ? `${this.promptTranscriptText}\n${text}` : text;
        this.promptTranscriptUpdatedAt = new Date().toISOString();
        if (this.promptCaptureTarget === 'assistant') {
          this.emitDesktopVoiceEvent({ type: 'desktop_voice_transcript_segment', text } satisfies DesktopVoiceEvent);
        }
      }
      this.promptTranscriptError = null;
      this.promptTranscribing = false;
      if (sleep && this.mode === 'recording' && this.shouldAcceptCommand('sleep:transcript', 1200)) {
        await this.finishPromptRecordingFromTranscript();
        return;
      }
      if (this.mode === 'recording') {
        this.message =
          this.promptCaptureTarget === 'patch'
            ? 'Awake: patching into current drone chat.'
            : this.promptCaptureTarget === 'clipboard'
              ? 'Awake: recording clipboard transcription.'
              : 'Awake: recording assistant voice prompt.';
        this.touch();
        this.emitChange();
        this.processPromptTranscriptQueue();
      }
    } catch (error: any) {
      this.promptTranscribing = false;
      this.promptTranscriptError = error?.message ?? String(error);
      this.message = `Assistant voice transcription failed: ${this.promptTranscriptError}`;
      this.touch();
      this.emitChange();
      this.processPromptTranscriptQueue();
    }
  }

  private async abortPromptRecordingFromTranscript(): Promise<void> {
    const target = this.promptCaptureTarget;
    const cancelledRealtime = await this.cancelRealtimeSession();
    this.promptChunks = [];
    this.promptSegments = [];
    this.promptSegmenter.reset();
    this.mode = 'awake';
    this.message =
      target === 'patch'
        ? 'Awake: patch-in cancelled.'
        : target === 'clipboard'
          ? 'Awake: voice transcription cancelled.'
          : 'Awake: assistant voice prompt cancelled.';
    this.promptTranscribing = false;
    this.promptTranscriptText = '';
    this.promptCaptureTarget = null;
    this.suppressPromptCommandsBriefly();
    if (cancelledRealtime) {
      this.touch();
      this.emitChange();
      return;
    }
    if (target === 'patch') {
      void this.opts.abortChatPatch?.().catch((error) => {
        desktopVoiceWarn('patch abort callback failed', { error: error?.message ?? String(error) });
      });
    }
    this.touch();
    this.emitChange();
  }

  private async cancelRealtimeSession(): Promise<boolean> {
    this.clearRealtimeWebRtcStartupTimer();
    const session = this.realtimeSession;
    const wasRealtime = Boolean(session || this.realtimeStarting);
    const transport = this.realtimeTransport;
    this.realtimeSession = null;
    this.realtimeStarting = false;
    this.realtimeTransport = null;
    this.realtimeWebRtcBrowserSessionId = null;
    if (transport === 'webrtc') {
      this.emitDesktopVoiceEvent({ type: 'desktop_voice_webrtc_stop' } satisfies DesktopVoiceEvent);
      try {
        await this.opts.cancelRealtimeWebRtcAssistant?.();
      } catch (error: any) {
        desktopVoiceWarn('realtime assistant WebRTC cancel failed', { error: error?.message ?? String(error) });
      }
    }
    if (session) {
      try {
        await session.cancel();
      } catch (error: any) {
        desktopVoiceWarn('realtime assistant cancel failed', { error: error?.message ?? String(error) });
      }
    }
    return wasRealtime;
  }

  private async finishPromptRecordingFromTranscript(): Promise<void> {
    const target = this.promptCaptureTarget ?? 'assistant';
    const pcm = Buffer.concat(this.promptChunks);
    const fallbackText = this.promptTranscriptText.trim();
    this.promptChunks = [];
    this.promptSegments = [];
    this.promptSegmenter.reset();
    const useFullRecording = this.voiceTranscriptionFinalMode === 'full-recording';
    if (useFullRecording) {
      this.mode = 'transcribing';
      this.message =
        target === 'patch'
          ? 'Awake: transcribing final patch recording.'
          : target === 'clipboard'
            ? 'Awake: transcribing final voice recording.'
            : 'Awake: transcribing final assistant recording.';
    }
    this.promptTranscribing = false;
    this.suppressPromptCommandsBriefly();
    if (useFullRecording) {
      this.touch();
      this.emitChange();
    }

    let text = '';
    try {
      text = useFullRecording ? await this.transcribeFinalPromptRecording(pcm, fallbackText) : fallbackText;
      this.mode = 'awake';
      this.message = text
        ? target === 'patch'
          ? 'Awake: sending patch to current drone chat.'
          : target === 'clipboard'
            ? 'Awake: sending voice transcription to clipboard.'
            : 'Awake: sending assistant voice prompt.'
        : target === 'patch'
          ? 'Awake: no patch text detected.'
          : target === 'clipboard'
            ? 'Awake: no voice transcription detected.'
            : 'Awake: no assistant prompt detected.';
      this.touch();
      this.emitChange();

      if (!text) {
        if (target === 'patch') {
          void this.opts.abortChatPatch?.().catch((error) => {
            desktopVoiceWarn('empty patch callback failed', { error: error?.message ?? String(error) });
          });
        }
        this.promptCaptureTarget = null;
        return;
      }

      if (target === 'patch') {
        await this.opts.submitChatPatch?.(text);
      } else if (target === 'clipboard') {
        this.emitDesktopVoiceEvent({ type: 'desktop_voice_clipboard_result', text } satisfies DesktopVoiceEvent);
      } else {
        await this.opts.submitAssistantPrompt(text);
      }
      if (this.mode === 'awake') {
        this.message =
          target === 'patch'
            ? 'Awake: sent patch to current drone chat.'
            : target === 'clipboard'
              ? 'Awake: voice transcription copied.'
              : 'Awake: sent assistant voice prompt.';
      }
    } catch (error: any) {
      if (this.mode === 'awake') {
        this.message =
          target === 'patch'
            ? `Patch-in failed: ${error?.message ?? String(error)}`
            : target === 'clipboard'
              ? `Voice transcription failed: ${error?.message ?? String(error)}`
              : `Assistant voice prompt failed: ${error?.message ?? String(error)}`;
      } else {
        this.mode = 'awake';
        this.message =
          target === 'patch'
            ? `Patch-in failed: ${error?.message ?? String(error)}`
            : target === 'clipboard'
              ? `Voice transcription failed: ${error?.message ?? String(error)}`
              : `Assistant voice prompt failed: ${error?.message ?? String(error)}`;
      }
    }
    this.promptCaptureTarget = null;
    this.promptTranscribing = false;
    this.touch();
    this.emitChange();
  }

  private async transcribeFinalPromptRecording(pcm: Buffer, fallbackText: string): Promise<string> {
    if (pcm.byteLength <= 0) return fallbackText;
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(pcm));
      const text = stripCommands(result.text).text.trim();
      return hasTranscriptContent(text) ? text : fallbackText;
    } catch (error: any) {
      desktopVoiceWarn('final prompt transcription failed', { error: error?.message ?? String(error) });
      if (hasTranscriptContent(fallbackText)) return fallbackText;
      throw error;
    }
  }

  private async finishAssistantPromptRecordingFromTranscript(): Promise<void> {
    this.promptCaptureTarget = 'assistant';
    await this.finishPromptRecordingFromTranscript();
  }

  private shouldAcceptCommand(key: string, cooldownMs: number): boolean {
    const now = Date.now();
    const last = this.lastCommandAt.get(key) ?? 0;
    if (now - last < cooldownMs) return false;
    this.lastCommandAt.set(key, now);
    return true;
  }

  private async finishAssistantPromptRecording(): Promise<void> {
    const pcm = Buffer.concat(this.promptChunks);
    this.promptChunks = [];
    this.mode = 'transcribing';
    this.message = 'Transcribing assistant voice prompt.';
    this.touch();
    this.emitChange();
    try {
      const result = await this.opts.transcribeWav(pcm16leToWav(pcm));
      const command = stripCommands(result.text);
      const text = promptTextFromCommand(result.text, command);
      if (command.lock && !hasTranscriptContent(text) && this.shouldAcceptCommand('lock:phrase', 1800)) {
        this.enterSleepingMode();
        return;
      }
      if (text) await this.opts.submitAssistantPrompt(text);
      this.mode = 'awake';
      this.message = text ? 'Awake: sent assistant voice prompt.' : 'Awake: no assistant prompt detected.';
      this.suppressPromptCommandsBriefly();
    } catch (error: any) {
      this.mode = 'awake';
      this.message = `Assistant voice transcription failed: ${error?.message ?? String(error)}`;
      this.suppressPromptCommandsBriefly();
    }
    this.touch();
    this.emitChange();
  }

  private suppressPromptCommandsBriefly(msRaw?: number): void {
    const ms = msRaw == null ? this.approvalSettings.postPromptCommandSuppressionMs : msRaw;
    this.promptCommandSuppressedUntil = Date.now() + Math.max(0, ms);
  }

  private async stopClipboardRecording(): Promise<string | null> {
    const sessionId = this.clipboardSessionId;
    const stopRequestedAtMs = Date.now();
    this.clipboardMode = 'transcribing';
    this.clipboardMessage = 'Transcribing voice recording.';
    this.clipboardError = null;
    this.touch();
    this.emitChange();
    try {
      const wav = await this.clipboardRecorder.stop(clipboardTailPadMs());
      if (this.clipboardSessionId !== sessionId) return null;
      desktopVoiceLog('voice clipboard recording wav ready', {
        requestId: this.clipboardRecordingRequestId,
        stopElapsedMs: Date.now() - stopRequestedAtMs,
        armedToStopMs: this.clipboardRecordingStartedAtMs ? stopRequestedAtMs - this.clipboardRecordingStartedAtMs : null,
        bytes: wav.byteLength,
        wavDurationMs: wavDurationMs(wav),
      });
      const result = await this.opts.transcribeWav(wav);
      const text = result.text.trim();
      if (!text) throw new Error('The transcription was empty.');
      this.clipboardMode = 'idle';
      this.clipboardMessage = `Transcribed ${text.length.toLocaleString()} characters.`;
      this.clipboardRecordingStartedAtMs = 0;
      this.clipboardRecordingRequestId = null;
      this.emitDesktopVoiceEvent({ type: 'desktop_voice_clipboard_result', text } satisfies DesktopVoiceEvent);
      return text;
    } catch (error: any) {
      if (this.clipboardSessionId !== sessionId) return null;
      this.clipboardMode = 'error';
      this.clipboardError = error?.message ?? String(error);
      this.clipboardMessage = `Voice transcription failed: ${this.clipboardError}`;
      desktopVoiceWarn('voice clipboard recording failed', {
        requestId: this.clipboardRecordingRequestId,
        error: this.clipboardError,
      });
      this.clipboardRecordingStartedAtMs = 0;
      this.clipboardRecordingRequestId = null;
      return null;
    } finally {
      this.resumeDesktopVoiceAfterClipboard();
      this.touch();
      this.emitChange();
    }
  }

  private suspendDesktopVoiceForClipboard(): void {
    if (this.desktopVoiceSuspensionReason) return;
    if (this.mode === 'off' || this.mode === 'error' || this.mode === 'recording' || this.mode === 'transcribing') return;
    this.desktopStartSessionId += 1;
    this.desktopVoiceSuspensionReason = 'clipboard';
    this.desktopVoiceSuspendedMode = this.mode;
    this.desktopVoiceSuspendedMessage = this.message;
    this.recognizer.stop();
    this.capture.stop();
    this.resetApprovalCollection();
    this.message = 'Desktop voice is suspended during voice transcription.';
    this.touch();
    this.emitChange();
  }

  private resumeDesktopVoiceAfterClipboard(): void {
    if (this.desktopVoiceSuspensionReason !== 'clipboard') return;
    const previousMode = this.desktopVoiceSuspendedMode;
    const previousMessage = this.desktopVoiceSuspendedMessage;
    this.clearDesktopVoiceSuspension();
    if (!previousMode || this.mode === 'off' || this.mode === 'error' || this.mode === 'recording' || this.mode === 'transcribing') return;
    this.mode = previousMode;
    this.message = previousMessage ?? this.defaultMessageForMode(previousMode);
    this.desktopStartSessionId += 1;
    if (previousMode === 'awake' || previousMode === 'sleeping') {
      this.recognizer.start();
      this.capture.start();
    }
    this.touch();
    this.emitChange();
  }

  private clearDesktopVoiceSuspension(): void {
    this.desktopVoiceSuspensionReason = null;
    this.desktopVoiceSuspendedMode = null;
    this.desktopVoiceSuspendedMessage = null;
  }

  private defaultMessageForMode(mode: DesktopVoiceMode): string {
    if (mode === 'sleeping') return this.sleepingMessage();
    if (mode === 'awake') return 'Awake: waiting for hey Sebastian.';
    if (mode === 'off') return 'Desktop voice is off.';
    if (mode === 'error') return 'Desktop voice failed.';
    if (mode === 'recording') return 'Awake: recording assistant voice prompt.';
    if (mode === 'transcribing') return 'Transcribing assistant voice prompt.';
    return this.message;
  }

  private seedPromptRecordingFromPreRoll(): void {
    const preRollChunks = this.promptPreRollBuffer.drain();
    if (preRollChunks.length === 0) return;
    const preRollPcm = Buffer.concat(preRollChunks);
    if (preRollPcm.byteLength <= 0) return;
    this.promptChunks.push(preRollPcm);
    this.enqueuePromptSegments(this.promptSegmenter.append(preRollPcm));
    desktopVoiceLog('seeded prompt recording from pre-roll', {
      bytes: preRollPcm.byteLength,
      preRollMs: promptPreRollMs(),
    });
  }

  private emitLocalCue(cue: DesktopVoiceCue): void {
    this.emitDesktopVoiceEvent({ type: 'desktop_voice_local_cue', cue } satisfies DesktopVoiceEvent);
  }

  private bufferEventForReplay(event: Exclude<DesktopVoiceEvent, { type: 'desktop_voice_status' }>): void {
    this.eventReplayBuffer.push(event);
    const limit = desktopVoiceEventReplayLimit();
    while (this.eventReplayBuffer.length > limit) {
      this.eventReplayBuffer.shift();
    }
  }

  private emitDesktopVoiceEvent(event: DesktopVoiceEvent): void {
    if (
      event.type !== 'desktop_voice_status' &&
      event.type !== 'desktop_voice_local_cue' &&
      event.type !== 'desktop_voice_speak' &&
      event.type !== 'desktop_voice_speak_audio' &&
      event.type !== 'desktop_voice_stop_audio' &&
      event.type !== 'desktop_voice_webrtc_start' &&
      event.type !== 'desktop_voice_webrtc_stop'
    ) {
      this.bufferEventForReplay(event);
    }
    this.events.emit('event', event);
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }

  private emitChange(): void {
    this.emitDesktopVoiceEvent({ type: 'desktop_voice_status', status: this.snapshot() } satisfies DesktopVoiceEvent);
  }
}
