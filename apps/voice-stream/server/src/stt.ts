export type TranscriptStatus = {
  type: "transcript_status";
  configured: boolean;
  status: "disabled" | "ready" | "collecting" | "transcribing" | "error";
  message: string;
  model?: string;
};

export type TranscriptSegment = {
  type: "transcript_segment";
  text: string;
  final: true;
  model: string;
  audioMs: number;
  receivedAt: string;
};

export type TranscriptMessage = TranscriptStatus | TranscriptSegment;

export type TranscriptCommand = {
  type: "sleep" | "abort";
  phrase: string;
  targetState?: "awake" | "sleeping";
  detectedAt: string;
  transcriptText: string;
};

export type TranscriptionConfig = {
  apiKey?: string;
  endpoint: string;
  model: string;
  language?: string;
  responseFormat: "json" | "verbose_json" | "text";
  prompt?: string;
  contextChars: number;
  maxPromptChars: number;
  intervalMs: number;
  minSpeechMs: number;
  minSubmitMs: number;
  silenceMs: number;
  shortUtteranceSilenceMs: number;
  maxSegmentMs: number;
  overlapMs: number;
  silenceThreshold: number;
  debugVad: boolean;
  debugSegments: boolean;
  logTextChars: number;
  sampleRateHz: number;
  channels: number;
  broadcastSegments: boolean;
  ignoreEmptySleepCommands: boolean;
  ignoreAbortCommands: boolean;
  finalTranscriptionMode: "full-recording" | "segments";
  maxSessionAudioBytes: number;
};

export type SpeechSegmenterConfig = {
  sampleRateHz: number;
  channels: number;
  minSpeechMs: number;
  minSubmitMs: number;
  silenceMs: number;
  shortUtteranceSilenceMs: number;
  maxSegmentMs: number;
  overlapMs: number;
  silenceThreshold: number;
  debugVad: boolean;
};

type BroadcastFn = (message: TranscriptMessage) => void;
type CommandFn = (command: TranscriptCommand) => void;
type SegmentFn = (segment: TranscriptSegment) => void | Promise<void>;

type QueuedSegment = {
  pcm: Buffer;
  audioMs: number;
  rawAudioMs: number;
  speechMs: number;
  trailingSilenceMs: number;
  reason: "silence" | "short_silence" | "max_segment" | "flush";
  queuedAt: string;
  sequence: number;
};

export class GroqTranscriptionManager {
  private readonly segmenter: PcmSpeechSegmenter;
  private readonly onSegment?: SegmentFn;
  private readonly logLabel: string;
  private readonly queue: QueuedSegment[] = [];
  private readonly timer: NodeJS.Timeout;
  private inFlight = false;
  private stopped = false;
  private terminalCommandDetected = false;
  private disabledStatusSent = false;
  private transcriptContext = "";
  private sessionChunks: Buffer[] = [];
  private sessionBytes = 0;
  private sessionAudioOverflowed = false;

  constructor(
    private readonly config: TranscriptionConfig,
    private readonly broadcast: BroadcastFn,
    private readonly onCommand?: CommandFn,
    onSegmentOrLogLabel?: SegmentFn | string,
    logLabel = "stt",
  ) {
    this.onSegment = typeof onSegmentOrLogLabel === "function" ? onSegmentOrLogLabel : undefined;
    this.logLabel = typeof onSegmentOrLogLabel === "string" ? onSegmentOrLogLabel : logLabel;
    this.segmenter = new PcmSpeechSegmenter(config);
    this.timer = setInterval(() => {
      this.processQueue();
    }, config.intervalMs);
    this.timer.unref();
  }

  get configured(): boolean {
    return Boolean(this.config.apiKey);
  }

  status(): TranscriptStatus {
    if (!this.config.apiKey) {
      return {
        type: "transcript_status",
        configured: false,
        status: "disabled",
        message: "Transcription disabled: set GROQ_API_KEY on the server.",
      };
    }

    if (this.inFlight) {
      return {
        type: "transcript_status",
        configured: true,
        status: "transcribing",
        message: "Transcribing a speech segment with Groq.",
        model: this.config.model,
      };
    }

    if (this.segmenter.hasOpenSpeech || this.queue.length > 0) {
      return {
        type: "transcript_status",
        configured: true,
        status: "collecting",
        message: "Collecting speech until silence or max segment length.",
        model: this.config.model,
      };
    }

    return {
      type: "transcript_status",
      configured: true,
      status: "ready",
      message: "Transcription ready.",
      model: this.config.model,
    };
  }

  appendPcm(pcm: Buffer): void {
    if (this.stopped || this.terminalCommandDetected) return;
    if (!this.config.apiKey) {
      if (!this.disabledStatusSent) {
        this.disabledStatusSent = true;
        this.broadcast(this.status());
      }
      return;
    }

    this.rememberSessionAudio(pcm);
    this.enqueueSegments(this.segmenter.append(pcm));

    if (this.queue.length > 0) {
      this.processQueue();
    } else if (this.segmenter.hasOpenSpeech) {
      this.broadcast(this.status());
    }
  }

  flushPending(): void {
    if (this.stopped || this.terminalCommandDetected) return;
    const segment = this.segmenter.flush();
    if (segment) {
      this.enqueueSegments([segment]);
    }
    this.processQueue();
  }

  stop(): void {
    this.stopped = true;
    this.queue.length = 0;
    this.inFlight = false;
    this.segmenter.reset();
    this.clearSessionAudio();
    clearInterval(this.timer);
    this.broadcast(this.status());
  }

  private processQueue(): void {
    if (!this.config.apiKey || this.stopped || this.terminalCommandDetected || this.inFlight || this.queue.length === 0) {
      return;
    }

    const segment = this.queue.shift()!;
    this.inFlight = true;
    this.broadcast(this.status());

    void this.transcribeSegment(segment);
  }

  private async transcribeSegment(segment: QueuedSegment): Promise<void> {
    const startedAt = Date.now();
    try {
      const wav = pcm16leToWav(segment.pcm, this.config.sampleRateHz, this.config.channels);
      const prompt = this.buildPrompt();
      const text = await transcribeWavWithGroq(wav, this.config, prompt);
      if (this.stopped || this.terminalCommandDetected) {
        this.inFlight = false;
        return;
      }
      const commandResult = stripTranscriptCommands(text);
      this.logSegmentResult(segment, text, commandResult, Date.now() - startedAt, prompt);
      const trimmed = commandResult.text;
      if (commandResult.abortDetected && !this.config.ignoreAbortCommands) {
        this.enterTerminalCommandState({ clearContext: true });
        this.log(
          `command=abort segment=${segment.sequence} phrase=${formatLogValue(commandResult.abortPhrase ?? "okay stop")} ` +
          `detectedAt=${new Date().toISOString()}`
        );
        this.onCommand?.({
          type: "abort",
          phrase: commandResult.abortPhrase ?? "okay stop",
          detectedAt: new Date().toISOString(),
          transcriptText: "",
        });
        this.broadcast({
          type: "transcript_status",
          configured: true,
          status: "ready",
          message: "Abort command detected by transcript.",
          model: this.config.model,
        });
        this.inFlight = false;
        this.broadcast(this.status());
        return;
      } else if (commandResult.sleepDetected) {
        const fallbackTranscriptText = this.buildFullTranscriptText(trimmed);
        if (this.config.ignoreEmptySleepCommands && !hasTranscriptContent(fallbackTranscriptText)) {
          this.log(
            `command=sleep_ignored_empty segment=${segment.sequence} phrase=${formatLogValue(commandResult.sleepPhrase ?? "that's it")} ` +
            `detectedAt=${new Date().toISOString()}`
          );
          this.inFlight = false;
          this.broadcast(this.status());
          this.processQueue();
          return;
        }
        const sessionPcm = this.config.finalTranscriptionMode === "full-recording" ? this.takeSessionAudio() : Buffer.alloc(0);
        if (this.config.finalTranscriptionMode === "segments") {
          this.clearSessionAudio();
        }
        this.enterTerminalCommandState({ clearContext: false });
        const transcriptText = this.config.finalTranscriptionMode === "full-recording"
          ? await this.transcribeFinalSession(sessionPcm, fallbackTranscriptText, segment.sequence)
          : fallbackTranscriptText;
        if (this.stopped) {
          this.inFlight = false;
          return;
        }
        this.log(
          `command=sleep segment=${segment.sequence} phrase=${formatLogValue(commandResult.sleepPhrase ?? "that's it")} ` +
          `detectedAt=${new Date().toISOString()}`
        );
        this.onCommand?.({
          type: "sleep",
          phrase: commandResult.sleepPhrase ?? "that's it",
          targetState: commandResult.sleepTargetState ?? "awake",
          detectedAt: new Date().toISOString(),
          transcriptText,
        });
        this.broadcast({
          type: "transcript_status",
          configured: true,
          status: "ready",
          message: "Sleep command detected by transcript.",
          model: this.config.model,
        });
        this.inFlight = false;
        this.broadcast(this.status());
        return;
      }

      if (!commandResult.abortDetected && hasTranscriptContent(trimmed)) {
        this.rememberTranscript(trimmed);
        const message: TranscriptSegment = {
          type: "transcript_segment",
          text: trimmed,
          final: true,
          model: this.config.model,
          audioMs: segment.audioMs,
          receivedAt: new Date().toISOString(),
        };
        if (this.config.broadcastSegments) {
          this.broadcast(message);
        }
        if (this.onSegment) {
          try {
            await this.onSegment(message);
          } catch (error) {
            this.log(
              `segment=${segment.sequence} segment_callback_error ` +
              `message=${formatLogValue(error instanceof Error ? error.message : String(error))}`
            );
          }
        }
      }
      this.inFlight = false;
      this.broadcast(this.status());
      this.processQueue();
    } catch (error) {
      if (this.stopped || this.terminalCommandDetected) {
        this.inFlight = false;
        return;
      }
      this.log(
        `segment=${segment.sequence} groq_error elapsedMs=${Date.now() - startedAt} ` +
        `message=${formatLogValue(error instanceof Error ? error.message : String(error))}`
      );
      this.inFlight = false;
      this.broadcast({
        type: "transcript_status",
        configured: true,
        status: "error",
        message: `Groq transcription failed: ${error instanceof Error ? error.message : String(error)}`,
        model: this.config.model,
      });
      this.processQueue();
    }
  }

  private buildPrompt(): string | undefined {
    return buildGroqPrompt(this.config.prompt, this.transcriptContext, this.config.maxPromptChars);
  }

  private rememberTranscript(text: string): void {
    const next = `${this.transcriptContext} ${text}`.trim();
    this.transcriptContext = next.slice(Math.max(0, next.length - this.config.contextChars));
  }

  private rememberSessionAudio(pcm: Buffer): void {
    if (this.config.finalTranscriptionMode === "segments") return;
    if (pcm.byteLength === 0 || this.sessionAudioOverflowed) return;
    if (this.sessionBytes + pcm.byteLength > this.config.maxSessionAudioBytes) {
      this.log(
        `session_audio_overflow bytes=${this.sessionBytes + pcm.byteLength} ` +
        `maxBytes=${this.config.maxSessionAudioBytes} final transcription will use chunk transcript fallback`
      );
      this.clearSessionAudio();
      this.sessionAudioOverflowed = true;
      return;
    }
    const copy = Buffer.from(pcm);
    this.sessionChunks.push(copy);
    this.sessionBytes += copy.byteLength;
  }

  private takeSessionAudio(): Buffer {
    const pcm = this.sessionBytes > 0
      ? Buffer.concat(this.sessionChunks, this.sessionBytes)
      : Buffer.alloc(0);
    this.clearSessionAudio();
    return pcm;
  }

  private clearSessionAudio(): void {
    this.sessionChunks = [];
    this.sessionBytes = 0;
    this.sessionAudioOverflowed = false;
  }

  private async transcribeFinalSession(pcm: Buffer, fallbackText: string, sequence: number): Promise<string> {
    if (pcm.byteLength === 0) return fallbackText;
    const startedAt = Date.now();
    try {
      const wav = pcm16leToWav(pcm, this.config.sampleRateHz, this.config.channels);
      const prompt = buildGroqPrompt(this.config.prompt, undefined, this.config.maxPromptChars);
      const text = await transcribeWavWithGroq(wav, this.config, prompt);
      const cleaned = stripTranscriptCommands(text).text;
      this.log(
        `segment=${sequence} final_groq_done elapsedMs=${Date.now() - startedAt} ` +
        `audioMs=${pcmDurationMs(pcm.byteLength, this.config.sampleRateHz, this.config.channels)} ` +
        `rawText=${formatLogValue(text, this.config.logTextChars)} ` +
        `cleanedText=${formatLogValue(cleaned, this.config.logTextChars)}`
      );
      return hasTranscriptContent(cleaned) ? cleaned : fallbackText;
    } catch (error) {
      this.log(
        `segment=${sequence} final_groq_error elapsedMs=${Date.now() - startedAt} ` +
        `message=${formatLogValue(error instanceof Error ? error.message : String(error))}`
      );
      return fallbackText;
    }
  }

  private buildFullTranscriptText(text: string): string {
    return `${this.transcriptContext} ${text}`.trim();
  }

  private enterTerminalCommandState(opts: { clearContext: boolean }): void {
    this.terminalCommandDetected = true;
    this.queue.length = 0;
    this.segmenter.reset();
    if (opts.clearContext) this.transcriptContext = "";
  }

  private enqueueSegments(segments: QueuedSegment[]): void {
    for (const segment of segments) {
      this.queue.push(segment);
      this.log(
        `queued segment=${segment.sequence} reason=${segment.reason} speechMs=${segment.speechMs} ` +
        `trailingSilenceMs=${segment.trailingSilenceMs} rawAudioMs=${segment.rawAudioMs} ` +
        `submitAudioMs=${segment.audioMs} queue=${this.queue.length}`
      );
    }
  }

  private logSegmentResult(
    segment: QueuedSegment,
    rawText: string,
    commandResult: ReturnType<typeof stripTranscriptCommands>,
    elapsedMs: number,
    prompt: string | undefined,
  ): void {
    this.log(
      `segment=${segment.sequence} groq_done elapsedMs=${elapsedMs} reason=${segment.reason} ` +
      `speechMs=${segment.speechMs} trailingSilenceMs=${segment.trailingSilenceMs} ` +
      `rawAudioMs=${segment.rawAudioMs} submitAudioMs=${segment.audioMs} ` +
      `promptChars=${prompt ? Array.from(prompt).length : 0} wake=${commandResult.wakeDetected} ` +
      `sleep=${commandResult.sleepDetected} abort=${commandResult.abortDetected} phrase=${formatLogValue(commandResult.sleepPhrase ?? commandResult.abortPhrase ?? "")} ` +
      `rawText=${formatLogValue(rawText, this.config.logTextChars)} ` +
      `cleanedText=${formatLogValue(commandResult.text, this.config.logTextChars)}`
    );
  }

  private log(message: string): void {
    if (this.config.debugSegments) {
      console.log(`[stt ${this.logLabel}] ${message}`);
    }
  }
}

export class PcmSpeechSegmenter {
  private currentChunks: Buffer[] = [];
  private currentBytes = 0;
  private speechMs = 0;
  private trailingSilenceMs = 0;
  private carryover: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private nextSequence = 1;

  constructor(private readonly config: SpeechSegmenterConfig) {}

  get hasOpenSpeech(): boolean {
    return this.speechMs > 0;
  }

  reset(): void {
    this.resetCurrent();
    this.carryover = Buffer.alloc(0);
  }

  append(pcm: Buffer): QueuedSegment[] {
    if (pcm.byteLength === 0) {
      return [];
    }

    this.currentChunks.push(Buffer.from(pcm));
    this.currentBytes += pcm.byteLength;

    const chunkMs = pcmDurationMs(pcm.byteLength, this.config.sampleRateHz, this.config.channels);
    const rms = pcm16leRms(pcm);
    if (rms >= this.config.silenceThreshold) {
      if (this.speechMs === 0) {
        this.debug(`speech_start rms=${rms.toFixed(4)} threshold=${this.config.silenceThreshold}`);
      }
      this.speechMs += chunkMs;
      this.trailingSilenceMs = 0;
    } else if (this.speechMs > 0) {
      this.trailingSilenceMs += chunkMs;
      if (this.trailingSilenceMs === chunkMs) {
        this.debug(`silence_started rms=${rms.toFixed(4)} threshold=${this.config.silenceThreshold}`);
      }
    }

    const currentMs = pcmDurationMs(this.currentBytes, this.config.sampleRateHz, this.config.channels);
    if (this.speechMs === 0 && currentMs > Math.max(1_000, this.config.silenceMs)) {
      this.debug(`drop_prespeech_silence totalMs=${currentMs}`);
      this.resetCurrent();
      return [];
    }

    if (
      this.speechMs >= this.config.minSpeechMs &&
      this.trailingSilenceMs >= this.config.silenceMs
    ) {
      return [this.takeSegment("silence")];
    }

    if (
      this.speechMs > 0 &&
      this.trailingSilenceMs >= Math.max(this.config.silenceMs, this.config.shortUtteranceSilenceMs)
    ) {
      return [this.takeSegment("short_silence")];
    }

    if (this.speechMs >= this.config.minSpeechMs && currentMs >= this.config.maxSegmentMs) {
      return [this.takeSegment("max_segment")];
    }

    return [];
  }

  flush(): QueuedSegment | null {
    if (this.speechMs < this.config.minSpeechMs) {
      this.debug(`flush_drop speechMs=${this.speechMs} minSpeechMs=${this.config.minSpeechMs}`);
      this.resetCurrent();
      return null;
    }
    return this.takeSegment("flush");
  }

  private takeSegment(reason: QueuedSegment["reason"]): QueuedSegment {
    const segment = Buffer.concat(this.currentChunks, this.currentBytes);
    const pcm = this.carryover.byteLength > 0
      ? Buffer.concat([this.carryover, segment], this.carryover.byteLength + segment.byteLength)
      : segment;
    const paddedPcm = padPcmToMinDuration(pcm, this.config.minSubmitMs, this.config.sampleRateHz, this.config.channels);
    const audioMs = pcmDurationMs(paddedPcm.byteLength, this.config.sampleRateHz, this.config.channels);
    const rawAudioMs = pcmDurationMs(pcm.byteLength, this.config.sampleRateHz, this.config.channels);

    this.carryover = lastPcmMs(segment, this.config.overlapMs, this.config.sampleRateHz, this.config.channels);
    this.debug(
      `finalize reason=${reason} speechMs=${this.speechMs} trailingSilenceMs=${this.trailingSilenceMs} ` +
      `rawAudioMs=${rawAudioMs} submitAudioMs=${audioMs} overlapMs=${this.config.overlapMs}`
    );
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

  private debug(message: string): void {
    if (this.config.debugVad) {
      console.log(`[stt-vad] ${message}`);
    }
  }
}

export function buildTranscriptionConfigFromEnv(env: NodeJS.ProcessEnv): TranscriptionConfig {
  return {
    apiKey: env.GROQ_API_KEY,
    endpoint: env.GROQ_STT_ENDPOINT ?? "https://api.groq.com/openai/v1/audio/transcriptions",
    model: env.GROQ_STT_MODEL ?? "whisper-large-v3-turbo",
    language: env.GROQ_STT_LANGUAGE ?? "en",
    responseFormat: parseResponseFormat(env.GROQ_STT_RESPONSE_FORMAT),
    prompt: env.GROQ_STT_PROMPT,
    contextChars: parsePositiveInteger(env.GROQ_STT_CONTEXT_CHARS, 700),
    maxPromptChars: parsePositiveInteger(env.GROQ_STT_MAX_PROMPT_CHARS, 896),
    intervalMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_INTERVAL_MS, 500),
    minSpeechMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_MIN_SPEECH_MS, 180),
    minSubmitMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_MIN_SUBMIT_MS, 1_000),
    silenceMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_SILENCE_MS, 650),
    shortUtteranceSilenceMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS, 1_000),
    maxSegmentMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_MAX_SEGMENT_MS, 10_000),
    overlapMs: parsePositiveInteger(env.GROQ_TRANSCRIBE_OVERLAP_MS, 500),
    silenceThreshold: parsePositiveFloat(env.GROQ_TRANSCRIBE_SILENCE_THRESHOLD, 0.025),
    debugVad: parseBoolean(env.GROQ_STT_DEBUG_VAD, false),
    debugSegments: parseBoolean(env.GROQ_STT_DEBUG_SEGMENTS, true),
    logTextChars: parsePositiveInteger(env.GROQ_STT_LOG_TEXT_CHARS, 500),
    sampleRateHz: 16_000,
    channels: 1,
    broadcastSegments: true,
    ignoreEmptySleepCommands: false,
    ignoreAbortCommands: false,
    finalTranscriptionMode: parseFinalTranscriptionMode(env.GROQ_STT_FINAL_TRANSCRIPTION_MODE),
    maxSessionAudioBytes: parsePositiveInteger(env.GROQ_STT_MAX_SESSION_AUDIO_BYTES, 80 * 1024 * 1024),
  };
}

export function buildGroqPrompt(
  configuredPrompt: string | undefined,
  transcriptContext: string | undefined,
  maxPromptChars: number,
): string | undefined {
  const maxChars = Math.max(0, maxPromptChars);
  if (maxChars === 0) {
    return undefined;
  }

  const prompt = configuredPrompt?.trim();
  const context = transcriptContext?.trim();
  if (!prompt && !context) {
    return undefined;
  }

  if (prompt && !context) {
    return takeFirstChars(prompt, maxChars);
  }

  if (!prompt && context) {
    return takeLastChars(context, maxChars);
  }

  const separator = "\n\nPrevious transcript context:\n";
  if (charLength(prompt!) + charLength(separator) >= maxChars) {
    return takeFirstChars(prompt!, maxChars);
  }

  const contextChars = maxChars - charLength(prompt!) - charLength(separator);
  return `${prompt}${separator}${takeLastChars(context!, contextChars)}`;
}

export function stripTranscriptCommands(text: string): {
  text: string;
  wakeDetected: boolean;
  sleepDetected: boolean;
  sleepPhrase?: string;
  sleepTargetState?: "awake" | "sleeping";
  abortDetected: boolean;
  abortPhrase?: string;
} {
  let cleaned = text;
  let wakeDetected = false;
  let sleepDetected = false;
  let sleepPhrase: string | undefined;
  let sleepTargetState: "awake" | "sleeping" | undefined;
  let abortDetected = false;
  let abortPhrase: string | undefined;

  cleaned = cleaned.replace(/\b(?:hey|hay)\s+sebastian\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return " ";
  });

  cleaned = cleaned.replace(/\bpatch\s+me\s+in\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return " ";
  });

  cleaned = cleaned.replace(/\bcan\s+you\s+transcribe\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return " ";
  });

  cleaned = cleaned.replace(/\btranscribe\b[\s,.:;!?-]*/gi, () => {
    wakeDetected = true;
    return " ";
  });

  cleaned = cleaned.replace(/\b(?:that's|thats|that\s+is)\s+it\b[\s,.:;!?-]*/gi, (match) => {
    sleepDetected = true;
    sleepPhrase = match.trim();
    sleepTargetState ??= "awake";
    return " ";
  });

  cleaned = cleaned.replace(/\bgo\s+to\s+sleep\b[\s,.:;!?-]*/gi, (match) => {
    sleepDetected = true;
    sleepPhrase = match.trim();
    sleepTargetState = "sleeping";
    return " ";
  });

  cleaned = cleaned.replace(/\b(?:okay|ok)[\s,.:;!?-]+stop\b[\s,.:;!?-]*/gi, (match) => {
    abortDetected = true;
    abortPhrase = match.trim();
    return " ";
  });

  return {
    text: normalizeTranscriptWhitespace(cleaned),
    wakeDetected,
    sleepDetected,
    sleepPhrase,
    sleepTargetState,
    abortDetected,
    abortPhrase,
  };
}

function normalizeTranscriptWhitespace(text: string): string {
  return text
    .replace(/\s+([,.:;!?])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function hasTranscriptContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function pcm16leToWav(pcm: Buffer, sampleRateHz: number, channels: number): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRateHz * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.byteLength, 40);

  return Buffer.concat([header, pcm], header.byteLength + pcm.byteLength);
}

export function pcmDurationMs(bytes: number, sampleRateHz: number, channels: number): number {
  const bytesPerSample = 2;
  return Math.round((bytes / (sampleRateHz * channels * bytesPerSample)) * 1000);
}

export function pcm16leRms(pcm: Buffer): number {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  if (sampleCount === 0) {
    return 0;
  }

  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2) {
    const normalized = pcm.readInt16LE(offset) / 32768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / sampleCount);
}

async function transcribeWavWithGroq(
  wav: Buffer,
  config: TranscriptionConfig,
  prompt: string | undefined,
): Promise<string> {
  if (!config.apiKey) {
    return "";
  }

  const form = new FormData();
  const wavArrayBuffer = new ArrayBuffer(wav.byteLength);
  new Uint8Array(wavArrayBuffer).set(wav);
  form.append("file", new Blob([wavArrayBuffer], { type: "audio/wav" }), "chunk.wav");
  form.append("model", config.model);
  form.append("response_format", config.responseFormat);
  form.append("temperature", "0");
  if (config.language) {
    form.append("language", config.language);
  }
  if (prompt) {
    form.append("prompt", prompt);
  }

  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
    },
    body: form,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body.slice(0, 300)}`);
  }

  if (config.responseFormat === "text") {
    return response.text();
  }

  const payload = await response.json() as { text?: unknown };
  return typeof payload.text === "string" ? payload.text : "";
}

function lastPcmMs(pcm: Buffer, ms: number, sampleRateHz: number, channels: number): Buffer {
  const bytesPerSample = 2;
  const byteCount = Math.min(pcm.byteLength, Math.round(sampleRateHz * channels * bytesPerSample * ms / 1000));
  if (byteCount <= 0) {
    return Buffer.alloc(0);
  }
  const evenByteCount = byteCount - (byteCount % 2);
  return Buffer.from(pcm.subarray(pcm.byteLength - evenByteCount));
}

function padPcmToMinDuration(pcm: Buffer, minMs: number, sampleRateHz: number, channels: number): Buffer {
  const bytesPerSample = 2;
  const minBytes = Math.round(sampleRateHz * channels * bytesPerSample * minMs / 1000);
  if (pcm.byteLength >= minBytes) {
    return pcm;
  }

  const paddingBytes = minBytes - pcm.byteLength;
  const leadingBytes = evenByteCount(Math.floor(paddingBytes / 2));
  const trailingBytes = evenByteCount(paddingBytes - leadingBytes);
  return Buffer.concat([
    Buffer.alloc(leadingBytes),
    pcm,
    Buffer.alloc(trailingBytes),
  ], leadingBytes + pcm.byteLength + trailingBytes);
}

function evenByteCount(byteCount: number): number {
  return byteCount - (byteCount % 2);
}

function charLength(value: string): number {
  return Array.from(value).length;
}

function takeFirstChars(value: string, maxChars: number): string {
  return Array.from(value).slice(0, maxChars).join("");
}

function takeLastChars(value: string, maxChars: number): string {
  if (maxChars <= 0) {
    return "";
  }
  return Array.from(value).slice(-maxChars).join("");
}

function formatLogValue(value: string, maxChars = 300): string {
  const sanitized = value.replace(/\s+/g, " ").trim();
  const truncated = Array.from(sanitized).slice(0, Math.max(0, maxChars)).join("");
  const suffix = Array.from(sanitized).length > Math.max(0, maxChars) ? "..." : "";
  return JSON.stringify(`${truncated}${suffix}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFinalTranscriptionMode(value: string | undefined): "full-recording" | "segments" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "segments" || normalized === "chunks" || normalized === "chunked") return "segments";
  return "full-recording";
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function parseResponseFormat(value: string | undefined): "json" | "verbose_json" | "text" {
  return value === "json" || value === "text" || value === "verbose_json" ? value : "verbose_json";
}
