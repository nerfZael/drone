import {
  createLiveAudioOffer,
  type LiveAudioFrameAuth,
  type LiveAudioOffer,
} from './live-audio-auth';
import {
  decodeLiveAudioFrame,
  LiveAudioBudget,
  LIVE_AUDIO_FRAME_BYTES,
  LIVE_AUDIO_QUEUE_BYTES,
  pcmFromBase64,
  pcmToBase64,
  sendLiveAudioFrame,
  type LiveAudioFrame,
  type LiveAudioSocket,
  type LiveAudioStream,
} from './live-audio-stream';

export type LiveAudioClientStream = LiveAudioStream & {
  offer: LiveAudioOffer;
  accept(answer: unknown): void;
};
type Session = {
  target: string;
  id: string;
  sequence: number;
  budget: LiveAudioBudget;
  auth?: LiveAudioFrameAuth;
  pending: LiveAudioFrame[];
  pendingBytes: number;
  audio(chunk: string): void;
  error(error: string): void;
  closed: boolean;
  terminalSent: boolean;
};

/** Session failures are isolated; only a failed physical socket ends every stream. */
export class LiveAudioClient {
  private readonly sessions = new Map<string, Session>();
  private closed = false;
  constructor(
    private readonly socket: LiveAudioSocket,
    private readonly source: string,
  ) {
    socket.onmessage = ({ data }) => {
      let frame: LiveAudioFrame;
      try {
        frame = decodeLiveAudioFrame(data);
      } catch {
        return;
      }
      if (frame.targetDeviceId !== source) return;
      const session = this.sessions.get(JSON.stringify([frame.sourceDeviceId, frame.sessionId]));
      if (!session) return;
      if (frame.aborted) {
        this.end(session, 'The Live audio route closed. Start a new conversation.', false);
        return;
      }
      if (!session.auth) {
        // The binary socket can beat the HTTP answer. Hold a bounded amount,
        // then authenticate in order before playing any of it.
        if (
          session.pendingBytes + frame.pcm.length > LIVE_AUDIO_QUEUE_BYTES ||
          session.pending.length >= 200
        ) {
          this.end(session, 'Live audio arrived before authentication could finish.');
          return;
        }
        session.pending.push(frame);
        session.pendingBytes += frame.pcm.length;
        return;
      }
      this.receive(session, frame);
    };
    socket.onclose = () => this.fail('Live audio connection closed. Start a new conversation.');
    socket.onerror = () => this.fail('Live audio connection failed. Start a new conversation.');
  }
  open(
    target: string,
    id: string,
    audio: Session['audio'],
    error: Session['error'],
    handshake: ReturnType<typeof createLiveAudioOffer>,
  ): LiveAudioClientStream {
    if (this.closed || this.socket.readyState !== 1)
      throw new Error('Live audio connection closed');
    const key = JSON.stringify([target, id]);
    if (this.sessions.has(key)) throw new Error('Live audio session already exists');
    const session: Session = {
      target,
      id,
      sequence: 0,
      budget: new LiveAudioBudget(),
      pending: [],
      pendingBytes: 0,
      audio,
      error,
      closed: false,
      terminalSent: false,
    };
    this.sessions.set(key, session);
    return {
      offer: handshake.offer,
      accept: (answer) => {
        if (session.auth) throw new Error('Live audio key exchange already completed');
        session.auth = handshake.finish(answer);
        // Stop may have happened while live.start was in flight. Complete only
        // authentication, then terminate immediately without sending buffered PCM.
        if (session.closed) this.terminate(session);
        else
          for (const frame of session.pending) {
            if (!session.closed) this.receive(session, frame);
          }
        session.pending = [];
        session.pendingBytes = 0;
      },
      send: async (audio) => {
        if (session.closed) return;
        if (!session.auth) throw new Error('Live audio is not authenticated');
        const pcm = pcmFromBase64(audio);
        try {
          for (let offset = 0; offset < pcm.length; offset += LIVE_AUDIO_FRAME_BYTES) {
            if (session.closed) return;
            await sendLiveAudioFrame(
              this.socket,
              session.auth.protect({
                sourceDeviceId: this.source,
                targetDeviceId: target,
                sessionId: id,
                sequence: session.sequence++,
                pcm: pcm.subarray(offset, offset + LIVE_AUDIO_FRAME_BYTES),
              }),
              () => !session.closed,
            );
          }
        } catch (error) {
          this.end(session, 'Live audio connection is too slow.');
          throw error;
        }
      },
      close: () => {
        if (!session.closed) {
          session.closed = true;
          session.pending = [];
          session.pendingBytes = 0;
          this.sessions.delete(key);
          this.terminate(session);
        }
      },
    };
  }
  private receive(session: Session, frame: LiveAudioFrame): void {
    if (!session.auth!.verify(frame)) {
      this.end(session, 'Live audio authentication failed. Start a new conversation.');
      return;
    }
    if (frame.closed) {
      this.end(session, 'Live audio session ended. Start a new conversation.', false);
      return;
    }
    if (!session.budget.accept(frame)) {
      this.end(session, 'Live audio stream exceeded its sequence or rate limit.');
      return;
    }
    try {
      session.audio(pcmToBase64(frame.pcm));
    } catch {
      this.end(session, 'Could not play Live audio.');
    }
  }
  private terminate(session: Session): void {
    if (!session.auth || session.terminalSent) return;
    session.terminalSent = true;
    void sendLiveAudioFrame(
      this.socket,
      session.auth.protect({
        sourceDeviceId: this.source,
        targetDeviceId: session.target,
        sessionId: session.id,
        sequence: Number.MAX_SAFE_INTEGER,
        closed: true,
        pcm: new Uint8Array(),
      }),
    ).catch(() => undefined);
  }
  private end(session: Session, error: string, notify = true): void {
    if (session.closed) return;
    session.closed = true;
    session.pending = [];
    session.pendingBytes = 0;
    this.sessions.delete(JSON.stringify([session.target, session.id]));
    if (notify) this.terminate(session);
    session.error(error);
  }
  private fail(message: string): void {
    if (this.closed) return;
    this.closed = true;
    for (const session of [...this.sessions.values()]) this.end(session, message, false);
    this.socket.close();
  }
}
