import React from 'react';

import type { UiMenuSelectEntry } from '../../ui/components';
import type { RepoRemoteBranchOption } from '../types';
import type { RepoBranchSourceMode } from './drone-create-runtime';

const HOST_BRANCH_VALUE = 'host';
const REMOTE_BRANCH_VALUE_PREFIX = 'remote:';

export function newDroneHostBranchLabel(hostBranch: string | null): string {
  return String(hostBranch ?? '').trim() || 'Detached HEAD';
}

function remoteBranchValue(branch: string): string {
  return `${REMOTE_BRANCH_VALUE_PREFIX}${branch}`;
}

function branchKindPill(label: string, tone: 'host' | 'remote') {
  return (
    <span
      className={`inline-flex h-4 flex-shrink-0 items-center rounded-full border px-1.5 text-[8px] font-[var(--weight-medium)] uppercase leading-none tracking-[0.06em] ${
        tone === 'host'
          ? 'border-[var(--green-border)] bg-transparent text-[var(--green)] opacity-80'
          : 'border-[var(--border-subtle)] bg-transparent text-[var(--muted-dim)]'
      }`}
    >
      {label}
    </span>
  );
}

export function newDroneBranchPickerValue(
  branchSource: RepoBranchSourceMode,
  remoteBranch: string,
): string {
  return branchSource === 'host' ? HOST_BRANCH_VALUE : remoteBranchValue(remoteBranch);
}

export function parseNewDroneBranchPickerValue(value: string): {
  branchSource: RepoBranchSourceMode;
  remoteBranch?: string;
} | null {
  if (value === HOST_BRANCH_VALUE) return { branchSource: 'host' };
  if (!value.startsWith(REMOTE_BRANCH_VALUE_PREFIX)) return null;
  const remoteBranch = value.slice(REMOTE_BRANCH_VALUE_PREFIX.length).trim();
  return remoteBranch ? { branchSource: 'remote', remoteBranch } : null;
}

export function buildNewDroneBranchPickerEntries({
  hostBranch,
  remoteBranches,
  remoteBranchCheckoutEnabled,
}: {
  hostBranch: string | null;
  remoteBranches: RepoRemoteBranchOption[];
  remoteBranchCheckoutEnabled: boolean;
}): UiMenuSelectEntry[] {
  const hostLabel = newDroneHostBranchLabel(hostBranch);
  return [
    {
      value: HOST_BRANCH_VALUE,
      label: (
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate font-mono text-[var(--text-11)] text-[var(--fg)]">
            {hostLabel}
          </span>
          {branchKindPill('Host', 'host')}
        </span>
      ),
      title: `Use ${hostLabel} from the host repository.`,
      searchText: `${hostLabel} host branch current`,
      className: '!px-2.5 !py-1.5',
    },
    ...(remoteBranches.length > 0
      ? ([{ kind: 'separator', key: 'host-remote-separator' }] as UiMenuSelectEntry[])
      : []),
    ...remoteBranches.map((entry) => ({
      value: remoteBranchValue(entry.name),
      label: (
        <span className="flex min-w-0 items-center justify-between gap-3">
          <span className="truncate font-mono text-[var(--text-11)] text-[var(--fg)]">
            {entry.name}
          </span>
          {branchKindPill('Remote', 'remote')}
        </span>
      ),
      title: remoteBranchCheckoutEnabled
        ? entry.name
        : `${entry.name} requires the container execution target.`,
      searchText: `${entry.name} ${entry.remote} ${entry.branch} remote ${entry.headSha ?? ''}`,
      disabled: !remoteBranchCheckoutEnabled,
      className: '!px-2.5 !py-1.5',
    })),
  ];
}
