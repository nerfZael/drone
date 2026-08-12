import { DroneLifecycleService } from '../drone-lifecycle-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type DroneLifecycleDependencyName =
  | 'archiveDroneById'
  | 'archiveRetentionMs'
  | 'cleanupExpiredArchivedChats'
  | 'commitDroneMetadataPatch'
  | 'deleteArchivedChatById'
  | 'deleteCanonicalDroneLifecycle'
  | 'deleteNativeChatSessionsForDrone'
  | 'dequeueProvisioning'
  | 'droneEnvironmentPayload'
  | 'droneRuntime'
  | 'dvmBaseSet'
  | 'dvmStop'
  | 'enqueueProvisioning'
  | 'findDroneIdByRef'
  | 'hubLog'
  | 'isDraftDroneEntry'
  | 'listArchivedChatsFromStore'
  | 'listCanonicalDroneLifecycleForRead'
  | 'loadRegistry'
  | 'looksLikeContainerNotRunningError'
  | 'looksLikeMissingContainerError'
  | 'normalizeArchiveRetention'
  | 'normalizeArchiveRuntimePolicy'
  | 'normalizeChatName'
  | 'normalizeDisabledRepoKeys'
  | 'normalizeDroneIdentity'
  | 'normalizeDroneRuntime'
  | 'normalizeEnvVarMap'
  | 'nowIso'
  | 'parseIsoToMs'
  | 'removeArchivedDroneById'
  | 'removeDroneTreeById'
  | 'readDroneChatCleanupProjectionFromStore'
  | 'renameDrone'
  | 'resolveArchiveDeleteAtIso'
  | 'resolveCanonicalDroneOrPendingForReadRef'
  | 'resolveDroneOrPendingForReadRef'
  | 'resolveDroneOrRespond'
  | 'resolveEffectiveDeleteActionSettings'
  | 'restoreArchivedChatById'
  | 'restoreArchivedDroneById'
  | 'revokeMcpAccessTokensForDrone'
  | 'runDroneLifecycleAction'
  | 'setDroneEnvironmentMetadata'
  | 'setDroneGroup'
  | 'stopAllDroneChatActivity'
  | 'triggerArchiveCleanup'
  | 'withLockedDroneContainer';

export type DroneLifecycleRouteDependencies =
  LegacyRouteDependencyContract<DroneLifecycleDependencyName>;

export function createDroneLifecycleRouteHandler(
  deps: DroneLifecycleRouteDependencies,
): LegacyRouteHandler {
  return new DroneLifecycleService(deps).handle;
}
