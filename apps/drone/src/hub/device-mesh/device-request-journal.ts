import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SignedCapabilityRequest } from '@drone/device-protocol';

/** Records acceptance before execution so a restart cannot execute the same signed command twice. */
export class DeviceRequestJournal {
  private lastPruned = 0;
  constructor(private readonly root: string) {}
  async accept(request: SignedCapabilityRequest): Promise<boolean> {
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    if (Date.now() - this.lastPruned > 60_000) {
      this.lastPruned = Date.now();
      for (const name of await fs.readdir(this.root)) {
        if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
        const target = path.join(this.root, name);
        const entry = await fs
          .readFile(target, 'utf8')
          .then(
            (raw) => JSON.parse(raw),
            () => null,
          )
          .catch(() => null);
        if (entry && Date.parse(entry.expiresAt) < Date.now() - 60 * 60_000) await fs.rm(target);
      }
    }
    const key = crypto
      .createHash('sha256')
      .update(`${request.sourceDeviceId}:${request.requestId}`)
      .digest('hex');
    const file = path.join(this.root, `${key}.json`);
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(file, 'wx', 0o600);
    } catch (error: any) {
      if (error?.code === 'EEXIST') return false;
      throw error;
    }
    try {
      await handle.writeFile(
        JSON.stringify({
          sourceDeviceId: request.sourceDeviceId,
          requestId: request.requestId,
          operation: request.operation,
          fingerprint: crypto.createHash('sha256').update(JSON.stringify(request)).digest('hex'),
          expiresAt: request.expiresAt,
          acceptedAt: new Date().toISOString(),
        }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    return true;
  }
}
