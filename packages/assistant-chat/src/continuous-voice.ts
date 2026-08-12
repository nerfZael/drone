export const CONTINUOUS_VOICE_SAMPLE_RATE = 16_000;
export const CONTINUOUS_VOICE_MINIMUM_SILENCE_MILLIS = 250;

export type ContinuousVoiceNoiseHandling = 'auto' | 'quiet' | 'noisy';
export type ContinuousVoiceEndpointReason = 'silence' | 'maximum-duration' | 'flush';
export type ContinuousVoiceActivity = 'silence' | 'speech' | 'thought-pause';

export type ContinuousVoiceEndpointConfig = {
  sampleRate: number;
  frameMillis: number;
  preRollMillis: number;
  trailingMillis: number;
  minimumSpeechMillis: number;
  silenceMillis: number;
  maximumSegmentMillis: number;
  noiseHandling: ContinuousVoiceNoiseHandling;
};

export type ContinuousVoiceSegment = {
  sequence: number;
  pcm: Int16Array;
  durationMillis: number;
  reason: ContinuousVoiceEndpointReason;
};

export type ContinuousVoicePushResult = {
  activity: ContinuousVoiceActivity;
  segments: ContinuousVoiceSegment[];
};

export const DEFAULT_CONTINUOUS_VOICE_ENDPOINT_CONFIG: ContinuousVoiceEndpointConfig = {
  sampleRate: CONTINUOUS_VOICE_SAMPLE_RATE,
  frameMillis: 20,
  preRollMillis: 300,
  trailingMillis: 400,
  minimumSpeechMillis: 300,
  silenceMillis: 2_500,
  maximumSegmentMillis: 60_000,
  noiseHandling: 'auto',
};

type NoiseProfile = {
  minimumStartRms: number;
  noiseMultiplier: number;
  releaseRatio: number;
  adaptationRate: number;
};

const NOISE_PROFILES: Record<ContinuousVoiceNoiseHandling, NoiseProfile> = {
  quiet: {
    minimumStartRms: 0.007,
    noiseMultiplier: 2.2,
    releaseRatio: 0.58,
    adaptationRate: 0.025,
  },
  auto: {
    minimumStartRms: 0.011,
    noiseMultiplier: 2.8,
    releaseRatio: 0.62,
    adaptationRate: 0.018,
  },
  noisy: {
    minimumStartRms: 0.018,
    noiseMultiplier: 3.6,
    releaseRatio: 0.68,
    adaptationRate: 0.012,
  },
};

function clampInteger(value: number, fallback: number, minimum: number): number {
  return Number.isFinite(value) ? Math.max(minimum, Math.round(value)) : fallback;
}

export function normalizeContinuousVoiceEndpointConfig(
  input: Partial<ContinuousVoiceEndpointConfig> = {},
): ContinuousVoiceEndpointConfig {
  const defaults = DEFAULT_CONTINUOUS_VOICE_ENDPOINT_CONFIG;
  const noiseHandling =
    input.noiseHandling === 'quiet' || input.noiseHandling === 'noisy'
      ? input.noiseHandling
      : 'auto';
  return {
    sampleRate: clampInteger(input.sampleRate ?? defaults.sampleRate, defaults.sampleRate, 8_000),
    frameMillis: clampInteger(input.frameMillis ?? defaults.frameMillis, defaults.frameMillis, 10),
    preRollMillis: clampInteger(input.preRollMillis ?? defaults.preRollMillis, defaults.preRollMillis, 0),
    trailingMillis: clampInteger(input.trailingMillis ?? defaults.trailingMillis, defaults.trailingMillis, 0),
    minimumSpeechMillis: clampInteger(
      input.minimumSpeechMillis ?? defaults.minimumSpeechMillis,
      defaults.minimumSpeechMillis,
      40,
    ),
    silenceMillis: clampInteger(
      input.silenceMillis ?? defaults.silenceMillis,
      defaults.silenceMillis,
      CONTINUOUS_VOICE_MINIMUM_SILENCE_MILLIS,
    ),
    maximumSegmentMillis: clampInteger(
      input.maximumSegmentMillis ?? defaults.maximumSegmentMillis,
      defaults.maximumSegmentMillis,
      1_000,
    ),
    noiseHandling,
  };
}

function pcmRms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let energy = 0;
  for (let index = 0; index < frame.length; index += 1) {
    const normalized = (frame[index] ?? 0) / 32_768;
    energy += normalized * normalized;
  }
  return Math.sqrt(energy / frame.length);
}

function concatPcm(parts: readonly Int16Array[], sampleCount?: number): Int16Array {
  const total = sampleCount ?? parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    if (offset >= total) break;
    const remaining = total - offset;
    output.set(part.length <= remaining ? part : part.subarray(0, remaining), offset);
    offset += Math.min(part.length, remaining);
  }
  return output;
}

/**
 * A deterministic, platform-neutral acoustic endpointer. It deliberately owns
 * no timers: silence and duration are derived from audio samples, so delayed UI
 * or network work cannot alter segment boundaries.
 */
export class ContinuousVoiceSegmenter {
  readonly config: ContinuousVoiceEndpointConfig;

  private readonly frameSamples: number;
  private readonly preRollSamples: number;
  private readonly trailingSamples: number;
  private readonly minimumSpeechSamples: number;
  private readonly silenceSamples: number;
  private readonly maximumSegmentSamples: number;
  private readonly profile: NoiseProfile;
  private pending = new Int16Array(0);
  private preRoll: Int16Array[] = [];
  private preRollLength = 0;
  private active: Int16Array[] = [];
  private activeLength = 0;
  private speechLength = 0;
  private lastSpeechEnd = 0;
  private speaking = false;
  private noiseFloorRms = 0.003;
  private nextSequence = 0;

  constructor(config: Partial<ContinuousVoiceEndpointConfig> = {}) {
    this.config = normalizeContinuousVoiceEndpointConfig(config);
    this.frameSamples = Math.max(1, Math.round((this.config.sampleRate * this.config.frameMillis) / 1_000));
    this.preRollSamples = Math.round((this.config.sampleRate * this.config.preRollMillis) / 1_000);
    this.trailingSamples = Math.round((this.config.sampleRate * this.config.trailingMillis) / 1_000);
    this.minimumSpeechSamples = Math.round((this.config.sampleRate * this.config.minimumSpeechMillis) / 1_000);
    this.silenceSamples = Math.round((this.config.sampleRate * this.config.silenceMillis) / 1_000);
    this.maximumSegmentSamples = Math.round((this.config.sampleRate * this.config.maximumSegmentMillis) / 1_000);
    this.profile = NOISE_PROFILES[this.config.noiseHandling];
  }

  push(input: Int16Array): ContinuousVoicePushResult {
    if (input.length === 0) return { activity: this.currentActivity(), segments: [] };
    const combined = new Int16Array(this.pending.length + input.length);
    combined.set(this.pending, 0);
    combined.set(input, this.pending.length);
    const segments: ContinuousVoiceSegment[] = [];
    let offset = 0;
    while (offset + this.frameSamples <= combined.length) {
      const frame = combined.slice(offset, offset + this.frameSamples);
      offset += this.frameSamples;
      const segment = this.pushFrame(frame);
      if (segment) segments.push(segment);
    }
    this.pending = combined.slice(offset);
    return { activity: this.currentActivity(), segments };
  }

  flush(): ContinuousVoiceSegment | null {
    if (this.pending.length > 0) {
      const padded = new Int16Array(this.frameSamples);
      padded.set(this.pending);
      this.pending = new Int16Array(0);
      this.pushFrame(padded, false);
    }
    return this.finalize('flush');
  }

  discard(): void {
    this.pending = new Int16Array(0);
    this.preRoll = [];
    this.preRollLength = 0;
    this.resetActive();
  }

  private currentActivity(): ContinuousVoiceActivity {
    if (!this.active.length) return 'silence';
    return this.speaking ? 'speech' : 'thought-pause';
  }

  private pushFrame(frame: Int16Array, allowEndpoint = true): ContinuousVoiceSegment | null {
    const rms = pcmRms(frame);
    const startThreshold = Math.max(
      this.profile.minimumStartRms,
      this.noiseFloorRms * this.profile.noiseMultiplier,
    );
    const stopThreshold = startThreshold * this.profile.releaseRatio;
    const hasSpeech = rms >= (this.speaking ? stopThreshold : startThreshold);

    if (!this.active.length && !hasSpeech) {
      this.adaptNoiseFloor(rms);
      this.pushPreRoll(frame);
      return null;
    }

    if (!this.active.length) {
      this.active = this.preRoll;
      this.activeLength = this.preRollLength;
      this.preRoll = [];
      this.preRollLength = 0;
    }

    this.active.push(frame);
    this.activeLength += frame.length;
    this.speaking = hasSpeech;
    if (hasSpeech) {
      this.speechLength += frame.length;
      this.lastSpeechEnd = this.activeLength;
    } else {
      this.adaptNoiseFloor(rms);
    }

    if (allowEndpoint && this.activeLength >= this.maximumSegmentSamples) {
      return this.finalize('maximum-duration');
    }
    const trailingSilence = this.activeLength - this.lastSpeechEnd;
    if (allowEndpoint && this.lastSpeechEnd > 0 && trailingSilence >= this.silenceSamples) {
      return this.finalize('silence');
    }
    return null;
  }

  private adaptNoiseFloor(rms: number): void {
    // Do not let a sudden loud event redefine the room. Slow adaptation handles
    // fans and HVAC while retaining sensitivity to soft speech.
    const capped = Math.min(rms, this.noiseFloorRms * 1.8 + 0.002);
    this.noiseFloorRms =
      this.noiseFloorRms * (1 - this.profile.adaptationRate) +
      capped * this.profile.adaptationRate;
  }

  private pushPreRoll(frame: Int16Array): void {
    if (this.preRollSamples === 0) return;
    this.preRoll.push(frame);
    this.preRollLength += frame.length;
    while (this.preRollLength - (this.preRoll[0]?.length ?? 0) >= this.preRollSamples) {
      this.preRollLength -= this.preRoll[0]?.length ?? 0;
      this.preRoll.shift();
    }
  }

  private finalize(reason: ContinuousVoiceEndpointReason): ContinuousVoiceSegment | null {
    if (!this.active.length) return null;
    const valid = this.speechLength >= this.minimumSpeechSamples && this.lastSpeechEnd > 0;
    const desiredLength = Math.min(this.activeLength, this.lastSpeechEnd + this.trailingSamples);
    const pcm = valid ? concatPcm(this.active, desiredLength) : null;
    this.resetActive();
    if (!pcm || pcm.length === 0) return null;
    const sequence = this.nextSequence;
    this.nextSequence += 1;
    return {
      sequence,
      pcm,
      durationMillis: Math.round((pcm.length / this.config.sampleRate) * 1_000),
      reason,
    };
  }

  private resetActive(): void {
    this.active = [];
    this.activeLength = 0;
    this.speechLength = 0;
    this.lastSpeechEnd = 0;
    this.speaking = false;
  }
}

export function normalizePcm16Audio(input: {
  pcm: Int16Array;
  sampleRate: number;
  channels?: number;
  targetSampleRate?: number;
}): Int16Array {
  const channels = Math.max(1, Math.round(input.channels ?? 1));
  const sourceRate = Math.max(1, Math.round(input.sampleRate));
  const targetRate = Math.max(1, Math.round(input.targetSampleRate ?? CONTINUOUS_VOICE_SAMPLE_RATE));
  const frameCount = Math.floor(input.pcm.length / channels);
  if (frameCount === 0) return new Int16Array(0);
  const mono = new Int16Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += input.pcm[frame * channels + channel] ?? 0;
    }
    mono[frame] = Math.max(-32_768, Math.min(32_767, Math.round(sum / channels)));
  }
  if (sourceRate === targetRate) return mono;
  const outputLength = Math.max(1, Math.round((mono.length * targetRate) / sourceRate));
  const output = new Int16Array(outputLength);
  const ratio = sourceRate / targetRate;
  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * ratio;
    const leftIndex = Math.min(mono.length - 1, Math.floor(sourcePosition));
    const rightIndex = Math.min(mono.length - 1, leftIndex + 1);
    const mix = sourcePosition - leftIndex;
    output[index] = Math.round((mono[leftIndex] ?? 0) * (1 - mix) + (mono[rightIndex] ?? 0) * mix);
  }
  return output;
}

export function pcm16ToWaveBytes(
  pcm: Int16Array,
  sampleRate = CONTINUOUS_VOICE_SAMPLE_RATE,
  channels = 1,
): Uint8Array {
  const bytesPerSample = 2;
  const dataSize = pcm.byteLength;
  const bytes = new Uint8Array(44 + dataSize);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataSize, true);
  bytes.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 44);
  return bytes;
}
