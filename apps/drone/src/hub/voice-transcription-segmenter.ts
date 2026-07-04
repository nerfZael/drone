export type TranscriptCommandResult = {
  text: string;
  wake: boolean;
  patch: boolean;
  clipboard: boolean;
  lock: boolean;
  sleep: boolean;
  abort: boolean;
  status: boolean;
};

export type PromptSpeechSegment = {
  pcm: Buffer;
  audioMs: number;
  speechMs: number;
  trailingSilenceMs: number;
  reason: 'silence' | 'short_silence' | 'max_segment' | 'flush';
  sequence: number;
};

export function stripCommands(text: string): TranscriptCommandResult {
  let cleaned = String(text ?? '');
  let wake = false;
  let patch = false;
  let clipboard = false;
  let lock = false;
  let sleep = false;
  let abort = false;
  cleaned = cleaned.replace(/\b(?:hey|hay)\s+sebastian\b[\s,.:;!?-]*/gi, () => {
    wake = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\bpatch\s+me\s+in\b[\s,.:;!?-]*/gi, () => {
    patch = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\bcan\s+you\s+transcribe\b[\s,.:;!?-]*/gi, () => {
    clipboard = true;
    return ' ';
  });
  cleaned = cleaned.replace(/\bgo\s+to\s+sleep\b[\s,.:;!?-]*/gi, () => {
    lock = true;
    return ' ';
  });
  cleaned = cleaned.replace(/[\s,.:;!?-]*\b(?:that's|thats|that\s+is)\s+it\b[\s,.:;!?-]*/gi, () => {
    sleep = true;
    return ' ';
  });
  cleaned = cleaned.replace(/[\s,.:;!?-]*\b(?:okay|ok)[\s,.:;!?-]+stop\b[\s,.:;!?-]*/gi, () => {
    abort = true;
    return ' ';
  });
  const words = normalizeWords(cleaned);
  const compact = words.join('');
  const status = words.includes('status') || compact === 'stateus' || compact === 'stateis' || compact === 'statuscheck' || compact === 'checkstatus';
  return {
    text: normalizeTranscriptWhitespace(cleaned),
    wake,
    patch,
    clipboard,
    lock,
    sleep,
    abort,
    status,
  };
}

export function hasTranscriptContent(text: string): boolean {
  return /[\p{L}\p{N}]/u.test(text);
}

export function pcmDurationMs(bytes: number, sampleRateHz = 16_000, channels = 1): number {
  return Math.round((bytes / (sampleRateHz * channels * 2)) * 1000);
}

export function pcm16leRms(buffer: Buffer): number {
  const samples = Math.floor(buffer.length / 2);
  if (samples <= 0) return 0;
  let sumSquares = 0;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    const sample = buffer.readInt16LE(offset) / 32768;
    sumSquares += sample * sample;
  }
  return Math.sqrt(sumSquares / samples);
}

export function pcm16leToWav(pcm: Buffer, sampleRateHz = 16_000, channels = 1): Buffer {
  const bitsPerSample = 16;
  const byteRate = sampleRateHz * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.byteLength, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRateHz, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([header, pcm], header.byteLength + pcm.byteLength);
}

export class PromptSpeechSegmenter {
  private currentChunks: Buffer[] = [];
  private currentBytes = 0;
  private speechMs = 0;
  private trailingSilenceMs = 0;
  private carryover: Buffer = Buffer.alloc(0);
  private nextSequence = 1;

  get hasOpenSpeech(): boolean {
    return this.speechMs > 0;
  }

  reset(): void {
    this.currentChunks = [];
    this.currentBytes = 0;
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
    this.carryover = Buffer.alloc(0);
  }

  append(pcm: Buffer): PromptSpeechSegment[] {
    if (pcm.byteLength === 0) return [];
    this.currentChunks.push(Buffer.from(pcm));
    this.currentBytes += pcm.byteLength;

    const chunkMs = pcmDurationMs(pcm.byteLength);
    const rms = pcm16leRms(pcm);
    if (rms >= this.silenceThreshold()) {
      this.speechMs += chunkMs;
      this.trailingSilenceMs = 0;
    } else if (this.speechMs > 0) {
      this.trailingSilenceMs += chunkMs;
    }

    const currentMs = pcmDurationMs(this.currentBytes);
    if (this.speechMs === 0 && currentMs > Math.max(1_000, this.silenceMs())) {
      this.resetCurrent();
      return [];
    }
    if (this.speechMs >= this.minSpeechMs() && this.trailingSilenceMs >= this.silenceMs()) return [this.takeSegment('silence')];
    if (this.speechMs > 0 && this.trailingSilenceMs >= this.shortUtteranceSilenceMs()) return [this.takeSegment('short_silence')];
    if (this.speechMs >= this.minSpeechMs() && currentMs >= this.maxSegmentMs()) return [this.takeSegment('max_segment')];
    return [];
  }

  flush(): PromptSpeechSegment | null {
    if (this.speechMs < this.minSpeechMs()) {
      this.resetCurrent();
      return null;
    }
    return this.takeSegment('flush');
  }

  private takeSegment(reason: PromptSpeechSegment['reason']): PromptSpeechSegment {
    const segment = Buffer.concat(this.currentChunks, this.currentBytes);
    const pcm = this.carryover.byteLength > 0 ? Buffer.concat([this.carryover, segment]) : segment;
    const padded = padPcmToMinDuration(pcm, this.minSubmitMs());
    const out = {
      pcm: padded,
      audioMs: pcmDurationMs(padded.byteLength),
      speechMs: this.speechMs,
      trailingSilenceMs: this.trailingSilenceMs,
      reason,
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;
    this.carryover = lastPcmMs(segment, this.overlapMs());
    this.resetCurrent();
    return out;
  }

  private resetCurrent(): void {
    this.currentChunks = [];
    this.currentBytes = 0;
    this.speechMs = 0;
    this.trailingSilenceMs = 0;
  }

  private minSpeechMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_MIN_SPEECH_MS', 180);
  }

  private minSubmitMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_MIN_SUBMIT_MS', 1_000);
  }

  private silenceMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_SILENCE_MS', 650);
  }

  private shortUtteranceSilenceMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_SHORT_UTTERANCE_SILENCE_MS', 1_000);
  }

  private maxSegmentMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_MAX_SEGMENT_MS', 10_000);
  }

  private overlapMs(): number {
    return positiveIntEnv('GROQ_TRANSCRIBE_OVERLAP_MS', 500);
  }

  private silenceThreshold(): number {
    const parsed = Number.parseFloat(String(process.env.GROQ_TRANSCRIBE_SILENCE_THRESHOLD ?? '0.025'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0.025;
  }
}

function normalizeWords(text: string): string[] {
  return String(text ?? '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

export function normalizeTranscriptWhitespace(text: string): string {
  return text
    .replace(/\s+([,.:;!?])/g, '$1')
    .replace(/([([{])\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function lastPcmMs(pcm: Buffer, ms: number, sampleRateHz = 16_000, channels = 1): Buffer {
  const byteCount = Math.min(pcm.byteLength, Math.round(sampleRateHz * channels * 2 * ms / 1000));
  const evenByteCount = byteCount - (byteCount % 2);
  return evenByteCount > 0 ? Buffer.from(pcm.subarray(pcm.byteLength - evenByteCount)) : Buffer.alloc(0);
}

function padPcmToMinDuration(pcm: Buffer, minMs: number, sampleRateHz = 16_000, channels = 1): Buffer {
  const minBytes = Math.round(sampleRateHz * channels * 2 * minMs / 1000);
  if (pcm.byteLength >= minBytes) return pcm;
  const paddingBytes = minBytes - pcm.byteLength;
  const leadingBytes = Math.floor(paddingBytes / 2) - (Math.floor(paddingBytes / 2) % 2);
  const trailingBytes = paddingBytes - leadingBytes - ((paddingBytes - leadingBytes) % 2);
  return Buffer.concat([Buffer.alloc(leadingBytes), pcm, Buffer.alloc(trailingBytes)], leadingBytes + pcm.byteLength + trailingBytes);
}

function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
