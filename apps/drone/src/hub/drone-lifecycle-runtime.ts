type DroneLifecycleRuntimeDependencyName =
  | 'cleanupQuarantineWorktree'
  | 'collectDockerSnapshotImageRefsFromDroneEntry'
  | 'deleteCanonicalDroneLifecycle'
  | 'dequeueProvisioning'
  | 'droneRuntime'
  | 'dvmContainerExists'
  | 'dvmRemove'
  | 'fleetDescendantIdsForActor'
  | 'gitTopLevel'
  | 'loadRegistry'
  | 'looksLikeMissingContainerError'
  | 'normalizeDroneIdentity'
  | 'permanentlyDeleteCanonicalDrone'
  | 'quarantineWorktreePath'
  | 'removeDockerSnapshotImagesBestEffort'
  | 'revokeMcpAccessTokensForDrone'
  | 'sleepMs'
  | 'stopAllDroneChatActivity';

export type DroneLifecycleRuntimeDependencies = {
  [Key in DroneLifecycleRuntimeDependencyName]: any;
};

export function createDroneLifecycleRuntime(dependencies: DroneLifecycleRuntimeDependencies) {
  const {
    cleanupQuarantineWorktree,
    collectDockerSnapshotImageRefsFromDroneEntry,
    deleteCanonicalDroneLifecycle,
    dequeueProvisioning,
    droneRuntime,
    dvmContainerExists,
    dvmRemove,
    fleetDescendantIdsForActor,
    gitTopLevel,
    loadRegistry,
    looksLikeMissingContainerError,
    normalizeDroneIdentity,
    permanentlyDeleteCanonicalDrone,
    quarantineWorktreePath,
    removeDockerSnapshotImagesBestEffort,
    revokeMcpAccessTokensForDrone,
    sleepMs,
    stopAllDroneChatActivity,
  } = dependencies;

  async function removeDroneContainerAndCleanup(opts: {
    droneId: string;
    containerName: string;
    repoPathRaw: string;
    keepVolume: boolean;
  }): Promise<{ containerGone: boolean; removeErr: string | null }> {
    let removeErr: string | null = null;
    let containerGone = false;

    // Deleting a drone can be racy: `dvm rm` may stop a container and then fail to remove it,
    // requiring a follow-up remove. The UI currently needs a second click in that case.
    // We retry here to make DELETE idempotent and "one click".
    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await dvmRemove(opts.containerName, { keepVolume: opts.keepVolume });
        containerGone = true;
        removeErr = null;
        break;
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        if (looksLikeMissingContainerError(msg)) {
          // If the container is already gone, treat as success and still clean registry metadata.
          containerGone = true;
          removeErr = null;
          break;
        }

        // Best-effort: if the remove errored but the container is actually gone, also treat as success.
        // eslint-disable-next-line no-await-in-loop
        const exists = await dvmContainerExists(opts.containerName);
        if (!exists) {
          containerGone = true;
          removeErr = null;
          break;
        }

        removeErr = msg;
        if (attempt < maxAttempts) {
          // eslint-disable-next-line no-await-in-loop
          await sleepMs(500);
        }
      }
    }

    if (containerGone && opts.repoPathRaw) {
      try {
        const repoRoot = await gitTopLevel(opts.repoPathRaw);
        const quarantineBranch = `quarantine/${opts.droneId}`;
        const wt = quarantineWorktreePath(repoRoot, opts.droneId);
        await cleanupQuarantineWorktree({ repoRoot, worktreePath: wt, branch: quarantineBranch });
      } catch {
        // Ignore quarantine cleanup failures during delete.
      }
    }

    return { containerGone, removeErr };
  }

  async function removeDroneRuntimeArtifacts(opts: {
    droneId: string;
    droneEntry: any;
    keepVolume: boolean;
    updateLiveRegistry: boolean;
  }): Promise<{ containerGone: boolean; removeErr: string | null }> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    if (!droneId)
      return { containerGone: false, removeErr: `invalid drone id: ${String(opts.droneId ?? '')}` };

    const repoPathRaw = String(opts.droneEntry?.repoPath ?? '').trim();
    const containerName =
      String(
        opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? `drone-${droneId}`,
      ).trim() || `drone-${droneId}`;

    try {
      await stopAllDroneChatActivity({
        droneId,
        droneEntry: opts.droneEntry,
        reason: 'delete',
        updateLiveRegistry: opts.updateLiveRegistry,
      });
    } catch (error) {
      // Archived drones were already stopped when they entered the archive and
      // can legitimately have no reachable daemon at TTL cleanup time. Do not
      // let that best-effort shutdown strand an otherwise deletable archive.
      if (opts.updateLiveRegistry !== false) throw error;
    }

    if (droneRuntime(opts.droneEntry) === 'host') {
      return { containerGone: true, removeErr: null };
    }

    return await removeDroneContainerAndCleanup({
      droneId,
      containerName,
      repoPathRaw,
      keepVolume: opts.keepVolume,
    });
  }

  async function removeDroneById(opts: { id: string; keepVolume: boolean; forget: boolean }) {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId)
      return {
        hadEntry: false,
        removedRegistry: false,
        removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
      };

    const regSnapshot: any = await loadRegistry();
    const droneEntry = regSnapshot?.drones?.[droneId] ?? null;
    const hadEntry = Boolean(droneEntry);
    const { containerGone, removeErr } = droneEntry
      ? await removeDroneRuntimeArtifacts({
          droneId,
          droneEntry,
          keepVolume: opts.keepVolume,
          updateLiveRegistry: true,
        })
      : { containerGone: false, removeErr: `unknown drone: ${droneId}` };

    let removedRegistry = false;
    // Only forget registry metadata once the container is actually gone.
    // Otherwise we can strand a drone in an "offline but still present" state that is harder to delete by group.
    if (hadEntry && opts.forget && containerGone) {
      const snapshotImageRefs = collectDockerSnapshotImageRefsFromDroneEntry(droneEntry);
      removedRegistry = (await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'real' }))
        .removedLifecycle;
      if (removedRegistry) {
        await revokeMcpAccessTokensForDrone(droneId);
        await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
          droneId,
          reason: 'delete-drone',
        });
      }
    }

    return { hadEntry, removedRegistry, removeErr };
  }

  async function removeDroneLifecycleEntryById(opts: {
    id: string;
    keepVolume: boolean;
    forget: boolean;
  }): Promise<{
    kind: 'real' | 'pending' | 'none';
    removedRegistry: boolean;
    removeErr: string | null;
  }> {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId) {
      return {
        kind: 'none',
        removedRegistry: false,
        removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
      };
    }

    const regSnapshot: any = await loadRegistry();
    if (regSnapshot?.drones?.[droneId]) {
      const result = await removeDroneById(opts);
      return {
        kind: result.hadEntry ? 'real' : 'none',
        removedRegistry: result.removedRegistry,
        removeErr: result.removeErr,
      };
    }
    if (regSnapshot?.pending?.[droneId]) {
      await deleteCanonicalDroneLifecycle(droneId, 'pending');
      dequeueProvisioning(droneId);
      return { kind: 'pending', removedRegistry: false, removeErr: null };
    }
    return { kind: 'none', removedRegistry: false, removeErr: null };
  }

  async function removeDroneTreeById(opts: {
    id: string;
    keepVolume: boolean;
    forget: boolean;
  }): Promise<{
    kind: 'real' | 'pending' | 'none';
    removedRegistry: boolean;
    removedPending: boolean;
    removedDescendants: string[];
    removeErr: string | null;
  }> {
    const droneId = normalizeDroneIdentity(opts.id);
    if (!droneId) {
      return {
        kind: 'none',
        removedRegistry: false,
        removedPending: false,
        removedDescendants: [],
        removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
      };
    }

    const regSnapshot: any = await loadRegistry();
    const descendantIds = fleetDescendantIdsForActor(regSnapshot, droneId).reverse();
    const removedDescendants: string[] = [];
    for (const descendantId of descendantIds) {
      const result = await removeDroneLifecycleEntryById({
        id: descendantId,
        keepVolume: opts.keepVolume,
        forget: opts.forget,
      });
      if (result.removeErr) {
        return {
          kind: 'none',
          removedRegistry: false,
          removedPending: false,
          removedDescendants,
          removeErr: `failed to delete descendant drone "${descendantId}": ${result.removeErr}`,
        };
      }
      if (result.kind !== 'none') removedDescendants.push(descendantId);
    }

    const rootResult = await removeDroneLifecycleEntryById(opts);
    return {
      kind: rootResult.kind,
      removedRegistry: rootResult.removedRegistry,
      removedPending: rootResult.kind === 'pending',
      removedDescendants,
      removeErr: rootResult.removeErr,
    };
  }

  return {
    removeDroneRuntimeArtifacts,
    removeDroneById,
    removeDroneLifecycleEntryById,
    removeDroneTreeById,
  };
}
