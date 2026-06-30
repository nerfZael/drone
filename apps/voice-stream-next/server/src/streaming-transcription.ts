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
  source: 'segment' | 'terminal_tail';
  segmentSequence: number | null;
  segmentReason: QueuedSegment['reason'] | 'terminal_tail';
  finalTranscriptionMode: StreamingTranscriptionConfig['finalTranscriptionMode'];
};

export type StreamingTranscriptionConfig = {
  intervalMs: number;
  concurrency: number;
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
  terminalTailDetectionEnabled: boolean;
  terminalTailWindowMs: number;
  terminalTailDelayMs: number;
  terminalTailRetryDelayMs: number;
  terminalTailCooldownMs: number;
};

export type StreamingSegmentMetadata = {
  audioMs: number;
  rawAudioMs: number;
  speechMs: number;
  trailingSilenceMs: number;
  reason: QueuedSegment['reason'];
  queuedAt: string;
  sequence: number;
};

export type StreamingTranscriptionHookContext = {
  source: 'segment' | 'final' | 'terminal_tail';
  segment?: StreamingSegmentMetadata;
  queuedDelayMs?: number;
  elapsedMs?: number;
};

export type StreamingTranscriptionHooks = {
  transcribe?: (pcm: Uint8Array) => Promise<RuntimeResult>;
  onSegmentQueued?: (segment: StreamingSegmentMetadata) => void;
  beforeTranscription?: (pcm: Uint8Array, source: 'segment' | 'final' | 'terminal_tail', context: StreamingTranscriptionHookContext) => void;
  onTranscription?: (result: RuntimeResult, source: 'segment' | 'final' | 'terminal_tail', context: StreamingTranscriptionHookContext) => void;
  onTranscriptionError?: (error: unknown, source: 'segment' | 'final' | 'terminal_tail', context: StreamingTranscriptionHookContext) => void;
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
    concurrency: parsePositiveInteger(env.VOICE_STREAM_NEXT_TRANSCRIBE_CONCURRENCY, 3),
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
    terminalTailDetectionEnabled: env.VOICE_STREAM_NEXT_TERMINAL_TAIL_DETECTION !== '0',
    terminalTailWindowMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TERMINAL_TAIL_WINDOW_MS, 7_000),
    terminalTailDelayMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TERMINAL_TAIL_DELAY_MS, 2_400),
    terminalTailRetryDelayMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TERMINAL_TAIL_RETRY_DELAY_MS, 2_000),
    terminalTailCooldownMs: parsePositiveInteger(env.VOICE_STREAM_NEXT_TERMINAL_TAIL_COOLDOWN_MS, 1_000),
  };
}

export function streamingTranscriptionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.VOICE_STREAM_NEXT_TEST_TRANSCRIPT != null || hasGroqSpeechRuntime(env);
}

export class StreamingTranscriptionManager {
  private readonly segmenter: PcmSpeechSegmenter;
  private readonly queue: QueuedSegment[] = [];
  private readonly timer: ReturnType<typeof setInterval>;
  private activeTranscriptions = 0;
  private stopped = false;
  private terminalCommandDetected = false;
  private transcriptContext = '';
  private completedSegmentTexts = new Map<number, { text: string; audioMs: number }>();
  private nextTranscriptSequence = 1;
  private sessionChunks: Uint8Array[] = [];
  private sessionBytes = 0;
  private sessionAudioOverflowed = false;
  private terminalTailChunks: Uint8Array[] = [];
  private terminalTailBytes = 0;
  private terminalTailTimer: ReturnType<typeof setTimeout> | null = null;
  private terminalTailInFlight = false;
  private lastTerminalTailStartedAtMs = 0;
  private terminalTailAttempt = 0;

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
    this.rememberTerminalTailAudio(pcm);
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
    this.segmenter.reset();
    this.completedSegmentTexts.clear();
    this.clearSessionAudio();
    this.clearTerminalTailAudio();
    this.clearTerminalTailTimer();
    clearInterval(this.timer);
  }

  private processQueue(): void {
    if (this.stopped || this.terminalCommandDetected) {
      return;
    }
    const concurrency = Math.max(1, this.config.concurrency);
    while (!this.stopped && !this.terminalCommandDetected && this.activeTranscriptions < concurrency && this.queue.length > 0) {
      const segment = this.queue.shift()!;
      this.activeTranscriptions += 1;
      void this.runSegmentTranscription(segment);
    }
  }

  private async runSegmentTranscription(segment: QueuedSegment): Promise<void> {
    try {
      await this.transcribeSegment(segment);
    } finally {
      this.activeTranscriptions = Math.max(0, this.activeTranscriptions - 1);
      this.processQueue();
    }
  }

  private async transcribeSegment(segment: QueuedSegment): Promise<void> {
    const startedAtMs = Date.now();
    const context: StreamingTranscriptionHookContext = {
      source: 'segment',
      segment: segmentMetadata(segment),
      queuedDelayMs: Math.max(0, startedAtMs - Date.parse(segment.queuedAt)),
    };
    this.hooks.beforeTranscription?.(segment.pcm, 'segment', context);
    let result: RuntimeResult;
    try {
      result = await (this.hooks.transcribe?.(segment.pcm) ?? transcribePcm16(segment.pcm));
    } catch (error) {
      this.hooks.onTranscriptionError?.(error, 'segment', { ...context, elapsedMs: Math.max(0, Date.now() - startedAtMs) });
      return;
    }
    const completedContext = { ...context, elapsedMs: Math.max(0, Date.now() - startedAtMs) };
    this.hooks.onTranscription?.(result, 'segment', completedContext);
    if (this.stopped || this.terminalCommandDetected) return;

    if (!this.config.detectTerminalCommands) {
      const text = normalizeTranscriptWhitespace(result.text);
      this.rememberCompletedSegment(segment, text);
      return;
    }

    const commandResult = stripTranscriptCommands(result.text);
    if (commandResult.abortDetected) {
      await this.handleTerminalCommandResult(commandResult, {
        source: 'segment',
        segmentSequence: segment.sequence,
        segmentReason: segment.reason,
      });
      return;
    }

    const terminalType: Extract<TerminalCommandType, 'finish' | 'sleep'> | null = commandResult.sleepDetected
      ? 'sleep'
      : commandResult.finishDetected
        ? 'finish'
        : null;
    if (terminalType) {
      await this.handleTerminalCommandResult(commandResult, {
        source: 'segment',
        segmentSequence: segment.sequence,
        segmentReason: segment.reason,
      });
      return;
    }

    this.rememberCompletedSegment(segment, commandResult.text);
  }

  private async runTerminalTailDetection(): Promise<void> {
    if (
      this.stopped ||
      this.terminalCommandDetected ||
      this.terminalTailInFlight ||
      !this.config.detectTerminalCommands ||
      !this.config.terminalTailDetectionEnabled
    ) {
      return;
    }
    const now = Date.now();
    if (now - this.lastTerminalTailStartedAtMs < this.config.terminalTailCooldownMs) return;
    const pcm = this.terminalTailAudioSnapshot();
    if (pcm.byteLength < 1600) return;
    this.terminalTailInFlight = true;
    this.lastTerminalTailStartedAtMs = now;
    const startedAtMs = Date.now();
    const context: StreamingTranscriptionHookContext = { source: 'terminal_tail' };
    this.hooks.beforeTranscription?.(pcm, 'terminal_tail', context);
    try {
      const result = await (this.hooks.transcribe?.(pcm) ?? transcribePcm16(pcm, {
        prompt: "Terminal commands may include: that's it, go to sleep, okay stop.",
      }));
      const completedContext = { ...context, elapsedMs: Math.max(0, Date.now() - startedAtMs) };
      this.hooks.onTranscription?.(result, 'terminal_tail', completedContext);
      if (this.stopped || this.terminalCommandDetected) return;
      const commandResult = stripTranscriptCommands(result.text);
      if (commandResult.abortDetected || commandResult.finishDetected || commandResult.sleepDetected) {
        await this.handleTerminalCommandResult(commandResult, {
          source: 'terminal_tail',
          segmentSequence: null,
          segmentReason: 'terminal_tail',
        });
        return;
      }
      this.scheduleTerminalTailRetry();
    } catch (error) {
      this.hooks.onTranscriptionError?.(error, 'terminal_tail', {
        ...context,
        elapsedMs: Math.max(0, Date.now() - startedAtMs),
      });
      this.scheduleTerminalTailRetry();
    } finally {
      this.terminalTailInFlight = false;
    }
  }

  private async handleTerminalCommandResult(
    commandResult: ReturnType<typeof stripTranscriptCommands>,
    metadata: {
      source: 'segment' | 'terminal_tail';
      segmentSequence: number | null;
      segmentReason: QueuedSegment['reason'] | 'terminal_tail';
    },
  ): Promise<void> {
    if (commandResult.abortDetected) {
      this.enterTerminalCommandState({ clearContext: true });
      const detectedAt = new Date().toISOString();
      this.onDetection({
        type: 'abort',
        phrase: commandResult.abortPhrase ?? 'okay stop',
        detectedAt,
        partialTranscriptText: '',
        source: metadata.source,
        segmentSequence: metadata.segmentSequence,
        segmentReason: metadata.segmentReason,
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
    if (!terminalType) return;

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
      source: metadata.source,
      segmentSequence: metadata.segmentSequence,
      segmentReason: metadata.segmentReason,
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
  }

  private async transcribeFinalSession(pcm: Uint8Array, fallbackText: string): Promise<string> {
    if (pcm.byteLength === 0) return fallbackText;
    try {
      const startedAtMs = Date.now();
      const context: StreamingTranscriptionHookContext = { source: 'final' };
      this.hooks.beforeTranscription?.(pcm, 'final', context);
      const result = await (this.hooks.transcribe?.(pcm) ?? transcribePcm16(pcm));
      this.hooks.onTranscription?.(result, 'final', { ...context, elapsedMs: Math.max(0, Date.now() - startedAtMs) });
      const cleaned = stripTranscriptCommands(result.text).text;
      return hasTranscriptContent(cleaned) ? cleaned : fallbackText;
    } catch (error) {
      this.hooks.onTranscriptionError?.(error, 'final', { source: 'final' });
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

  private rememberCompletedSegment(segment: QueuedSegment, text: string): void {
    this.completedSegmentTexts.set(segment.sequence, { text, audioMs: segment.audioMs });
    this.flushCompletedSegments();
  }

  private flushCompletedSegments(): void {
    while (!this.stopped && !this.terminalCommandDetected) {
      const next = this.completedSegmentTexts.get(this.nextTranscriptSequence);
      if (!next) return;
      this.completedSegmentTexts.delete(this.nextTranscriptSequence);
      if (hasTranscriptContent(next.text)) {
        this.rememberTranscript(next.text);
        this.hooks.onSegment?.({
          text: next.text,
          audioMs: next.audioMs,
          sequence: this.nextTranscriptSequence,
          receivedAt: new Date().toISOString(),
        });
      }
      this.nextTranscriptSequence += 1;
    }
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

  private rememberTerminalTailAudio(pcm: Uint8Array): void {
    if (!this.config.detectTerminalCommands || !this.config.terminalTailDetectionEnabled) return;
    const copy = new Uint8Array(pcm);
    this.terminalTailChunks.push(copy);
    this.terminalTailBytes += copy.byteLength;
    const maxBytes = pcmBytesForMs(this.config.terminalTailWindowMs, this.config.sampleRateHz, this.config.channels);
    while (this.terminalTailBytes > maxBytes && this.terminalTailChunks.length > 0) {
      const first = this.terminalTailChunks[0];
      const overflow = this.terminalTailBytes - maxBytes;
      if (first.byteLength <= overflow) {
        this.terminalTailChunks.shift();
        this.terminalTailBytes -= first.byteLength;
      } else {
        const trimmed = first.subarray(overflow);
        this.terminalTailChunks[0] = new Uint8Array(trimmed);
        this.terminalTailBytes -= overflow;
      }
    }
  }

  private terminalTailAudioSnapshot(): Uint8Array {
    if (this.terminalTailBytes === 0) return new Uint8Array(0);
    return concatUint8Arrays(this.terminalTailChunks, this.terminalTailBytes);
  }

  private clearTerminalTailAudio(): void {
    this.terminalTailChunks = [];
    this.terminalTailBytes = 0;
  }

  private clearTerminalTailTimer(): void {
    if (!this.terminalTailTimer) return;
    clearTimeout(this.terminalTailTimer);
    this.terminalTailTimer = null;
  }

  private scheduleTerminalTailDetection(delayMs = this.config.terminalTailDelayMs, resetAttempts = true): void {
    if (!this.config.detectTerminalCommands || !this.config.terminalTailDetectionEnabled) return;
    if (resetAttempts) this.terminalTailAttempt = 0;
    this.clearTerminalTailTimer();
    this.terminalTailTimer = setTimeout(() => {
      this.terminalTailTimer = null;
      void this.runTerminalTailDetection();
    }, delayMs);
    this.terminalTailTimer.unref?.();
  }

  private scheduleTerminalTailRetry(): void {
    if (this.stopped || this.terminalCommandDetected || this.terminalTailTimer) return;
    if (this.terminalTailAttempt >= 1) return;
    this.terminalTailAttempt += 1;
    this.scheduleTerminalTailDetection(this.config.terminalTailRetryDelayMs, false);
  }

  private enterTerminalCommandState(opts: { clearContext: boolean }): void {
    this.terminalCommandDetected = true;
    this.queue.length = 0;
    this.segmenter.reset();
    this.clearTerminalTailTimer();
    if (opts.clearContext) this.transcriptContext = '';
  }

  private enqueueSegments(segments: QueuedSegment[]): void {
    for (const segment of segments) {
      this.queue.push(segment);
      this.hooks.onSegmentQueued?.(segmentMetadata(segment));
      this.scheduleTerminalTailDetection();
    }
  }
}

function segmentMetadata(segment: QueuedSegment): StreamingSegmentMetadata {
  return {
    audioMs: segment.audioMs,
    rawAudioMs: segment.rawAudioMs,
    speechMs: segment.speechMs,
    trailingSilenceMs: segment.trailingSilenceMs,
    reason: segment.reason,
    queuedAt: segment.queuedAt,
    sequence: segment.sequence,
  };
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

function pcmBytesForMs(ms: number, sampleRateHz: number, channels: number): number {
  const bytesPerSample = 2;
  return evenByteCount(Math.max(0, Math.round((sampleRateHz * channels * bytesPerSample * ms) / 1000)));
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
