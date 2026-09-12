import { COMPANION_CAPABILITY, type CapabilityEvent } from '@drone/device-protocol';
import type { RTCPeerConnection, MediaStream } from 'react-native-webrtc';
import type { MobileMicrophoneCoordinator, MobileMicrophoneLease } from './mobile-microphone-coordinator';

type Audio = { peer: RTCPeerConnection; microphone: MediaStream; release(): Promise<void> };
type Options = {
  targetDeviceId: string;
  sessionId: string;
  microphoneCoordinator: MobileMicrophoneCoordinator;
  openAudio(): Promise<Audio>;
  request(deviceId: string, capability: string, operation: string, payload?: unknown): Promise<unknown>;
  subscribe(capability: string, event: string, listener: (event: CapabilityEvent) => void): () => void;
  onEvent(event: Record<string, unknown>): void;
  onReady(model: string): void;
  onError(error: string): void;
};

export class MobileCompanionLiveConnection {
  private audio: Audio | null = null;
  private lease: MobileMicrophoneLease | null = null;
  private closed = false;
  private ready = false;
  private mediaReady = false;
  private controlReady = false;
  private answerReceived = false;
  private muted = false;
  private started = false;
  private outgoingEvents = Promise.resolve();
  private backendModel = '';
  private unsubscribe: (() => void) | undefined;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private timeout: ReturnType<typeof setTimeout> | undefined;
  private disconnect: ReturnType<typeof setTimeout> | undefined;
  private releaseIce: (() => void) | undefined;
  private releasePendingAudio: Promise<void> = Promise.resolve();

  constructor(private readonly options: Options) {}

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    this.lease = this.options.microphoneCoordinator.acquire('companion');
    if (!this.lease) { this.fail('Another voice feature is using the microphone. Stop it before starting Live.'); return; }
    this.timeout = setTimeout(() => this.fail('Live voice took too long to connect. Try again.'), 40_000);
    let audioReady!: () => void;
    this.releasePendingAudio = new Promise((resolve) => { audioReady = resolve; });
    try {
      try {
        this.audio = await this.options.openAudio();
      } finally { audioReady(); }
      if (this.closed) return;
      const { peer, microphone } = this.audio;
      microphone.getTracks().forEach((track) => {
        track.enabled = false;
        track.onended = () => this.fail('Microphone disconnected. Start Live voice again.');
        peer.addTrack(track, microphone);
      });
      peer.onconnectionstatechange = () => {
        if (this.closed) return;
        clearTimeout(this.disconnect);
        if (peer.connectionState === 'failed' || peer.connectionState === 'closed') this.fail('Live audio disconnected. Start a new conversation.');
        else if (peer.connectionState === 'disconnected') this.disconnect = setTimeout(() => this.fail('Live audio disconnected. Start again.'), 5_000);
      };
      const channel = peer.createDataChannel('oai-events');
      channel.onmessage = ({ data }: { data: unknown }) => {
        const event = parseEvent(data);
        if (this.closed) return;
        if (event?.type === 'session.started' && !this.ready) {
          this.mediaReady = true;
          this.becomeReady();
        } else if (event?.type === 'session.closed') this.fail('Live conversation ended. Start again to reconnect.');
      };
      channel.onclose = () => { if (!this.closed) this.fail('Live voice disconnected.'); };
      this.unsubscribe = this.options.subscribe(COMPANION_CAPABILITY.id, 'live.event', (event) => {
        if (this.closed || event.sourceDeviceId !== this.options.targetDeviceId || event.payload?.sessionId !== this.options.sessionId) return;
        const payload = event.payload;
        if ((payload.type === 'live_answer' || payload.type === 'live_ready') && typeof payload.sdp === 'string') {
          this.backendModel = String(payload.backendModel ?? '');
          if (!this.answerReceived) {
            this.answerReceived = true;
            void peer.setRemoteDescription({ type: 'answer', sdp: payload.sdp }).catch(() => this.fail('Could not connect Live audio.'));
          }
          if (payload.type === 'live_ready') this.controlReady = true;
          this.becomeReady();
        } else if (payload.type === 'live_event') {
          const liveEvent = payload.event;
          if (liveEvent?.type === 'error') this.fail('Live voice reported an error. Start a new conversation.');
          else if (liveEvent && typeof liveEvent === 'object' && !Array.isArray(liveEvent)) this.options.onEvent(liveEvent);
        } else if (payload.type === 'live_error') this.fail(String(payload.error ?? 'Live voice failed.'));
        else if (payload.type === 'live_closed') this.fail('Live conversation ended. Start again to reconnect.');
      });
      await peer.setLocalDescription(await peer.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: false }));
      if (this.closed) return;
      await this.waitForIce(peer);
      if (this.closed) return;
      await this.request('live.start', { sdp: peer.localDescription?.sdp });
      if (this.closed) { void this.request('live.close').catch(() => undefined); return; }
      this.heartbeat = setInterval(() => {
        void this.request('live.ping').catch(() => this.fail('Live voice lost its connection to the Hub.'));
      }, 10_000);
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Live voice could not start.'); }
  }

  send(event: Record<string, unknown>): void {
    this.outgoingEvents = this.outgoingEvents.then(async () => {
      if (!this.closed) await this.request('live.event', { event });
    }).catch(() => this.fail('Could not send the backend result to Live.'));
  }

  mute(muted: boolean): void {
    this.muted = muted;
    this.audio?.microphone.getTracks().forEach((track) => { track.enabled = !this.closed && this.ready && !muted; });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.timeout);
    clearTimeout(this.disconnect);
    clearInterval(this.heartbeat);
    this.releaseIce?.();
    this.unsubscribe?.();
    this.audio?.microphone.getTracks().forEach((track) => { track.enabled = false; track.stop(); });
    this.audio?.peer.close();
    // Keep the lease through late native permission results and audio-mode cleanup.
    void this.lease?.release(async () => {
      await this.releasePendingAudio;
      await this.audio?.release();
      this.audio = null;
    }).catch(() => undefined);
    // Hub closes the sideband and uses HTTP hangup if final events cannot drain.
    if (this.started) void this.request('live.close').catch(() => undefined);
  }

  private request(operation: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    return this.options.request(this.options.targetDeviceId, COMPANION_CAPABILITY.id, operation,
      { sessionId: this.options.sessionId, ...payload });
  }

  private becomeReady(): void {
    if (this.closed || this.ready || !this.mediaReady || !this.controlReady) return;
    this.ready = true;
    clearTimeout(this.timeout);
    this.mute(this.muted);
    this.options.onReady(this.backendModel);
  }

  private fail(error: string): void {
    if (this.closed) return;
    this.close();
    this.options.onError(error);
  }

  private waitForIce(peer: RTCPeerConnection): Promise<void> {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        peer.onicegatheringstatechange = null;
        this.releaseIce = undefined;
        resolve();
      };
      const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, 5_000);
      this.releaseIce = finish;
      peer.onicegatheringstatechange = change;
    });
  }
}

function parseEvent(data: unknown): Record<string, unknown> | null {
  try { const value = JSON.parse(String(data)); return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
  catch { return null; }
}
