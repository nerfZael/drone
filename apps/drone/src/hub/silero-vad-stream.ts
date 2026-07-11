import type { RealTimeVADOptions } from 'avr-vad';

export type SileroVadStreamCallbacks = {
  onSpeechStart?: () => void | Promise<void>;
  onSpeechEnd?: (pcm: Buffer) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
};

type SileroVadEngine = {
  start: () => void;
  processAudio: (audio: Float32Array) => Promise<void>;
  flush: () => Promise<void>;
  reset: () => void;
  destroy: () => Promise<void>;
};

export type SileroVadStreamOptions = {
  callbacks?: SileroVadStreamCallbacks;
  env?: NodeJS.ProcessEnv;
  createEngine?: (options: Partial<RealTimeVADOptions>) => Promise<SileroVadEngine>;
};

function positiveInt(raw: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function probability(raw: unknown, fallback: number): number {
  const parsed = Number.parseFloat(String(raw ?? ''));
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : fallback;
}

export function pcm16leToFloat32(pcm: Buffer): Float32Array {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const audio = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    audio[index] = pcm.readInt16LE(index * 2) / 32768;
  }
  return audio;
}

export function float32ToPcm16le(audio: Float32Array): Buffer {
  const pcm = Buffer.alloc(audio.length * 2);
  for (let index = 0; index < audio.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, Number(audio[index]) || 0));
    const value = sample < 0 ? Math.round(sample * 32768) : Math.round(sample * 32767);
    pcm.writeInt16LE(value, index * 2);
  }
  return pcm;
}

export function sileroVadOptions(env: NodeJS.ProcessEnv = process.env): Partial<RealTimeVADOptions> {
  return {
    model: 'v5',
    sampleRate: 16_000,
    frameSamples: 512,
    positiveSpeechThreshold: probability(env.DRONE_HUB_SILERO_POSITIVE_THRESHOLD, 0.5),
    negativeSpeechThreshold: probability(env.DRONE_HUB_SILERO_NEGATIVE_THRESHOLD, 0.35),
    preSpeechPadFrames: positiveInt(env.DRONE_HUB_SILERO_PRE_SPEECH_FRAMES, 8),
    redemptionFrames: positiveInt(env.DRONE_HUB_SILERO_REDEMPTION_FRAMES, 18),
    minSpeechFrames: positiveInt(env.DRONE_HUB_SILERO_MIN_SPEECH_FRAMES, 6),
  };
}

function emit(callback: (() => void | Promise<void>) | undefined): void {
  if (!callback) return;
  void Promise.resolve(callback()).catch(() => {});
}

function emitWith<T>(callback: ((value: T) => void | Promise<void>) | undefined, value: T): void {
  if (!callback) return;
  void Promise.resolve(callback(value)).catch(() => {});
}

export class SileroVadStream {
  private processing = Promise.resolve();
  private closed = false;

  private constructor(
    private readonly engine: SileroVadEngine,
    private readonly callbacks: SileroVadStreamCallbacks,
  ) {}

  static async create(options: SileroVadStreamOptions = {}): Promise<SileroVadStream> {
    const callbacks = options.callbacks ?? {};
    const createEngine = options.createEngine ?? (async (vadOptions) => {
      // Loading ONNX is intentionally deferred until native realtime voice is selected.
      const { RealTimeVAD } = await import('avr-vad');
      return await RealTimeVAD.new(vadOptions);
    });
    let stream: SileroVadStream | null = null;
    const engine = await createEngine({
      ...sileroVadOptions(options.env),
      onSpeechRealStart: () => {
        if (stream && !stream.closed) emit(callbacks.onSpeechStart);
      },
      onSpeechEnd: (audio: Float32Array) => {
        if (stream && !stream.closed && audio.length > 0) emitWith(callbacks.onSpeechEnd, float32ToPcm16le(audio));
      },
    });
    stream = new SileroVadStream(engine, callbacks);
    engine.start();
    return stream;
  }

  appendPcm(pcm: Buffer): Promise<void> {
    if (this.closed || pcm.byteLength < 2) return Promise.resolve();
    const audio = pcm16leToFloat32(Buffer.from(pcm));
    this.processing = this.processing
      .catch(() => {})
      .then(async () => {
        if (!this.closed) await this.engine.processAudio(audio);
      })
      .catch((error: unknown) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        emitWith(this.callbacks.onError, normalized);
        throw normalized;
      });
    return this.processing;
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    await this.processing.catch(() => {});
    if (!this.closed) await this.engine.flush();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.processing.catch(() => {});
    this.engine.reset();
    await this.engine.destroy();
  }
}
