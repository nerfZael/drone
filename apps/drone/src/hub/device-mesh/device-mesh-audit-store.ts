import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { SignedCapabilityRequest } from '@drone/device-protocol';
import type { DeviceMeshAuditEntry } from './device-mesh-types';

export class DeviceMeshAuditStore {
  private entries: DeviceMeshAuditEntry[] = [];
  private loaded = false;
  private writes = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async record(
    request: SignedCapabilityRequest,
    outcome: DeviceMeshAuditEntry['outcome'],
    errorCode: string | null = null,
  ): Promise<void> {
    await this.load();
    const payload =
      request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
        ? (request.payload as Record<string, unknown>)
        : {};
    const actor =
      payload.actor && typeof payload.actor === 'object' && !Array.isArray(payload.actor)
        ? (payload.actor as Record<string, unknown>)
        : null;
    this.entries.unshift({
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      requestId: request.requestId,
      sourceDeviceId: request.sourceDeviceId,
      targetDeviceId: request.targetDeviceId,
      capability: request.capability,
      operation: request.operation,
      outcome,
      errorCode,
      resource: actor
        ? {
            assistantHomeDeviceId: String(actor.assistantHomeDeviceId ?? ''),
            threadId: String(actor.threadId ?? ''),
            rootId: String(actor.rootId ?? ''),
            path: String(payload.path ?? '').slice(0, 500),
          }
        : null,
    });
    this.entries = this.entries.slice(0, 500);
    const snapshot = this.entries;
    this.writes = this.writes.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
    });
    await this.writes;
  }

  async list(limit = 50): Promise<DeviceMeshAuditEntry[]> {
    await this.load();
    return this.entries.slice(0, Math.max(1, Math.min(200, limit)));
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.entries = Array.isArray(value) ? value.slice(0, 500) : [];
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}
