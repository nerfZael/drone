import { DroneProvisioningService } from '../drone-provisioning-route-service';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type DroneProvisioningDependencyName =
  | 'allocateUntitledDisplayName'
  | 'assertReadOnlySupportedForAgent'
  | 'buildAssistantDroneSummariesFromRegistry'
  | 'buildDroneDockerSizeSummary'
  | 'buildDroneRegistrySnapshot'
  | 'canonicalRepositoriesMap'
  | 'commitDroneMetadataPatch'
  | 'createRequestTimer'
  | 'deriveCanonicalCreatedDroneEnvironmentConfig'
  | 'deriveCreatedDroneEnvironmentConfig'
  | 'droneChatSseClients'
  | 'droneChatSseLastByKey'
  | 'droneDisplayNameExists'
  | 'droneRegistrySseClients'
  | 'enqueueProvisioning'
  | 'ensureCanonicalGroup'
  | 'fileExists'
  | 'findDroneEntryByIdentity'
  | 'findDroneIdByRef'
  | 'formatPullHostBranchBeforeCreateError'
  | 'gitPullHostBranchBeforeCreate'
  | 'gitResolveRemoteBranchForCreate'
  | 'getDroneRegistrySseLastSnapshot'
  | 'isSafePromptId'
  | 'loadCanonicalActiveModel'
  | 'loadRegistry'
  | 'logSlowHubRequest'
  | 'makeDroneIdentity'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizeDroneDisplayName'
  | 'normalizeDroneRuntime'
  | 'normalizeSubmittedAtIso'
  | 'notifyCanonicalDroneRegistryWrite'
  | 'nowIso'
  | 'parseAgentPermissionModeForUpdate'
  | 'parseChatModelForUpdate'
  | 'parseCreateRuntime'
  | 'parseDraftFlag'
  | 'parsePersistVolume'
  | 'parsePullHostBranchBeforeCreate'
  | 'parseRemoteBranchName'
  | 'parseRepoBranchSourceMode'
  | 'parseSeedAgent'
  | 'refreshDroneChatEventSnapshot'
  | 'refreshDroneRegistryBroadcasterSnapshot'
  | 'resolveDroneCliPath'
  | 'resolveDroneOrRespond'
  | 'resolveEffectiveLlmProvider'
  | 'resolveStableDroneOrPendingIdFromRef'
  | 'scheduleDroneRegistryBroadcasterRefresh'
  | 'scheduleDroneStatusRefresh'
  | 'setFleetActorConfig'
  | 'startDroneChatBroadcaster'
  | 'startDroneRegistryBroadcaster'
  | 'stopDroneChatBroadcasterIfIdle'
  | 'stopDroneRegistryBroadcasterIfIdle'
  | 'upsertCanonicalDroneLifecycle'
  | 'upsertCanonicalDroneLifecycleBatch'
  | 'writeHubSseEvent';

export type DroneProvisioningRouteDependencies =
  LegacyRouteDependencyContract<DroneProvisioningDependencyName>;

export function createDroneProvisioningRouteHandler(
  deps: DroneProvisioningRouteDependencies,
): LegacyRouteHandler {
  return new DroneProvisioningService(deps).handle;
}
