export type ChatVoiceSendRequestDisposition =
  | 'run-now'
  | 'queued-after-transcription'
  | 'already-sending';

export class ChatVoiceSendCoordinator<TSend> {
  private token = 0;
  private active = false;
  private actionWillSend = false;
  private pendingSend: TSend | null = null;

  begin(actionWillSend: boolean): number | null {
    if (this.active) return null;
    this.token += 1;
    this.active = true;
    this.actionWillSend = actionWillSend;
    return this.token;
  }

  requestSend(send: TSend): ChatVoiceSendRequestDisposition {
    if (!this.active) return 'run-now';
    if (this.actionWillSend) return 'already-sending';
    this.pendingSend = send;
    return 'queued-after-transcription';
  }

  isCurrent(token: number): boolean {
    return this.active && this.token === token;
  }

  finish(token: number): TSend | null {
    if (!this.isCurrent(token)) return null;
    const pendingSend = this.pendingSend;
    this.active = false;
    this.actionWillSend = false;
    this.pendingSend = null;
    return pendingSend;
  }

  cancel(): void {
    this.token += 1;
    this.active = false;
    this.actionWillSend = false;
    this.pendingSend = null;
  }
}
