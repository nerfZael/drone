import {
  LiveAudioBudget,
  LIVE_AUDIO_FRAME_BYTES,
  LIVE_AUDIO_QUEUE_BYTES,
  pcmFromBase64,
  pcmToBase64,
  type LiveAudioFrame,
  type LiveAudioStream,
  type LiveAudioAnswer,
  type LiveAudioFrameAuth,
} from '@drone/device-protocol';
import type { DeviceHttpChannel } from './device-http-channel';

export type LiveAudioEndpoint = LiveAudioStream & {
  answer?: LiveAudioAnswer;
  onAudio(listener: (audio: string) => void): void;
  onClose(listener: () => void): void;
};
export type LiveAudioSummary = {
  source: string;
  target: string;
  session: string;
  relayed: boolean;
  durationMs: number;
  inputFrames: number;
  inputBytes: number;
  outputFrames: number;
  outputBytes: number;
  peakQueuedBytes: number;
  reason: string;
};
type Direction = { budget: LiveAudioBudget; queued: number; work: Promise<void> };
type Route = {
  startedAt: number;
  inputFrames: number;
  inputBytes: number;
  outputFrames: number;
  outputBytes: number;
  peakQueuedBytes: number;
  source: string;
  target: string;
  session: string;
  upstream: DeviceHttpChannel;
  downstream?: DeviceHttpChannel;
  input: Direction;
  output: Direction;
  sequence: number;
  closed: boolean;
  auth?: LiveAudioFrameAuth;
  endpoint?: LiveAudioEndpoint;
  audio?: (audio: string) => void;
  close?: () => void;
};
const direction = (): Direction => ({
  budget: new LiveAudioBudget(),
  queued: 0,
  work: Promise.resolve(),
});

/** Relays forward opaque authenticated frames. Only endpoints hold session keys. */
export class MeshLiveAudioRouter {
  private readonly routes = new Map<string, Route>();
  private readonly retired = new Map<string, { channels: DeviceHttpChannel[]; until: number }>();
  constructor(private readonly onClosed: (summary: LiveAudioSummary) => void = () => {}) {}
  private key(source: string, target: string, session: string): string {
    return JSON.stringify([source, target, session]);
  }

  async open(
    source: string,
    target: string,
    session: string,
    upstream: DeviceHttpChannel,
    downstream?: DeviceHttpChannel,
    negotiation?: { answer: LiveAudioAnswer; auth: LiveAudioFrameAuth },
  ): Promise<LiveAudioEndpoint> {
    if (!session || session.length > 200) throw new Error('Invalid Live session');
    if (!downstream && !negotiation) throw new Error('Live audio key exchange is required');
    const key = this.key(source, target, session);
    for (const [id, marker] of this.retired)
      if (marker.until <= Date.now()) this.retired.delete(id);
    if (this.retired.get(key)?.channels.includes(upstream))
      throw new Error('Live audio session was already closed');
    const existing = this.routes.get(key);
    if (existing) {
      if (existing.upstream === upstream && existing.downstream === downstream && existing.endpoint)
        return existing.endpoint;
      throw new Error('Live audio session is already opening');
    }
    this.closeSession(source, target);
    if (this.routes.size >= 100) throw new Error('Too many Live audio streams');
    const route: Route = {
      startedAt: Date.now(),
      inputFrames: 0,
      inputBytes: 0,
      outputFrames: 0,
      outputBytes: 0,
      peakQueuedBytes: 0,
      source,
      target,
      session,
      upstream,
      downstream,
      input: direction(),
      output: direction(),
      sequence: 0,
      closed: false,
      auth: negotiation?.auth,
    };
    this.routes.set(key, route);
    try {
      // Forward start while the reverse-connected Hub opens its audio socket.
      if (downstream)
        void downstream
          .ensureLiveAudio()
          .catch(() => this.remove(key, route, 'transport-unavailable'));
      await upstream.ensureLiveAudio();
      if (route.closed) throw new Error('Live audio setup was cancelled');
    } catch (error) {
      this.remove(key, route);
      throw error;
    }
    const endpoint: LiveAudioEndpoint = {
      answer: negotiation?.answer,
      onAudio: (listener) => {
        route.audio = listener;
      },
      onClose: (listener) => {
        route.close = listener;
      },
      send: async (audio) => {
        if (!route.auth) throw new Error('A relay cannot originate endpoint audio');
        const pcm = pcmFromBase64(audio);
        for (let offset = 0; offset < pcm.length; offset += LIVE_AUDIO_FRAME_BYTES) {
          const chunk = pcm.subarray(offset, offset + LIVE_AUDIO_FRAME_BYTES);
          await this.enqueue(key, route, route.output, chunk.length, async () => {
            const frame = route.auth!.protect({
              sourceDeviceId: target,
              targetDeviceId: source,
              sessionId: session,
              sequence: route.sequence++,
              pcm: chunk,
            });
            if (!route.output.budget.accept(frame))
              throw new Error('Live audio exceeded its stream budget');
            route.outputFrames++;
            route.outputBytes += chunk.length;
            await upstream.sendLiveAudio(frame, () => !route.closed);
          });
        }
      },
      close: () => this.remove(key, route),
    };
    route.endpoint = endpoint;
    return endpoint;
  }

  receive(channel: DeviceHttpChannel, frame: LiveAudioFrame): void {
    let key = this.key(frame.sourceDeviceId, frame.targetDeviceId, frame.sessionId);
    let route = this.routes.get(key);
    let returning = false;
    if (!route) {
      key = this.key(frame.targetDeviceId, frame.sourceDeviceId, frame.sessionId);
      route = this.routes.get(key);
      returning = true;
    }
    if (!route) {
      // A transport failure can overtake start. It is explicitly a hop abort,
      // not a forged endpoint close; bind the bounded marker to that same hop.
      if (frame.aborted) {
        this.rememberClosed(
          this.key(frame.sourceDeviceId, frame.targetDeviceId, frame.sessionId),
          [channel],
          false,
        );
        this.rememberClosed(
          this.key(frame.targetDeviceId, frame.sourceDeviceId, frame.sessionId),
          [channel],
          false,
        );
      }
      return;
    }
    if (channel !== (returning ? route.downstream : route.upstream)) {
      channel.closeLiveAudio();
      return;
    }
    if (frame.aborted) {
      this.remove(key, route, 'hop-aborted');
      return;
    }
    if (route.auth && !route.auth.verify(frame)) {
      this.remove(key, route, 'authentication-failed');
      return;
    }
    if (frame.closed) {
      this.remove(key, route, 'remote-closed', frame);
      return;
    }
    const queue = returning ? route.output : route.input;
    if (!queue.budget.accept(frame)) {
      this.remove(key, route, 'rate-or-sequence-limit');
      return;
    }
    const current = route;
    if (returning) {
      current.outputFrames++;
      current.outputBytes += frame.pcm.length;
    } else {
      current.inputFrames++;
      current.inputBytes += frame.pcm.length;
    }
    void this.enqueue(key, route, queue, frame.pcm.length, async () => {
      if (returning) await current.upstream.sendLiveAudio(frame, () => !current.closed);
      else if (current.downstream)
        await current.downstream.sendLiveAudio(frame, () => !current.closed);
      else current.audio?.(pcmToBase64(frame.pcm));
    }).catch(() => undefined);
  }

  private enqueue(
    key: string,
    route: Route,
    queue: Direction,
    bytes: number,
    work: () => Promise<void>,
  ): Promise<void> {
    if (route.closed) return Promise.reject(new Error('Live audio session closed'));
    if (queue.queued + bytes > LIVE_AUDIO_QUEUE_BYTES) {
      this.remove(key, route, 'queue-limit');
      return Promise.reject(new Error('Live audio queue is full'));
    }
    queue.queued += bytes;
    route.peakQueuedBytes = Math.max(route.peakQueuedBytes, queue.queued);
    const pending = queue.work.then(async () => {
      if (!route.closed) await work();
    });
    queue.work = pending
      .catch(() => this.remove(key, route, 'send-failed'))
      .finally(() => {
        queue.queued -= bytes;
      });
    return pending;
  }
  closeSession(source: string, target: string, session?: string): void {
    for (const [key, route] of this.routes)
      if (
        route.source === source &&
        route.target === target &&
        (!session || route.session === session)
      )
        this.remove(key, route);
  }
  disconnect(channel: DeviceHttpChannel): void {
    for (const [key, route] of this.routes)
      if (route.upstream === channel || route.downstream === channel)
        this.remove(key, route, 'transport-closed');
  }
  revoke(deviceId: string): void {
    for (const [key, route] of this.routes)
      if (route.source === deviceId || route.target === deviceId)
        this.remove(key, route, 'access-changed');
  }
  close(): void {
    for (const [key, route] of this.routes) this.remove(key, route);
  }
  private rememberClosed(key: string, channels: DeviceHttpChannel[], authoritative: boolean): void {
    const old = this.retired.get(key);
    if (old && !authoritative) return;
    if (this.retired.size >= 1_000 && !old) {
      if (!authoritative) return;
      this.retired.delete(this.retired.keys().next().value!);
    }
    this.retired.set(key, { channels, until: Date.now() + 60_000 });
  }
  private remove(
    key: string,
    route: Route,
    reason = 'session-closed',
    terminal?: LiveAudioFrame,
  ): void {
    if (route.closed) return;
    route.closed = true;
    this.rememberClosed(
      key,
      [route.upstream, ...(route.downstream ? [route.downstream] : [])],
      true,
    );
    if (this.routes.get(key) === route) this.routes.delete(key);
    const header = {
      sessionId: route.session,
      sequence: Number.MAX_SAFE_INTEGER,
      pcm: new Uint8Array(),
    };
    if (route.auth) {
      const closed = route.auth.protect({
        ...header,
        sourceDeviceId: route.target,
        targetDeviceId: route.source,
        closed: true,
      });
      void route.upstream.sendLiveAudio(closed).catch(() => undefined);
    } else if (terminal) {
      // Preserve the endpoint's MAC and direction; relays cannot synthesize it.
      const target = terminal.sourceDeviceId === route.source ? route.downstream : route.upstream;
      void target?.sendLiveAudio(terminal).catch(() => undefined);
    } else {
      // A relay may report its own failed delivery, never impersonate an endpoint.
      void route.upstream
        .sendLiveAudio({
          ...header,
          sourceDeviceId: route.target,
          targetDeviceId: route.source,
          aborted: true,
        })
        .catch(() => undefined);
      void route.downstream
        ?.sendLiveAudio({
          ...header,
          sourceDeviceId: route.source,
          targetDeviceId: route.target,
          aborted: true,
        })
        .catch(() => undefined);
    }
    route.close?.();
    try {
      this.onClosed({
        source: route.source,
        target: route.target,
        session: route.session,
        relayed: Boolean(route.downstream),
        durationMs: Math.max(0, Date.now() - route.startedAt),
        inputFrames: route.inputFrames,
        inputBytes: route.inputBytes,
        outputFrames: route.outputFrames,
        outputBytes: route.outputBytes,
        peakQueuedBytes: route.peakQueuedBytes,
        reason,
      });
    } catch {
      /* Diagnostics cannot interrupt cleanup. */
    }
  }
}
