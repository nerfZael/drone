import { splitLiveCommentary } from './CompanionLiveConversation';

export type AnnouncementPlayback = { stage: 'scheduled' | 'completed'; silent: boolean };
type Schedule = (callback: () => void, delayMs: number) => () => void;

/** Live has no audio-done event. End after audible playback and a quiet grace period. */
export class CompanionLiveAnnouncement {
  private pending: string[] = [];
  private ready = false;
  private stopped = false;
  private blocked = false;
  private heardSpeech = false;
  private announcing = false;
  private queuedSpeech = 0;
  private cancelQuiet?: () => void;
  private cancelDeadline?: () => void;

  constructor(private readonly send: (event: Record<string, unknown>) => void,
    private readonly finish: (error?: string) => void,
    private readonly schedule: Schedule = scheduleTimeout) {
    this.resetDeadline();
  }

  deliver(reply: string): void {
    if (this.stopped || !reply.trim()) return;
    this.pending.push(reply);
    if (this.ready && !this.announcing) this.startNext();
  }

  connected(): void {
    if (this.stopped || this.ready) return;
    this.ready = true;
    this.send({ type: 'session.instructions.append', delegation_id: null,
      content: 'Announce the supplied subscription updates immediately and concisely. These are completed backend results, not new requests. Do not greet, ask follow-up questions, or delegate work. After announcing the updates, remain silent.' });
    this.startNext();
  }

  playback(event: AnnouncementPlayback): void {
    if (this.stopped || !this.announcing || event.silent) return;
    if (event.stage === 'scheduled') {
      this.queuedSpeech++;
      this.cancelQuiet?.();
    } else {
      this.queuedSpeech = Math.max(0, this.queuedSpeech - 1);
      this.heardSpeech = true;
      this.waitForQuiet();
    }
  }

  playbackBlocked(blocked: boolean): void {
    if (this.blocked === blocked) return;
    this.blocked = blocked;
    this.cancelQuiet?.();
    if (!blocked) this.waitForQuiet();
  }

  stop(): void {
    this.stopped = true;
    this.cancelDeadline?.();
    this.cancelQuiet?.();
    this.pending = [];
  }

  private waitForQuiet(): void {
    this.cancelQuiet?.();
    if (this.stopped || this.blocked || !this.heardSpeech || this.queuedSpeech) return;
    this.cancelQuiet = this.schedule(() => {
      if (this.stopped) return;
      if (this.pending.length) this.startNext();
      else this.complete();
    }, 2_500);
  }

  private startNext(): void {
    if (this.stopped) return;
    const reply = this.pending.shift();
    if (!reply) return;
    this.announcing = true;
    this.heardSpeech = false;
    this.cancelQuiet?.();
    this.resetDeadline();
    const chunks = splitLiveCommentary(reply);
    const content = chunks.length > 4
      ? ['The backend returned a detailed subscription update. The full answer is available in Companion on screen.']
      : chunks;
    for (const chunk of content) {
      if (this.stopped) break;
      this.send({ type: 'session.commentary.append', delegation_id: null, content: chunk });
    }
  }

  private resetDeadline(): void {
    this.cancelDeadline?.();
    this.cancelDeadline = this.schedule(() => {
      if (!this.stopped) this.complete('The subscription announcement timed out. The response is available in Companion.');
    }, 90_000);
  }

  private complete(error?: string): void {
    this.stop();
    this.finish(error);
  }
}

function scheduleTimeout(callback: () => void, delayMs: number): () => void {
  const timer = setTimeout(callback, delayMs);
  return () => clearTimeout(timer);
}
