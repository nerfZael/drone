import { buildDirectApiWebSocketUrl } from '../app/direct-api-fetch';
import { browserMicrophoneCoordinator, type BrowserMicrophoneLease } from '../chat/browser-microphone-coordinator';

type Options = {
  onEvent(event: Record<string, unknown>): void;
  onReady(model: string): void;
  onError(error: string): void;
  onPlaybackBlocked(blocked: boolean): void;
};

export class CompanionLiveConnection {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private socket: WebSocket | null = null;
  private microphone: MediaStream | null = null;
  private lease: BrowserMicrophoneLease | null = null;
  private audio: HTMLAudioElement | null = null;
  private closed = false;
  private ready = false;
  private muted = false;
  private started = false;
  private mediaReady = false;
  private controlReady = false;
  private answerReceived = false;
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private startupTimer: ReturnType<typeof setTimeout> | undefined;
  private disconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closeTimer: ReturnType<typeof setTimeout> | undefined;
  private backendModel = '';
  private releasePendingStart: (() => void) | undefined;

  constructor(private readonly options: Options) {}

  async start(): Promise<void> {
    if (this.started || this.closed) return;
    this.started = true;
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
        throw new Error('Live voice needs microphone access and WebRTC in a secure browser.');
      }
      this.lease = browserMicrophoneCoordinator.acquire('companion');
      if (!this.lease) throw new Error('Another recording is using the microphone. Stop it before starting Live voice.');
      this.startupTimer = setTimeout(() => this.fail('Live voice took too long to connect. Try again.'), 40_000);
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: {
        echoCancellation: true, noiseSuppression: true, autoGainControl: true,
      } });
      if (this.closed) { microphone.getTracks().forEach((track) => track.stop()); return; }
      this.microphone = microphone;
      const peer = new RTCPeerConnection();
      this.peer = peer;
      const audio = document.createElement('audio');
      audio.autoplay = true;
      this.audio = audio;
      peer.ontrack = (event) => {
        if (this.closed) return;
        audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void this.play();
      };
      for (const track of microphone.getTracks()) {
        track.enabled = false;
        track.onended = () => this.fail('Microphone disconnected. Start Live voice again after reconnecting it.');
        peer.addTrack(track, microphone);
      }
      peer.onconnectionstatechange = () => {
        if (this.closed) return;
        clearTimeout(this.disconnectTimer);
        if (peer.connectionState === 'failed') this.fail('Live audio connection failed. Start a new conversation.');
        if (peer.connectionState === 'disconnected') {
          this.disconnectTimer = setTimeout(() => this.fail('Live audio disconnected. Start a new conversation.'), 5_000);
        }
      };
      const channel = peer.createDataChannel('oai-events');
      this.channel = channel;
      channel.onmessage = (message) => {
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) return;
        if (event.type === 'session.closed' && this.closed) { this.releaseTransports(); return; }
        if (event.type === 'session.started' && !this.closed && !this.ready) {
          this.mediaReady = true;
          this.becomeReady();
        }
        if (event.type === 'session.closed') this.fail('Live conversation ended. Start again to reconnect.');
      };
      channel.onclose = () => { if (!this.closed) this.fail('Live voice disconnected. Start a new conversation.'); };
      const socket = new WebSocket(buildDirectApiWebSocketUrl('/api/companion/stream'));
      this.socket = socket;
      let offerReady = false;
      let offerSent = false;
      const sendOffer = () => {
        if (this.closed || offerSent || !offerReady || socket.readyState !== WebSocket.OPEN) return;
        offerSent = true;
        socket.send(JSON.stringify({ type: 'live_start', sdp: peer.localDescription?.sdp }));
      };
      socket.onopen = () => {
        if (this.closed) { socket.close(); return; }
        sendOffer();
        this.heartbeat = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'live_ping' }));
        }, 10_000);
      };
      socket.onmessage = (message) => {
        let event: Record<string, unknown>;
        try { event = JSON.parse(String(message.data)); } catch { return; }
        if (!event || typeof event !== 'object' || Array.isArray(event)) return;
        if (this.closed) {
          if (event.type === 'live_closed') this.releaseTransports();
          return;
        }
        if ((event.type === 'live_answer' || event.type === 'live_ready') && typeof event.sdp === 'string') {
          this.backendModel = String(event.backendModel ?? '');
          if (!this.answerReceived) {
            this.answerReceived = true;
            void peer.setRemoteDescription({ type: 'answer', sdp: event.sdp }).catch(() => this.fail('Could not connect Live audio.'));
          }
          if (event.type === 'live_ready') this.controlReady = true;
          this.becomeReady();
        } else if (event.type === 'live_event') {
          const payload = event.event as Record<string, unknown>;
          if (payload?.type === 'error') {
            this.fail('Live voice reported an error. End the conversation and try again.');
          } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) this.options.onEvent(payload);
        } else if (event.type === 'live_error') this.fail(String(event.error ?? 'Live voice failed.'));
        else if (event.type === 'live_closed') this.fail('Live conversation ended. Start again to reconnect.');
      };
      socket.onerror = () => this.fail('Live voice could not connect to Drone Hub.');
      socket.onclose = () => { if (!this.closed) this.fail('Live voice disconnected from Drone Hub.'); };
      await peer.setLocalDescription(await peer.createOffer());
      if (this.closed) return;
      await this.waitForIce(peer);
      if (this.closed) return;
      offerReady = true;
      sendOffer();
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Live voice could not start.');
    }
  }

  send(event: Record<string, unknown>): void {
    if (!this.closed && this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'live_event', event }));
    }
  }

  mute(muted: boolean): void {
    this.muted = muted;
    this.microphone?.getTracks().forEach((track) => { track.enabled = !this.closed && this.ready && !muted; });
  }

  async play(): Promise<void> {
    if (this.closed || !this.audio) return;
    try { await this.audio.play(); if (!this.closed) this.options.onPlaybackBlocked(false); }
    catch { if (!this.closed) this.options.onPlaybackBlocked(true); }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.startupTimer);
    clearTimeout(this.disconnectTimer);
    clearInterval(this.heartbeat);
    this.releasePendingStart?.();
    this.microphone?.getTracks().forEach((track) => { track.onended = null; track.stop(); });
    this.microphone = null;
    this.lease?.release();
    this.lease = null;
    if (this.audio) { this.audio.pause(); this.audio.srcObject = null; }
    // Release the microphone immediately, but let final session events drain before
    // tearing down WebRTC. The Hub also has a hangup fallback if either path fails.
    const canClose = this.channel?.readyState === 'open' || this.socket?.readyState === WebSocket.OPEN;
    if (canClose) {
      this.closeTimer = setTimeout(() => this.releaseTransports(), 6_000);
      try {
        if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify({ type: 'session.close' }));
        if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'live_close' }));
      } catch { this.releaseTransports(); }
    } else this.releaseTransports();
  }

  private releaseTransports(): void {
    clearTimeout(this.closeTimer);
    this.socket?.close();
    this.peer?.close();
  }

  private becomeReady(): void {
    if (this.closed || this.ready || !this.mediaReady || !this.controlReady) return;
    this.ready = true;
    clearTimeout(this.startupTimer);
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
        peer.removeEventListener('icegatheringstatechange', change);
        this.releasePendingStart = undefined;
        resolve();
      };
      const change = () => { if (peer.iceGatheringState === 'complete') finish(); };
      const timer = setTimeout(finish, 5_000);
      this.releasePendingStart = finish;
      peer.addEventListener('icegatheringstatechange', change);
    });
  }
}
