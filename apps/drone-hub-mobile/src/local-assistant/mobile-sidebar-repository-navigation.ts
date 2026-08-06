export type MobileSidebarRepositoryAlignment = {
  alignedSelectionKey: string | null;
  repoIdToOpen: string | null;
};

export function resolveMobileSidebarRepositoryAlignment(args: {
  open: boolean;
  activeDeviceId: string;
  activeDroneId: string;
  resolvedRepoId: string | null;
  alignedSelectionKey: string | null;
}): MobileSidebarRepositoryAlignment {
  if (!args.open) {
    return { alignedSelectionKey: null, repoIdToOpen: null };
  }

  const activeDroneId = String(args.activeDroneId ?? '').trim();
  if (!activeDroneId) {
    return { alignedSelectionKey: null, repoIdToOpen: null };
  }

  const activeDeviceId = String(args.activeDeviceId ?? '').trim();
  const selectionKey = `${activeDeviceId}\u0000${activeDroneId}`;
  if (args.alignedSelectionKey === selectionKey) {
    return { alignedSelectionKey: args.alignedSelectionKey, repoIdToOpen: null };
  }

  const resolvedRepoId = String(args.resolvedRepoId ?? '').trim();
  if (!resolvedRepoId) {
    return { alignedSelectionKey: args.alignedSelectionKey, repoIdToOpen: null };
  }

  return { alignedSelectionKey: selectionKey, repoIdToOpen: resolvedRepoId };
}
