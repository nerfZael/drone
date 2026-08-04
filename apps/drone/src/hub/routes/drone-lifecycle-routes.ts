import { DroneLifecycleService } from '../drone-lifecycle-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type DroneLifecycleDependencyName =
  | 'DRONE_DISPLAY_NAME_MAX_LEN'
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
  | 'resolveCanonicalGroupReference'
  | 'fileExists'
  | 'findDroneIdByRef'
  | 'hubLog'
  | 'isDraftDroneEntry'
  | 'isUngroupedGroupName'
  | 'loadRegistry'
  | 'looksLikeContainerNotRunningError'
  | 'looksLikeMissingContainerError'
  | 'normalizeArchiveRetention'
  | 'normalizeArchiveRuntimePolicy'
  | 'normalizeChatName'
  | 'normalizeDisabledRepoKeys'
  | 'normalizeDroneDisplayName'
  | 'normalizeDroneIdentity'
  | 'normalizeDroneRuntime'
  | 'normalizeEnvVarMap'
  | 'notifyCanonicalDroneRegistryWrite'
  | 'nowIso'
  | 'parseIsoToMs'
  | 'removeArchivedDroneById'
  | 'removeDroneTreeById'
  | 'renameDroneDisplayName'
  | 'resolveArchiveDeleteAtIso'
  | 'resolveDroneCliPath'
  | 'resolveDroneOrPendingForReadRef'
  | 'resolveDroneOrRespond'
  | 'resolveEffectiveDeleteActionSettings'
  | 'restoreArchivedChatById'
  | 'restoreArchivedDroneById'
  | 'revokeMcpAccessTokensForDrone'
  | 'runDroneLifecycleAction'
  | 'setDroneEnvironmentMetadata'
  | 'setDroneGroupMetadata'
  | 'stopAllDroneChatActivity'
  | 'triggerArchiveCleanup'
  | 'validateGroupNameOrThrow'
  | 'withLockedDroneContainer';

export type DroneLifecycleRouteDependencies =
  LegacyRouteDependencyContract<DroneLifecycleDependencyName>;

export function createDroneLifecycleRouteHandler(
  deps: DroneLifecycleRouteDependencies,
): LegacyRouteHandler {
  return new DroneLifecycleService(deps).handle;
}
