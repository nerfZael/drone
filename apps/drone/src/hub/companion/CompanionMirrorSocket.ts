import type { CompanionMirrorService } from './CompanionMirrorService';

export class CompanionMirrorSocket {
  private unsubscribe?: () => void;
  private closed = false;
  private subscribed = false;

  constructor(private readonly service: CompanionMirrorService, private readonly send: (message: unknown) => void) {}

  handle(message: Record<string, unknown>): void {
    if (this.closed) return;
    if (message.type === 'mirror_subscribe') {
      if (this.subscribed) return;
      this.subscribed = true;
      void this.service.subscribe(this.send).then((unsubscribe) => {
        if (this.closed) unsubscribe(); else this.unsubscribe = unsubscribe;
      }).catch((error) => {
        this.subscribed = false;
        this.send({ type: 'mirror_error', error: String(error) });
      });
      return;
    }
    if (message.type !== 'mirror_command' || typeof message.requestId !== 'string' || message.requestId.length > 200) return;
    void this.service.command(message).then(
      () => this.send({ type: 'mirror_result', requestId: message.requestId, ok: true }),
      (error) => this.send({ type: 'mirror_result', requestId: message.requestId, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  }

  close(): void { this.closed = true; this.unsubscribe?.(); }
}
