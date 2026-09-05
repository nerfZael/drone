/** Admission/cancellation for bounded JSON reads; no retained content or chunk protocol. */
export class DeviceReadBudget {
  private readonly owners = new Map<string, AbortController>();
  private reservations = 0;
  private closed = false;
  captureOwner(deviceId: string): { deviceId: string; signal: AbortSignal } {
    if (this.closed) throw new Error('Device reader is closed');
    let owner = this.owners.get(deviceId);
    if (!owner) {
      owner = new AbortController();
      this.owners.set(deviceId, owner);
    }
    return { deviceId, signal: owner.signal };
  }
  async reserveJson(owner: { deviceId: string; signal: AbortSignal }, signal?: AbortSignal) {
    if (this.closed || owner.signal.aborted || signal?.aborted)
      throw new Error('Device read cancelled');
    if (this.reservations >= 8)
      throw Object.assign(new Error('Device reads are busy'), { code: 'RESOURCE_LIMIT' });
    this.reservations++;
    let released = false;
    return {
      signal: signal ? AbortSignal.any([owner.signal, signal]) : owner.signal,
      maxBytes: 6 * 1024 * 1024,
      assertActive: () => {
        if (this.closed || owner.signal.aborted || signal?.aborted)
          throw Object.assign(new Error('Device read permission or connection changed'), {
            code: 'TRANSFER_EXPIRED',
          });
      },
      release: () => {
        if (!released) {
          released = true;
          this.reservations--;
        }
      },
    };
  }
  revokeDevice(deviceId: string): void {
    this.owners.get(deviceId)?.abort();
    this.owners.delete(deviceId);
  }
  close(): void {
    this.closed = true;
    for (const owner of this.owners.values()) owner.abort();
    this.owners.clear();
  }
}
