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
  | 'resolveCanonicalGroupReference'
  | 'findDroneEntryByIdentity'
  | 'findDroneIdByRef'
  | 'gitResolveRemoteBranchForCreate'
  | 'getDroneRegistrySseLastSnapshot'
  | 'isSafePromptId'
  | 'loadCanonicalActiveModel'
  | 'loadRegistry'
  | 'logSlowHubRequest'
  | 'makeDroneIdentity'
  | 'normalizeChatImageAttachments'
  | 'normalizeChatName'
  | 'normalizeChatReasoning'
  | 'normalizeDroneDisplayName'
  | 'normalizeDroneRuntime'
  | 'normalizeSubmittedAtIso'
  | 'notifyCanonicalDroneRegistryWrite'
  | 'nowIso'
  | 'parseAgentPermissionModeForUpdate'
  | 'parseAgentApprovalPolicyForUpdate'
  | 'parseChatModelForUpdate'
  | 'parseCreateRuntime'
  | 'parseDraftFlag'
  | 'parsePersistVolume'
  | 'parseRemoteBranchName'
  | 'parseRepoBranchSourceMode'
  | 'parseSeedAgent'
  | 'refreshDroneChatEventSnapshot'
  | 'refreshDroneRegistryBroadcasterSnapshot'
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
