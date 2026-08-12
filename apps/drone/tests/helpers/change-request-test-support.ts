import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  ChangeRequestInsert,
  ChangeRequestRepository,
  ChangeRequestUpdate,
} from '../../src/hub/change-requests/change-request-repository';
import {
  changeRequestEventTypeForStatus,
  createChangeRequestDomainEvent,
  type ChangeRequestDomainEventType,
  type PendingChangeRequestDomainEvent,
} from '../../src/hub/change-requests/change-request-events';
import type { ChangeRequestRecord } from '../../src/hub/change-requests/change-request-types';
import type { RunResult } from '../../src/host/dvm';

export class MemoryChangeRequestRepository implements ChangeRequestRepository {
  private sequence = 0;
  private readonly records = new Map<string, ChangeRequestRecord>();
  private readonly events: PendingChangeRequestDomainEvent[] = [];
  private outboxAvailableHandler: (() => void) | null = null;
  failNextUpdateMessage: string | null = null;
  private failNextMirrorUpdateMessage: string | null = null;

  failNextMirrorUpdate(message: string): void {
    this.failNextMirrorUpdateMessage = message;
  }

  async insert(input: ChangeRequestInsert): Promise<ChangeRequestRecord> {
    const record = { ...input, number: ++this.sequence, stateVersion: 1 };
    this.records.set(record.id, record);
    this.events.push({
      ...createChangeRequestDomainEvent(record, 'change_request.created', record.createdAt),
      attemptCount: 0,
    });
    this.outboxAvailableHandler?.();
    return structuredClone(record);
  }

  get(id: string): ChangeRequestRecord | null {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  getByNumber(number: number): ChangeRequestRecord | null {
    const record = [...this.records.values()].find((candidate) => candidate.number === number);
    return record ? structuredClone(record) : null;
  }

  getByNumbers(numbers: number[]): Map<number, ChangeRequestRecord> {
    return new Map(
      numbers.flatMap((number) => {
        const record = this.getByNumber(number);
        return record ? [[number, record] as const] : [];
      }),
    );
  }

  list(): ChangeRequestRecord[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  async update(id: string, update: ChangeRequestUpdate): Promise<ChangeRequestRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error(`unknown change request: ${id}`);
    const patch = typeof update === 'function' ? update(structuredClone(current)) : update;
    const failure =
      this.failNextUpdateMessage ?? (patch.githubMirror ? this.failNextMirrorUpdateMessage : null);
    if (failure) {
      if (this.failNextUpdateMessage) this.failNextUpdateMessage = null;
      else this.failNextMirrorUpdateMessage = null;
      throw new Error(failure);
    }
    const updated = { ...current, ...patch, stateVersion: current.stateVersion + 1 };
    this.records.set(id, updated);
    this.upsertEvent(
      updated,
      changeRequestEventTypeForStatus(updated.status),
      patch.updatedAt ?? patch.githubMirror?.updatedAt ?? new Date().toISOString(),
    );
    return structuredClone(updated);
  }

  async emitEvent(
    id: string,
    eventType: Exclude<ChangeRequestDomainEventType, 'change_request.created'>,
    occurredAt: string,
  ): Promise<ChangeRequestRecord> {
    const current = this.records.get(id);
    if (!current) throw new Error(`unknown change request: ${id}`);
    const updated = { ...current, stateVersion: current.stateVersion + 1 };
    this.records.set(id, updated);
    this.upsertEvent(updated, eventType, occurredAt);
    this.outboxAvailableHandler?.();
    return structuredClone(updated);
  }

  listPendingEvents(limit = 100): PendingChangeRequestDomainEvent[] {
    return structuredClone(this.events.slice(0, limit));
  }

  async markEventDispatched(eventId: string): Promise<void> {
    const index = this.events.findIndex((event) => event.id === eventId);
    if (index >= 0) this.events.splice(index, 1);
  }

  async markEventFailed(eventId: string, error: string): Promise<void> {
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (event) event.attemptCount += 1;
  }

  setOutboxAvailableHandler(handler: (() => void) | null): void {
    this.outboxAvailableHandler = handler;
  }

  private upsertEvent(
    record: ChangeRequestRecord,
    eventType: Exclude<ChangeRequestDomainEventType, 'change_request.created'>,
    occurredAt: string,
  ): void {
    const existing = this.events.findIndex((event) => event.requestNumber === record.number);
    const event = {
      ...createChangeRequestDomainEvent(record, eventType, occurredAt),
      attemptCount: 0,
    };
    if (existing >= 0) this.events[existing] = event;
    else this.events.push(event);
    this.outboxAvailableHandler?.();
  }
}

export async function runCommand(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<RunResult> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', (error) => resolve({ code: 1, stdout, stderr: error.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export async function git(cwd: string, args: string[]): Promise<string> {
  const result = await runCommand('git', ['-C', cwd, ...args]);
  if (result.code !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout.trim();
}

export async function snapshotCommit(
  repoRoot: string,
  baseSha: string,
  fileName: string,
  contents: string,
): Promise<string> {
  await git(repoRoot, ['reset', '--hard', baseSha]);
  await fs.writeFile(path.join(repoRoot, fileName), contents);
  await git(repoRoot, ['add', fileName]);
  const tree = await git(repoRoot, ['write-tree']);
  const commit = await git(repoRoot, [
    'commit-tree',
    tree,
    '-p',
    baseSha,
    '-m',
    `snapshot ${fileName}`,
  ]);
  await git(repoRoot, ['reset', '--hard', baseSha]);
  return commit;
}
