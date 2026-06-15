import { hasGroqSpeechRuntime, transcribePcm16, type RuntimeResult } from './assistant-runtime.js';

export type TerminalCommandType = 'finish' | 'sleep' | 'abort';

export type TerminalCommand = {
  type: TerminalCommandType;
  phrase: string;
  detectedAt: string;
  transcriptText: string;
};

export type TerminalDetection = {
  type: TerminalCommandType;
  phrase: string;
  detectedAt: string;
  partialTranscriptText: string;
  segmentSequence: number;
  segmentReason: QueuedSegment['reason'];
  finalTranscriptionMode: StreamingTranscriptionConfig['finalTranscriptionMode'];
};

export type StreamingTranscriptionConfig = {
  intervalMs: number;
  minSpeechMs: number;
  minSubmitMs: number;
  silenceMs: number;
  shortUtteranceSilenceMs: number;
  maxSegmentMs: number;
  overlapMs: number;
  silenceThreshold: number;
  sampleRateHz: number;
  channels: number;
  ignoreEmptyFinishCommands: boolean;
  detectTerminalCommands: boolean;
  finalTranscriptionMode: 'full-recording' | 'segments';
  maxSessionAudioBytes: number;
};

export type StreamingTranscriptionHooks = {
  transcribe?: (pcm: Uint8Array) => Promise<RuntimeResult>;
  beforeTranscription?: (pcm: Uint8Array, source: 'segment' | 'final') => void;
  onTranscription?: (result: RuntimeResult, source: 'segment' | 'final') => void;
  onSegment?: (segment: { text: string; audioMs: number; sequence: number; receivedAt: string }) => void;
};

type QueuedSegment = {
  pcm: Uint8Array;
  audioMs: number;
  rawAudioMs: number;
  speechMs: number;
  trailingSilenceMs: number;
  reason: 'silence' | 'short_silence' | 'max_segment' | 'flush';
  queuedAt: string;
  sequence: number;
};

type SpeechSegmenterConfig = Pick<
  StreamingTranscriptionConfig,
  | 'sampleRateHz'
  | 'channels'
  | 'minSpeechMs'
  | 'minSubmitMs'
  | 'silenceMs'
  | 'shortUtteranceSilenceMs'
  | 'maxSegmentMs'
  | 'overlapMs'
  | 'silenceThreshold'
>;

export function buildStreamingTranscriptionConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StreamingTranscriptionConfig {
  return {
    intervalMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_INTERVAL_MS, 500),
    minSpeechMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_MIN_SPEECH_MS, 180),
    minSubmitMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_MIN_SUBMIT_MS, 1_000),
    silenceMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_SILENCE_MS, 650),
    shortUtteranceSilenceMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS, 1_000),
    maxSegmentMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_MAX_SEGMENT_MS, 10_000),
    overlapMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_OVERLAP_MS, 500),
    silenceThreshold: parsePositiveFloat(env.VOICE_STREAM_NEXT_TRANSCRIBE_SILENCE_THRESHOLD, 0.025),
    sampleRateHz: 16_000,
    channels: 1,
    ignoreEmptyFinishCommands: env.VOICE_STREAM_NEXT_IGNORE_EMPTY_FINISH_COMMANDS === '1' || env.VOICE_STREAM_NEXT_IGNORE_EMPTY_SLEEP_COMMANDS === '1',
    detectTerminalCommands: true,
    finalTranscriptionMode: parseFinalTranscriptionMode(env.VOICE_STREAM_NEXT_FINAL_TRANSCRIPTION_MODE),
    maxSessionAudioBytes: parsePositiveInteger(env.VOICE_STREAM_NEXT_MAX_SESSION_AUDIO_BYTES, 80 * 1024 * 1024),
  };
}

export function streamingTranscriptionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT != null || hasGroqSpeechRuntime(env);
}

export class StreamingTranscriptionManager {
  private readonly segmenter: PcmSpeechSegmenter;
  private readonly queue: QueuedSegment[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private inFlight = false;
  private stopped = false;
  private terminalCommandDetected = false;
  private transcriptContext = '';
  private sessionChunks: Uint8Array[] = [];
  private sessionBytes = 0;
  private sessionAudioOverflowed = false;

  constructor(
    private readonly config: StreamingTranscriptionConfig,
    private readonly onCommand: (command: TerminalCommand) => void,
    private readonly onDetection: (detection: TerminalDetection) => void = () => undefined,
    private readonly hooks: StreamingTranscriptionHooks = {},
  ) {
    this.segmenter = new PcmSpeechSegmenter(config);
    this.timer = setInterval(() => {
      void this.processQueue();
    }, config.intervalMs);
    this.timer.unref?.();
  }

  appendPcm(pcm: Uint8Array): void {
    if (this.stopped || this.terminalCommandDetected || pcm.byteLength === 0) return;
    this.rememberSessionAudio(pcm);
    this.enqueueSegments(this.segmenter.append(pcm));
    if (this.queue.length > 0) {
      void this.processQueue();
    }
  }

  flushPending(): void {
    if (this.stopped || this.terminalCommandDetected) return;
    const segment = this.segmenter.flush();
    if (segment) {
      this.enqueueSegments([segment]);
    }
    void this.processQueue();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.inFlight = false;
    this.segmenter.reset();
    this.clearSessionAudio();
    clearInterval(this.timer);
  }

  private async processQueue(): Promise<void> {
    if (this.stopped || this.terminalCommandDetected || this.inFlight || this.queue.length === 0) {
      return;
    }
    const segment = this.queue.shift()!;
    this.inFlight = true;
    try {
      await this.transcribeSegment(segment);
    } finally {
      this.inFlight = false;
      if (!this.terminalCommandDetected) {
        void this.processQueue();
      }
    }
  }

  private async transcribeSegment(segment: QueuedSegment): Promise<void> {
    this.hooks.beforeTranscription?.(segment.pcm, 'segment');
    const result = await (this.hooks.transcribe?.(segment.pcm) ?? transcribePcm16(segment.pcm));
    this.hooks.onTranscription?.(result, 'segment');
    if (this.stopped || this.terminalCommandDetected) return;

    if (!this.config.detectTerminalCommands) {
      const text = normalizeTranscriptWhitespace(result.text);
      if (hasTranscriptContent(text)) {
        this.rememberTranscript(text);
        this.hooks.onSegment?.({
          text,
          audioMs: segment.audioMs,
          sequence: segment.sequence,
          receivedAt: new Date().toISOString(),
        });
      }
      return;
    }

    const commandResult = stripTranscriptCommands(result.text);
    if (commandResult.abortDetected) {
      this.enterTerminalCommandState({ clearContext: true });
      const detectedAt = new Date().toISOString();
      this.onDetection({
        type: 'abort',
        phrase: commandResult.abortPhrase ?? 'okay stop',
        detectedAt,
        partialTranscriptText: '',
        segmentSequence: segment.sequence,
        segmentReason: segment.reason,
        finalTranscriptionMode: this.config.finalTranscriptionMode,
      });
      this.onCommand({
        type: 'abort',
        phrase: commandResult.abortPhrase ?? 'okay stop',
        detectedAt,
        transcriptText: '',
      });
      return;
    }

    const terminalType: Extract<TerminalCommandType, 'finish' | 'sleep'> | null = commandResult.sleepDetected
      ? 'sleep'
      : commandResult.finishDetected
        ? 'finish'
        : null;
    if (terminalType) {
      const fallbackTranscriptText = this.buildFullTranscriptText(commandResult.text);
      if (terminalType === 'finish' && this.config.ignoreEmptyFinishCommands && !hasTranscriptContent(fallbackTranscriptText)) {
        return;
      }
      const detectedAt = new Date().toISOString();
      const sessionPcm = this.config.finalTranscriptionMode === 'full-recording' ? this.takeSessionAudio() : new Uint8Array(0);
      if (this.config.finalTranscriptionMode === 'segments') {
        this.clearSessionAudio();
      }
      this.enterTerminalCommandState({ clearContext: false });
      const phrase = terminalType === 'sleep'
        ? commandResult.sleepPhrase ?? 'go to sleep'
        : commandResult.finishPhrase ?? "that's it";
      this.onDetection({
        type: terminalType,
        phrase,
        detectedAt,
        partialTranscriptText: fallbackTranscriptText,
        segmentSequence: segment.sequence,
        segmentReason: segment.reason,
        finalTranscriptionMode: this.config.finalTranscriptionMode,
      });
      const transcriptText =
        this.config.finalTranscriptionMode === 'full-recording'
          ? await this.transcribeFinalSession(sessionPcm, fallbackTranscriptText)
          : fallbackTranscriptText;
      if (this.stopped) return;
      this.onCommand({
        type: terminalType,
        phrase,
        detectedAt,
        transcriptText,
      });
      return;
    }

    if (hasTranscriptContent(commandResult.text)) {
      this.rememberTranscript(commandResult.text);
      this.hooks.onSegment?.({
        text: commandResult.text,
        audioMs: segment.audioMs,
        sequence: segment.sequence,
        receivedAt: new Date().toISOString(),
      });
    }
  }

  private async transcribeFinalSession(pcm: Uint8Array, fallbackText: string): Promise<string> {
    if (pcm.byteLength === 0) return fallbackText;
    try {
      this.hooks.beforeTranscription?.(pcm, 'final');
      const result = await (this.hooks.transcribe?.(pcm) ?? transcribePcm16(pcm));
      this.hooks.onTranscription?.(result, 'final');
      const cleaned = stripTranscriptCommands(result.text).text;
      return hasTranscriptContent(cleaned) ? cleaned : fallbackText;
    } catch {
      return fallbackText;
    }
  }

  private buildFullTranscriptText(text: string): string {
    return `${this.transcriptContext} ${text}`.trim();
  }

  private rememberTranscript(text: string): void {
    const next = `${this.transcriptContext} ${text}`.trim();
    this.transcriptContext = next.slice(Math.max(0, next.length - 700));
  }

  private rememberSessionAudio(pcm: Uint8Array): void {
    if (this.config.finalTranscriptionMode === 'segments') return;
    if (this.sessionAudioOverflowed) return;
    if (this.sessionBytes + pcm.byteLength > this.config.maxSessionAudioBytes) {
      this.clearSessionAudio();
      this.sessionAudioOverflowed = true;
      return;
    }
    const copy = new Uint8Array(pcm);
    this.sessionChunks.push(copy);
    this.sessionBytes += copy.byteLength;
  }

  private takeSessionAudio(): Uint8Array {
    if (this.sessionBytes === 0) return new Uint8Array(0);
    const output = new Uint8Array(this.sessionBytes);
    let offset = 0;
    for (const chunk of this.sessionChunks) {
      output.set(chunk, offset);
      offset += chunk.byteLength;
    }
    this.clearSessionAudio();
    return output;
  }

  private clearSessionAudio(): void {
    this.sessionChunks = [];
    this.sessionBytes = 0;
    this.sessionAudioOverflowed = false;
  }

  private enterTerminalCommandState(opts: { clearContext: boolean }): void {
    this.terminalCommandDetected = true;
    this.queue.length = 0;
    this.segmenter.reset();
    if (opts.clearContext) this.transcriptContext = '';
  }

  private enqueueSegments(segments: QueuedSegment[]): void {
    for (const segment of segments) {
      this.queue.push(segment);
    }
  }
}

export function stripTranscriptCommands(text: string): {
  text: string;
  wakeDetected: boolean;
  finishDetected: boolean;
  finishPhrase?: string;
  sleepDetected: boolean;
  sleepPhrase?: string;
  abortDetected: boolean;
  abortPhrase?: string;
} {
  let cleaned = text;
  let wakeDetected = false;
  let finishDetected = false;
  let finishPhrase: string | undefined;
  let sleepDetected = false;
  let sleepPhrase: string | undefined;
  let abortDetected = false;
  let abortPhrase: string | undefined;

  cleaned = cleaned.replace(/\b(?:hey|hay)\s+sebasti[ae]n\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\bpatch\s+me\s+in\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\bcan\s+you\s+transcribe\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\btranscribe\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\b(?:that's|thats|that\s+is)\s+it\b[\s,.:;!?-]*/gi, (match) => {
    finishDetected = true;
    finishPhrase = match.trim();
    return ' ';
  });
  cleaned = cleaned.replace(/\bgo\s+to\s+sleep\b[\s,.:;!?-]*/gi, (match) => {
    sleepDetected = true;
    sleepPhrase = match.trim();
    return ' ';
  });
  cleaned = cleaned.replace(/\b(?:okay|ok)[\s,.:;!?-]+stop\b[\s,.:;!?-]*/gi, (match) => {
    abortDetected = true;
    abortPhrase = match.trim();
    return ' ';
  });
  cleaned = cleaned.replace(/\b(?:cancel|abort)(?:\s+(?:that|this|it))?\b[\s,.:;!?-]*/gi, (match) => {
    abortDetected = true;
    abortPhrase = match.trim();
    return ' ';
  });

  return {
    text: normalizeTranscriptWhitespace(cleaned),
    wakeDetected,
    finishDetected,
    finishPhrase,
    sleepDetected,
    sleepPhrase,
    abortDetected,
    abortPhrase,
  };
}

export function hasTranscriptContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

class PcmSpeechSegmenter {
  private currentChunks: Uint8Array[] = [];
  private currentBytes = 0;
  private speechMs = 0;
  private trailingSilenceMs = 0;
  private carryover = new Uint8Array(0);
  private nextSequence = 1;

  constructor(private readonly config: SpeechSegmenterConfig) {}

  reset(): void {
    this.resetCurrent();
    this.carryover = new Uint8Array(0);
  }

  append(pcm: Uint8Array): QueuedSegment[] {
    if (pcm.byteLength === 0) return [];

    const chunk = new Uint8Array(pcm);
    this.currentChunks.push(chunk);
    this.currentBytes += chunk.byteLength;

    const chunkMs = pcmDurationMs(chunk.byteLength, this.config.sampleRateHz, this.config.channels);
    const rms = pcm16leRms(chunk);
    if (rms >= this.config.silenceThreshold) {
      this.speechMs += chunkMs;
      this.trailingSilenceMs = 0;
    } else if (this.speechMs > 0) {
      this.trailingSilenceMs += chunkMs;
    }

    const currentMs = pcmDurationMs(this.currentBytes, this.config.sampleRateHz, this.config.channels);
    if (this.speechMs === 0 && currentMs > Math.max(1_000, this.config.silenceMs)) {
      this.resetCurrent();
      return [];
    }

    if (this.speechMs >= this.config.minSpeechMs && this.trailingSilenceMs >= this.config.silenceMs) {
      return [this.takeSegment('silence')];
    }

    if (this.speechMs > 0 && this.trailingSilenceMs >= Math.max(this.config.silenceMs, this.config.shortUtteranceSilenceMs)) {
      return [this.takeSegment('short_silence')];
    }

    if (this.speechMs >= this.config.minSpeechMs && currentMs >= this.config.maxSegmentMs) {
      return [this.takeSegment('max_segment')];
    }

    return [];
  }

  flush(): QueuedSegment | null {
    if (this.speechMs < this.config.minSpeechMs) {
      this.resetCurrent();
      return null;
    }
    return this.takeSegment('flush');
  }

  private takeSegment(reason: QueuedSegment['reason']): QueuedSegment {
    const segment = concatUint8Arrays(this.currentChunks, this.currentBytes);
    const pcm = this.carryover.byteLength > 0 ? concatUint8Arrays([this.carryover, segment], this.carryover.byteLength + segment.byteLength) : segment;
    const paddedPcm = padPcmToMinDuration(pcm, this.config.minSubmitMs, this.config.sampleRateHz, this.config.channels);
    const audioMs = pcmDurationMs(paddedPcm.byteLength, this.config.sampleRateHz, this.config.channels);
    const rawAudioMs = pcmDurationMs(pcm.byteLength, this.config.sampleRateHz, this.config.channels);
    const overlap = lastPcmMs(segment, this.config.overlapMs, this.config.sampleRateHz, this.config.channels);
    this.carryover = new Uint8Array(overlap);
    const queued: QueuedSegment = {
      pcm: paddedPcm,
      audioMs,
      rawAudioMs,
      speechMs: this.speechMs,
      trailingSilenceMs: this.trailingSilenceMs,
      reason,
      queuedAt: new Date().toISOString(),
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.resetCurrent();
    return queued;
  }

  private resetCurrent(): void {
    this.currentChunks = [];
    this.currentBytes = 0;
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
  }
}

function normalizeTranscriptWhitespace(text: string): string {
  return text
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function pcmDurationMs(bytes: number, sampleRateHz: number, channels: number): number {
  const bytesPerSample = 2;
  return Math.round((bytes / (sampleRateHz * channels * bytesPerSample)) * 1000);
}

function pcm16leRms(pcm: Uint8Array): number {
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount === 0) return 0;
  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const normalized = view.getInt16(offset, true) / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

function concatUint8Arrays(chunks: Uint8Array[], totalBytes: number): Uint8Array {
  const output = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function lastPcmMs(pcm: Uint8Array, ms: number, sampleRateHz: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const byteCount = Math.min(pcm.byteLength, Math.round((sampleRateHz * channels * bytesPerSample * ms) / 1000));
  if (byteCount <= 0) return new Uint8Array(0);
  const evenByteCount = byteCount - (byteCount % 2);
  return pcm.subarray(pcm.byteLength - evenByteCount);
}

function padPcmToMinDuration(pcm: Uint8Array, minMs: number, sampleRateHz: number, channels: number): Uint8Array {
  const bytesPerSample = 2;
  const minBytes = Math.round((sampleRateHz * channels * bytesPerSample * minMs) / 1000);
  if (pcm.byteLength >= minBytes) return pcm;
  const paddingBytes = minBytes - pcm.byteLength;
  const leadingBytes = evenByteCount(Math.floor(paddingBytes / 2));
  const trailingBytes = evenByteCount(paddingBytes - leadingBytes);
  const output = new Uint8Array(leadingBytes + pcm.byteLength + trailingBytes);
  output.set(pcm, leadingBytes);
  return output;
}

function evenByteCount(byteCount: number): number {
  return byteCount - (byteCount % 2);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFinalTranscriptionMode(value: string | undefined): 'full-recording' | 'segments' {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'segments' || normalized === 'chunks' || normalized === 'chunked') return 'segments';
  return 'full-recording';
}
