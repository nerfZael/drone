export type RepoTransferProbeStatus = {
  code: string | null;
  detail: string;
  kind: 'ready' | 'nothing-to-sync' | 'sync-with-confirmation' | 'blocked';
  label: string;
  syncAllowed: boolean;
};

export function normalizeRepoTransferProbeStatus(response: {
  ok: boolean;
  status: number;
  data: any;
}): RepoTransferProbeStatus {
  const mode = String(response.data?.mode ?? '').trim().toLowerCase();
  const code = String(response.data?.code ?? '').trim() || null;
  const message = String(response.data?.error ?? '').trim();
  const dirtyFileCount = Number(response.data?.dirtyFileCount);
  const dirtyLabel =
    Number.isFinite(dirtyFileCount) && dirtyFileCount > 0
      ? `${Math.floor(dirtyFileCount)} file${dirtyFileCount === 1 ? '' : 's'}`
      : 'uncommitted changes';

  if (response.ok && (mode === 'no-changes' || response.data?.noChanges === true)) {
    return {
      kind: 'nothing-to-sync',
      label: 'Nothing to sync',
      detail: 'Already up to date with this drone.',
      syncAllowed: false,
      code,
    };
  }

  if (response.ok) {
    return {
      kind: 'ready',
      label: 'Ready to sync',
      detail: 'Pull this drone into the target drone.',
      syncAllowed: true,
      code,
    };
  }

  if (code === 'source_drone_dirty') {
    return {
      kind: 'sync-with-confirmation',
      label: 'Needs confirmation',
      detail: `Source drone has ${dirtyLabel}. Sync can snapshot them first after confirmation.`,
      syncAllowed: true,
      code,
    };
  }

  return {
    kind: 'blocked',
    label: 'Sync unavailable',
    detail: message || (response.status >= 500 ? 'Failed to inspect sync state.' : 'This drone cannot be synced right now.'),
    syncAllowed: false,
    code,
  };
}
