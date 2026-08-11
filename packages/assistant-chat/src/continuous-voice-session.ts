import {
  ContinuousVoiceSegmenter,
  type ContinuousVoiceActivity,
  type ContinuousVoiceEndpointConfig,
  type ContinuousVoiceSegment,
} from './continuous-voice.js';

export type ContinuousVoiceSessionStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'speech'
  | 'thought-pause'
  | 'recovering'
  | 'paused'
  | 'stopping'
  | 'error';

export type ContinuousVoiceSessionSnapshot = {
  status: ContinuousVoiceSessionStatus;
  pendingCount: number;
  durationMillis: number;
};

export type ContinuousVoiceTranscriptionInput = {
  segment: ContinuousVoiceSegment;
  context: string;
  signal: AbortSignal;
};

export type ContinuousVoiceSessionStart = {
  sessionId: string;
  endpointConfig: Partial<ContinuousVoiceEndpointConfig>;
  transcribe(input: ContinuousVoiceTranscriptionInput): Promise<string>;
  route?(): string | null;
  deliver(text: string, deliveryId: string, route: string | null): Promise<boolean>;
  confirm?(): void;
};

export type ContinuousVoiceResumeResult = 'ignored' | 'resumed' | 'finished';

type ContinuousVoiceSessionOptions = {
  onChange(snapshot: ContinuousVoiceSessionSnapshot): void;
  onError(message: string): void;
  maximumPendingSegments?: number;
};

const DEFAULT_MAXIMUM_PENDING_SEGMENTS = 8;
const TRANSCRIPT_CONTEXT_CHARACTERS = 1_200;
const DURATION_UPDATE_MILLIS = 500;

type QueuedContinuousVoiceSegment = {
  segment: ContinuousVoiceSegment;
  route: string | null;
};

/**
 * Owns the platform-neutral lifecycle of a continuous voice session. Browser
 * and native callers only provide PCM capture, transcription, and feedback.
 */
export class ContinuousVoiceSession {
  private readonly options: ContinuousVoiceSessionOptions;
  private readonly maximumPendingSegments: number;
  private generation = 0;
  private currentStatus: ContinuousVoiceSessionStatus = 'idle';
  private segmenter: ContinuousVoiceSegmenter | null = null;
  private queue: QueuedContinuousVoiceSegment[] = [];
  private drainPromise: Promise<void> | null = null;
  private abortController: AbortController | null = null;
  private callbacks: ContinuousVoiceSessionStart | null = null;
  private transcriptContext = '';
  private sampleCount = 0;
  private paused = false;
  private finishing = false;
  private lastSnapshot: ContinuousVoiceSessionSnapshot | null = null;

  constructor(options: ContinuousVoiceSessionOptions) {
    this.options = options;
    this.maximumPendingSegments = Math.max(
      1,
      Math.round(options.maximumPendingSegments ?? DEFAULT_MAXIMUM_PENDING_SEGMENTS),
    );
  }

  get status(): ContinuousVoiceSessionStatus {
    return this.currentStatus;
  }

  get isFinishing(): boolean {
    return this.finishing;
  }

  begin(): boolean {
    if (this.currentStatus !== 'idle') return false;
    this.generation += 1;
    this.callbacks = null;
    this.segmenter = null;
    this.queue = [];
    this.transcriptContext = '';
    this.sampleCount = 0;
    this.paused = false;
    this.finishing = false;
    this.setStatus('starting');
    return true;
  }

  configure(input: ContinuousVoiceSessionStart): void {
    if (this.currentStatus !== 'starting') return;
    this.callbacks = input;
    this.segmenter = new ContinuousVoiceSegmenter(input.endpointConfig);
  }

  start(input: ContinuousVoiceSessionStart): void {
    if (!this.begin()) return;
    this.configure(input);
  }

  listen(): void {
    if (this.currentStatus !== 'starting' && this.currentStatus !== 'recovering') return;
    this.setStatus('listening');
  }

  push(pcm: Int16Array): void {
    if (
      pcm.length === 0 ||
      this.paused ||
      !this.segmenter ||
      this.currentStatus === 'idle' ||
      this.currentStatus === 'stopping'
    ) {
      return;
    }
    this.sampleCount += pcm.length;
    const result = this.segmenter.push(pcm);
    this.setStatus(statusForActivity(result.activity));
    this.enqueue(result.segments);
    this.emit();
  }

  pause(): void {
    if (this.currentStatus === 'idle' || this.currentStatus === 'starting') return;
    this.paused = true;
    this.setStatus('paused');
  }

  async resume(): Promise<ContinuousVoiceResumeResult> {
    if (this.currentStatus === 'error' && this.finishing) {
      this.paused = false;
      this.setStatus('stopping');
      await this.drain();
      if (this.currentStatus === 'error') return 'ignored';
      this.resetToIdle();
      return 'finished';
    }
    if (this.currentStatus !== 'paused' && this.currentStatus !== 'error') return 'ignored';
    this.paused = false;
    this.setStatus('listening');
    if (this.queue.length > 0) void this.drain();
    return 'resumed';
  }

  interrupt(): void {
    if (!this.segmenter || this.currentStatus === 'idle') return;
    const segment = this.segmenter.flush();
    if (segment) this.enqueue([segment]);
    if (this.currentStatus !== 'error') this.setStatus('recovering');
  }

  recover(): void {
    if (this.currentStatus === 'recovering') this.setStatus('listening');
  }

  reportError(message: string): void {
    if (this.currentStatus !== 'idle') this.fail(message);
  }

  async finish(): Promise<boolean> {
    if (this.currentStatus === 'idle') return true;
    if (this.currentStatus === 'starting') {
      this.cancel();
      return true;
    }
    this.paused = true;
    this.finishing = true;
    this.setStatus('stopping');
    const segment = this.segmenter?.flush() ?? null;
    this.segmenter = null;
    if (segment) this.enqueue([segment]);
    await this.drain();
    if (this.currentStatus === 'error') return false;
    this.resetToIdle();
    return true;
  }

  cancel(): void {
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.segmenter?.discard();
    this.segmenter = null;
    this.queue = [];
    this.drainPromise = null;
    this.resetToIdle();
  }

  discardPending(): void {
    if (
      this.currentStatus === 'idle' ||
      this.currentStatus === 'starting' ||
      this.currentStatus === 'stopping'
    ) {
      return;
    }
    this.generation += 1;
    this.abortController?.abort();
    this.abortController = null;
    this.segmenter?.discard();
    this.queue = [];
    this.drainPromise = null;
    this.transcriptContext = '';
    if (!this.paused && this.currentStatus !== 'recovering') this.setStatus('listening');
    this.emit();
  }

  private enqueue(segments: ContinuousVoiceSegment[]): void {
    if (segments.length === 0) return;
    const maximumRetained = this.maximumPendingSegments + 1;
    const available = Math.max(0, maximumRetained - this.queue.length);
    const retained = segments.slice(0, available);
    const route = this.callbacks?.route?.() ?? null;
    this.queue.push(...retained.map((segment) => ({ segment, route })));
    this.emit();
    if (retained.length < segments.length) {
      this.fail('Continuous voice stopped accepting audio because its retained backlog is full.');
      return;
    }
    if (this.queue.length > this.maximumPendingSegments) {
      this.fail('Continuous voice paused because the transcription backlog is full.');
      void this.drain();
      return;
    }
    void this.drain();
  }

  private drain(): Promise<void> {
    if (this.drainPromise) return this.drainPromise;
    const generation = this.generation;
    const work = (async () => {
      while (this.generation === generation && this.queue.length > 0) {
        const callbacks = this.callbacks;
        const queued = this.queue[0]!;
        const segment = queued.segment;
        const controller = new AbortController();
        this.abortController = controller;
        try {
          if (!callbacks) throw new Error('Continuous voice lost its target chat.');
          const transcript = await callbacks.transcribe({
            segment,
            context: this.transcriptContext,
            signal: controller.signal,
          });
          if (this.generation !== generation) return;
          const cleanTranscript = transcript.trim();
          if (cleanTranscript) {
            const accepted = await callbacks.deliver(
              cleanTranscript,
              `${callbacks.sessionId}.${segment.sequence}`,
              queued.route,
            );
            if (this.generation !== generation) return;
            if (!accepted) throw new Error('The voice input target did not accept the transcription.');
            this.transcriptContext = `${this.transcriptContext} ${cleanTranscript}`
              .trim()
              .slice(-TRANSCRIPT_CONTEXT_CHARACTERS);
            callbacks.confirm?.();
          }
          this.queue.shift();
          this.emit();
        } catch (error) {
          if (controller.signal.aborted || this.generation !== generation) return;
          this.fail(errorMessage(error));
          return;
        } finally {
          if (this.abortController === controller) this.abortController = null;
        }
      }
    })().finally(() => {
      if (this.drainPromise === work) this.drainPromise = null;
    });
    this.drainPromise = work;
    return work;
  }

  private fail(message: string): void {
    this.paused = true;
    this.setStatus('error');
    this.options.onError(message);
  }

  private resetToIdle(): void {
    this.callbacks = null;
    this.transcriptContext = '';
    this.sampleCount = 0;
    this.paused = false;
    this.finishing = false;
    this.setStatus('idle');
  }

  private setStatus(status: ContinuousVoiceSessionStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emit();
  }

  private emit(): void {
    const snapshot: ContinuousVoiceSessionSnapshot = {
      status: this.currentStatus,
      pendingCount: this.queue.length,
      durationMillis: Math.round((this.sampleCount / 16_000) * 1_000),
    };
    const previous = this.lastSnapshot;
    const sameDurationWindow =
      previous &&
      Math.floor(previous.durationMillis / DURATION_UPDATE_MILLIS) ===
        Math.floor(snapshot.durationMillis / DURATION_UPDATE_MILLIS);
    if (
      previous?.status === snapshot.status &&
      previous.pendingCount === snapshot.pendingCount &&
      sameDurationWindow
    ) {
      return;
    }
    this.lastSnapshot = snapshot;
    this.options.onChange(snapshot);
  }
}

function statusForActivity(activity: ContinuousVoiceActivity): ContinuousVoiceSessionStatus {
  return activity === 'silence' ? 'listening' : activity;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
