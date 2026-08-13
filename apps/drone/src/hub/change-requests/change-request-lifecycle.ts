import type { ChangeRequestRepository } from './change-request-repository';
import type { ChangeRequestActor, ChangeRequestRecord } from './change-request-types';

export type ChangeRequestLifecycleDependencies = {
  repository: ChangeRequestRepository;
  deleteHostRefBestEffort: (input: { repoRoot: string; refName: string }) => Promise<void>;
  now: () => string;
};

export function normalizeChangeRequestActor(value: ChangeRequestActor): ChangeRequestActor {
  return {
    kind: value.kind === 'chat' || value.kind === 'system' ? value.kind : 'user',
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : null,
    label: String(value.label ?? '').trim() || 'Unknown actor',
  };
}

export class ChangeRequestLifecycle {
  constructor(private readonly deps: ChangeRequestLifecycleDependencies) {}

  async completeClose(record: ChangeRequestRecord): Promise<ChangeRequestRecord> {
    if (record.status !== 'open') return record;
    const now = this.deps.now();
    const closed = await this.deps.repository.update(record.id, {
      status: 'closed',
      lastError: null,
      updatedAt: now,
      closedAt: now,
    });
    return closed;
  }

  async completeMerge(
    record: ChangeRequestRecord,
    input: { actor: ChangeRequestActor; mergeCommitSha: string | null },
  ): Promise<ChangeRequestRecord> {
    if (record.status !== 'open') return record;
    const now = this.deps.now();
    const merged = await this.deps.repository.update(record.id, {
      status: 'merged',
      mergedBy: normalizeChangeRequestActor(input.actor),
      mergeCommitSha: input.mergeCommitSha,
      lastError: null,
      updatedAt: now,
      mergedAt: now,
    });
    return merged;
  }
}
