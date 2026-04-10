export type DirtyDroneApplyModalState = {
  autoCommitMessage: string;
  dirtyFileCount: number;
  droneId: string;
  droneLabel: string;
};

export function dirtyDroneApplyFileLabel(dirtyFileCountRaw: unknown): string {
  const dirtyFileCount = Number(dirtyFileCountRaw);
  if (Number.isFinite(dirtyFileCount) && dirtyFileCount > 0) {
    return `${Math.floor(dirtyFileCount)} file${dirtyFileCount === 1 ? '' : 's'}`;
  }
  return 'one or more files';
}

export function dirtyDroneApplyRequestBody(choice: 'commit' | 'keep', autoCommitMessage: string): Record<string, unknown> {
  if (choice === 'commit') {
    return { commitDirty: true, commitMessage: autoCommitMessage };
  }
  return { allowDirty: true };
}

export function reconcileDirtyDroneApplyModal(
  current: DirtyDroneApplyModalState | null,
  activeDroneIdRaw: unknown,
): DirtyDroneApplyModalState | null {
  if (!current) return null;
  const activeDroneId = String(activeDroneIdRaw ?? '').trim();
  if (!activeDroneId) return null;
  return current.droneId === activeDroneId ? current : null;
}
