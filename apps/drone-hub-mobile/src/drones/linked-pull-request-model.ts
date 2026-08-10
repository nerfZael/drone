export type MobilePullRequestMergeMethod = 'merge' | 'squash' | 'rebase';

export type MobilePullRequestAction = {
  pullNumber: number;
  action: 'merge' | 'close';
};

export type MobilePullRequestDiffStats = {
  changed: number;
  additions: number;
  deletions: number;
};

export type MobilePullRequestConfirmationCopy = {
  title: string;
  message: string;
  confirmLabel: string;
  destructive: boolean;
};

export const MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS: ReadonlyArray<{
  value: MobilePullRequestMergeMethod;
  label: string;
}> = [
  { value: 'merge', label: 'Merge commit' },
  { value: 'squash', label: 'Squash' },
  { value: 'rebase', label: 'Rebase' },
];

export function normalizeMobilePullRequestMergeMethod(
  value: unknown,
): MobilePullRequestMergeMethod {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'squash' || normalized === 'rebase') return normalized;
  return 'merge';
}

export function mobilePullRequestMergeMethodLabel(
  method: MobilePullRequestMergeMethod,
): string {
  return (
    MOBILE_PULL_REQUEST_MERGE_METHOD_OPTIONS.find((option) => option.value === method)?.label ??
    'Merge commit'
  );
}

export function mobilePullRequestActionUnavailableReason({
  action,
  supported,
  granted,
}: {
  action: MobilePullRequestAction['action'];
  supported: boolean;
  granted: boolean;
}): string | null {
  if (!supported) {
    return `The selected Hub must be updated to ${action} pull requests from mobile.`;
  }
  if (!granted) {
    return `This phone has not been granted pull request ${action} access.`;
  }
  return null;
}

export function mobilePullRequestActionGuardError({
  expectedScope,
  currentScope,
  unavailableReason,
  busyAction,
}: {
  expectedScope: string;
  currentScope: string;
  unavailableReason: string | null;
  busyAction: MobilePullRequestAction | null;
}): string | null {
  if (currentScope !== expectedScope) {
    return 'The selected drone changed. Open the pull request and try again.';
  }
  if (unavailableReason) return unavailableReason;
  if (busyAction) return 'Another pull request action is already in progress.';
  return null;
}

export function mobilePullRequestMergePresentation({
  method,
  blockedReason,
  forceReason,
  confirmation,
}: {
  method: MobilePullRequestMergeMethod;
  blockedReason: string | null;
  forceReason: string | null;
  confirmation: MobilePullRequestConfirmationCopy;
}) {
  const methodLabel = mobilePullRequestMergeMethodLabel(method);
  const actionLabel = forceReason ? 'Force merge' : 'Merge';
  return {
    canRequestMerge: !blockedReason,
    buttonLabel: blockedReason ? 'Blocked' : actionLabel,
    accessibilityLabel: blockedReason
      ? `Merge blocked: ${blockedReason}`
      : `${actionLabel} using ${methodLabel}`,
    confirmation: {
      ...confirmation,
      message: `${confirmation.message} Selected method: ${methodLabel}.`,
      confirmLabel: `${actionLabel} (${methodLabel})`,
      destructive: confirmation.destructive || Boolean(forceReason),
    },
  };
}

export function mobilePullRequestMergeFailureMessage({
  pullNumber,
  method,
  error,
}: {
  pullNumber: number;
  method: MobilePullRequestMergeMethod;
  error: unknown;
}): string {
  const detail =
    error instanceof Error
      ? error.message
      : String(error ?? '').trim() || 'The pull request could not be merged.';
  return `Could not merge PR #${pullNumber} using ${mobilePullRequestMergeMethodLabel(method)}: ${detail}`;
}

export function mobilePullRequestDiffStatsPresentation(stats: MobilePullRequestDiffStats) {
  const changed = Math.max(0, Math.floor(Number(stats.changed) || 0));
  const additions = Math.max(0, Math.floor(Number(stats.additions) || 0));
  const deletions = Math.max(0, Math.floor(Number(stats.deletions) || 0));
  const net = additions - deletions;
  const netLabel = net === 0 ? '±0' : `${net > 0 ? '+' : ''}${net}`;
  return {
    changed,
    additions,
    deletions,
    netLabel,
    accessibilityLabel: `${changed} files changed, ${additions} additions, ${deletions} deletions, ${netLabel} net lines`,
  };
}

export async function performMobilePullRequestMerge({
  request,
  targetDeviceId,
  droneId,
  pullNumber,
  method,
}: {
  request(
    targetDeviceId: string,
    capability: string,
    operation: string,
    payload: unknown,
  ): Promise<any>;
  targetDeviceId: string;
  droneId: string;
  pullNumber: number;
  method: MobilePullRequestMergeMethod;
}): Promise<string> {
  try {
    const result = await request(
      targetDeviceId,
      'drone-control',
      'repo.pull-requests.merge',
      { droneId, pullNumber, method },
    );
    if (result?.ok !== true || result?.merged !== true) {
      throw new Error(
        String(
          result?.message ?? result?.error ?? `GitHub did not merge PR #${pullNumber}`,
        ),
      );
    }
    const summary = `Merged PR #${pullNumber} using ${mobilePullRequestMergeMethodLabel(method)}.`;
    const detail = String(result?.message ?? '').trim();
    return detail ? `${summary} ${detail}` : summary;
  } catch (error) {
    throw new Error(mobilePullRequestMergeFailureMessage({ pullNumber, method, error }));
  }
}
