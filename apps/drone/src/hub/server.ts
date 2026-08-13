import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

import { BaseConfigManager } from 'dvm';
import { normalizeAgentPlan, sameAgentPlan } from '@drone/assistant-chat';

import { ensureContainerDroneDaemonSession } from '../host/container-daemon';
import {
  HubOutboxDispatcher,
  HubOutboxDispatchLoop,
  HubOutboxRepository,
} from '../host/hub-outbox';
import { getHubDatabase } from '../host/hub-database';
import { droneRootPath } from '../host/paths';
import { readActiveProfileName } from '../host/profiles';
import {
  createProfile as createManagedProfile,
  deleteProfile as deleteManagedProfile,
  ensureDefaultProfileForFirstRun,
  listProfilesState,
  type HubState as ManagedHubState,
  renameProfile as renameManagedProfile,
  useProfile as useManagedProfile,
} from '../host/profile-manager';
import {
  loadRegistry,
  loadRegistryRawSnapshot,
  updateRegistry as updateHostRegistry,
} from '../host/registry';
import { getCatalogStore } from '../host/catalog-store';
import {
  createRegistryBackup,
  resolveRegistryBackupStatusResponse,
  startRegistryBackupScheduler,
  stopRegistryBackupScheduler,
  upsertStoredRegistryBackupSettings,
} from '../host/registry-backups';
import {
  buildContainerDroneDaemonLaunchScript,
  DRONE_DAEMON_SESSION_NAME,
  installBlipCliScript,
  removeRetiredContainerCliScripts,
  normalizeDroneRuntime,
  type DroneRuntime,
} from '../host/runtime';
import {
  dismissWelcomeForScope,
  ensureHubSetupState,
  resolveHubSetupScopeKey,
} from '../host/setup-state';
import {
  resolveContainerTerminalShellCommand,
  resolveHostTerminalShellCommand,
} from '../host/shell';
import {
  dvmBaseSet,
  dvmCopyFromContainer,
  dvmCopyToContainer,
  dvmExec,
  dvmLs,
  dvmPorts,
  dvmRepoHeadSha,
  dvmRepoExport,
  dvmRepoSeed,
  dvmRepoSetBaseSha,
  run as runHostCommand,
  dvmRemove,
  dvmRename,
  dvmStart,
  dvmStop,
  dvmSessionRead,
  dvmSessionStart,
  dvmSessionType,
} from '../host/dvm';
import {
  daemonClientForDrone,
  health as droneHealth,
  managedDroneSync,
  procStart,
  procStop,
  codexPromptApprovalResolve as droneCodexPromptApprovalResolve,
  codexPromptEnqueue as droneCodexPromptEnqueue,
  promptEnqueue as dronePromptEnqueue,
  promptCancel as dronePromptCancel,
  promptGet as dronePromptGet,
  status as droneStatus,
  terminalInput as droneTerminalInput,
  terminalOutput as droneTerminalOutput,
  terminalPrompt as droneTerminalPrompt,
} from '../host/api';
import {
  retryTemporaryNameSuggestion,
  suggestDroneNameFromMessage,
} from './drone-name-from-message';
import { buildAutoRenamedChatCandidate, isGeneratedChatName } from './chat-auto-rename';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  BuiltinAgentId,
  ChatAgentConfig,
} from './chat-types';
import { createDeviceMeshService } from './device-mesh';
import { createBackgroundLifecycle, type BackgroundLifecycle } from './background-lifecycle';
import {
  canonicalRepositoriesMap,
  ensureCanonicalGroup,
  listCanonicalGroups,
  resolveCanonicalGroupReference,
  listCanonicalRepositories,
  registerCanonicalRepository,
  removeCanonicalRepository,
  updateCanonicalRepositoryAgents,
  updateCanonicalRepositoryEnvironment,
} from './groups-repositories';
import { deleteCanonicalGroupArtifacts } from './group-orchestration';
import { resolveTranscriptPromptAt } from './transcript-order';
import {
  applyChatReconciliationInStore,
  archiveChatInStore,
  countTranscriptTurnsFromStore,
  createChatInStore,
  deleteArchivedChatFromStore,
  deleteActiveChatFromStore,
  deleteChatFromStore,
  importArchivedChatsFromRegistry,
  importChatFromRegistry,
  importDroneChatsFromRegistry,
  importTranscriptTurnsFromRegistry,
  listChatReadStatesForDronesFromStore,
  listChatReadStatesFromStore,
  listArchivedChatsFromStore,
  listChatsFromStore,
  markChatReadInStore,
  markChatUnreadInStore,
  patchChatMetadataInStore,
  readChatFromStore,
  readDroneChatCleanupProjectionFromStore,
  readChatReadStateFromStore,
  readChatRowsFromStore,
  readChatVersionFromStore,
  readTranscriptTurnsFromStore,
  renameChatInStore,
  resetTranscriptStoreForTests,
  restoreArchivedChatInStore,
  rollbackTranscriptToTurnInStore,
  transcriptTurnsSourceHash,
  type ChatReadState,
  upsertChatInStore,
  upsertTranscriptTurnInStore,
  updateTranscriptTurnInStore,
  updateChatInStore,
} from './transcript-store';
import { requireWhiteboardStore, type WhiteboardDocument } from './whiteboard-store';
import { renderWhiteboardPng } from './whiteboard-export';
import { cloneChatEntryForDroneClone, maybeBootstrapPromptFromTranscript } from './chat-clone';
import {
  formatTranscriptJobFailure,
  hasKnownBuiltinTranscriptSession,
  parseBlipJobTranscript,
  parseCodexJobTranscript,
  parseCodexRolloutRuntime,
  parsePiJobTranscript,
  parseStructuredAgentJobTranscript,
  readBuiltinTranscriptSessionId,
  type AgentTurnRuntimeMetadata,
} from './builtin-transcript-sessions';
import { agentModelCatalogAdapter } from './agent-model-catalog/adapters';
import { AgentModelCatalogService } from './agent-model-catalog/service';
import { createAgentModelCatalogStore } from './agent-model-catalog/store';
import type { AgentModelCatalogTarget } from './agent-model-catalog/types';
import { registerAgentModelCatalogRoutes } from './agent-model-catalog/routes';
import {
  createCanonicalAgentsLibraryFile,
  deleteCanonicalAgentsLibraryFile,
  normalizeAgentsMarkdown,
  parseDroneAgentsMdOverride,
  normalizeRepoAgentsMode,
  resolveCanonicalAgentsLibrary,
  resolveCanonicalAgentsLibraryFile,
  resolveCanonicalDefaultAgentsConfig,
  resolveCanonicalRepoAgentsConfig,
  resolveRepoAgentsConfig,
  updateCanonicalAgentsLibraryFile,
  upsertCanonicalDefaultAgentsConfig,
} from './agents-config';
import {
  buildEnvExportLines,
  deriveCanonicalCreatedDroneEnvironmentConfig,
  deriveCreatedDroneEnvironmentConfig,
  normalizeDisabledRepoKeys,
  normalizeEnvVarMap,
  resolveCanonicalRepoEnvironmentConfig,
  resolveDroneEnvironmentConfig,
  upsertCanonicalNonRepoEnvironmentConfig,
} from './environment-config';
import {
  buildStoredSyncSet,
  ensureSyncSetSourceIsReadable,
  ensureHubManagedSyncSetSourceDir,
  findStoredSyncSetIndex,
  parseSyncSetMutationInput,
  removeHubManagedSyncSetSourceDir,
  type ParsedSyncSetMutationInput,
} from './sync-sets';
import { createSyncSetService } from './sync-set-service';
import {
  hasInFlightPriorPendingPrompt,
  looksLikeTransientPromptEnqueueError,
  shouldDeferQueuedPendingPrompt,
  shouldRetryFailedPendingPrompt,
  stalePendingPromptState,
} from './pendingPromptEnqueue';
import {
  applyBranchDiffToMainWorkingTree,
  applyBranchMergeNoCommitToMainWorkingTree,
  buildReviewScopeId,
  cleanupQuarantineWorktree,
  createHostAuthoredMirrorCommit,
  deleteHostRefBestEffort,
  gitRepoCommitDetails,
  gitRepoCommitDiffForPath,
  gitRepoCommitList,
  gitCurrentBranchOrSha,
  gitRepoDiffForPath,
  gitResolveCommitSha,
  gitIsClean,
  gitIsAncestor,
  gitMergeBase,
  gitListRemoteBranches,
  gitMergePreviewNameStatusEntries,
  gitRepoChangesSummary,
  gitResolveRemoteBranchForCreate,
  importBundleHeadToHostRef,
  resolveBundleImportSourceRefFromListHeads,
  gitStashPop,
  gitStashPush,
  gitTopLevel,
  isRepoPatchApplyError,
  repoChangeReviewKey,
  quarantineWorktreePath,
  updateHostRef,
} from './repoOps';
import { ShortLivedSingleFlightCache } from './repo-changes-scan-cache';
import { rejectWebSocketUpgrade } from './hub-auth';
import {
  bashQuote,
  encodeRemotePath,
  hexEncodeUtf8,
  normalizeContainerPath,
  parseBoolParam,
  shellQuoteIfNeeded,
} from './hub-format';
import { normalizeOrigin, readJsonBody, readRawBody, sendJson as json } from './hub-http';
import {
  handleHubRequestFailure,
  prepareHubHttpRequest,
  rejectUnauthorizedHubApiRequest,
} from './hub-request';
import { HubRouter } from './hub-router';
import { createAssistantRuntime } from './assistant-runtime';
import { createArchiveRuntime } from './archive-runtime';
import { createChatPromptRuntime } from './chat-prompt-runtime';
import { createChatSessionRuntime } from './chat-session-runtime';
import { createDroneChatCreator } from './chat-creation-service';
import {
  FS_EDITOR_MAX_BYTES,
  FS_LIST_TIMEOUT_MS,
  FS_MEDIA_MAX_BYTES,
  FS_QUICK_OPEN_MAX_RESULTS,
  FS_TEXT_CHUNK_MAX_BYTES,
  FS_THUMB_MAX_BYTES,
  bufferLooksBinary,
  extensionLower,
  guessImageMimeType,
  guessVideoMimeType,
  isLikelyImagePath,
  isLikelyTextMimeType,
  isLikelyVideoPath,
  parseContainerFsListOutput,
  sortFsEntries,
  type ContainerFsEntry,
} from './filesystem-media';
import { DroneChatBroadcaster } from './drone-chat-broadcaster';
import { DroneRegistryBroadcaster, type DroneRegistrySnapshot } from './drone-registry-broadcaster';
import { createTerminalWebSocketServer } from './terminal-websocket-server';
import { createTerminalWebSocketUpgradeHandler } from './terminal-websocket-upgrade';
import { registerAssistantRoutes } from './routes/assistant-routes';
import { registerAgentRunDiffRoutes } from './routes/agent-run-diff-routes';
import { NativeChatLifecycle } from './assistant/native-chat-lifecycle';
import { buildNativeModelCatalog } from './assistant/native-model-catalog';
import { registerNativeChatRoutes } from './routes/native-chat-routes';
import { registerCatalogRoutes } from './routes/catalog-routes';
import { createChatRouteHandler } from './routes/chat-routes';
import { createDroneLifecycleRouteHandler } from './routes/drone-lifecycle-routes';
import { createDroneProvisioningRouteHandler } from './routes/drone-provisioning-routes';
import { createEditorRouteHandler } from './routes/editor-routes';
import { createFilesystemRouteHandler } from './routes/filesystem-routes';
import { createLocalCheckoutRouteHandler } from './routes/local-checkout-routes';
import { registerFleetRoutes } from './routes/fleet-routes';
import { registerGroupRoutes } from './routes/group-routes';
import { registerMessageRoutes } from './routes/message-routes';
import { registerOperationalRoutes } from './routes/operational-routes';
import { registerResourceSubscriptionRoutes } from './routes/resource-subscription-routes';
import { createRepositoryRouteHandler } from './routes/repository-operation-routes';
import { registerRepositoryRoutes } from './routes/repository-routes';
import { registerSettingsRoutes } from './routes/settings-routes';
import { registerSidebarRoutes } from './routes/sidebar-routes';
import { registerSystemRoutes } from './routes/system-routes';
import { createTerminalRouteHandler } from './routes/terminal-routes';
import { registerWhiteboardRoutes } from './routes/whiteboard-routes';
import { LocalCheckoutService } from './local-checkout-service';
import { createResourceSubscriptionDeliveryAuthorizer } from './subscriptions/create-resource-subscription-delivery-authorizer';
import { ResourceSubscriptionRepository } from './subscriptions/resource-subscription-repository';
import { ResourceSubscriptionService } from './subscriptions/resource-subscription-service';
import { registerChangeRequestFeature } from './change-requests/register-change-request-feature';
import { getChangeRequestRepository } from './change-requests/change-request-repository';
import { partitionWorkflowChatEntries } from './workflows/workflow-chat-metadata';
import {
  isWorkflowChildDroneEntry,
  workflowChildDroneMetadata,
} from './workflows/workflow-child-drone-metadata';
import { registerWorkflowFeature } from './workflows/workflow-feature';
import { DroneHubMcpHttpTransport } from './mcp-http-transport';
import { createHubApplication } from './application/create-hub-application';
import { isUngroupedGroupName } from './application/group-name';
import type { HubApplicationEvent } from './application/hub-application-events';
import { createSidebarCommandService } from './sidebar-command-service';
import {
  assertContainerDroneRuntimePayloadReady,
  assertDroneDaemonRuntimeReady,
  launchHostDroneDaemon,
  resolveContainerDroneRuntimePayloadDir,
  resolveDroneDaemonRuntimeDir,
} from './drone-daemon-runtime';
import { hubChatSessionName } from './terminal-open';
import {
  buildChatAttachmentsDirectory,
  buildChatImageAttachmentRefs,
  copyChatAttachmentsToContainer,
  normalizeChatImageAttachments,
  promptWithImageAttachments,
  readChatAttachmentsFromRefs,
  type ChatImageAttachment,
  type ChatImageAttachmentRef,
} from './chat-attachments';
import {
  droneRepoBaseSha,
  droneRepoChangesSummary,
  droneRepoCommitDetails,
  droneRepoCommitDiffForPath,
  droneRepoCommitList,
  droneRepoDiffForPath,
  droneRepoPullChangesSummary,
  droneRepoPullDiffForPath,
  createDroneDaemonGitRunner,
  createDroneDaemonWorktreeHasher,
  nameStatusCharToType,
  runGitInDrone,
  runGitInDroneOrThrow,
  type RepoPullChangeEntry,
} from './drone-repo';
import {
  resolveLanguageDefinition,
  resolveLanguageReferences,
  LanguageServiceError,
} from './language-service';
import {
  closeGithubPullRequestForRepoRoot,
  getGithubPullRequestCommitForRepoRoot,
  inspectGithubAuthStatus,
  inspectGithubRepoForRepoRoot,
  isGithubPullRequestError,
  listGithubPullRequestChangesForRepoRoot,
  listGithubPullRequestCommitsForRepoRoot,
  listGithubPullRequestsForRepoRoot,
  mergeGithubPullRequestForRepoRoot,
  normalizeGithubPullRequestListState,
  normalizeGithubPullRequestMergeMethod,
} from './github-pull-requests';
import {
  archiveRetentionMs,
  cancelCodexLogin,
  clearStoredProviderApiKey,
  codexLoginStatus,
  collectProviderApiKeyDiagnostics,
  FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
  FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
  UiPreferencesSettingsConflictError,
  UiPreferencesSettingsValidationError,
  hubLog,
  loadHubEnv,
  parseArchiveRetentionId,
  parseArchiveRuntimePolicy,
  parseFilesystemUploadMaxBytes,
  parseDroneDeleteMode,
  parseLlmProvider,
  providerDisplayName,
  providerKeySettingsResponse,
  resolveDeleteActionSettingsResponse,
  resolveEffectiveFilesystemSettings,
  resolveEffectiveDeleteActionSettings,
  resolveEffectiveLlmProvider,
  resolveFilesystemSettingsResponse,
  resolveEffectiveProviderApiKeySettings,
  resolveNameSuggestionLlmSettings,
  resolveExaApiKeySettings,
  resolveEffectiveSpeechSettings,
  resolveGroqApiKeySettings,
  resolveLlmSettingsResponse,
  resolveSpeechSettingsResponse,
  resolveVoiceInputSettingsResponse,
  resolveUserContextSettingsResponse,
  startCodexLogin,
  upsertStoredDeleteActionSettings,
  upsertStoredFilesystemSettings,
  upsertStoredSpeechSettings,
  upsertStoredVoiceInputSettings,
  upsertStoredLlmProvider,
  upsertStoredProviderApiKey,
  updateStoredUserTimeZone,
  type LlmProviderId,
  type StoredApiKeyProviderId,
  type UiPreferencesSettings,
} from './hub-settings';
import {
  createSkill,
  deleteSkillRecord,
  getSkillById,
  listSkills,
  renderSkillProjectionPackages,
  syncSkillLibraryToContainerTargets,
  syncSkillLibraryToHostTargets,
  type SkillProjectionTarget,
  updateSkillRecord,
} from './skills';
import {
  createMcpServer,
  deleteMcpServerRecord,
  getMcpServerById,
  listMcpServers,
  renderMcpProjection,
  type McpServerRecord,
  syncMcpServersToContainerTargets,
  syncMcpServersToHostTargets,
  type McpProjectionTarget,
  updateMcpServerRecord,
} from './mcp-servers';
import { createManagedDroneStateSyncService } from './managed-drone-state-sync';
import {
  createChatMcpAccessToken,
  createMcpAccessToken,
  ensureHostMcpAccessToken,
  getMcpAccessTokenById,
  listMcpAccessTokens,
  regenerateMcpAccessToken,
  revokeMcpAccessToken,
  revokeMcpAccessTokensForDrone,
} from './mcp-tokens';
import {
  isDroneHubMcpServer,
  projectMcpServerForManagedChats,
} from './mcp-managed-chat-projection';
import {
  importSkillFromSource,
  listSkillSourceCandidates,
  listSkillSources,
  previewSkillFromSource,
} from './skill-sources';
import {
  fleetActorConfig,
  fleetActorPayload,
  fleetDescendantIdsForActor,
  setFleetActorConfig,
} from './fleet-helpers';
import { pruneMissingRegistryDrones } from './stale-registry-prune';
import {
  applyDroneDisplayNameAcrossLifecycleEntries,
  findDroneEntryByIdentity,
  findDroneIdByRef,
  findDroneLifecycleEntriesByIdentity,
  normalizeDroneIdentity,
  resolveStableDroneOrPendingIdFromRef,
} from './drone-lifecycle-registry';
import {
  deleteCanonicalDroneLifecycleBatch,
  deleteCanonicalDroneLifecycle,
  listCanonicalDroneLifecycleForRead,
  resolveDroneContainerNameByIdentity,
  resolveDroneFromRegistryRef,
  resolveDroneNameByIdentity,
  resolveCanonicalDroneOrPendingForReadRef,
  resolveDroneOrPendingForReadRef,
  setDroneHubMetaByIdentity,
  upsertCanonicalDroneLifecycle,
  upsertCanonicalDroneLifecycleBatch,
  type ResolvedDrone,
  type ResolvedOrPendingDrone,
} from './drone-lifecycle-service';
import { permanentlyDeleteCanonicalDrone } from './drone-deletion-service';
import {
  readCanonicalActiveDroneModel,
  readCanonicalDroneLifecycleModel,
} from './canonical-drone-read-model';
import {
  commitDroneMetadataPatch,
  renameDroneDisplayName,
  setDroneEnvironmentMetadata,
  updateDroneFleetMetadata,
} from './drone-metadata-commands';
import { createRenameDroneCommand } from './drone-rename-command';
import {
  createPendingDroneStateHelpers,
  hasQueuedPromptWithId,
  type PendingPhase,
} from './drone-pending-state';
import { createDronePendingPromptStore, type PendingPrompt } from './drone-pending-prompts';
import { createDroneProvisioningController } from './drone-provisioning';
import { createDroneRuntime, importContainerDroneRuntime } from './drone-runtime-creation-service';
import { createDockerSnapshotRuntime } from './docker-snapshot-runtime';
import { createDroneStatusRuntime } from './drone-status-runtime';
import { startHubHttpTransport } from './hub-http-transport';
import { hubChangeEvents } from './hub-change-events';
import {
  createNativeChatRuntimePort,
  createResourceSubscriptionRuntimePort,
} from './hub-runtime-ports';
import { createDroneLifecycleRuntime } from './drone-lifecycle-runtime';
import { createFilesystemRuntime } from './filesystem-runtime';
import {
  isDraftChatEntry,
  isDraftDroneEntry,
  summarizeDroneActivity,
} from './drone-summary-helpers';
import { mergeNativeBusyChatNames } from './native-drone-summary';
import { summarizeAssistantChatIdle } from './assistant';
import { saveAssistantArtifactUploads, validateAssistantPromptImages } from './assistant-artifacts';

const HUB_API_LOADED_AT = new Date().toISOString();
const HUB_API_BUILD_ID = crypto.randomBytes(6).toString('hex');
const requireForHub = createRequire(__filename);

async function updateRegistry<T>(
  mutator: (reg: any) => T | Promise<T>,
  opts?: { timeoutMs?: number; staleAfterMs?: number },
): Promise<T> {
  const result = await updateHostRegistry(mutator as any, opts as any);
  hubChangeEvents.emitRegistryWrite();
  return result as T;
}

const HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES = 600;
const HUB_SETTINGS_LOG_MAX_TAIL_LINES = 5000;
const HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES = 200_000;
const HUB_SETTINGS_LOG_MAX_BYTES = 1_000_000;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

type RepoBranchSourceMode = 'host' | 'remote';

function parseRepoBranchSourceMode(raw: unknown): RepoBranchSourceMode {
  if (raw == null) return 'host';
  const value = String(raw).trim().toLowerCase();
  if (!value || value === 'host' || value === 'host-branch' || value === 'current-branch')
    return 'host';
  if (value === 'remote' || value === 'remote-branch') return 'remote';
  throw new Error('invalid repoBranchSource (expected host|remote)');
}

function parseRemoteBranchName(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^refs\/remotes\//, '')
    .replace(/^remotes\//, '');
}

function comparableBranchRefCandidates(raw: unknown): string[] {
  const value = String(raw ?? '').trim();
  if (!value) return [];
  const out = new Set<string>();
  const push = (nextRaw: unknown) => {
    const next = String(nextRaw ?? '').trim();
    if (next) out.add(next);
  };
  push(value);
  const normalized = value
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\//, '')
    .replace(/^remotes\//, '');
  push(normalized);
  const firstSlash = normalized.indexOf('/');
  if (firstSlash > 0) push(normalized.slice(firstSlash + 1));
  return Array.from(out);
}

function repoBaseRefMatchesCurrentHostBranch(
  baseRefRaw: unknown,
  currentHostBranchRaw: unknown,
): boolean {
  const baseRefCandidates = comparableBranchRefCandidates(baseRefRaw);
  const currentHostCandidates = comparableBranchRefCandidates(currentHostBranchRaw);
  if (baseRefCandidates.length === 0 || currentHostCandidates.length === 0) return false;
  return currentHostCandidates.some((candidate) => baseRefCandidates.includes(candidate));
}

function parseCreateRuntime(raw: unknown): DroneRuntime {
  if (raw == null) return 'container';
  const value = String(raw).trim().toLowerCase();
  if (!value) return 'container';
  if (value === 'container' || value === 'host') return value;
  throw new Error('invalid runtime (expected container|host)');
}

function parseDraftFlag(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw == null) return false;
  const value = String(raw).trim().toLowerCase();
  return (
    value === '1' || value === 'true' || value === 'yes' || value === 'on' || value === 'draft'
  );
}

function parsePersistVolume(raw: unknown): boolean | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'boolean') return raw;
  throw new Error('invalid persistVolume (expected boolean)');
}

async function readLogTail(
  logPath: string,
  opts: {
    tailLines: number;
    maxBytes: number;
  },
): Promise<{
  logPath: string;
  text: string;
  truncated: boolean;
  fileSize: number;
  bytesRead: number;
  updatedAt: string | null;
}> {
  let fileSize = 0;
  let updatedAt: string | null = null;
  try {
    const st = await fs.stat(logPath);
    fileSize = Number.isFinite(st.size) && st.size > 0 ? Math.floor(st.size) : 0;
    updatedAt = st.mtime ? st.mtime.toISOString() : null;
  } catch (error: any) {
    const code = String(error?.code ?? '');
    if (code === 'ENOENT') {
      return { logPath, text: '', truncated: false, fileSize: 0, bytesRead: 0, updatedAt: null };
    }
    throw error;
  }

  if (fileSize <= 0) {
    return { logPath, text: '', truncated: false, fileSize: 0, bytesRead: 0, updatedAt };
  }

  const maxBytes = clampInt(opts.maxBytes, 1, HUB_SETTINGS_LOG_MAX_BYTES);
  const start = Math.max(0, fileSize - maxBytes);
  const readLen = Math.max(1, fileSize - start);
  const fh = await fs.open(logPath, 'r');

  let bytesRead = 0;
  let text = '';
  try {
    const buf = Buffer.alloc(readLen);
    const out = await fh.read(buf, 0, readLen, start);
    bytesRead = out.bytesRead;
    text = buf.subarray(0, bytesRead).toString('utf8').replace(/\r\n/g, '\n');
  } finally {
    await fh.close();
  }

  let truncated = start > 0;
  if (start > 0) {
    // We likely started mid-line; drop the partial first line for cleaner output.
    const nl = text.indexOf('\n');
    if (nl >= 0) text = text.slice(nl + 1);
  }

  const tailLines = clampInt(opts.tailLines, 1, HUB_SETTINGS_LOG_MAX_TAIL_LINES);
  const lines = text.split('\n');
  if (lines.length > tailLines) {
    text = lines.slice(-tailLines).join('\n');
    truncated = true;
  }

  return {
    logPath,
    text,
    truncated,
    fileSize,
    bytesRead,
    updatedAt,
  };
}

async function readHubLogTail(opts: { tailLines: number; maxBytes: number }) {
  return await readLogTail(droneRootPath('hub.log'), opts);
}

function stableResponseFingerprint(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value ?? null), 'utf8')
    .digest('base64url');
}

function jsonWithEtag(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: any,
) {
  const data = JSON.stringify(body, null, 2);
  const etag = `"sha256-${crypto.createHash('sha256').update(data).digest('base64url')}"`;
  res.setHeader('etag', etag);
  res.setHeader('cache-control', 'no-store');
  if (status === 200) {
    const ifNoneMatch = String(req.headers['if-none-match'] ?? '');
    const requestedEtags = ifNoneMatch.split(',').map((item) => item.trim());
    if (requestedEtags.includes(etag) || requestedEtags.includes('*')) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(data);
}

function jsonWithKnownEtag(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  status: number,
  body: any,
  etag: string,
) {
  const safeEtag = etag.startsWith('"') ? etag : `"${etag.replace(/"/g, '')}"`;
  res.setHeader('etag', safeEtag);
  res.setHeader('cache-control', 'no-store');
  if (status === 200) {
    const ifNoneMatch = String(req.headers['if-none-match'] ?? '');
    const requestedEtags = ifNoneMatch.split(',').map((item) => item.trim());
    if (requestedEtags.includes(safeEtag) || requestedEtags.includes('*')) {
      res.statusCode = 304;
      res.end();
      return;
    }
  }
  const data = JSON.stringify(body, null, 2);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(data);
}

function createRequestTimer() {
  const start = process.hrtime.bigint();
  let last = start;
  const items: Array<{ name: string; dur: number }> = [];
  return {
    mark(name: string) {
      const now = process.hrtime.bigint();
      items.push({ name, dur: Number(now - last) / 1_000_000 });
      last = now;
    },
    total(): number {
      return Number(process.hrtime.bigint() - start) / 1_000_000;
    },
    snapshot() {
      return {
        totalMs: Math.round((Number(process.hrtime.bigint() - start) / 1_000_000) * 10) / 10,
        phases: items.map((item) => ({
          name: item.name,
          durationMs: Math.round(Math.max(0, item.dur) * 10) / 10,
        })),
      };
    },
    setHeader(res: http.ServerResponse) {
      if (res.headersSent || items.length === 0) return;
      const total = Number(process.hrtime.bigint() - start) / 1_000_000;
      const header = [
        ...items.map((item) => `${item.name};dur=${Math.max(0, item.dur).toFixed(1)}`),
        `total;dur=${Math.max(0, total).toFixed(1)}`,
      ].join(', ');
      res.setHeader('server-timing', header);
    },
  };
}

function logSlowHubRequest(
  label: string,
  timer: ReturnType<typeof createRequestTimer>,
  meta?: Record<string, unknown>,
) {
  const totalMs = timer.total();
  if (totalMs < 250) return;
  hubLog('warn', `slow ${label} request`, {
    ...(meta ?? {}),
    durationMs: Math.round(totalMs),
    timing: timer.snapshot(),
  });
}

async function readManagedHubStateAtRoot(rootDir: string): Promise<ManagedHubState> {
  const statePath = path.join(rootDir, 'hub.json');
  const raw = await fs.readFile(statePath, 'utf8');
  const parsed: any = JSON.parse(raw);
  const pid = Number(parsed?.pid);
  const apiPort = Number(parsed?.apiPort);
  const uiPort = Number(parsed?.uiPort);
  if (!parsed || typeof parsed !== 'object' || Number(parsed.version) !== 1) {
    throw new Error(`invalid hub state at ${statePath}`);
  }
  if (!Number.isFinite(pid) || !Number.isFinite(apiPort) || !Number.isFinite(uiPort)) {
    throw new Error(`invalid hub state at ${statePath}`);
  }
  return {
    version: 1,
    pid,
    apiHost: typeof parsed.apiHost === 'string' ? parsed.apiHost : '127.0.0.1',
    apiPort,
    uiPort,
    containerMcp: parseManagedHubContainerMcpState(parsed.containerMcp),
    startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
    logPath: typeof parsed.logPath === 'string' ? parsed.logPath : path.join(rootDir, 'hub.log'),
    launchEnv: parsed.launchEnv ?? null,
  };
}

function parseManagedHubContainerMcpState(raw: unknown): ManagedHubState['containerMcp'] {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as any;
  const host = typeof value.host === 'string' ? value.host.trim() : '';
  const port = Number(value.port);
  const url = typeof value.url === 'string' ? value.url.trim() : '';
  if (!host || !Number.isFinite(port) || port <= 0 || !url) return null;
  return { host, port: Math.floor(port), url };
}

function profileSettingsErrorStatus(error: unknown): number {
  const message = String((error as any)?.message ?? error ?? '').trim();
  if (/invalid profile name/i.test(message)) return 400;
  if (
    /unknown profile/i.test(message) ||
    /cannot delete active profile/i.test(message) ||
    /already exists/i.test(message)
  ) {
    return 409;
  }
  return 500;
}

function shellQuoteForCheck(raw: string): string {
  return `'${String(raw ?? '').replace(/'/g, `'\\''`)}'`;
}

async function checkHostCommand(
  command: string,
): Promise<{ available: boolean; detail: string | null }> {
  const result = await runHostCommand(
    'bash',
    ['-lc', `command -v ${shellQuoteForCheck(command)} >/dev/null 2>&1`],
    { timeoutMs: 3_000 },
  );
  if (result.code === 0) return { available: true, detail: null };
  return { available: false, detail: `${command} is not on PATH` };
}

function githubAuthDetail(auth: Awaited<ReturnType<typeof inspectGithubAuthStatus>>): string {
  if (auth.tokenSource === 'environment') {
    return `GitHub auth is available from ${auth.tokenEnvKey ?? 'environment'}.`;
  }
  if (auth.tokenSource === 'gh') {
    return 'GitHub auth is available from host gh auth.';
  }
  if (auth.ghCliInstalled) {
    return 'Host gh is installed but not authenticated. Run gh auth login or set DRONE_HUB_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN.';
  }
  return 'Set DRONE_HUB_GITHUB_TOKEN / GITHUB_TOKEN / GH_TOKEN, or install and authenticate host gh.';
}

async function resolveGithubSettingsResponse(): Promise<any> {
  const auth = await inspectGithubAuthStatus();
  return {
    ok: true,
    github: {
      pullRequestTransport: 'github-api',
      authReady: auth.tokenAvailable,
      authSource: auth.tokenSource,
      authEnvKey: auth.tokenEnvKey,
      authDetail: githubAuthDetail(auth),
      ghCliInstalled: auth.ghCliInstalled,
      ghCliAuthenticated: auth.ghCliAuthenticated,
      ghCliPath: auth.ghCliPath,
      ghCliVersion: auth.ghCliVersion,
    },
  };
}

async function resolveSetupStatusResponse(): Promise<any> {
  await ensureDefaultProfileForFirstRun();
  const setupState = await ensureHubSetupState();
  const profileState = await listProfilesState();
  const setupScope = resolveHubSetupScopeKey(profileState.activeProfile);
  const welcomeDismissedAt = setupState.welcomeDismissedAtByScope[setupScope] ?? null;
  const regAny = await loadRegistry();
  const dronesObj =
    regAny?.drones && typeof regAny.drones === 'object' && !Array.isArray(regAny.drones)
      ? regAny.drones
      : {};
  const droneCount = Object.values(dronesObj).filter(
    (drone) => !isWorkflowChildDroneEntry(drone),
  ).length;
  const repoCount = (await listCanonicalRepositories()).length;
  const llmSettings = await resolveLlmSettingsResponse();
  const activeProvider = llmSettings.provider.selected;
  const activeProviderSettings =
    activeProvider === 'gemini'
      ? llmSettings.gemini
      : activeProvider === 'codex'
        ? llmSettings.codex
        : llmSettings.openai;
  const dockerCommand = await checkHostCommand('docker');
  let dockerStatus: { status: 'ready' | 'missing' | 'warning'; detail: string | null } = {
    status: dockerCommand.available ? 'ready' : 'missing',
    detail: dockerCommand.detail,
  };
  if (dockerCommand.available) {
    const info = await runHostCommand('docker', ['info'], { timeoutMs: 10_000 });
    if (info.code !== 0) {
      const detail = String(
        info.stderr || info.stdout || 'docker is installed but unavailable',
      ).trim();
      dockerStatus = { status: 'warning', detail: detail || 'docker is installed but unavailable' };
    }
  }
  const tmuxCommand = await checkHostCommand('tmux');
  const githubSettings = await resolveGithubSettingsResponse();
  const hasBaseImage = await new BaseConfigManager().hasBase();
  const dependencies = [
    {
      id: 'docker',
      label: 'Docker',
      status: dockerStatus.status,
      blocking: dockerStatus.status !== 'ready',
      requiredFor: 'container drones',
      detail:
        dockerStatus.detail ??
        (dockerStatus.status === 'ready'
          ? 'Docker daemon is reachable.'
          : 'Docker is required for container drones.'),
    },
    {
      id: 'tmux',
      label: 'tmux',
      status: tmuxCommand.available ? 'ready' : 'warning',
      blocking: false,
      requiredFor: 'host-runtime drones',
      detail: tmuxCommand.available
        ? 'Host-runtime drones can launch local daemons.'
        : 'Install tmux if you plan to use host-runtime drones.',
    },
    {
      id: 'github',
      label: 'GitHub auth',
      status: githubSettings.github.authReady ? 'ready' : 'warning',
      blocking: false,
      requiredFor: 'pull request actions',
      detail: githubSettings.github.authDetail,
    },
    {
      id: 'llm',
      label: 'LLM provider',
      status: activeProviderSettings.hasKey ? 'ready' : 'warning',
      blocking: !activeProviderSettings.hasKey,
      requiredFor: 'agent chats',
      detail: activeProviderSettings.hasKey
        ? `${providerDisplayName(activeProvider)} is configured.`
        : activeProvider === 'codex'
          ? 'Run Codex CLI login on the Hub host before sending prompts.'
          : `Configure a ${providerDisplayName(activeProvider)} key before sending prompts.`,
    },
    {
      id: 'base-image',
      label: 'Base image',
      status: hasBaseImage ? 'ready' : 'warning',
      blocking: false,
      requiredFor: 'faster container setup',
      detail: hasBaseImage
        ? 'A DVM base image is configured for this profile.'
        : 'Optional: set a base image to speed up future container creation.',
    },
  ];
  const hasBlockingDependency = dependencies.some(
    (item) => item.blocking && item.status !== 'ready',
  );
  const isFreshProfile = droneCount === 0 && repoCount === 0;
  return {
    ok: true,
    firstHubStartedAt: setupState.firstHubStartedAt,
    welcomeDismissedAt,
    shouldShowWelcome: !welcomeDismissedAt && (hasBlockingDependency || isFreshProfile),
    activeProfile: profileState.activeProfile,
    mode: profileState.mode,
    profile: {
      activeProfile: profileState.activeProfile,
      droneCount,
      repoCount,
      isFresh: isFreshProfile,
      droneDataDir: profileState.droneDataDir,
      dvmDataDir: profileState.dvmDataDir,
    },
    dependencies,
  };
}

const DRONE_OP_LOCKS = new Map<string, Promise<void>>();

async function withDroneOpLock<T>(keyRaw: string, fn: () => Promise<T>): Promise<T> {
  const key = String(keyRaw ?? '').trim();
  if (!key) return await fn();
  const prev = DRONE_OP_LOCKS.get(key) ?? Promise.resolve();
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = () => resolve();
  });
  const chained = prev.then(() => gate);
  DRONE_OP_LOCKS.set(key, chained);
  await prev;
  try {
    return await fn();
  } finally {
    try {
      release();
    } finally {
      if (DRONE_OP_LOCKS.get(key) === chained) DRONE_OP_LOCKS.delete(key);
    }
  }
}

type DroneContainerContext = {
  registryDroneName: string;
  containerName: string;
  droneEntry: any;
  droneId: string | null;
};

async function resolveDroneContainerContext(opts: {
  requestedDroneName: string;
  droneEntry: any;
}): Promise<DroneContainerContext> {
  const requestedDroneName = String(opts.requestedDroneName ?? '').trim();
  const seedEntry = opts.droneEntry;
  const seedId = normalizeDroneIdentity(seedEntry?.id) || null;

  let registryDroneName = requestedDroneName;
  let containerName =
    String(seedEntry?.containerName ?? seedEntry?.name ?? requestedDroneName).trim() ||
    requestedDroneName;
  let droneEntry = seedEntry;

  if (seedId) {
    const canonical = !(globalThis as any).Bun
      ? await resolveCanonicalDroneOrPendingForReadRef(seedId)
      : null;
    if (canonical?.kind === 'real') {
      registryDroneName = canonical.id;
      droneEntry = canonical.drone;
      const resolvedContainerName = String(
        canonical.drone?.containerName ?? canonical.drone?.name ?? canonical.id,
      ).trim();
      if (resolvedContainerName) containerName = resolvedContainerName;
    } else if ((globalThis as any).Bun) {
      const regLatest: any = await loadRegistry();
      const found = findDroneEntryByIdentity(regLatest, seedId);
      if (found) {
        registryDroneName = String(found.key ?? requestedDroneName).trim() || requestedDroneName;
        droneEntry = found.entry ?? droneEntry;
        const resolvedContainerName = String(
          (found.entry as any)?.containerName ?? (found.entry as any)?.name ?? found.key ?? '',
        ).trim();
        if (resolvedContainerName) containerName = resolvedContainerName;
      }
    }
  }

  return { registryDroneName, containerName, droneEntry, droneId: seedId };
}

async function withLockedDroneContainer<T>(
  opts: { requestedDroneName: string; droneEntry: any },
  fn: (ctx: DroneContainerContext) => Promise<T>,
): Promise<T> {
  const requestedDroneName = String(opts.requestedDroneName ?? '').trim();
  const seedEntry = opts.droneEntry;
  const seedId = normalizeDroneIdentity(seedEntry?.id) || null;
  const lockKey = seedId
    ? `drone:${seedId}`
    : `drone-name:${String(seedEntry?.containerName ?? seedEntry?.name ?? requestedDroneName)}`;

  return await withDroneOpLock(lockKey, async () => {
    return await fn(await resolveDroneContainerContext(opts));
  });
}

async function withReadonlyDroneContainer<T>(
  opts: { requestedDroneName: string; droneEntry: any },
  fn: (ctx: DroneContainerContext) => Promise<T>,
): Promise<T> {
  // Read-only Docker exec/copy operations should not wait behind long chat,
  // provisioning, or mutation work. A concurrent rename/delete will surface as
  // a normal Docker missing-container error, which callers already handle.
  return await fn(await resolveDroneContainerContext(opts));
}

function lockedDroneContainerSortKey(opts: {
  requestedDroneName: string;
  droneEntry: any;
}): string {
  const requestedDroneName = String(opts.requestedDroneName ?? '').trim();
  const seedEntry = opts.droneEntry;
  const seedId = normalizeDroneIdentity(seedEntry?.id) || null;
  if (seedId) return `drone:${seedId}`;
  return `drone-name:${String(seedEntry?.containerName ?? seedEntry?.name ?? requestedDroneName).trim() || requestedDroneName}`;
}

async function withLockedDroneContainers<T>(
  sourceOpts: { requestedDroneName: string; droneEntry: any },
  targetOpts: { requestedDroneName: string; droneEntry: any },
  fn: (ctx: {
    source: {
      registryDroneName: string;
      containerName: string;
      droneEntry: any;
      droneId: string | null;
    };
    target: {
      registryDroneName: string;
      containerName: string;
      droneEntry: any;
      droneId: string | null;
    };
  }) => Promise<T>,
): Promise<T> {
  const sourceKey = lockedDroneContainerSortKey(sourceOpts);
  const targetKey = lockedDroneContainerSortKey(targetOpts);

  if (sourceKey === targetKey) {
    return await withLockedDroneContainer(sourceOpts, async (ctx) => {
      return await fn({ source: ctx, target: ctx });
    });
  }

  if (sourceKey.localeCompare(targetKey) <= 0) {
    return await withLockedDroneContainer(sourceOpts, async (source) => {
      return await withLockedDroneContainer(targetOpts, async (target) => {
        return await fn({ source, target });
      });
    });
  }

  return await withLockedDroneContainer(targetOpts, async (target) => {
    return await withLockedDroneContainer(sourceOpts, async (source) => {
      return await fn({ source, target });
    });
  });
}

function normalizeFleetAssignedRefsForSummary(
  regAny: any,
  actorIdRaw: unknown,
  assignedRaw: unknown,
): string[] {
  const actorId = normalizeDroneIdentity(actorIdRaw);
  if (!Array.isArray(assignedRaw)) return [];
  return Array.from(
    new Set(
      assignedRaw
        .map((item) => resolveStableDroneOrPendingIdFromRef(regAny, item))
        .filter((item): item is string => Boolean(item) && item !== actorId),
    ),
  );
}

async function resolveDroneOrRespond(
  res: http.ServerResponse,
  droneRef: string,
): Promise<ResolvedDrone | null> {
  const ref = String(droneRef ?? '').trim();
  if (!(globalThis as any).Bun) {
    const canonical = await resolveCanonicalDroneOrPendingForReadRef(ref);
    if (canonical?.kind === 'pending') {
      json(res, 409, { ok: false, error: `drone "${ref}" is still starting` });
      return null;
    }
    if (canonical?.kind === 'real') return { id: canonical.id, drone: canonical.drone };
    json(res, 404, { ok: false, error: `unknown drone: ${ref}` });
    return null;
  }
  return resolveDroneFromRegistryRef(ref, {
    onStillStarting: () => {
      json(res, 409, { ok: false, error: `drone "${ref}" is still starting` });
    },
    onUnknown: () => {
      json(res, 404, { ok: false, error: `unknown drone: ${ref}` });
    },
  });
}

function sortedEnvEntries(
  varsRaw: unknown,
  source: 'repo' | 'drone',
): Array<{ key: string; value: string; source: 'repo' | 'drone' }> {
  return Object.entries(normalizeEnvVarMap(varsRaw))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value, source }));
}

async function withCanonicalRepositories(registry?: any): Promise<any> {
  const regAny = registry ?? (await loadRegistry());
  return { ...regAny, repos: await canonicalRepositoriesMap() };
}

async function repoEnvironmentPayload(regAny: any, repoPathRaw: unknown) {
  const repo = await resolveCanonicalRepoEnvironmentConfig(regAny, repoPathRaw);
  return {
    ok: true as const,
    repoPath: repo.repoPath,
    label: repo.label,
    registered: repo.registered,
    autoApplyToNewContainerDrones: repo.autoApplyToNewContainerDrones,
    updatedAt: repo.updatedAt,
    vars: repo.vars,
    entries: sortedEnvEntries(repo.vars, 'repo'),
  };
}

async function defaultAgentsPayload(regAny: any) {
  const agents = await resolveCanonicalDefaultAgentsConfig(regAny);
  const files = await resolveCanonicalAgentsLibrary();
  return {
    ok: true as const,
    agents: {
      content: agents.content,
      enabled: agents.enabled,
      updatedAt: agents.updatedAt,
    },
    files: files.map(({ content: _content, ...file }) => file),
  };
}

function repoAgentsPayload(regAny: any, repoPathRaw: unknown) {
  const agents = resolveRepoAgentsConfig(regAny, repoPathRaw);
  return {
    ok: true as const,
    repoPath: agents.repoPath,
    label: agents.label,
    registered: agents.registered,
    mode: agents.mode,
    content: agents.content,
    updatedAt: agents.updatedAt,
    effectiveContent: agents.effectiveContent,
    effectiveSource: agents.effectiveSource,
  };
}

function droneEnvironmentPayload(
  regAny: any,
  opts: {
    id: string;
    kind: 'real' | 'pending';
    entry: any;
  },
) {
  const env = resolveDroneEnvironmentConfig(regAny, opts.entry);
  const disabledRepoKeys = [...env.disabledRepoKeys].sort((a, b) => a.localeCompare(b));
  const disabledSet = new Set(disabledRepoKeys);
  const availableRepoEntries = Object.entries(env.repo.vars)
    .filter(([key]) => disabledSet.has(key))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value, source: 'repo' as const }));
  const resolvedEntries = [
    ...Object.entries(env.repoVars)
      .filter(([key]) => !(key in env.vars))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value, source: 'repo' as const })),
    ...Object.entries(env.vars)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value, source: 'drone' as const })),
  ];
  return {
    ok: true as const,
    id: opts.id,
    kind: opts.kind,
    name: String(opts.entry?.name ?? opts.id).trim() || opts.id,
    runtime: normalizeDroneRuntime((opts.entry as any)?.runtime),
    repoPath: String(opts.entry?.repoPath ?? '').trim(),
    repoLabel: env.repo.label,
    repoRegistered: env.repo.registered,
    repoVars: env.repo.vars,
    repoEntries: sortedEnvEntries(env.repo.vars, 'repo'),
    useRepoVars: env.useRepoVars,
    disabledRepoKeys,
    excludedRepoEntries: availableRepoEntries,
    vars: env.vars,
    customEntries: sortedEnvEntries(env.vars, 'drone'),
    resolvedVars: env.resolvedVars,
    resolvedEntries,
    updatedAt: env.updatedAt,
    repoUpdatedAt: env.repo.updatedAt,
    autoApplyToNewContainerDrones: env.repo.autoApplyToNewContainerDrones,
  };
}

async function resolveDroneOrRejectUpgrade(
  socket: any,
  droneRef: string,
): Promise<ResolvedDrone | null> {
  return resolveDroneFromRegistryRef(droneRef, {
    onStillStarting: () => {
      rejectWebSocketUpgrade(socket, 409, 'Conflict');
    },
    onUnknown: () => {
      rejectWebSocketUpgrade(socket, 404, 'Not Found');
    },
  });
}

function fleetError(message: string, status: number = 400): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function isRepoAttachedDrone(drone: any): boolean {
  if (!drone || typeof drone !== 'object') return false;
  const explicit = (drone as any).repoAttached;
  if (typeof explicit === 'boolean') return explicit;
  return (
    Boolean(String((drone as any).repoPath ?? '').trim()) ||
    Boolean(String((drone as any).repo?.dest ?? '').trim()) ||
    Boolean(String((drone as any).repo?.seededAt ?? '').trim())
  );
}

function resourceSubscriptionChatIds(droneEntry: any): string[] {
  return [
    ...Object.values<any>(droneEntry?.chats ?? {}),
    ...Object.values<any>(droneEntry?.archivedChats ?? {}),
  ]
    .map((chatEntry) => String(chatEntry?.id ?? '').trim())
    .filter(Boolean);
}

function safeDroneRefSegment(raw: unknown, fallback = 'drone'): string {
  return (
    String(raw ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || fallback
  );
}

function unsupportedHostCustomAgentError(): Error & { statusCode?: number } {
  const err = new Error('custom agents are not yet supported for host runtime') as Error & {
    statusCode?: number;
  };
  err.statusCode = 400;
  return err;
}

function assertChatAgentSupportedForDrone(
  drone: any,
  agent: ChatAgentConfig | null | undefined,
): void {
  if (droneRuntime(drone) === 'host' && agent?.kind === 'custom') {
    throw unsupportedHostCustomAgentError();
  }
}

function looksLikeEmptyBundleExportError(message: string): boolean {
  const raw = String(message ?? '');
  return /refusing to create empty bundle/i.test(raw);
}

function looksLikeBundleMissingPrerequisiteError(message: string): boolean {
  const raw = String(message ?? '');
  return /lacks these prerequisite commits|missing prerequisite commits|repository lacks.*prerequisite/i.test(
    raw,
  );
}

function looksLikeUnrelatedHistoriesError(message: string): boolean {
  const raw = String(message ?? '');
  return /refusing to merge unrelated histories/i.test(raw);
}

function parseShaFromText(raw: string): string | null {
  const m = String(raw ?? '').match(/\b[0-9a-f]{40}\b/i);
  return m ? m[0].toLowerCase() : null;
}

function parseMergeConflictFilesFromText(text: string): string[] {
  const raw = String(text ?? '');
  const out = new Set<string>();
  let m: RegExpExecArray | null = null;

  const patchFailedRe = /patch failed:\s+(.+?):\d+/gi;
  while ((m = patchFailedRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const mergeConflictRe = /CONFLICT\s+\([^)]+\):\s+.*\s+in\s+(.+)$/gim;
  while ((m = mergeConflictRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  const doesNotApplyRe = /error:\s+(.+?):\s+patch does not apply$/gim;
  while ((m = doesNotApplyRe.exec(raw))) {
    const file = String(m[1] ?? '').trim();
    if (file) out.add(file);
  }

  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

async function droneUnmergedFiles(opts: {
  containerName: string;
  repoPathInContainer: string;
}): Promise<string[]> {
  const r = await runGitInDrone({
    container: opts.containerName,
    repoPathInContainer: opts.repoPathInContainer,
    args: ['diff', '--name-only', '--diff-filter=U'],
  });
  if (r.code !== 0) return [];
  return String(r.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

async function exportFullHeadBundleFromDrone(opts: {
  containerName: string;
  repoPathInContainer: string;
  outDir: string;
  label?: string;
}): Promise<{ exportedPath: string }> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer || '/work/repo');
  const outDir = path.resolve(String(opts.outDir ?? ''));
  const safeLabel =
    String(opts.label || opts.containerName || 'drone')
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'drone';
  const runId = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
  const containerTmp = normalizeContainerPath(
    `/tmp/drone-hub/full-repo-exports/${safeLabel}-${runId}`,
  );
  const containerBundlePath = normalizeContainerPath(`${containerTmp}/changes.bundle`);
  const exportedPath = path.join(outDir, `bundle-full-${safeLabel}-${runId}.bundle`);

  await fs.mkdir(outDir, { recursive: true });

  const create = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    [
      'set -euo pipefail',
      `rm -rf ${JSON.stringify(containerTmp)}`,
      `mkdir -p ${JSON.stringify(containerTmp)}`,
      `cd ${JSON.stringify(repoPathInContainer)}`,
      `git bundle create ${JSON.stringify(containerBundlePath)} HEAD`,
    ].join('\n'),
  ]);
  if (create.code !== 0) {
    const details = `${String(create.stderr ?? '')}\n${String(create.stdout ?? '')}`.trim();
    throw new Error(`Failed creating full source bundle.${details ? `\n\n${details}` : ''}`);
  }

  try {
    await dvmCopyFromContainer(opts.containerName, containerBundlePath, exportedPath);
  } finally {
    try {
      await dvmExec(opts.containerName, 'bash', [
        '-lc',
        `rm -rf ${JSON.stringify(containerTmp)} || true`,
      ]);
    } catch {
      // ignore cleanup failure
    }
  }

  return { exportedPath };
}

async function importBundleHeadToDroneRef(opts: {
  containerName: string;
  repoPathInContainer: string;
  hostBundlePath: string;
  containerBundlePath: string;
  refName: string;
}): Promise<string> {
  const repoPathInContainer = normalizeContainerPath(opts.repoPathInContainer || '/work/repo');
  const hostBundlePath = String(opts.hostBundlePath ?? '').trim();
  const containerBundlePath = normalizeContainerPath(
    opts.containerBundlePath || '/tmp/drone-hub/repo-import.bundle',
  );
  const refName = String(opts.refName ?? '').trim();
  if (!hostBundlePath) throw new Error('missing host bundle path');
  if (!refName) throw new Error('missing drone import ref');

  const mkOutDir = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    [
      'set -euo pipefail',
      `mkdir -p ${JSON.stringify(path.posix.dirname(containerBundlePath))}`,
    ].join('\n'),
  ]);
  if (mkOutDir.code !== 0) {
    const details = `${String(mkOutDir.stderr ?? '')}\n${String(mkOutDir.stdout ?? '')}`.trim();
    throw new Error(
      `Failed preparing bundle import path in container.${details ? `\n\n${details}` : ''}`,
    );
  }

  await dvmCopyToContainer(opts.containerName, hostBundlePath, containerBundlePath);

  const listHeads = await dvmExec(opts.containerName, 'git', [
    'bundle',
    'list-heads',
    containerBundlePath,
  ]);
  if (listHeads.code !== 0) {
    const details = `${String(listHeads.stderr ?? '')}\n${String(listHeads.stdout ?? '')}`.trim();
    throw new Error(`Failed reading bundle refs in container.${details ? `\n\n${details}` : ''}`);
  }

  const sourceRef = resolveBundleImportSourceRefFromListHeads(String(listHeads.stdout ?? ''));
  const fetch = await dvmExec(opts.containerName, 'git', [
    '-C',
    repoPathInContainer,
    'fetch',
    '--no-tags',
    '--force',
    containerBundlePath,
    `${sourceRef}:${refName}`,
  ]);
  if (fetch.code !== 0) {
    const details = `${String(fetch.stderr ?? '')}\n${String(fetch.stdout ?? '')}`.trim();
    throw new Error(
      `Failed importing host bundle into drone ref ${refName}.${details ? `\n\n${details}` : ''}`,
    );
  }

  const rev = await dvmExec(opts.containerName, 'git', [
    '-C',
    repoPathInContainer,
    'rev-parse',
    refName,
  ]);
  if (rev.code !== 0) {
    const details = `${String(rev.stderr ?? '')}\n${String(rev.stdout ?? '')}`.trim();
    throw new Error(
      `Failed resolving imported drone ref ${refName}.${details ? `\n\n${details}` : ''}`,
    );
  }
  const sha = parseShaFromText(rev.stdout);
  if (!sha) throw new Error(`Failed parsing imported drone ref SHA for ${refName}.`);
  return sha;
}

const NON_REPO_HOME_CWD = '/dvm-data/home';
const CONTAINER_MANAGED_HOME_DIR = '/root';

function containerManagedHomeDir(drone: any): string {
  void drone;
  return CONTAINER_MANAGED_HOME_DIR;
}

export function resolveContainerManagedEnvVars(
  drone: any,
  envVars?: Record<string, string> | null,
): Record<string, string> | null {
  const merged = envVars ? { ...envVars } : {};
  if (droneRuntime(drone) !== 'container') {
    return Object.keys(merged).length > 0 ? merged : null;
  }
  const home = containerManagedHomeDir(drone);
  merged.HOME = home;
  merged.XDG_CONFIG_HOME = path.posix.join(home, '.config');
  return merged;
}

function buildContainerManagedEnvLines(drone: any): string[] {
  const env = resolveContainerManagedEnvVars(drone);
  if (!env) return [];
  const home = String(env.HOME ?? '').trim() || CONTAINER_MANAGED_HOME_DIR;
  const xdgConfigHome =
    String(env.XDG_CONFIG_HOME ?? '').trim() ||
    path.posix.join(CONTAINER_MANAGED_HOME_DIR, '.config');
  return [
    ...buildEnvExportLines(env),
    `mkdir -p ${bashQuote(home)} ${bashQuote(xdgConfigHome)} 2>/dev/null || true`,
  ];
}

function droneRuntime(drone: any): DroneRuntime {
  return normalizeDroneRuntime((drone as any)?.runtime);
}

function defaultDroneHomeCwd(drone: any): string {
  if (droneRuntime(drone) === 'host') {
    const cwd = String((drone as any)?.cwd ?? '').trim();
    if (cwd && path.isAbsolute(cwd)) return path.normalize(cwd);
    const repoPath = String((drone as any)?.repoPath ?? '').trim();
    if (repoPath && path.isAbsolute(repoPath)) return path.normalize(repoPath);
    return path.resolve(os.homedir());
  }
  return isRepoAttachedDrone(drone) ? '/work/repo' : NON_REPO_HOME_CWD;
}

function normalizeDroneCwdForRuntime(drone: any, cwdRaw: unknown): string {
  const fallback = defaultDroneHomeCwd(drone);
  const runtime = droneRuntime(drone);
  const raw = typeof cwdRaw === 'string' ? String(cwdRaw).trim() : '';
  if (runtime === 'host') {
    const target = raw || fallback;
    if (!target) return path.resolve(os.homedir());
    return path.isAbsolute(target)
      ? path.normalize(target)
      : path.resolve(fallback || os.homedir(), target);
  }
  return normalizeContainerPath(raw || fallback || NON_REPO_HOME_CWD);
}

function isContainerOnlyCwd(raw: string): boolean {
  const pathText = String(raw ?? '').trim();
  if (!pathText) return false;
  return (
    pathText === '/dvm-data' ||
    pathText.startsWith('/dvm-data/') ||
    pathText === '/work/repo' ||
    pathText.startsWith('/work/repo/')
  );
}

function normalizeDroneUiCwdForRuntime(drone: any, cwdRaw: unknown): string {
  const normalized = normalizeDroneCwdForRuntime(drone, cwdRaw);
  if (droneRuntime(drone) !== 'host') return normalized;
  if (!isContainerOnlyCwd(normalized)) return normalized;
  return normalizeDroneCwdForRuntime(drone, null);
}

function hostChatAttachmentsStorageRoot(): string {
  const xdgStateHome = String(process.env.XDG_STATE_HOME ?? '').trim();
  if (xdgStateHome) return path.resolve(xdgStateHome, 'drone-hub', 'attachments');
  return path.resolve(os.homedir(), '.local', 'state', 'drone-hub', 'attachments');
}

function chatAttachmentsStorageRootForDrone(drone: any): string {
  return droneRuntime(drone) === 'host'
    ? hostChatAttachmentsStorageRoot()
    : '/dvm-data/drone-hub/attachments';
}

async function resolveDroneDaemonClientForEntry(
  drone: any,
): Promise<{ client: ReturnType<typeof makeClient>; hostPort: number; token: string } | null> {
  const token = typeof drone?.token === 'string' ? String(drone.token).trim() : '';
  if (!token) return null;

  const runtime = droneRuntime(drone);
  const storedHostPort = Number(drone?.hostPort ?? NaN);
  if (runtime === 'host') {
    if (!Number.isFinite(storedHostPort) || storedHostPort <= 0) return null;
    const hostPort = Math.floor(storedHostPort);
    return { client: makeClient(hostPort, token), hostPort, token };
  }

  let hostPort =
    Number.isFinite(storedHostPort) && storedHostPort > 0 ? Math.floor(storedHostPort) : 0;
  if (!hostPort) {
    const containerName = String(
      (drone as any)?.containerName ?? (drone as any)?.name ?? '',
    ).trim();
    const containerPort = Number((drone as any)?.containerPort ?? NaN);
    if (containerName && Number.isFinite(containerPort) && containerPort > 0) {
      const resolved = await resolveHostPort(containerName, Math.floor(containerPort));
      hostPort =
        Number.isFinite(resolved as number) && (resolved as number) > 0
          ? Math.floor(resolved as number)
          : 0;
    }
  }
  if (!hostPort) return null;
  const client = makeClient(hostPort, token);
  const containerName = String((drone as any)?.containerName ?? (drone as any)?.name ?? '').trim();
  const containerPort = Number((drone as any)?.containerPort ?? NaN);
  if (containerName && Number.isFinite(containerPort) && containerPort > 0) {
    try {
      await droneStatus(client);
    } catch {
      try {
        await ensureContainerDroneDaemonSession({
          containerName,
          containerPort: Math.floor(containerPort),
        });
      } catch {
        // Ignore best-effort recovery here; callers still perform their own readiness checks.
      }
    }
  }
  return { client, hostPort, token };
}

function droneRepoPathInContainer(drone: any): string {
  const raw = String(drone?.repo?.dest ?? '/work/repo').trim();
  return normalizeContainerPath(raw || '/work/repo');
}

export function buildHostSkillProjectionTargets(drone: any): SkillProjectionTarget[] {
  const repoAttached = isRepoAttachedDrone(drone);
  const repoRootRaw = String((drone as any)?.repoPath ?? '').trim();
  const repoRoot = repoAttached && repoRootRaw ? path.resolve(repoRootRaw) : '';
  const homeRoot = path.resolve(os.homedir());
  const targets: SkillProjectionTarget[] = [
    { agent: 'codex', rootPath: path.join(homeRoot, '.agents', 'skills') },
    { agent: 'claude', rootPath: path.join(homeRoot, '.claude', 'skills') },
    { agent: 'cursor', rootPath: path.join(homeRoot, '.cursor', 'skills') },
    { agent: 'opencode', rootPath: path.join(homeRoot, '.config', 'opencode', 'skills') },
  ];
  if (repoRoot) {
    targets.push({
      agent: 'codex',
      rootPath: path.join(repoRoot, '.agents', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'claude',
      rootPath: path.join(repoRoot, '.claude', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'cursor',
      rootPath: path.join(repoRoot, '.cursor', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'opencode',
      rootPath: path.join(repoRoot, '.opencode', 'skills'),
      cleanupOnly: true,
    });
  }
  return targets;
}

export function buildContainerSkillProjectionTargets(drone: any): SkillProjectionTarget[] {
  const repoAttached = isRepoAttachedDrone(drone);
  const projectRoot = repoAttached ? droneRepoPathInContainer(drone) : '';
  const homeRoot = CONTAINER_MANAGED_HOME_DIR;
  const targets: SkillProjectionTarget[] = [
    { agent: 'codex', rootPath: path.posix.join(homeRoot, '.agents', 'skills') },
    { agent: 'claude', rootPath: path.posix.join(homeRoot, '.claude', 'skills') },
    { agent: 'cursor', rootPath: path.posix.join(homeRoot, '.cursor', 'skills') },
    { agent: 'opencode', rootPath: path.posix.join(homeRoot, '.config', 'opencode', 'skills') },
  ];
  if (projectRoot) {
    targets.push({
      agent: 'codex',
      rootPath: path.posix.join(projectRoot, '.agents', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'claude',
      rootPath: path.posix.join(projectRoot, '.claude', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'cursor',
      rootPath: path.posix.join(projectRoot, '.cursor', 'skills'),
      cleanupOnly: true,
    });
    targets.push({
      agent: 'opencode',
      rootPath: path.posix.join(projectRoot, '.opencode', 'skills'),
      cleanupOnly: true,
    });
  }
  return targets;
}

export function buildHostMcpProjectionTargets(_drone: any): McpProjectionTarget[] {
  const homeRoot = path.resolve(os.homedir());
  return [
    { agent: 'codex', configPath: path.join(homeRoot, '.codex', 'config.toml') },
    { agent: 'cursor', configPath: path.join(homeRoot, '.cursor', 'mcp.json') },
    { agent: 'claude', configPath: path.join(homeRoot, '.claude.json') },
    { agent: 'opencode', configPath: path.join(homeRoot, '.config', 'opencode', 'opencode.json') },
  ];
}

export function buildContainerMcpProjectionTargets(_drone: any): McpProjectionTarget[] {
  const homeRoot = CONTAINER_MANAGED_HOME_DIR;
  return [
    { agent: 'codex', configPath: path.posix.join(homeRoot, '.codex', 'config.toml') },
    { agent: 'cursor', configPath: path.posix.join(homeRoot, '.cursor', 'mcp.json') },
    { agent: 'claude', configPath: path.posix.join(homeRoot, '.claude.json') },
    {
      agent: 'opencode',
      configPath: path.posix.join(homeRoot, '.config', 'opencode', 'opencode.json'),
    },
  ];
}

type ActiveDroneHubMcpProjectionConfig = {
  signingSecret: string;
  hostUrl: string;
  containerUrl: string;
};

async function revokeLegacyProjectedDroneMcpTokens(): Promise<void> {
  const activeDroneTokens = (await listMcpAccessTokens()).filter(
    (token) => token.kind === 'drone' && !token.revokedAt,
  );
  if (activeDroneTokens.length === 0) return;
  await Promise.all(activeDroneTokens.map((token) => revokeMcpAccessToken(token.id)));
  hubLog('info', 'revoked legacy globally projected drone MCP credentials', {
    count: activeDroneTokens.length,
  });
}

function createMcpProjectionFeature() {
  let config: ActiveDroneHubMcpProjectionConfig | null = null;

  function bindConfig(next: ActiveDroneHubMcpProjectionConfig): () => void {
    if (config) throw new Error('MCP projection config is already bound');
    config = next;
    return () => {
      if (config === next) config = null;
    };
  }

  async function isManagedChatMcpAvailable(): Promise<boolean> {
    if (!config?.signingSecret) return false;
    return (await listMcpServers()).some(
      (server) => isDroneHubMcpServer(server) && server.enabled !== false,
    );
  }

  async function mcpServersForProjection(opts: {
    runtime: 'host' | 'container';
    droneId?: string;
    droneEntry?: any;
  }): Promise<McpServerRecord[]> {
    const servers = await listMcpServers();
    if (!config) return servers;
    const out: McpServerRecord[] = [];
    for (const server of servers) {
      if (!isDroneHubMcpServer(server)) {
        out.push(server);
        continue;
      }
      out.push(
        projectMcpServerForManagedChats({
          server,
          runtime: opts.runtime,
          hostBridgePath: path.resolve(__dirname, '..', 'mcp-http-stdio-bridge.js'),
        }),
      );
    }
    return out;
  }

  async function resolveManagedChatMcpEnv(input: {
    runtime: DroneRuntime;
    droneId: string;
    chatName: string;
    chat: any;
  }): Promise<Record<string, string>> {
    if (!config || !(await isManagedChatMcpAvailable())) return {};
    const chatId = String(input.chat?.id ?? '').trim();
    if (!chatId) return {};
    return {
      DRONE_HUB_MCP_URL: input.runtime === 'container' ? config.containerUrl : config.hostUrl,
      DRONE_HUB_MCP_TOKEN: createChatMcpAccessToken({
        droneId: input.droneId,
        chatName: input.chatName,
        chatId,
        signingSecret: config.signingSecret,
      }),
    };
  }

  async function syncSkillLibraryForDrone(opts: {
    droneId: string;
    droneEntry: any;
  }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const droneEntry = opts.droneEntry;
    if (!droneId || !droneEntry) return;
    const runtime = droneRuntime(droneEntry);
    if (runtime === 'host') {
      await syncSkillLibraryToHostTargets({ targets: buildHostSkillProjectionTargets(droneEntry) });
      return;
    }
    const requestedDroneName = String((droneEntry as any)?.name ?? droneId).trim() || droneId;
    await withLockedDroneContainer(
      { requestedDroneName, droneEntry },
      async ({ containerName }) => {
        await syncSkillLibraryToContainerTargets({
          containerName,
          targets: buildContainerSkillProjectionTargets(droneEntry),
        });
      },
    );
  }

  async function syncMcpServersForDrone(opts: { droneId: string; droneEntry: any }): Promise<void> {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const droneEntry = opts.droneEntry;
    if (!droneId || !droneEntry) return;
    const runtime = droneRuntime(droneEntry);
    if (runtime === 'host') {
      await syncMcpServersToHostTargets({
        targets: buildHostMcpProjectionTargets(droneEntry),
        servers: await mcpServersForProjection({ runtime: 'host', droneId, droneEntry }),
      });
      return;
    }
    const requestedDroneName = String((droneEntry as any)?.name ?? droneId).trim() || droneId;
    await withLockedDroneContainer(
      { requestedDroneName, droneEntry },
      async ({ containerName }) => {
        await syncMcpServersToContainerTargets({
          containerName,
          targets: buildContainerMcpProjectionTargets(droneEntry),
          servers: await mcpServersForProjection({ runtime: 'container', droneId, droneEntry }),
        });
      },
    );
  }

  const { syncManagedFilesForDrone } = createManagedDroneStateSyncService({
    normalizeDroneIdentity,
    droneRuntime,
    syncHostManagedFiles: async (opts) => {
      await syncSkillLibraryForDrone(opts);
      await syncMcpServersForDrone(opts);
      await syncRepoAgentsInstructionsForDrone(opts);
    },
    listSkills,
    mcpServersForProjection,
    resolveAgentsFile: resolveRepoAgentsInstructionsProjection,
    buildSkillTargets: buildContainerSkillProjectionTargets,
    renderSkillPackages: (skills, agent) => renderSkillProjectionPackages(skills, agent),
    buildMcpTargets: buildContainerMcpProjectionTargets,
    renderMcpProjection: (agent, servers) => renderMcpProjection(agent, servers),
    withDroneOpLock,
    daemonClientForDrone,
    daemonHealth: droneHealth,
    managedDroneSync,
    upgradeDaemon: upgradeDroneDaemonInContainer,
    waitForDaemonReady: async (client) => {
      await waitForDroneDaemonReady(client, defaultDaemonReadyTimeoutMs());
    },
    onTiming: (timing) => hubLog('info', 'managed state sync timing', timing),
  });

  return {
    bindConfig,
    isManagedChatMcpAvailable,
    resolveManagedChatMcpEnv,
    syncMcpServersForDrone,
    syncManagedFilesForDrone,
    syncSkillLibraryForDrone,
  };
}

async function resolveRepoAgentsInstructionsProjection(opts: {
  droneId: string;
  droneEntry: any;
}): Promise<{ path: string; content: string } | null> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const droneEntry = opts.droneEntry;
  if (!droneId || !droneEntry) return null;
  if (droneRuntime(droneEntry) !== 'container') return null;
  if (!isRepoAttachedDrone(droneEntry)) return null;

  const regAny: any = await loadRegistryRawSnapshot();
  const hasDroneOverride = typeof (droneEntry as any)?.agentsMdOverride === 'string';
  const effectiveContent = hasDroneOverride
    ? parseDroneAgentsMdOverride((droneEntry as any).agentsMdOverride)
    : (await resolveCanonicalRepoAgentsConfig(regAny, (droneEntry as any)?.repoPath))
        .effectiveContent;
  if (effectiveContent == null || (!hasDroneOverride && !effectiveContent)) return null;
  return {
    path: path.posix.join(droneRepoPathInContainer(droneEntry), 'AGENTS.md'),
    content: effectiveContent,
  };
}

async function syncRepoAgentsInstructionsForDrone(opts: {
  droneId: string;
  droneEntry: any;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const droneEntry = opts.droneEntry;
  if (!droneId || !droneEntry) return;
  if (droneRuntime(droneEntry) !== 'container') return;
  if (!isRepoAttachedDrone(droneEntry)) return;

  const projection = await resolveRepoAgentsInstructionsProjection(opts);
  if (!projection) return;

  const requestedDroneName = String((droneEntry as any)?.name ?? droneId).trim() || droneId;
  const targetPath = projection.path;

  await withLockedDroneContainer({ requestedDroneName, droneEntry }, async ({ containerName }) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-agents-sync-'));
    try {
      const localPath = path.join(tempRoot, 'AGENTS.md');
      await fs.writeFile(localPath, projection.content, 'utf8');
      await dvmExec(containerName, 'bash', [
        '-lc',
        `mkdir -p ${bashQuote(path.posix.dirname(targetPath))}`,
      ]);
      await dvmCopyToContainer(containerName, localPath, targetPath, { clean: false });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });
}

function buildDockerExecShellCommand(containerName: string, cwdRaw: string): string {
  const cwd = normalizeContainerPath(cwdRaw);
  const home = containerManagedHomeDir({ runtime: 'container', cwd });
  const xdgConfigHome = path.posix.join(home, '.config');
  const shellBody = [
    `target=${bashQuote(cwd)}`,
    `export HOME=${bashQuote(home)}`,
    `export XDG_CONFIG_HOME=${bashQuote(xdgConfigHome)}`,
    'mkdir -p "$HOME" "$XDG_CONFIG_HOME" 2>/dev/null || true',
    'mkdir -p "$target" 2>/dev/null || true',
    'cd "$target" 2>/dev/null || cd /',
    // Some images export ENV/BASH_ENV startup files with bashisms (`source`).
    // Clear them so fallback POSIX sh does not error on startup.
    'unset ENV BASH_ENV',
    'if command -v bash >/dev/null 2>&1; then exec bash -i; fi',
    'exec sh -i',
  ].join('; ');
  // Use `sh -c` (not login shell) to avoid profile bashisms like `source`.
  return `docker exec -it ${bashQuote(containerName)} sh -c ${bashQuote(shellBody)}`;
}

function createHubFilesystemFeature(runtimeGraph: any) {
  return createFilesystemRuntime({
    NON_REPO_HOME_CWD,
    bashQuote,
    defaultDroneHomeCwd,
    droneRepoPathInContainer,
    droneRuntime,
    dvmCopyToContainer,
    dvmExec,
    extensionLower,
    isLikelyImagePath,
    isLikelyVideoPath,
    isRepoAttachedDrone,
    json,
    looksLikeMissingContainerError: (...args: any[]) =>
      runtimeGraph.promptRuntime.looksLikeMissingContainerError(...args),
    normalizeContainerPath,
    normalizeDroneCwdForRuntime,
    readJsonBody,
    resolveEffectiveFilesystemSettings,
    runHostCommand,
    sortFsEntries,
    withLockedDroneContainer,
    withReadonlyDroneContainer,
  });
}

function normalizeGroupName(raw: any): string {
  return String(raw ?? '').trim();
}

function isSameOrDescendantGroupPath(pathRaw: any, prefixRaw: any): boolean {
  const path = normalizeGroupName(pathRaw);
  const prefix = normalizeGroupName(prefixRaw);
  if (!path || !prefix) return false;
  return path === prefix || path.startsWith(`${prefix}/`);
}

const DRONE_DISPLAY_NAME_MAX_LEN = 80;
function normalizeDroneDisplayName(raw: any): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (s.length > DRONE_DISPLAY_NAME_MAX_LEN)
    throw new Error(`invalid drone name (max ${DRONE_DISPLAY_NAME_MAX_LEN} chars)`);
  if (/[\r\n]/.test(s)) throw new Error('invalid drone name (no newlines)');
  return s;
}
function droneDisplayNameExists(regAny: any, nameRaw: string): boolean {
  const name = String(nameRaw ?? '').trim();
  if (!name) return false;
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) {
    if (String(d?.name ?? '').trim() === name) return true;
  }
  return false;
}
function allocateUntitledDisplayName(regAny: any): string {
  const usedNums = new Set<number>();
  const consider = (n: any) => {
    const s = String(n?.name ?? '').trim();
    const m = s.match(/^untitled\s+(\d+)$/i);
    if (!m) return;
    const v = Number(m[1]);
    if (Number.isFinite(v) && v >= 1 && Math.floor(v) === v) usedNums.add(v);
  };
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) consider(d);
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) consider(d);
  for (let i = 1; i <= 9999; i += 1) {
    if (!usedNums.has(i)) return `Untitled ${i}`;
  }
  // Fallback (extremely unlikely)
  return `Untitled ${Date.now().toString(36)}`;
}
function normalizeAssistantUiOrderList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = String(item ?? '').trim();
    if (!text || out.includes(text)) continue;
    out.push(text);
  }
  return out;
}

function assistantSidebarGroupToken(group: string): string {
  return `group:${String(group ?? '').trim()}`;
}

function assistantSidebarFolderNodeId(group: string): string {
  return `folder:${String(group ?? '').trim()}`;
}

function assistantSidebarDroneNodeId(droneId: string): string {
  return `drone:${String(droneId ?? '').trim()}`;
}

function assistantSidebarGroupParentPath(value: unknown): string | null {
  const group = normalizeGroupName(value).replace(/^\/+|\/+$/g, '');
  if (!group || !group.includes('/')) return null;
  return group.split('/').slice(0, -1).join('/') || null;
}

function insertAssistantGroupTokenAtParentTop(
  order: unknown,
  visibleGroups: string[],
  groupRaw: string,
): string[] {
  const group = normalizeGroupName(groupRaw);
  if (!group || isUngroupedGroupName(group)) return normalizeAssistantUiOrderList(order);
  const nextToken = assistantSidebarGroupToken(group);
  const normalizedOrder = normalizeAssistantUiOrderList(order);
  if (normalizedOrder.includes(nextToken)) return normalizedOrder;
  const missingAncestorTokens = group
    .split('/')
    .map((_, index, parts) => parts.slice(0, index + 1).join('/'))
    .slice(0, -1)
    .map(assistantSidebarGroupToken)
    .filter((token) => token && !normalizedOrder.includes(token));
  const tokensToInsert = normalizeAssistantUiOrderList([...missingAncestorTokens, nextToken]);
  const visibleTokens = normalizeAssistantUiOrderList(
    visibleGroups.map(assistantSidebarGroupToken),
  );
  const visibleTokenSet = new Set(visibleTokens);
  const hiddenTokens = normalizedOrder.filter((token) => !visibleTokenSet.has(token));
  const visibleOrder = normalizeAssistantUiOrderList([
    ...normalizedOrder.filter((token) => visibleTokenSet.has(token)),
    ...visibleTokens.filter((token) => !normalizedOrder.includes(token)),
  ]);
  const parentPath = assistantSidebarGroupParentPath(group);
  const siblingTokenSet = new Set(
    visibleGroups
      .filter((entry) => assistantSidebarGroupParentPath(entry) === parentPath)
      .map(assistantSidebarGroupToken),
  );
  const siblingIndex = visibleOrder.findIndex((token) => siblingTokenSet.has(token));
  if (siblingIndex >= 0) {
    const nextVisibleOrder = visibleOrder.slice();
    nextVisibleOrder.splice(siblingIndex, 0, ...tokensToInsert);
    return normalizeAssistantUiOrderList([...nextVisibleOrder, ...hiddenTokens]);
  }
  if (parentPath) {
    const parentIndex = visibleOrder.indexOf(assistantSidebarGroupToken(parentPath));
    if (parentIndex >= 0) {
      const nextVisibleOrder = visibleOrder.slice();
      nextVisibleOrder.splice(parentIndex + 1, 0, ...tokensToInsert);
      return normalizeAssistantUiOrderList([...nextVisibleOrder, ...hiddenTokens]);
    }
  }
  return normalizeAssistantUiOrderList([...tokensToInsert, ...visibleOrder, ...hiddenTokens]);
}

function reorderAssistantVisibleEntries(
  existingOrder: unknown,
  visibleEntries: string[],
  movingEntries: string[],
  beforeEntry: string,
  afterEntry: string,
): string[] {
  const visible = normalizeAssistantUiOrderList(visibleEntries);
  const moving = normalizeAssistantUiOrderList(movingEntries).filter((entry) =>
    visible.includes(entry),
  );
  if (moving.length === 0)
    throw new Error('none of the requested drones are in the selected order scope');
  const withoutMoving = visible.filter((entry) => !moving.includes(entry));
  let insertIndex = 0;
  if (afterEntry) {
    const index = withoutMoving.indexOf(afterEntry);
    if (index < 0) throw new Error(`afterDrone is not in the selected order scope: ${afterEntry}`);
    insertIndex = index + 1;
  } else if (beforeEntry) {
    const index = withoutMoving.indexOf(beforeEntry);
    if (index < 0)
      throw new Error(`beforeDrone is not in the selected order scope: ${beforeEntry}`);
    insertIndex = index;
  }
  const nextVisible = withoutMoving.slice();
  nextVisible.splice(insertIndex, 0, ...moving);
  const visibleSet = new Set(visible);
  const hidden = normalizeAssistantUiOrderList(existingOrder).filter(
    (entry) => !visibleSet.has(entry),
  );
  return normalizeAssistantUiOrderList([...nextVisible, ...hidden]);
}

function buildDockerExecTmuxAttachCommand(containerName: string, sessionName: string): string {
  const args = ['docker', 'exec', '-it', containerName, 'tmux', 'attach', '-t', sessionName];
  return args.map(shellQuoteIfNeeded).join(' ');
}

function sanitizeTmuxSessionName(raw: string): string {
  // tmux session names are fairly permissive, but keep it conservative:
  // - no spaces
  // - no slashes
  // - keep it short-ish
  const s = String(raw ?? '').trim();
  const cleaned = s
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!cleaned) return 'default';
  return cleaned.slice(0, 48);
}

function isSafeTmuxSessionName(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s || s.length > 64) return false;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

async function sleepMs(ms: number, signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason;
  await new Promise<void>((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', abort);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    const abort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', abort, { once: true });
    timer.unref?.();
  });
}

async function dvmContainerExists(name: string): Promise<boolean> {
  const n = String(name ?? '').trim();
  if (!n) return false;
  try {
    const names = await dvmLs();
    return names.includes(n);
  } catch {
    // If `dvm ls` is unavailable, be conservative and assume it exists.
    return true;
  }
}

async function waitForDroneDaemonReady(
  client: ReturnType<typeof makeClient>,
  timeoutMs: number,
  signal?: AbortSignal,
) {
  const start = Date.now();
  // Keep retrying briefly; daemon may not be ready immediately after container start.
  // NOTE: droneStatus already has its own per-request timeout.
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await droneStatus(client, { signal });
      return;
    } catch {
      if (signal?.aborted) throw signal.reason;
      // eslint-disable-next-line no-await-in-loop
      await sleepMs(250, signal);
    }
  }
  throw new Error(`drone daemon not ready after ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  const ms = Number.isFinite(timeoutMs) ? Math.max(1, Math.floor(timeoutMs)) : 1;
  return await new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${message} (timed out after ${Math.round(ms / 1000)}s)`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

const DEFAULT_DAEMON_READY_TIMEOUT_MS = 20_000;
const UPGRADE_DAEMON_READY_TIMEOUT_MS = 30_000;
const DEFAULT_REPO_SEED_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_SEED_BOOTSTRAP_TIMEOUT_MS = 45_000;
const DEFAULT_PROMPT_ENQUEUE_TIMEOUT_MS = 180_000;
const DEFAULT_PENDING_PROMPT_ENQUEUE_RETRY_DELAY_MS = 15_000;
function defaultDaemonReadyTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_DAEMON_READY_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1_000) return Math.max(1_000, Math.min(120_000, Math.floor(n)));
  return DEFAULT_DAEMON_READY_TIMEOUT_MS;
}

function defaultRepoSeedTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_REPO_SEED_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 10_000)
    return Math.max(10_000, Math.min(60 * 60_000, Math.floor(n)));
  return DEFAULT_REPO_SEED_TIMEOUT_MS;
}

function defaultSeedBootstrapTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_SEED_BOOTSTRAP_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 5_000)
    return Math.max(5_000, Math.min(10 * 60_000, Math.floor(n)));
  return DEFAULT_SEED_BOOTSTRAP_TIMEOUT_MS;
}

function defaultPromptEnqueueTimeoutMs(): number {
  const raw = String(process.env.DRONE_HUB_PROMPT_ENQUEUE_TIMEOUT_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 30_000)
    return Math.max(30_000, Math.min(30 * 60_000, Math.floor(n)));
  return DEFAULT_PROMPT_ENQUEUE_TIMEOUT_MS;
}

function defaultPendingPromptEnqueueRetryDelayMs(): number {
  const raw = String(process.env.DRONE_HUB_PENDING_PROMPT_ENQUEUE_RETRY_DELAY_MS ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1_000) return Math.max(1_000, Math.min(5 * 60_000, Math.floor(n)));
  return DEFAULT_PENDING_PROMPT_ENQUEUE_RETRY_DELAY_MS;
}

function isValidDroneNameDashCase(raw: string): boolean {
  const s = String(raw ?? '').trim();
  if (!s) return false;
  if (s.length > 48) return false;
  // Conservative: docker-ish, URL-ish, and consistent with the hub UI.
  // - lower-case letters/numbers
  // - single hyphens between segments
  // - no leading/trailing hyphen
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

function normalizeAgentPermissionMode(raw: unknown): AgentPermissionMode {
  const value = String(raw ?? '').trim();
  return value === 'read' || value === 'write' ? value : 'execute';
}

function parseAgentPermissionModeForUpdate(raw: unknown): AgentPermissionMode {
  const value = String(raw ?? '').trim();
  if (value === 'execute' || value === 'write' || value === 'read') return value;
  throw new Error('agentPermissionMode must be read, write, or execute');
}

function normalizeAgentApprovalPolicy(raw: unknown): AgentApprovalPolicy {
  const value = String(raw ?? '').trim();
  return value === 'auto' || value === 'none' ? value : 'ask';
}

function parseAgentApprovalPolicyForUpdate(raw: unknown): AgentApprovalPolicy {
  const value = String(raw ?? '').trim();
  if (value === 'ask' || value === 'auto' || value === 'none') return value;
  throw new Error('approvalPolicy must be ask, auto, or none');
}

type TranscriptTurn = {
  at: string;
  id?: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  ok: boolean;
  output: string;
  userOnly?: boolean;
  error?: string;
  promptAt?: string;
  startedAt?: string;
  completedAt?: string;
  attachments?: ChatImageAttachmentRef[];
  inheritedFromClone?: boolean;
  dockerSnapshot?: {
    id: string;
    status: 'creating' | 'ready' | 'failed' | 'restoring';
    imageRef?: string;
    imageId?: string;
    createdAt: string;
    readyAt?: string;
    restoredAt?: string;
    error?: string;
    sizeBytes?: number;
  };
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSubmittedAtIso(raw: unknown, fallback: string = nowIso()): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return fallback;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? text : fallback;
}

async function reconcilePendingHostMirrorApply(opts: {
  droneId: string;
  droneName: string;
  droneEntry: any;
  repoRoot: string;
  repoPathInContainer: string;
}): Promise<{
  promoted: boolean;
  cleanedAbortedCandidate: boolean;
  hostMirrorRef: string | null;
  hostMirrorSha: string | null;
  droneHeadSha: string | null;
  error: string | null;
}> {
  const d = opts.droneEntry;
  const lastPull =
    d?.repo?.lastPull && typeof d.repo.lastPull === 'object' ? d.repo.lastPull : null;
  const mode = String((lastPull as any)?.mode ?? '')
    .trim()
    .toLowerCase();
  const pendingRef = String((lastPull as any)?.hostMirrorCandidateRef ?? '').trim();
  const pendingSha = String((lastPull as any)?.hostMirrorCandidateSha ?? '')
    .trim()
    .toLowerCase();
  const droneHeadSha = String((lastPull as any)?.exportedHeadSha ?? '')
    .trim()
    .toLowerCase();
  const currentMirrorRef = String((lastPull as any)?.hostMirrorRef ?? '').trim() || null;
  const currentMirrorSha =
    String((lastPull as any)?.hostMirrorSha ?? '')
      .trim()
      .toLowerCase() || null;

  if (mode !== 'host-mirror-merge-pending' || !pendingRef || !/^[0-9a-f]{40}$/.test(pendingSha)) {
    return {
      promoted: false,
      cleanedAbortedCandidate: false,
      hostMirrorRef: currentMirrorRef,
      hostMirrorSha: currentMirrorSha,
      droneHeadSha: /^[0-9a-f]{40}$/.test(droneHeadSha) ? droneHeadSha : null,
      error: null,
    };
  }

  const clean = await gitIsClean(opts.repoRoot).catch(() => false);
  if (!clean) {
    return {
      promoted: false,
      cleanedAbortedCandidate: false,
      hostMirrorRef: currentMirrorRef,
      hostMirrorSha: currentMirrorSha,
      droneHeadSha: /^[0-9a-f]{40}$/.test(droneHeadSha) ? droneHeadSha : null,
      error: null,
    };
  }

  const isCommitted =
    /^[0-9a-f]{40}$/.test(droneHeadSha) && (await gitIsAncestor(opts.repoRoot, pendingSha, 'HEAD'));
  if (!isCommitted) {
    await deleteHostRefBestEffort({ repoRoot: opts.repoRoot, refName: pendingRef });
    await commitDroneMetadataPatch({
      droneId: opts.droneId,
      state: 'real',
      eventType: 'drone.repo-mirror.aborted',
      transform: (dd) => {
        dd.repo = dd.repo ?? {};
        const previousLastPull =
          dd.repo.lastPull && typeof dd.repo.lastPull === 'object' ? dd.repo.lastPull : {};
        dd.repo.lastPullAt = nowIso();
        dd.repo.lastPullError = null;
        dd.repo.lastPull = {
          ...previousLastPull,
          mode: 'host-mirror-merge-aborted',
          hostMirrorRef: currentMirrorRef,
          hostMirrorSha: currentMirrorSha,
          hostMirrorCandidateRef: null,
          hostMirrorCandidateSha: null,
          mergeSourceRef: null,
          baseAdvanced: false,
          baseAdvanceError: null,
        };
        return dd;
      },
    });
    return {
      promoted: false,
      cleanedAbortedCandidate: true,
      hostMirrorRef: currentMirrorRef,
      hostMirrorSha: currentMirrorSha,
      droneHeadSha: /^[0-9a-f]{40}$/.test(droneHeadSha) ? droneHeadSha : null,
      error: null,
    };
  }

  const appliedRef = `refs/drone/mirrors/${safeDroneRefSegment(opts.droneName)}/applied`;
  try {
    await withLockedDroneContainer(
      { requestedDroneName: opts.droneName, droneEntry: d },
      async ({ containerName }) => {
        await dvmRepoSetBaseSha({
          container: containerName,
          repoPathInContainer: opts.repoPathInContainer,
          baseSha: droneHeadSha,
        });
      },
    );
    await updateHostRef({ repoRoot: opts.repoRoot, refName: appliedRef, target: pendingSha });
    if (pendingRef !== appliedRef) {
      await deleteHostRefBestEffort({ repoRoot: opts.repoRoot, refName: pendingRef });
    }
    await commitDroneMetadataPatch({
      droneId: opts.droneId,
      state: 'real',
      eventType: 'drone.repo-mirror.committed',
      transform: (dd) => {
        dd.repo = dd.repo ?? {};
        const previousLastPull =
          dd.repo.lastPull && typeof dd.repo.lastPull === 'object' ? dd.repo.lastPull : {};
        dd.repo.lastPull = {
          ...previousLastPull,
          mode: 'host-mirror-merge-committed',
          hostMirrorRef: appliedRef,
          hostMirrorSha: pendingSha,
          hostMirrorCandidateRef: null,
          hostMirrorCandidateSha: null,
          baseAdvanced: true,
          baseAdvanceError: null,
        };
        return dd;
      },
    });
    return {
      promoted: true,
      cleanedAbortedCandidate: false,
      hostMirrorRef: appliedRef,
      hostMirrorSha: pendingSha,
      droneHeadSha,
      error: null,
    };
  } catch (e: any) {
    return {
      promoted: false,
      cleanedAbortedCandidate: false,
      hostMirrorRef: currentMirrorRef,
      hostMirrorSha: currentMirrorSha,
      droneHeadSha,
      error: e?.message ?? String(e),
    };
  }
}

function normalizeChatName(raw: any): string {
  return String(raw ?? 'default').trim() || 'default';
}

const {
  applyPendingDisplayNameToProvisionedDrone,
  normalizePendingPromptText,
  normalizePendingPromptState,
  normalizePendingStartupPrompts,
  resolvePendingDroneDisplayName,
  startupPromptToPendingPrompt,
} = createPendingDroneStateHelpers({
  normalizeChatName,
  normalizeChatImageAttachments,
  nowIso,
});

function makeDroneIdentity(): string {
  return crypto.randomUUID();
}

const CHAT_NAME_MAX_LEN = 64;

function parseChatNameForMutation(raw: any, fieldName = 'chat name'): string {
  const text = String(raw ?? '').trim();
  if (!text) throw new Error(`missing ${fieldName}`);
  if (text.length > CHAT_NAME_MAX_LEN)
    throw new Error(`${fieldName} is too long (max ${CHAT_NAME_MAX_LEN} chars)`);
  if (/[\r\n\t]/.test(text)) throw new Error(`${fieldName} contains invalid whitespace`);
  if (/[\\/]/.test(text)) throw new Error(`${fieldName} cannot include / or \\`);
  return text;
}

function chatNameExists(droneEntry: any, chatNameRaw: unknown): boolean {
  const chatName = normalizeChatName(chatNameRaw);
  if (!chatName) return false;
  const chats = droneEntry?.chats && typeof droneEntry.chats === 'object' ? droneEntry.chats : null;
  return Boolean(chats?.[chatName]);
}

function normalizeBuiltinAgentId(raw: any): BuiltinAgentId | null {
  const id = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (
    id === 'cursor' ||
    id === 'codex' ||
    id === 'claude' ||
    id === 'opencode' ||
    id === 'pi' ||
    id === 'blip'
  )
    return id;
  if (id === 'cloud' || id === 'claude-code' || id === 'claude_code') return 'claude';
  if (id === 'open-code' || id === 'open_code') return 'opencode';
  if (id === 'pi-agent' || id === 'pi_agent') return 'pi';
  return null;
}

function isValidChatAgentConfig(v: any): v is ChatAgentConfig {
  if (!v || typeof v !== 'object') return false;
  if (v.kind === 'native') return true;
  if (v.kind === 'builtin') return normalizeBuiltinAgentId(v.id) !== null;
  if (v.kind === 'custom') {
    return Boolean(
      String(v.id ?? '').trim() && String(v.label ?? '').trim() && String(v.command ?? '').trim(),
    );
  }
  return false;
}

function parseSeedAgent(raw: any): ChatAgentConfig | null {
  if (!raw) return null;
  const kind = String(raw?.kind ?? raw?.type ?? '')
    .trim()
    .toLowerCase();
  const directBuiltin = normalizeBuiltinAgentId(kind);
  if (directBuiltin) return { kind: 'builtin', id: directBuiltin };
  if (kind === 'native') return { kind: 'native' };
  if (kind === 'builtin') {
    const id = normalizeBuiltinAgentId(raw?.id);
    if (id) return { kind: 'builtin', id };
    return null;
  }
  if (kind === 'custom' || raw?.kind === 'custom') {
    const id = String(raw?.id ?? '').trim();
    const label = String(raw?.label ?? '').trim();
    const command = String(raw?.command ?? '').trim();
    if (!id || !label || !command) return null;
    return { kind: 'custom', id, label, command };
  }
  // Also accept already-normalized configs.
  if (isValidChatAgentConfig(raw)) return raw;
  return null;
}

const CHAT_MODEL_MAX_LEN = 160;
const CLI_MODEL_FLAG_CACHE_TTL_MS = 5 * 60 * 1000;
const cliModelFlagSupportCache = new Map<string, { atMs: number; supported: boolean }>();
const PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS = 25_000;
const pullPreviewHostMergeCache = new Map<
  string,
  { atMs: number; entries: RepoPullChangeEntry[] }
>();
const GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS = 12_000;
const repoChangesScanCache = new ShortLivedSingleFlightCache<any>(2_000);
const githubPullRequestListCache = new Map<
  string,
  {
    atMs: number;
    payload: {
      repoRoot: string;
      state: 'open' | 'closed' | 'all';
      github: { owner: string; repo: string };
      count: number;
      pullRequests: any[];
    };
  }
>();

function attachReviewMetadataToPullEntries<T extends { path: string; originalPath: string | null }>(
  entries: T[],
): Array<T & { reviewKey: string; reviewToken: string }> {
  return entries.map((entry) => {
    const reviewKey = repoChangeReviewKey(entry.path, entry.originalPath);
    return {
      ...entry,
      reviewKey,
      reviewToken: reviewKey,
    };
  });
}
function clearGithubPullRequestListCache(repoRootRaw: string): void {
  const repoRoot = String(repoRootRaw ?? '').trim();
  if (!repoRoot) return;
  for (const key of githubPullRequestListCache.keys()) {
    if (key.startsWith(`${repoRoot}\u0000`)) githubPullRequestListCache.delete(key);
  }
}

function normalizeChatModel(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > CHAT_MODEL_MAX_LEN) return null;
  if (/[\r\n\t]/.test(s)) return null;
  return s;
}

function normalizeChatReasoning(raw: any): string | null {
  const text = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!text || text.length > 32 || !/^[a-z0-9._-]+$/.test(text)) return null;
  return text;
}

function parseChatModelForUpdate(raw: any): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.length > CHAT_MODEL_MAX_LEN)
    throw new Error(`model is too long (max ${CHAT_MODEL_MAX_LEN} chars)`);
  if (/[\r\n\t]/.test(s)) throw new Error('model contains invalid whitespace');
  return s;
}

function parseChatReasoningForUpdate(raw: unknown): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  const reasoning = normalizeChatReasoning(raw);
  if (!reasoning) throw new Error('reasoning contains invalid characters');
  return reasoning;
}

function stripAnsiFromCliOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '')
    .replace(
      /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[A-Z@-_]/g,
      '',
    )
    .replace(/\r/g, '');
}

function createHubAgentModelCatalogService(): AgentModelCatalogService {
  return new AgentModelCatalogService(
    {
      runContainer: async (containerName, command, timeoutMs) =>
        dvmExec(containerName, 'bash', ['-lc', command], { timeoutMs }),
      runHost: async (command, timeoutMs) =>
        runHostCommand('bash', ['-lc', command], { timeoutMs }),
      readHostFile: (filePath) => fs.readFile(filePath, 'utf8'),
      hostHomeDirectory: () => os.homedir(),
      hostModelListCommand: (agentId) =>
        agentId === 'blip' ? `${resolveBlipPromptCommand('host')} --list-models` : null,
      ensureContainerAgent: async (agentId, target) => {
        if (agentId !== 'blip' || !target.containerName) return;
        await upgradeDroneDaemonInContainer({
          containerName: target.containerName,
          containerPort: Number(target.containerPort ?? 7777),
        });
      },
      timeoutMs: defaultSeedBootstrapTimeoutMs,
    },
    createAgentModelCatalogStore(),
  );
}

function sharedAgentCatalogTarget(opts: {
  runtime?: DroneRuntime;
  containerName?: string;
  containerPort?: number;
}): AgentModelCatalogTarget {
  const runtime = opts.runtime ?? 'container';
  return {
    runtime,
    ...(opts.containerName ? { containerName: opts.containerName } : {}),
    ...(opts.containerPort ? { containerPort: opts.containerPort } : {}),
  };
}

async function isHostBuiltinAgentInstalled(agentId: BuiltinAgentId): Promise<boolean> {
  if (agentId === 'blip') return true;
  return (await checkHostCommand(agentModelCatalogAdapter(agentId).binary)).available;
}

async function readCodexLastTurnRuntime(opts: {
  runtime: DroneRuntime;
  containerName: string;
  threadId: string;
}): Promise<AgentTurnRuntimeMetadata> {
  const threadId = String(opts.threadId ?? '').trim();
  if (!/^[0-9a-f-]{20,64}$/i.test(threadId)) return {};
  const script = [
    'set -euo pipefail',
    'roots=("${CODEX_HOME:-$HOME/.codex}/sessions" "$HOME/.codex/sessions" "/root/.codex/sessions" "/dvm-data/home/.codex/sessions")',
    'files=()',
    'for root in "${roots[@]}"; do',
    '  [ -d "$root" ] || continue',
    `  while IFS= read -r file; do files+=("$file"); done < <(find "$root" -type f -name ${bashQuote(`*${threadId}*.jsonl`)} -print 2>/dev/null)`,
    'done',
    '[ "${#files[@]}" -gt 0 ] || exit 1',
    'file=$(printf "%s\\n" "${files[@]}" | sort | tail -n 1)',
    `grep '"type":"turn_context"' -- "$file" | tail -n 1`,
  ].join('\n');
  const result =
    opts.runtime === 'host'
      ? await runHostCommand('bash', ['-lc', script], {
          timeoutMs: defaultSeedBootstrapTimeoutMs(),
        })
      : await dvmExec(opts.containerName, 'bash', ['-lc', script], {
          timeoutMs: defaultSeedBootstrapTimeoutMs(),
        });
  if (result.code !== 0) return {};
  const parsed = parseCodexRolloutRuntime(result.stdout);
  const model = normalizeChatModel(parsed.model);
  const reasoning = normalizeChatReasoning(parsed.reasoning);
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

async function resolveCodexTurnRuntime(opts: {
  parsed: { model?: string; reasoning?: string; threadId: string | null };
  pendingModel: string | null;
  runtime: DroneRuntime;
  containerName: string;
  fallbackThreadId?: string | null;
}): Promise<AgentTurnRuntimeMetadata> {
  const parsedModel = normalizeChatModel(opts.parsed.model);
  const parsedReasoning = normalizeChatReasoning(opts.parsed.reasoning);
  const knownModel = parsedModel ?? opts.pendingModel;
  const rollout =
    knownModel && parsedReasoning
      ? {}
      : await readCodexLastTurnRuntime({
          runtime: opts.runtime,
          containerName: opts.containerName,
          threadId: String(opts.parsed.threadId ?? opts.fallbackThreadId ?? ''),
        }).catch(() => ({}));
  const model = knownModel ?? rollout.model;
  const reasoning = parsedReasoning ?? rollout.reasoning;
  return {
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
  };
}

async function cliSupportsModelFlag(opts: {
  bin: string;
  runtime: DroneRuntime;
  containerName?: string;
  cwd?: string | null;
}): Promise<boolean> {
  const keyBase =
    opts.runtime === 'host'
      ? String(opts.cwd ?? '').trim() || 'host'
      : String(opts.containerName ?? '').trim() || 'container';
  const key = `${opts.runtime}:${keyBase}::${opts.bin}`;
  const now = Date.now();
  const cached = cliModelFlagSupportCache.get(key);
  if (cached && now - cached.atMs < CLI_MODEL_FLAG_CACHE_TTL_MS) return cached.supported;
  const r =
    opts.runtime === 'host'
      ? await runHostCommand('bash', ['-lc', `${opts.bin} --help`], {
          cwd: String(opts.cwd ?? '').trim() || undefined,
          timeoutMs: defaultSeedBootstrapTimeoutMs(),
        })
      : await dvmExec(String(opts.containerName ?? ''), 'bash', ['-lc', `${opts.bin} --help`], {
          timeoutMs: defaultSeedBootstrapTimeoutMs(),
        });
  const text = stripAnsiFromCliOutput(`${r.stdout || ''}\n${r.stderr || ''}`);
  const supported = /\B--model\b/i.test(text) || /\B-m,\s*--model\b/i.test(text);
  cliModelFlagSupportCache.set(key, { atMs: now, supported });
  return supported;
}

function createHubRuntimeGraph(
  nativeChatRuntimePort: ReturnType<typeof createNativeChatRuntimePort>,
  mcpProjectionFeature: ReturnType<typeof createMcpProjectionFeature>,
) {
  let promptRuntime: any;
  let dockerSnapshotRuntime: any;
  const promptSkillSyncWarnings = new Set<string>();
  const syncSetService = createSyncSetService({
    loadRegistry,
    updateRegistry,
    normalizeDroneIdentity,
    droneRuntime,
    withLockedDroneContainer,
    nowIso,
    logWarn: (message, meta) => {
      hubLog('warn', message, meta);
    },
    logInfo: (message, meta) => {
      hubLog('info', message, meta);
    },
  });
  const {
    resolveManagedChatMcpEnv,
    syncManagedFilesForDrone,
  } = mcpProjectionFeature;

  const chatSessionRuntime = createChatSessionRuntime({
    applyChatReconciliationInStore,
    assertChatAgentSupportedForDrone,
    bashQuote,
    buildAutoRenamedChatCandidate,
    buildContainerManagedEnvLines,
    buildEnvExportLines,
    chatHasActiveDockerSnapshot: (...args: any[]) =>
      dockerSnapshotRuntime.chatHasActiveDockerSnapshot(...args),
    chatHasReconcilablePendingPrompts: (...args: any[]) =>
      promptRuntime.chatHasReconcilablePendingPrompts(...args),
    countTranscriptTurnsFromStore,
    defaultChatAgentConfigForDrone,
    defaultSeedBootstrapTimeoutMs,
    droneRuntime,
    dvmExec,
    dvmSessionStart,
    enqueueReconcile: (...args: any[]) => promptRuntime.enqueueReconcile(...args),
    ensureDaemonPromptEventSubscription: (...args: any[]) =>
      promptRuntime.ensureDaemonPromptEventSubscription(...args),
    failStaleDockerSnapshotsForChat: (...args: any[]) =>
      dockerSnapshotRuntime.failStaleDockerSnapshotsForChat(...args),
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    importDroneChatsFromRegistry,
    importTranscriptTurnsFromRegistry,
    isGeneratedChatName,
    listChatsFromStore,
    loadRegistry,
    migrateInMemoryChatStateForRename: (...args: any[]) =>
      promptRuntime.migrateInMemoryChatStateForRename(...args),
    normalizeAgentPermissionMode,
    normalizeAgentPlan,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachmentRefs: (...args: any[]) =>
      promptRuntime.normalizeChatImageAttachmentRefs(...args),
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDockerSnapshot: (...args: any[]) =>
      dockerSnapshotRuntime.normalizeDockerSnapshot(...args),
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    nowIso,
    parseChatNameForMutation,
    patchChatMetadataInStore,
    pruneCompletedPendingPrompts: (...args: any[]) =>
      promptRuntime.pruneCompletedPendingPrompts(...args),
    readChatFromStore,
    readChatRowsFromStore,
    readChatVersionFromStore,
    readPendingPrompts: (...args: any[]) => promptRuntime.readPendingPrompts(...args),
    readPendingStartupPrompts: (...args: any[]) => promptRuntime.readPendingStartupPrompts(...args),
    readTranscriptTurnsFromStore,
    renameChatInStore,
    resolveBuiltinTmuxCommand,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveContainerTerminalShellCommand,
    resolveDroneOrPendingForReadRef,
    resolveHubAgentCommand,
    resolveNameSuggestionLlmSettings,
    resolvePendingCodexApprovalsForNeverAsk: (...args: any[]) =>
      promptRuntime.resolvePendingCodexApprovalsForNeverAsk(...args),
    runHostCommand,
    sanitizeTmuxSessionName,
    stableResponseFingerprint,
    startupPromptToPendingPrompt,
    suggestDroneNameFromMessage,
    transcriptTurnsSourceHash,
    updateChatInStore,
    updateRegistry,
    updateTranscriptTurnInStore,
    upsertChatInStore,
  });

  const {
    HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
    HUB_WEB_TERMINAL_MAX_BYTES,
    HUB_WEB_TERMINAL_MAX_TAIL_LINES,
    assertReadOnlySupportedForAgent,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    clampInt,
    clampIntParam,
    copyChatAttachmentsToHost,
    ensureChatEntry,
    ensureChatEntryCopiedFromChat,
    ensureClaudeSessionId,
    ensureCursorChatId,
    ensureHubChatSessionRunning,
    ensureHubSessionRunning,
    ensureOpenCodeSessionId,
    getChatEntry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    openCodeSessionTitle,
    parseOptionalNonNegativeInt,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    readChatSnapshot,
    resolveChatTmuxCommand,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
    updateTranscriptTurnById,
  } = chatSessionRuntime;

  const createDroneChat = createDroneChatCreator({
    buildNewChatEntry,
    cloneNativeChatSession: nativeChatRuntimePort.cloneSession,
    copyNativeChatConfiguration: nativeChatRuntimePort.copyConfiguration,
    createChatInStore,
    getChatEntry,
    importDroneChatsFromRegistry,
    inferChatAgent,
    listChatsFromStore,
    nowIso,
    projectCanonicalChatsToRegistry,
    readChatFromStore,
  });

  dockerSnapshotRuntime = createDockerSnapshotRuntime({
    chatHasActivePendingPromptsForSummary: (...args: any[]) =>
      promptRuntime.chatHasActivePendingPromptsForSummary(...args),
    droneRuntime,
    droneStatus,
    enqueuePendingPromptPump: (...args: any[]) => promptRuntime.enqueuePendingPromptPump(...args),
    hubLog,
    inferChatAgent,
    loadRegistry,
    makeClient,
    normalizeChatName,
    normalizeDroneIdentity,
    nowIso,
    projectCanonicalChatToRegistry,
    readChatFromStore,
    resolveHostPort,
    rollbackTranscriptToTurnInStore,
    runHostCommand,
    stopAllDroneChatActivity: (...args: any[]) => promptRuntime.stopAllDroneChatActivity(...args),
    updateTranscriptTurnById,
    updateTranscriptTurnInStore,
    upsertTranscriptTurnInStore,
  });

  const {
    chatHasActiveDockerSnapshot,
    collectDockerSnapshotImageRefsFromChatEntry,
    collectDockerSnapshotImageRefsFromDroneEntry,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    dockerContainerId,
    dockerContainerSizeBytes,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    dockerSnapshotTotalsForDroneEntry,
    failStaleDockerSnapshotsForChat,
    isStaleDockerExecErrorMessage,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeDockerSnapshot,
    removeDockerSnapshotImagesBestEffort,
    restoreDockerSnapshotForTranscriptTurn,
  } = dockerSnapshotRuntime;

  promptRuntime = createChatPromptRuntime({
    NON_REPO_HOME_CWD,
    PROMPT_SKILL_SYNC_WARNINGS: promptSkillSyncWarnings,
    UPGRADE_DAEMON_READY_TIMEOUT_MS,
    applyChatReconciliationInStore,
    applyPendingDisplayNameToProvisionedDrone,
    autoRenameGeneratedChatFromFirstPrompt,
    assertReadOnlySupportedForAgent,
    bashQuote,
    buildChatAttachmentsDirectory,
    buildChatImageAttachmentRefs,
    buildContainerManagedEnvLines,
    buildEnvExportLines,
    chatAttachmentsStorageRootForDrone,
    chatHasActiveDockerSnapshot,
    chatNameExists,
    cliSupportsModelFlag,
    cloneChatEntryForDroneClone,
    collectDroneRuntimeDiagnostics,
    compactDiagnosticError,
    commitDroneMetadataPatch,
    copyChatAttachmentsToContainer,
    copyChatAttachmentsToHost,
    createDronePendingPromptStore,
    createDroneChat,
    createDroneProvisioningController,
    createDroneRuntime,
    defaultDaemonReadyTimeoutMs,
    defaultPendingPromptEnqueueRetryDelayMs,
    defaultPromptEnqueueTimeoutMs,
    defaultRepoSeedTimeoutMs,
    droneCodexPromptApprovalResolve,
    dronePromptCancel,
    dronePromptEnqueue,
    droneCodexPromptEnqueue,
    dronePromptGet,
    droneStatus,
    droneRuntime,
    dvmExec,
    dvmSessionType,
    dvmStart,
    dvmStop,
    ensureChatEntry,
    ensureClaudeSessionId,
    ensureContainerDroneDaemonSession,
    ensureCursorChatId,
    ensureHubChatSessionRunning,
    ensureOpenCodeSessionId,
    failStaleDockerSnapshotsForChat,
    formatTranscriptJobFailure,
    getChatEntry,
    hasInFlightPriorPendingPrompt,
    hasKnownBuiltinTranscriptSession,
    hubChatSessionName,
    hubLog,
    importChatFromRegistry,
    importContainerDroneRuntime,
    inferChatAgent,
    isDraftChatEntry,
    isNotFoundErrorMessage,
    listChatsFromStore,
    loadRegistry,
    looksLikeTransientPromptEnqueueError,
    launchHostDroneDaemon,
    makeClient,
    maybeBootstrapPromptFromTranscript,
    maybeStartDockerSnapshotForTranscriptTurn,
    normalizeAgentPermissionMode,
    normalizeAgentApprovalPolicy,
    normalizeBuiltinAgentId,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeContainerPath,
    normalizeDroneCwdForRuntime,
    normalizeDroneIdentity,
    normalizePendingPromptState,
    normalizePendingPromptText,
    normalizePendingStartupPrompts,
    normalizeSubmittedAtIso,
    notifyDroneChatWrite: (droneId: string, chatName: string) =>
      hubChangeEvents.emitChatWrite(droneId, chatName),
    nowIso,
    openCodeSessionTitle,
    parseBlipJobTranscript,
    parseCodexJobTranscript,
    parsePiJobTranscript,
    parseSeedAgent,
    parseStructuredAgentJobTranscript,
    promptNativeChat: nativeChatRuntimePort.prompt,
    stopNativeChat: nativeChatRuntimePort.stop,
    nativeChatIsBusy: nativeChatRuntimePort.isBusy,
    nativeChatError: nativeChatRuntimePort.error,
    nativeChatLatestAssistantText: nativeChatRuntimePort.latestAssistantText,
    projectCanonicalChatToRegistry,
    promptWithImageAttachments,
    readBuiltinTranscriptSessionId,
    readChatAttachmentsFromRefs,
    readChatFromStore,
    resetTranscriptStoreForTests,
    resolveBlipPromptCommand,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveChatTmuxCommand,
    resolveCodexTurnRuntime,
    resolveDroneDaemonClientForEntry,
    resolveDroneEnvironmentConfig,
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveHostPort,
    resolveManagedChatMcpEnv,
    resolvePendingDroneDisplayName,
    resolveTranscriptPromptAt,
    sameAgentPlan,
    setChatAgentConfig,
    setDroneHubMetaByIdentity,
    shouldDeferQueuedPendingPrompt,
    shouldRetryFailedPendingPrompt,
    sleepMs,
    stalePendingPromptState,
    startupPromptToPendingPrompt,
    syncManagedFilesForDrone,
    syncSetService,
    unsupportedHostCustomAgentError,
    updateTranscriptTurnById,
    upgradeDroneDaemonInContainer,
    waitForDroneDaemonReady,
    withDroneOpLock,
    withLockedDroneContainer,
    withTimeout,
  });

  const {
    attachmentOnlyPromptLabel,
    busyChatNamesForDrone,
    cancelQueuedPendingPrompt,
    chatHasActivePendingPromptsForSummary,
    chatHasReconcilablePendingPrompts,
    chatRequiresCodexApprovalForSummary,
    chatReconciliationQueue,
    createOrEnqueueNewChatAction,
    createOrEnqueuePromptUnified,
    daemonPromptEventMonitor,
    dequeueProvisioning,
    enqueuePendingPromptPump,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
    enqueueReconcile,
    ensureDaemonPromptEventSubscription,
    isSafePromptId,
    looksLikeContainerAlreadyRunningError,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    migrateInMemoryChatStateForRename,
    normalizeChatImageAttachmentRefs,
    pendingPromptsFromChatEntry,
    promoteQueuedNewChatAction,
    resolveInterruptedPendingPrompt,
    pruneCompletedPendingPrompts,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readPendingPrompts,
    readPendingStartupPrompts,
    resumePendingPromptChats,
    runDroneLifecycleAction,
    stopAllDroneChatActivity,
    stopChatResponse,
    startPromptRuntimeBackgroundWork,
    stopPromptRuntimeBackgroundWork,
    stopSingleDroneChatActivity,
    stopTranscriptPendingPrompts,
    transcriptTurnIdsFromEntry,
  } = promptRuntime;

  return {
    chatSessionRuntime,
    createDroneChat,
    dockerSnapshotRuntime,
    promptRuntime,
    syncSetService,
  };
}

function isNotFoundErrorMessage(msg: string): boolean {
  const s = String(msg ?? '')
    .trim()
    .toLowerCase();
  return s.startsWith('404') || s === 'not found' || s.includes('not found');
}

async function upgradeDroneDaemonInContainer(opts: {
  containerName: string;
  containerPort: number;
}) {
  // Stage the built daemon runtime first. Do not remove the active runtime until
  // the replacement has a runnable daemon.js.
  const runtimeDir = resolveDroneDaemonRuntimeDir();
  await assertDroneDaemonRuntimeReady(runtimeDir);
  await assertContainerDroneRuntimePayloadReady(runtimeDir);

  const clearStagedDaemonRuntime = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    'mkdir -p /dvm-data/drone && rm -rf /dvm-data/drone/dist.next',
  ]);
  if (clearStagedDaemonRuntime.code !== 0) {
    throw new Error(
      clearStagedDaemonRuntime.stderr ||
        clearStagedDaemonRuntime.stdout ||
        'failed clearing staged daemon runtime in container',
    );
  }
  await dvmCopyToContainer(
    opts.containerName,
    resolveContainerDroneRuntimePayloadDir(runtimeDir),
    '/dvm-data/drone/dist.next',
    { clean: false },
  );
  const verifyStagedDaemonRuntime = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    'test -f /dvm-data/drone/dist.next/daemon.bundle.js -o -f /dvm-data/drone/dist.next/daemon.js || { echo "staged daemon runtime is missing a daemon entry" 1>&2; exit 1; }',
  ]);
  if (verifyStagedDaemonRuntime.code !== 0) {
    throw new Error(
      verifyStagedDaemonRuntime.stderr ||
        verifyStagedDaemonRuntime.stdout ||
        'staged daemon runtime verification failed',
    );
  }
  const activateStagedDaemonRuntime = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    [
      'set -euo pipefail',
      'cd /dvm-data/drone',
      'rm -rf dist.prev',
      'if [ -d dist ]; then mv dist dist.prev; fi',
      'if ! mv dist.next dist; then',
      '  if [ -d dist.prev ] && [ ! -d dist ]; then mv dist.prev dist; fi',
      '  exit 1',
      'fi',
      'rm -rf dist.prev',
    ].join('\n'),
  ]);
  if (activateStagedDaemonRuntime.code !== 0) {
    throw new Error(
      activateStagedDaemonRuntime.stderr ||
        activateStagedDaemonRuntime.stdout ||
        'failed activating staged daemon runtime in container',
    );
  }
  const removeRetiredClis = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    removeRetiredContainerCliScripts(),
  ]);
  if (removeRetiredClis.code !== 0) {
    throw new Error(
      removeRetiredClis.stderr ||
        removeRetiredClis.stdout ||
        'failed removing retired CLIs from container',
    );
  }
  const installBlipCli = await dvmExec(opts.containerName, 'bash', ['-lc', installBlipCliScript()]);
  if (installBlipCli.code !== 0) {
    throw new Error(
      installBlipCli.stderr || installBlipCli.stdout || 'failed installing blip CLI in container',
    );
  }

  // Restart daemon session so new code is loaded.
  await dvmExec(opts.containerName, 'bash', [
    '-lc',
    `tmux kill-session -t ${DRONE_DAEMON_SESSION_NAME} 2>/dev/null || true`,
  ]);
  await dvmSessionStart(
    opts.containerName,
    DRONE_DAEMON_SESSION_NAME,
    'bash',
    ['-lc', buildContainerDroneDaemonLaunchScript(opts.containerPort)],
    true,
  );
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(p: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fileExists(p)) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return await fileExists(p);
}

function appleScriptQuote(s: string): string {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function spawnTerminalWithBash(
  script: string,
  opts?: { terminal?: string | null; markerPath?: string | null },
): Promise<{ ok: true; launcher: string } | { ok: false; error: string }> {
  const platform = process.platform;
  const requestedRaw = String(opts?.terminal ?? '').trim();
  const requested = requestedRaw === 'terminal' ? 'osascript' : requestedRaw;
  const candidates: Array<{ cmd: string; args: string[] }> = (() => {
    if (platform === 'linux') {
      const hasDisplay = Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
      if (!hasDisplay) return [];
      return [
        // Prefer terminals that don't depend on a desktop DBus service.
        { cmd: 'kitty', args: ['bash', '-lc', script] },
        { cmd: 'xterm', args: ['-e', 'bash', '-lc', script] },
        // Then system/default emulator choices.
        //
        // NOTE: on Ubuntu/Debian, x-terminal-emulator is often gnome-terminal.wrapper, which does NOT support `-e`.
        // So we try the modern `-- COMMAND...` form first, then fall back to `-e` for emulators that still use it.
        { cmd: 'x-terminal-emulator', args: ['--window', '--', 'bash', '-lc', script] },
        { cmd: 'x-terminal-emulator', args: ['--', 'bash', '-lc', script] },
        { cmd: 'x-terminal-emulator', args: ['-e', 'bash', '-lc', script] },
        // gnome-terminal: try to avoid factory/server handoff issues.
        // Some environments "launch" gnome-terminal but drop the requested command.
        {
          cmd: 'gnome-terminal',
          args: ['--disable-factory', '--wait', '--window', '--', 'bash', '-lc', script],
        },
        { cmd: 'gnome-terminal', args: ['--wait', '--window', '--', 'bash', '-lc', script] },
        { cmd: 'gnome-terminal', args: ['--wait', '--', 'bash', '-lc', script] },
        { cmd: 'konsole', args: ['-e', 'bash', '-lc', script] },
        { cmd: 'alacritty', args: ['-e', 'bash', '-lc', script] },
      ];
    }

    if (platform === 'darwin') {
      const shellCmd = `bash -lc ${bashQuote(script)}`;
      return [
        {
          cmd: 'osascript',
          args: [
            '-e',
            `tell application "Terminal" to do script "${appleScriptQuote(shellCmd)}"`,
            '-e',
            'tell application "Terminal" to activate',
          ],
        },
      ];
    }

    if (platform === 'win32') {
      const psScript = `bash -lc '${String(script).replace(/'/g, "''")}'`;
      return [
        { cmd: 'wt', args: ['bash', '-lc', script] },
        { cmd: 'powershell.exe', args: ['-NoExit', '-Command', psScript] },
        { cmd: 'pwsh', args: ['-NoExit', '-Command', psScript] },
      ];
    }

    return [];
  })();

  if (platform === 'linux' && candidates.length === 0) {
    return { ok: false, error: 'No DISPLAY/WAYLAND_DISPLAY set; cannot spawn a GUI terminal.' };
  }
  if (candidates.length === 0) {
    return { ok: false, error: `Terminal launching is not supported on platform: ${platform}` };
  }

  const primary =
    requested && requested !== 'auto' ? candidates.filter((c) => c.cmd === requested) : candidates;

  if (requested && requested !== 'auto' && primary.length === 0) {
    return { ok: false, error: `Unknown terminal: ${requested}` };
  }

  // Marker file is used to confirm the terminal actually started `bash -lc <script>`.
  // Some terminals (notably gnome-terminal wrappers) can "spawn" successfully but fail to
  // launch a window/command due to DBus/session issues, while still returning 0.
  const markerPath = opts?.markerPath ? String(opts.markerPath) : null;

  const errors: string[] = [];
  const tryList = async (
    list: Array<{ cmd: string; args: string[] }>,
  ): Promise<{ ok: true; launcher: string } | null> => {
    for (const c of list) {
      // Remove any prior marker.
      if (markerPath) {
        try {
          await fs.rm(markerPath, { force: true });
        } catch {
          // ignore
        }
      }

      const result = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
        let settled = false;
        const done = (v: { ok: true } | { ok: false; error: string }) => {
          if (settled) return;
          settled = true;
          resolve(v);
        };

        const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', env: process.env });
        let exited = false;
        let exitCode: number | null = null;
        let exitSignal: NodeJS.Signals | null = null;

        child.once('exit', (code, signal) => {
          exited = true;
          exitCode = typeof code === 'number' ? code : null;
          exitSignal = signal ?? null;
        });

        child.once('spawn', () => {
          // Some terminal emulators will spawn then immediately exit non-zero if they can't
          // connect to the GUI session (DBus/DISPLAY/etc). Give it a brief window to fail,
          // otherwise treat as success and detach.
          setTimeout(() => {
            if (exited) {
              if (exitCode != null && exitCode !== 0) {
                done({
                  ok: false,
                  error: `exited with code ${exitCode}${exitSignal ? ` (signal ${exitSignal})` : ''}`,
                });
                return;
              }
              if (exitCode == null && exitSignal) {
                done({ ok: false, error: `exited by signal ${exitSignal}` });
                return;
              }
            }
            if (exited && exitCode == null && !exitSignal) {
              done({ ok: false, error: 'exited immediately' });
              return;
            }
            try {
              child.unref();
            } catch {
              // ignore
            }
            done({ ok: true });
          }, 800);
        });
        child.once('error', (err: any) => {
          done({ ok: false, error: err?.message ?? String(err) });
        });
      });

      if (result.ok) {
        if (markerPath) {
          const markerTimeoutMs =
            c.cmd === 'gnome-terminal' || c.cmd === 'x-terminal-emulator'
              ? 15000
              : c.cmd === 'osascript'
                ? 12000
                : 6000;
          const started = await waitForFile(markerPath, markerTimeoutMs);
          if (!started) {
            errors.push(`${c.cmd}: launched but did not start command (no marker)`);
            // Avoid launching additional windows when one terminal already opened but dropped
            // the command. Return a failure so the UI can offer manual fallback instead.
            return null;
          }
          try {
            await fs.rm(markerPath, { force: true });
          } catch {
            // ignore
          }
        }
        return { ok: true, launcher: `${c.cmd} ${c.args.join(' ')}` };
      }

      errors.push(`${c.cmd}: ${result.error}`);
    }

    return null;
  };

  const primaryOk = await tryList(primary);
  if (primaryOk) return primaryOk;

  return {
    ok: false,
    error:
      `Failed to launch a terminal emulator.${requested && requested !== 'auto' ? ` Requested: ${requested}.` : ''}\n\n` +
      errors.join('\n'),
  };
}

function createHubLifecycleFeatures(
  runtimeGraph: any,
  nativeChatRuntimePort: ReturnType<typeof createNativeChatRuntimePort>,
  resourceSubscriptionRuntimePort: ReturnType<typeof createResourceSubscriptionRuntimePort>,
) {
  const droneLifecycleRuntime = createDroneLifecycleRuntime({
    cleanupQuarantineWorktree,
    collectDockerSnapshotImageRefsFromDroneEntry: (...args: any[]) =>
      runtimeGraph.dockerSnapshotRuntime.collectDockerSnapshotImageRefsFromDroneEntry(...args),
    deleteCanonicalDroneLifecycle,
    dequeueProvisioning: (...args: any[]) =>
      runtimeGraph.promptRuntime.dequeueProvisioning(...args),
    droneRuntime,
    dvmContainerExists,
    dvmRemove,
    fleetDescendantIdsForActor,
    gitTopLevel,
    loadRegistry,
    looksLikeMissingContainerError: (...args: any[]) =>
      runtimeGraph.promptRuntime.looksLikeMissingContainerError(...args),
    normalizeDroneIdentity,
    permanentlyDeleteCanonicalDrone,
    quarantineWorktreePath,
    removeDockerSnapshotImagesBestEffort: (...args: any[]) =>
      runtimeGraph.dockerSnapshotRuntime.removeDockerSnapshotImagesBestEffort(...args),
    revokeMcpAccessTokensForDrone,
    sleepMs,
    stopAllDroneChatActivity: (...args: any[]) =>
      runtimeGraph.promptRuntime.stopAllDroneChatActivity(...args),
  });

  const archiveRuntime = createArchiveRuntime({
    CHAT_NAME_MAX_LEN,
    DRONE_DISPLAY_NAME_MAX_LEN,
    allocateUntitledDisplayName,
    archiveChatInStore,
    archiveRetentionMs,
    buildNewChatEntry: (...args: any[]) =>
      runtimeGraph.chatSessionRuntime.buildNewChatEntry(...args),
    collectDockerSnapshotImageRefsFromChatEntry: (...args: any[]) =>
      runtimeGraph.dockerSnapshotRuntime.collectDockerSnapshotImageRefsFromChatEntry(...args),
    collectDockerSnapshotImageRefsFromDroneEntry: (...args: any[]) =>
      runtimeGraph.dockerSnapshotRuntime.collectDockerSnapshotImageRefsFromDroneEntry(...args),
    deleteArchivedChatFromStore,
    deleteNativeChatSessionsForDrone: (droneEntry: any) =>
      nativeChatRuntimePort.deleteSessions(droneEntry),
    droneDisplayNameExists,
    droneRuntime,
    dvmContainerExists,
    dvmStart,
    hubLog,
    importArchivedChatsFromRegistry,
    importDroneChatsFromRegistry,
    listArchivedChatsFromStore,
    listCanonicalDroneLifecycleForRead,
    listChatsFromStore,
    loadRegistry,
    looksLikeContainerAlreadyRunningError: (...args: any[]) =>
      runtimeGraph.promptRuntime.looksLikeContainerAlreadyRunningError(...args),
    normalizeChatName,
    normalizeDroneIdentity,
    nowIso,
    parseArchiveRetentionId,
    parseArchiveRuntimePolicy,
    pauseResourceSubscriptionsForDrone: (droneId: string, droneEntry: any) =>
      resourceSubscriptionRuntimePort.pauseForDrone(
        droneId,
        resourceSubscriptionChatIds(droneEntry),
      ),
    permanentlyDeleteCanonicalDrone,
    readChatFromStore,
    readDroneChatCleanupProjectionFromStore,
    removeDockerSnapshotImagesBestEffort: (...args: any[]) =>
      runtimeGraph.dockerSnapshotRuntime.removeDockerSnapshotImagesBestEffort(...args),
    removeDroneRuntimeArtifacts: droneLifecycleRuntime.removeDroneRuntimeArtifacts,
    restoreArchivedChatInStore,
    resumeResourceSubscriptionsForChat: (chatId: string) =>
      resourceSubscriptionRuntimePort.resumeForChat(chatId),
    resumeResourceSubscriptionsForDrone: (droneId: string, droneEntry: any) =>
      resourceSubscriptionRuntimePort.resumeForDrone(
        droneId,
        resourceSubscriptionChatIds(droneEntry),
      ),
    revokeMcpAccessTokensForDrone,
    updateRegistry,
    upsertCanonicalDroneLifecycle,
  });

  return { archiveRuntime, droneLifecycleRuntime };
}

async function resolveHostPort(container: string, containerPort: number): Promise<number | null> {
  try {
    const ports = await dvmPorts(container);
    const match = ports.find((p) => p.containerPort === containerPort);
    return match ? match.hostPort : null;
  } catch {
    return null;
  }
}

function makeClient(hostPort: number, token: string) {
  return { baseUrl: `http://127.0.0.1:${hostPort}`, token };
}

function resolveHubAgentCommand(): string {
  // CLI-agnostic by design: this is just a command run inside tmux.
  // Override via env for other CLIs (e.g. "my-agent --foo").
  return String(process.env.DRONE_HUB_AGENT_CMD ?? '').trim() || 'agent --approve-mcps';
}

function resolveBuiltinTmuxCommand(agent: BuiltinAgentId): string {
  if (agent === 'cursor') {
    return String(process.env.DRONE_HUB_CURSOR_CMD ?? '').trim() || 'agent --approve-mcps';
  }
  if (agent === 'codex') {
    return String(process.env.DRONE_HUB_CODEX_CMD ?? '').trim() || 'codex';
  }
  if (agent === 'claude') {
    return String(process.env.DRONE_HUB_CLAUDE_CMD ?? '').trim() || 'claude';
  }
  if (agent === 'opencode') {
    return String(process.env.DRONE_HUB_OPENCODE_CMD ?? '').trim() || 'opencode';
  }
  if (agent === 'pi') {
    return String(process.env.DRONE_HUB_PI_CMD ?? '').trim() || 'pi';
  }
  if (agent === 'blip') {
    return String(process.env.DRONE_HUB_BLIP_CMD ?? '').trim() || 'blip';
  }
  return resolveHubAgentCommand();
}

function resolveBlipPromptCommand(runtime: DroneRuntime): string {
  if (runtime === 'host') {
    return `node ${bashQuote(path.join(resolveDroneDaemonRuntimeDir(), 'blip.js'))}`;
  }
  return 'blip';
}

function resolveHubTerminalShellCommand(): string {
  return resolveContainerTerminalShellCommand(process.env);
}

function defaultBuiltinChatAgentIdForDrone(droneEntry: any): BuiltinAgentId {
  return String(droneEntry?.fleet?.createdBy ?? '').trim() ? 'codex' : 'cursor';
}

function defaultChatAgentConfigForDrone(droneEntry: any): ChatAgentConfig {
  return { kind: 'builtin', id: defaultBuiltinChatAgentIdForDrone(droneEntry) };
}

function llmProviderEnvLogMeta() {
  const raw = String(process.env.DRONE_HUB_LLM_PROVIDER ?? '').trim();
  return {
    pid: process.pid,
    llmProviderEnv: parseLlmProvider(raw),
    llmProviderEnvRaw: raw || null,
  };
}

async function logProviderApiKeyResolution(
  level: 'info' | 'warn' | 'error',
  message: string,
  provider: LlmProviderId,
  meta?: Record<string, unknown>,
) {
  hubLog(level, message, {
    ...llmProviderEnvLogMeta(),
    provider,
    keyDiagnostics: await collectProviderApiKeyDiagnostics(provider),
    ...(meta ?? {}),
  });
}

async function logHubLlmStartupSnapshot() {
  const [openai, gemini, codex] = await Promise.all([
    collectProviderApiKeyDiagnostics('openai'),
    collectProviderApiKeyDiagnostics('gemini'),
    collectProviderApiKeyDiagnostics('codex'),
  ]);
  hubLog('info', 'hub llm configuration snapshot', {
    ...llmProviderEnvLogMeta(),
    cwd: process.cwd(),
    openai,
    gemini,
    codex,
  });
}

async function suggestCreatedDroneNameDirect(input: {
  droneId: string;
  prompt: string;
}): Promise<string> {
  const source = 'mobile-create-auto-rename';
  const { provider, ...resolved } = await resolveNameSuggestionLlmSettings();
  if (!resolved.apiKey) {
    await logProviderApiKeyResolution(
      'warn',
      'name-from-message rejected: missing Codex connection and OpenAI key',
      provider,
      {
        source,
        requestedDroneId: input.droneId,
        messageLength: input.prompt.length,
      },
    );
    throw new Error('Connect Codex or configure an OpenAI API key in Settings.');
  }
  const name = await retryTemporaryNameSuggestion(
    () =>
      suggestDroneNameFromMessage(input.prompt, {
        provider,
        apiKey: resolved.apiKey!,
        style: 'display',
      }),
    {
      onRetry: ({ attempt, delayMs, error }) => {
        hubLog('warn', 'name-from-message temporary failure; retrying', {
          provider,
          source,
          requestedDroneId: input.droneId,
          attempt,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    },
  );
  hubLog('info', 'name-from-message suggested', {
    provider,
    source,
    requestedDroneId: input.droneId,
    suggestedName: name,
    messageLength: input.prompt.length,
  });
  return name;
}

function normalizeContainerMcpUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  const normalized = value.replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error('invalid container MCP URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('container MCP URL must be an http(s) URL');
  }
  if (parsed.pathname !== '/mcp') {
    throw new Error('container MCP URL must point to /mcp');
  }
  if (parsed.hash) {
    throw new Error('container MCP URL must not include a URL fragment');
  }
  return parsed.toString().replace(/\/+$/, '');
}

type DroneHubApiServerOptions = {
  port: number;
  host?: string;
  containerMcpHost?: string;
  containerMcpPort?: number;
  containerMcpUrl?: string;
  apiToken: string;
  deviceMeshIngressPort?: number;
  mcpToken?: string;
  allowedOrigins?: string[];
};

export async function startDroneHubApiServer(opts: DroneHubApiServerOptions) {
  const lifecycle = createBackgroundLifecycle((resource, error) => {
    hubLog('warn', 'background resource stop failed', {
      resource,
      error: error instanceof Error ? error.message : String(error),
    });
  });
  try {
    return await startDroneHubApiServerWithLifecycle(opts, lifecycle);
  } catch (error) {
    await lifecycle.stop();
    throw error;
  }
}

async function startDroneHubApiServerWithLifecycle(
  opts: DroneHubApiServerOptions,
  lifecycle: BackgroundLifecycle,
) {
  const { register: registerBackgroundResource, stop: stopBackgroundResources } = lifecycle;
  const nativeChatRuntimePort = createNativeChatRuntimePort();
  const resourceSubscriptionRuntimePort = createResourceSubscriptionRuntimePort();
  const mcpProjectionFeature = createMcpProjectionFeature();
  const {
    bindConfig: bindMcpProjectionConfig,
    isManagedChatMcpAvailable,
    syncMcpServersForDrone,
    syncSkillLibraryForDrone,
  } = mcpProjectionFeature;
  const runtimeGraph = createHubRuntimeGraph(nativeChatRuntimePort, mcpProjectionFeature);
  const {
    chatSessionRuntime,
    createDroneChat,
    dockerSnapshotRuntime,
    promptRuntime,
    syncSetService,
  } = runtimeGraph;
  const { archiveRuntime, droneLifecycleRuntime } = createHubLifecycleFeatures(
    runtimeGraph,
    nativeChatRuntimePort,
    resourceSubscriptionRuntimePort,
  );
  const filesystemRuntime = createHubFilesystemFeature(runtimeGraph);
  const {
    assistantFilesystemService,
    buildFsSearchScript,
    handleFsActionRoute,
    handleFsUploadRoute,
    hostFsErrorStatus,
    hostMimeType,
    listHostFsDirectory,
    normalizeFsPathForRuntime,
    parseFsSearchOutput,
    readHostFileBytes,
  } = filesystemRuntime;
  const { removeDroneById, removeDroneTreeById } = droneLifecycleRuntime;
  const {
    archiveChatById,
    archiveDroneById,
    cleanupExpiredArchivedChats,
    deleteArchivedChatById,
    normalizeArchiveRetention,
    normalizeArchiveRuntimePolicy,
    parseIsoToMs,
    removeArchivedDroneById,
    resolveArchiveDeleteAtIso,
    restoreArchivedChatById,
    restoreArchivedDroneById,
    startArchiveCleanupScheduler,
    stopArchiveCleanupScheduler,
    triggerArchiveCleanup,
  } = archiveRuntime;
  const {
    HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
    HUB_WEB_TERMINAL_MAX_BYTES,
    HUB_WEB_TERMINAL_MAX_TAIL_LINES,
    assertReadOnlySupportedForAgent,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    clampIntParam,
    ensureChatEntry,
    ensureHubChatSessionRunning,
    ensureHubSessionRunning,
    getChatEntry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    parseOptionalNonNegativeInt,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    readChatSnapshot,
    resolveChatTmuxCommand,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
  } = chatSessionRuntime;
  const {
    chatHasActiveDockerSnapshot,
    collectDockerSnapshotImageRefsFromChatEntry,
    collectDockerSnapshotImageRefsFromDroneEntry,
    collectDroneRuntimeDiagnostics,
    dockerContainerId,
    dockerContainerSizeBytes,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    dockerSnapshotTotalsForDroneEntry,
    isStaleDockerExecErrorMessage,
    removeDockerSnapshotImagesBestEffort,
    restoreDockerSnapshotForTranscriptTurn,
  } = dockerSnapshotRuntime;
  const {
    attachmentOnlyPromptLabel,
    busyChatNamesForDrone,
    cancelQueuedPendingPrompt,
    chatHasReconcilablePendingPrompts,
    chatRequiresCodexApprovalForSummary,
    chatReconciliationQueue,
    createOrEnqueueNewChatAction,
    createOrEnqueuePromptUnified,
    dequeueProvisioning,
    enqueuePendingPromptPump,
    enqueueProvisioning,
    enqueueProvisioningForAllPending,
    enqueueReconcile,
    ensureDaemonPromptEventSubscription,
    isSafePromptId,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    migrateInMemoryChatStateForRename,
    promoteQueuedNewChatAction,
    resolveInterruptedPendingPrompt,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    resumePendingPromptChats,
    runDroneLifecycleAction,
    startPromptRuntimeBackgroundWork,
    stopAllDroneChatActivity,
    stopChatResponse,
    stopPromptRuntimeBackgroundWork,
    stopSingleDroneChatActivity,
  } = promptRuntime;
  let releaseMcpProjectionConfig = () => {};
  let releaseNativeChatRuntimePort = () => {};
  let releaseResourceSubscriptionRuntimePort = () => {};
  registerBackgroundResource('runtime ports', async () => {
    releaseMcpProjectionConfig();
    releaseNativeChatRuntimePort();
    releaseResourceSubscriptionRuntimePort();
  });
  startPromptRuntimeBackgroundWork();
  registerBackgroundResource('prompt runtime', stopPromptRuntimeBackgroundWork);
  chatSessionRuntime.start();
  registerBackgroundResource('chat state maintenance', async () => chatSessionRuntime.close());
  chatReconciliationQueue.clearRetries();
  loadHubEnv();
  await logHubLlmStartupSnapshot();
  const agentModelCatalogService = createHubAgentModelCatalogService();
  const discoverAndRememberModelsForBuiltinAgent = (input: {
    containerName?: string;
    containerPort?: number;
    runtime?: DroneRuntime;
    agentId: BuiltinAgentId;
    forceRefresh?: boolean;
  }) =>
    agentModelCatalogService.get({
      agentId: input.agentId,
      target: sharedAgentCatalogTarget(input),
      forceRefresh: input.forceRefresh,
    });
  const host = opts.host ?? '127.0.0.1';
  const containerMcpHost = String(opts.containerMcpHost ?? '').trim();
  const containerMcpPort = Number(opts.containerMcpPort ?? NaN);
  const containerMcpRequestedUrl = normalizeContainerMcpUrl(opts.containerMcpUrl);
  const apiToken = String(opts.apiToken ?? '').trim();
  if (!apiToken) throw new Error('missing hub API token');
  const mcpToken = String(opts.mcpToken ?? '').trim();
  if (mcpToken) await revokeLegacyProjectedDroneMcpTokens();
  const renameDroneCommand = createRenameDroneCommand({
    displayNameMaxLength: DRONE_DISPLAY_NAME_MAX_LEN,
    findDroneIdByRef,
    loadRegistry,
    log: hubLog,
    normalizeDisplayName: normalizeDroneDisplayName,
    normalizeDroneIdentity,
    notifyRegistryWrite: () => hubChangeEvents.emitRegistryWrite(),
    persistDisplayName: renameDroneDisplayName,
  });
  const hubApplication = createHubApplication({
    renameDrone: renameDroneCommand,
    deleteGroupDependencies: {
      listCanonicalGroups,
      loadRegistry,
      normalizeDroneIdentity,
      deleteCanonicalGroupArtifacts,
      dequeueProvisioning,
      removeDroneById,
      deleteCanonicalDroneLifecycleBatch,
    },
    fleetActorDependencies: {
      resolveDrone: async (ref) =>
        (globalThis as any).Bun
          ? await resolveDroneOrPendingForReadRef(ref)
          : await resolveCanonicalDroneOrPendingForReadRef(ref),
    },
  });
  const pendingHubApplicationEvents: HubApplicationEvent[] = [];
  let handleHubApplicationEvent = (event: HubApplicationEvent) => {
    pendingHubApplicationEvents.push(event);
  };
  const unsubscribeHubApplicationEvents = hubApplication.events.subscribe((event) => {
    handleHubApplicationEvent(event);
  });
  registerBackgroundResource('Hub application events', async () => {
    unsubscribeHubApplicationEvents();
  });
  const sidebarCommands = createSidebarCommandService(hubApplication);
  let actualPort = opts.port;
  const deviceMesh = await createDeviceMeshService({
    rootDir: droneRootPath('device-mesh'),
    apiToken,
    sidebarCommands,
    hubServices: hubApplication,
    localHubBaseUrl: () => `http://127.0.0.1:${actualPort}`,
    ingressPort: opts.deviceMeshIngressPort,
    createdDroneAutoRename: {
      suggestName: suggestCreatedDroneNameDirect,
      renameDrone: async ({ droneId, ...input }) => {
        await renameDroneCommand({ droneRef: droneId, ...input });
      },
    },
  });

  const allowedOrigins = new Set<string>();
  for (const o of opts.allowedOrigins ?? []) {
    const n = normalizeOrigin(o);
    if (n) allowedOrigins.add(n);
  }

  const resolveCurrentHubStateFallback = (
    rootDir: string,
    req: http.IncomingMessage,
  ): ManagedHubState => {
    const apiPort = actualPort;
    let uiPort = 0;
    const candidateUrl =
      typeof req.headers.origin === 'string'
        ? req.headers.origin
        : typeof req.headers.referer === 'string'
          ? req.headers.referer
          : '';
    if (candidateUrl) {
      try {
        const parsed = new URL(candidateUrl);
        const parsedPort = Number(parsed.port);
        if (Number.isFinite(parsedPort) && parsedPort > 0) uiPort = parsedPort;
      } catch {
        // ignore
      }
    }
    return {
      version: 1,
      pid: process.pid,
      apiHost: host,
      apiPort,
      uiPort,
      containerMcp:
        containerMcpHost && Number.isFinite(containerMcpPort) && containerMcpPort > 0
          ? {
              host: containerMcpHost,
              port: Math.floor(containerMcpPort),
              url:
                containerMcpRequestedUrl ||
                `http://host.docker.internal:${Math.floor(containerMcpPort)}/mcp`,
            }
          : null,
      startedAt: new Date().toISOString(),
      logPath: path.join(rootDir, 'hub.log'),
      launchEnv: null,
    };
  };

  const readManagedHubStateAtRootOrFallback = async (
    rootDir: string,
    req: http.IncomingMessage,
  ): Promise<ManagedHubState> => {
    try {
      return await readManagedHubStateAtRoot(rootDir);
    } catch (error: any) {
      const message = String(error?.message ?? error ?? '');
      if (/no such file/i.test(message) || /invalid hub state/i.test(message)) {
        return resolveCurrentHubStateFallback(rootDir, req);
      }
      throw error;
    }
  };

  // Best-effort: resume any pending provisioning after hub restarts.
  // (Pending entries are persisted in the registry, but the in-memory queue is not.)
  try {
    // Ensure a legacy-only installation has completed its lightweight
    // lifecycle import before the synchronous canonical read model is used.
    await listCanonicalDroneLifecycleForRead('real');
    const regAny: any = readCanonicalActiveDroneModel() ?? (await loadRegistry());
    enqueueProvisioningForAllPending(regAny);
    // Best-effort: resume only unfinished durable prompts after hub restarts.
    // Daemons for idle drones are recovered lazily when their next prompt is delivered.
    try {
      const drones =
        regAny?.drones && typeof regAny.drones === 'object' ? Object.entries(regAny.drones) : [];
      const activeDroneIds = new Set(drones.map(([droneId]) => String(droneId)));
      for (const pendingChat of await resumePendingPromptChats()) {
        if (!activeDroneIds.has(pendingChat.droneId)) continue;
        const nextAttemptMs = Date.parse(pendingChat.nextAttemptAt);
        const delayMs = Number.isFinite(nextAttemptMs)
          ? Math.max(0, nextAttemptMs - Date.now())
          : 0;
        if (delayMs > 0) {
          promptRuntime.schedulePendingPromptPumpRetry(
            pendingChat.droneId,
            pendingChat.chatName,
            delayMs,
          );
        } else {
          enqueuePendingPromptPump(pendingChat.droneId, pendingChat.chatName);
        }
      }
    } catch {
      // ignore (best-effort)
    }
  } catch {
    // ignore (best-effort)
  }

  startArchiveCleanupScheduler();
  registerBackgroundResource('archive cleanup', stopArchiveCleanupScheduler);
  startRegistryBackupScheduler();
  registerBackgroundResource('registry backups', stopRegistryBackupScheduler);

  const wss = createTerminalWebSocketServer({
    isStaleSessionError: isStaleDockerExecErrorMessage,
  });

  const callLocalHubApi = async (
    method: 'POST' | 'DELETE',
    pathname: string,
    body?: unknown,
  ): Promise<any> => {
    const response = await fetch(`http://127.0.0.1:${actualPort}${pathname}`, {
      method,
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: text };
      }
    }
    if (!response.ok) {
      throw Object.assign(new Error(data?.error ?? `${response.status} ${response.statusText}`), {
        status: response.status,
      });
    }
    return data;
  };

  const {
    assistantPromptDrains,
    assistantService,
    blipAssistantHost,
    buildAssistantDroneSummariesFromRegistry,
    emitWhiteboardChange,
    submitAssistantPrompt,
    subscribeWhiteboardChanges,
    unsubscribeDeviceMeshAssistantChanges,
    writeAssistantSseEvent,
  } = createAssistantRuntime({
    assistantFilesystemService,
    busyChatNamesForDrone,
    deviceMesh,
    normalizeDroneIdentity,
    nowIso,
    hubServices: hubApplication,
    onNativePromptQueueChanged: ({ droneId, chatName }) => {
      hubChangeEvents.emitChatWrite(droneId, chatName);
      promptRuntime.enqueuePendingPromptPump(droneId, chatName);
    },
    onNativeThreadStateChanged: () => {
      hubChangeEvents.emitSummaryChange();
    },
    summarizeDroneActivity,
  });
  registerBackgroundResource('device mesh assistant changes', async () => {
    unsubscribeDeviceMeshAssistantChanges();
  });
  const nativeChatLifecycle = new NativeChatLifecycle(assistantService, blipAssistantHost);
  const cloneNativeChatSession = (input: any) =>
    nativeChatLifecycle.clone({ ...input, id: input.targetId });
  const copyNativeChatConfiguration = async (input: any) => {
    await nativeChatLifecycle.ensure({
      id: input.sourceId,
      droneId: input.droneId,
      chatName: input.sourceChatName,
      provider: input.sourceProvider,
      model: input.sourceModel,
      thinkingLevel: input.sourceThinkingLevel,
    });
    await assistantService.cloneNativeThread({
      sourceId: input.sourceId,
      id: input.targetId,
      droneId: input.droneId,
      chatName: input.chatName,
    });
  };
  const nativeChatIsBusy = async (nativeChatId: string) =>
    assistantPromptDrains.has(nativeChatId) ||
    blipAssistantHost.isThreadRunning(nativeChatId) ||
    (await assistantService.nativeThreadIsBusy(nativeChatId));
  const nativeChatError = (nativeChatId: string) =>
    assistantService.nativeThreadError(nativeChatId);
  const nativeChatLatestAssistantText = (nativeChatId: string) =>
    blipAssistantHost.latestAssistantText(nativeChatId);
  const deleteNativeChatSessions = async (droneEntry: any) => {
    const chatEntries = [
      ...Object.values<any>(droneEntry?.chats ?? {}),
      ...Object.values<any>(droneEntry?.archivedChats ?? {}),
    ];
    const nativeChatIds = chatEntries
      .filter((chatEntry) => inferChatAgent(chatEntry, droneEntry).kind === 'native')
      .map((chatEntry) => String(chatEntry?.id ?? '').trim())
      .filter(Boolean);
    await nativeChatLifecycle.deleteMany(nativeChatIds);
  };
  const promptNativeChat = async ({
    droneId,
    chatName,
    chatId,
    promptId,
    provider,
    model,
    thinkingLevel,
    agentPermissionMode,
    approvalPolicy,
    deliveryMode,
    submissionSource,
    prompt,
    attachments,
  }: {
    droneId: string;
    chatName: string;
    chatId: string;
    promptId?: string;
    provider?: string;
    model?: string;
    thinkingLevel?: string;
    agentPermissionMode?: AgentPermissionMode;
    approvalPolicy?: AgentApprovalPolicy;
    deliveryMode?: 'queue' | 'asap';
    submissionSource?: import('../host/prompt-queue-repository').PromptSubmissionSource;
    prompt: string;
    attachments?: ChatImageAttachment[];
  }) => {
    if (!chatId) throw new Error('native chat has no stable identity');
    const activeNativeTurn = blipAssistantHost.isThreadRunning(chatId);
    if (!activeNativeTurn) {
      await nativeChatLifecycle.ensureForPrompt({
        id: chatId,
        droneId,
        chatName,
        provider,
        model,
        thinkingLevel,
        agentPermissionMode,
        approvalPolicy,
      });
    }
    const nativeAttachments = Array.isArray(attachments) ? attachments : [];
    const promptImages = validateAssistantPromptImages(
      nativeAttachments
        .filter((attachment) => String(attachment?.mime ?? '').startsWith('image/'))
        .map((attachment) => ({
          mime: attachment.mime,
          dataBase64: attachment.dataBase64,
        })),
    );
    const uploaded = await saveAssistantArtifactUploads(
      chatId,
      nativeAttachments.filter(
        (attachment) => !String(attachment?.mime ?? '').startsWith('image/'),
      ),
    );
    if (uploaded.length > 0 && (await assistantService.ensureArtifactsWorkspaceEnabled(chatId))) {
      blipAssistantHost.invalidateThread(chatId);
    }
    const references = uploaded.map((file: any) => `- ${file.path}`).join('\n');
    const promptWithFiles = references
      ? `${prompt}${prompt ? '\n\n' : ''}Attached files:\n${references}`
      : prompt;
    await submitAssistantPrompt({
      threadId: chatId,
      promptId,
      prompt: promptWithFiles,
      promptImages,
      deliveryMode,
      submissionSource,
    });
  };
  const stopNativeChat = async (nativeChatId: string) => {
    blipAssistantHost.stopThread(nativeChatId);
    await assistantService.stopThread(nativeChatId);
  };
  releaseNativeChatRuntimePort = nativeChatRuntimePort.bind({
    cloneSession: cloneNativeChatSession,
    copyConfiguration: copyNativeChatConfiguration,
    deleteSessions: deleteNativeChatSessions,
    error: nativeChatError,
    isBusy: nativeChatIsBusy,
    latestAssistantText: nativeChatLatestAssistantText,
    prompt: promptNativeChat,
    stop: stopNativeChat,
  });

  function writeHubSseEvent(res: http.ServerResponse, event: string, data: any): void {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  const DRONE_STATUS_SUMMARY_CONCURRENCY = 16;
  const DRONE_SUMMARY_REGISTRY_CACHE_TTL_MS = 1_000;
  const CANONICAL_ACTIVE_MODEL_CACHE_TTL_MS = 250;
  const DRONE_SUMMARY_MAINTENANCE_MIN_INTERVAL_MS = 5_000;
  let droneSummaryRegistryCache: { loadedAtMs: number; registry: any } | null = null;
  let droneSummaryRegistryCacheLoad: Promise<any> | null = null;
  let droneSummaryRegistryCacheEpoch = 0;
  let droneSummaryMaintenanceTimeout: ReturnType<typeof setTimeout> | null = null;
  let droneSummaryMaintenanceTask: Promise<void> | null = null;
  let droneSummaryMaintenanceLastStartedAt = 0;
  let droneSummaryMaintenanceStopped = false;
  let canonicalActiveModelCache: { loadedAtMs: number; model: any } | null = null;

  async function loadCanonicalActiveModel(): Promise<any> {
    if ((globalThis as any).Bun) return await loadRegistry();
    if (
      canonicalActiveModelCache &&
      Date.now() - canonicalActiveModelCache.loadedAtMs < CANONICAL_ACTIVE_MODEL_CACHE_TTL_MS
    ) {
      return canonicalActiveModelCache.model;
    }
    const model = readCanonicalActiveDroneModel() ?? (await loadRegistry());
    canonicalActiveModelCache = { loadedAtMs: Date.now(), model };
    return model;
  }

  async function loadCanonicalLifecycleModel(): Promise<any> {
    if ((globalThis as any).Bun) return await loadRegistry();
    return readCanonicalDroneLifecycleModel() ?? (await loadRegistry());
  }

  async function mapDroneRegistrySummaryConcurrent<T, R>(
    items: T[],
    limitRaw: number,
    fn: (item: T, index: number) => Promise<R>,
  ): Promise<R[]> {
    const limit = Math.max(1, Math.floor(limitRaw || 1));
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await fn(items[index], index);
      }
    });
    await Promise.all(workers);
    return results;
  }

  const droneStatusRuntime = createDroneStatusRuntime({
    loadModel: loadCanonicalActiveModel,
    log: hubLog,
    makeClient,
    normalizeDroneId: normalizeDroneIdentity,
    normalizeRuntime: normalizeDroneRuntime,
    onChanged: (source) => scheduleDroneRegistryBroadcasterRefresh(source === 'startup' ? 0 : 50),
    readStatus: droneStatus,
    resolveHostPort,
  });
  const cachedDroneStatusSummaryForEntry = droneStatusRuntime.cachedForEntry;

  function invalidateDroneSummaryRegistryCache(): void {
    droneSummaryRegistryCacheEpoch += 1;
    droneSummaryRegistryCache = null;
    droneSummaryRegistryCacheLoad = null;
  }

  async function loadDroneRegistryForSummary(): Promise<any> {
    if (
      droneSummaryRegistryCache &&
      Date.now() - droneSummaryRegistryCache.loadedAtMs < DRONE_SUMMARY_REGISTRY_CACHE_TTL_MS
    ) {
      return droneSummaryRegistryCache.registry;
    }
    if (!droneSummaryRegistryCacheLoad) {
      const loadEpoch = droneSummaryRegistryCacheEpoch;
      const loadPromise = loadCanonicalActiveModel()
        .then((registry) => {
          if (loadEpoch === droneSummaryRegistryCacheEpoch) {
            droneSummaryRegistryCache = { loadedAtMs: Date.now(), registry };
          }
          return registry;
        })
        .finally(() => {
          if (droneSummaryRegistryCacheLoad === loadPromise) {
            droneSummaryRegistryCacheLoad = null;
          }
        });
      droneSummaryRegistryCacheLoad = loadPromise;
    }
    return await droneSummaryRegistryCacheLoad;
  }

  const scheduleDroneStatusRefresh = droneStatusRuntime.schedule;

  async function auditStartupRegistryPresence(): Promise<void> {
    try {
      // The first call may perform the one-time migration. Keep it ordered so
      // concurrent readers do not each parse and attempt the same legacy seed.
      const real = await listCanonicalDroneLifecycleForRead('real');
      const remaining = await Promise.all([
        listCanonicalDroneLifecycleForRead('pending'),
        listCanonicalDroneLifecycleForRead('archived'),
      ]);
      const canonical = [real, ...remaining];
      let drones: number;
      let pending: number;
      let archived: number;
      if (canonical.every((records) => records != null)) {
        [drones, pending, archived] = canonical.map((records) => records?.length ?? 0);
      } else {
        const regAny: any = await loadRegistry();
        drones = Object.keys(regAny?.drones ?? {}).length;
        pending = Object.keys(regAny?.pending ?? {}).length;
        archived = Object.keys(regAny?.archived ?? {}).length;
      }
      if (drones + pending + archived > 0) return;

      let containerNames: string[] = [];
      try {
        containerNames = await dvmLs();
      } catch (error: any) {
        hubLog('warn', 'registry startup empty and container audit unavailable', {
          drones,
          pending,
          archived,
          error: error?.message ?? String(error),
        });
        return;
      }

      const droneContainers = containerNames
        .map((name) => String(name ?? '').trim())
        .filter((name) =>
          /^drone-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name),
        );
      if (droneContainers.length === 0) return;

      hubLog('error', 'registry startup empty while containers exist', {
        drones,
        pending,
        archived,
        containerCount: droneContainers.length,
        sampleContainers: droneContainers.slice(0, 20),
      });
    } catch (error: any) {
      hubLog('warn', 'registry startup audit failed', { error: error?.message ?? String(error) });
    }
  }

  function enqueueDroneRegistryReconcilers(regAny: any): void {
    enqueueProvisioningForAllPending(regAny);
    try {
      for (const [droneId, d] of Object.entries(regAny.drones ?? {})) {
        const id = normalizeDroneIdentity(droneId);
        if (!id) continue;
        if (!d || typeof d !== 'object') continue;
        if (!(d as any)?.chats || typeof (d as any).chats !== 'object') continue;
        for (const [chatName, entry] of Object.entries((d as any).chats)) {
          if (chatHasReconcilablePendingPrompts(entry)) {
            ensureDaemonPromptEventSubscription(id);
            enqueueReconcile(id, String(chatName));
          }
        }
      }
    } catch {
      // ignore
    }
  }

  async function reconcileSeedingPromptCompletion(regAny: any): Promise<void> {
    const hubPatches: Array<{ id: string; hub: any | null }> = [];
    for (const [droneId, d] of Object.entries(regAny.drones ?? {}) as any[]) {
      const hub = d?.hub;
      if (!hub || String(hub?.phase ?? '') !== 'seeding') continue;
      const id = normalizeDroneIdentity(droneId);
      if (!id) continue;
      let changedForDrone = false;
      let nextHub: any = hub;
      let promptId = String(nextHub?.promptId ?? '').trim();

      if (!promptId) {
        const chats = d?.chats && typeof d.chats === 'object' ? Object.values(d.chats) : [];
        for (const entry of chats as any[]) {
          const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
          const candidate = pending.find((p: any) => {
            const pendingId = String(p?.id ?? '').trim();
            const st = String(p?.state ?? '').trim();
            return Boolean(pendingId) && st !== 'failed';
          });
          const candidateId = String(candidate?.id ?? '').trim();
          if (!candidateId) continue;
          promptId = candidateId;
          nextHub = { ...nextHub, promptId };
          changedForDrone = true;
          break;
        }
      }

      // Current provisioning treats the initial prompt as durable queue work,
      // not as part of runtime startup. Older records can still carry a
      // `seeding` marker for that queued prompt. There is no daemon job to poll
      // yet, so polling it only produces a swallowed 404 and leaves the UI
      // permanently gated behind the stale phase.
      if (nextHub && promptId && hasQueuedPromptWithId(d, promptId)) {
        nextHub = null;
        changedForDrone = true;
      }

      if (nextHub && promptId) {
        const token = typeof d.token === 'string' ? d.token : '';
        const containerName = String(d?.containerName ?? d?.name ?? '').trim();
        const hostPort =
          typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
            ? d.hostPort
            : await resolveHostPort(containerName || String(d.name ?? ''), d.containerPort);
        if (hostPort && token) {
          try {
            const r: any = await dronePromptGet(makeClient(hostPort, token), promptId);
            const job = r?.job ?? null;
            const st = String(job?.state ?? '').trim();
            if (st === 'done') {
              nextHub = null;
              changedForDrone = true;
            } else if (st === 'failed') {
              nextHub = {
                phase: 'error',
                message: String(job?.error ?? 'Seed failed'),
                updatedAt: nowIso(),
              };
              changedForDrone = true;
            }
          } catch {
            // ignore; keep seeding
          }
        }
      }

      if (changedForDrone) {
        if (nextHub == null) {
          delete d.hub;
        } else {
          d.hub = nextHub;
        }
        hubPatches.push({ id, hub: nextHub ?? null });
      }
    }
    if (hubPatches.length === 0) return;
    try {
      for (const p of hubPatches) {
        const id = normalizeDroneIdentity(p?.id);
        if (!id) continue;
        await commitDroneMetadataPatch({
          droneId: id,
          state: 'real',
          eventType: 'drone.seeding-status.reconciled',
          transform: (d) => {
            if (p.hub == null) {
              delete d.hub;
            } else {
              d.hub = p.hub;
            }
            return d;
          },
        });
      }
    } catch {
      // ignore
    }
  }

  async function autoClearStaleRepoConflictHubErrors(regAny: any): Promise<void> {
    const autoClearedConflictErrors = new Map<string, 'pull' | 'push'>();
    for (const [droneIdRaw, d] of Object.entries(regAny.drones ?? {}) as any[]) {
      const droneId = normalizeDroneIdentity(droneIdRaw);
      if (!droneId) continue;
      if (
        String(d?.hub?.phase ?? '')
          .trim()
          .toLowerCase() !== 'error'
      )
        continue;
      const lastPullMode = String(d?.repo?.lastPull?.mode ?? '')
        .trim()
        .toLowerCase();
      const lastPushMode = String(d?.repo?.lastPush?.mode ?? '')
        .trim()
        .toLowerCase();
      const conflictMode: 'pull' | 'push' | null =
        lastPushMode === 'drone-conflicts-ready'
          ? 'push'
          : lastPullMode === 'host-conflicts-ready'
            ? 'pull'
            : null;
      if (!conflictMode) continue;

      try {
        let resolved = false;
        if (conflictMode === 'pull') {
          const repoPathRaw = String(d?.repoPath ?? '').trim();
          if (!repoPathRaw) continue;
          const repoRoot = await gitTopLevel(repoPathRaw);
          const changes = await gitRepoChangesSummary(repoRoot);
          resolved = Number(changes?.counts?.conflicted ?? 0) === 0;
        } else {
          const name = String(d?.name ?? '').trim() || droneId;
          const repoPathInContainer = droneRepoPathInContainer(d);
          const unmerged = await withLockedDroneContainer(
            { requestedDroneName: name, droneEntry: d },
            async ({ containerName }) => {
              return await droneUnmergedFiles({ containerName, repoPathInContainer });
            },
          );
          resolved = unmerged.length === 0;
        }

        if (resolved) {
          delete d.hub;
          d.repo = d.repo ?? {};
          if (conflictMode === 'pull') d.repo.lastPullError = null;
          else d.repo.lastPushError = null;
          autoClearedConflictErrors.set(droneId, conflictMode);
        }
      } catch {
        // ignore; keep current hub error until we can verify repo state
      }
    }
    if (autoClearedConflictErrors.size === 0) return;
    try {
      const cleared = Array.from(autoClearedConflictErrors.entries());
      for (const [rawDroneId, conflictMode] of cleared) {
        const droneId = normalizeDroneIdentity(rawDroneId);
        if (!droneId) continue;
        await commitDroneMetadataPatch({
          droneId,
          state: 'real',
          eventType: 'drone.repo-conflict.cleared',
          transform: (d) => {
            if (
              String(d?.hub?.phase ?? '')
                .trim()
                .toLowerCase() === 'error'
            )
              delete d.hub;
            d.repo = d.repo ?? {};
            if (conflictMode === 'pull' && typeof d.repo.lastPullError === 'string')
              d.repo.lastPullError = null;
            if (conflictMode === 'push' && typeof d.repo.lastPushError === 'string')
              d.repo.lastPushError = null;
            return d;
          },
        });
      }
    } catch {
      // ignore
    }
  }

  function runDroneSummaryMaintenance(source: string): Promise<void> {
    if (droneSummaryMaintenanceTask) return droneSummaryMaintenanceTask;
    droneSummaryMaintenanceLastStartedAt = Date.now();
    const task = (async () => {
      try {
        const regAny: any = await loadCanonicalActiveModel();
        enqueueDroneRegistryReconcilers(regAny);
        await reconcileSeedingPromptCompletion(regAny);
        await autoClearStaleRepoConflictHubErrors(regAny);
      } catch (e: any) {
        hubLog('warn', 'drone summary maintenance failed', {
          source,
          error: e?.message ?? String(e),
        });
      }
    })().finally(() => {
      if (droneSummaryMaintenanceTask === task) {
        droneSummaryMaintenanceTask = null;
      }
    });
    droneSummaryMaintenanceTask = task;
    return task;
  }

  function registryNeedsDroneSummaryMaintenance(regAny: any): boolean {
    if (Object.keys(regAny?.pending ?? {}).length > 0) return true;
    for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
      if (String(d?.hub?.phase ?? '') === 'seeding') return true;
      if (
        String(d?.hub?.phase ?? '')
          .trim()
          .toLowerCase() === 'error'
      ) {
        const lastPullMode = String(d?.repo?.lastPull?.mode ?? '')
          .trim()
          .toLowerCase();
        const lastPushMode = String(d?.repo?.lastPush?.mode ?? '')
          .trim()
          .toLowerCase();
        if (lastPushMode === 'drone-conflicts-ready' || lastPullMode === 'host-conflicts-ready')
          return true;
      }
      for (const entry of Object.values(d?.chats ?? {}) as any[]) {
        if (chatHasReconcilablePendingPrompts(entry)) return true;
      }
    }
    return false;
  }

  function scheduleDroneSummaryMaintenance(source: string, delayMs = 0): void {
    if (droneSummaryMaintenanceStopped) return;
    if (droneSummaryMaintenanceTimeout) return;
    const sinceLastStartMs = Date.now() - droneSummaryMaintenanceLastStartedAt;
    const throttleMs = Math.max(0, DRONE_SUMMARY_MAINTENANCE_MIN_INTERVAL_MS - sinceLastStartMs);
    droneSummaryMaintenanceTimeout = setTimeout(
      () => {
        droneSummaryMaintenanceTimeout = null;
        void runDroneSummaryMaintenance(source);
      },
      Math.max(0, delayMs, throttleMs),
    );
    (droneSummaryMaintenanceTimeout as any).unref?.();
  }

  async function loadPreparedDroneRegistryForSummary(source: string): Promise<any> {
    const regAny = await loadDroneRegistryForSummary();
    if (registryNeedsDroneSummaryMaintenance(regAny)) {
      scheduleDroneSummaryMaintenance(source, 0);
    }
    return regAny;
  }

  function buildPendingDroneSummary(regAny: any, p: any): any {
    const runtime = normalizeDroneRuntime(p?.runtime);
    const repoAttached = Boolean(String(p?.repoPath ?? '').trim());
    const phase = String(p?.phase ?? 'starting') as PendingPhase;
    const seed = p?.seed;
    const activity = summarizeDroneActivity(p);
    const hasSeed =
      seed &&
      typeof seed === 'object' &&
      (Boolean((seed as any)?.agent) ||
        Boolean(String((seed as any)?.prompt ?? '').trim()) ||
        Boolean(String((seed as any)?.chatName ?? '').trim()) ||
        Boolean(String((seed as any)?.cwd ?? '').trim()));
    const message =
      typeof p?.message === 'string'
        ? p.message
        : phase === 'draft'
          ? 'Draft'
          : phase === 'error'
            ? 'Failed'
            : hasSeed
              ? 'Seeding…'
              : 'Starting…';
    const err = typeof p?.error === 'string' ? p.error : null;
    const hubPhase: any =
      phase === 'draft'
        ? 'draft'
        : phase === 'error'
          ? 'error'
          : phase === 'seeding'
            ? 'seeding'
            : 'starting';
    const startupChats = [
      ...new Set(
        normalizePendingStartupPrompts((p as any)?.startupQueuedPrompts).map(
          (item) => item.chatName,
        ),
      ),
    ].filter(Boolean);
    const chats = startupChats.length > 0 ? startupChats : ['default'];
    const workflowChild = workflowChildDroneMetadata(p);
    return {
      id: normalizeDroneIdentity(p?.id) || null,
      name: String(p?.name ?? ''),
      group: typeof p?.group === 'string' && p.group.trim() ? p.group.trim() : null,
      groupId: typeof p?.groupId === 'string' && p.groupId.trim() ? p.groupId.trim() : null,
      draft: isDraftDroneEntry(p),
      createdAt: String(p?.createdAt ?? nowIso()),
      lastActivityAt: activity.lastActivityAt,
      lastMessageAt: activity.lastMessageAt,
      lastActivityChat: activity.lastActivityChat,
      fleetParentId: resolveStableDroneOrPendingIdFromRef(regAny, fleetActorConfig(p).createdBy),
      fleetAssignedIds: normalizeFleetAssignedRefsForSummary(
        regAny,
        p?.id,
        fleetActorConfig(p).assigned,
      ),
      ...(workflowChild ? { workflowChild } : {}),
      runtime,
      repoAttached,
      repoPath: repoAttached ? String(p?.repoPath ?? '') : '',
      repoBranch: String(p?.repo?.branch ?? '').trim() || null,
      cwd: normalizeDroneCwdForRuntime(p, null),
      ...(runtime === 'container' ? { persistVolume: p?.persistVolume !== false } : {}),
      containerPort:
        typeof p?.containerPort === 'number' && Number.isFinite(p.containerPort)
          ? p.containerPort
          : 7777,
      hostPort: null,
      statusOk: false,
      status: null,
      statusError: phase === 'error' ? (err ?? message ?? 'failed') : null,
      statusChecking: false,
      chats,
      busyChats: [],
      hubPhase,
      hubMessage: phase === 'error' ? (err ?? message ?? null) : message,
      busy: false,
    };
  }

  async function buildDroneDockerSizeSummary(d: any): Promise<{
    totalBytes: number;
    containerWritableBytes: number | null;
    snapshotBytes: number;
    snapshotVirtualBytes: number | null;
    snapshotCount: number;
  }> {
    const runtime = normalizeDroneRuntime(d?.runtime);
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const snapshotTotals = await dockerSnapshotTotalsForDroneEntry(d);
    const containerWritableBytes =
      runtime === 'container' && containerName
        ? await dockerContainerSizeBytes(containerName)
        : null;
    return {
      totalBytes: (containerWritableBytes ?? 0) + snapshotTotals.sizeBytes,
      containerWritableBytes,
      snapshotBytes: snapshotTotals.sizeBytes,
      snapshotVirtualBytes: snapshotTotals.virtualSizeBytes,
      snapshotCount: snapshotTotals.count,
    };
  }

  async function buildRealDroneSummary(
    regAny: any,
    d: any,
    storedReadStates: Record<string, ChatReadState>,
    canonicalMessageAtByChatId: ReadonlyMap<string, string>,
  ): Promise<any> {
    const runtime = normalizeDroneRuntime(d?.runtime);
    const activity = summarizeDroneActivity(d, canonicalMessageAtByChatId);
    const hubPhase = typeof d?.hub?.phase === 'string' ? String(d.hub.phase) : null;
    const hubMessage = typeof d?.hub?.message === 'string' ? String(d.hub.message) : null;
    const repoPath = String(d?.repoPath ?? '').trim();
    const repoBranch = String(d?.repo?.branch ?? '').trim() || null;
    const repoAttached =
      Boolean(repoPath) ||
      Boolean(String(d?.repo?.dest ?? '').trim()) ||
      Boolean(String(d?.repo?.seededAt ?? '').trim());
    const droneId = normalizeDroneIdentity(d?.id);
    const { chats, workflowChats } = partitionWorkflowChatEntries(d.chats);
    const workflowChatSet = new Set(workflowChats);
    const pendingBusyChats = droneId
      ? busyChatNamesForDrone(d, droneId).filter(
          (chatName: string) => !workflowChatSet.has(chatName),
        )
      : [];
    const busyChats = await mergeNativeBusyChatNames({
      busyChatNames: pendingBusyChats,
      chatNames: chats,
      droneEntry: d,
      isNativeChat: (chatEntry, droneEntry) =>
        inferChatAgent(chatEntry, droneEntry).kind === 'native',
      isThreadBusy: async (threadId) =>
        assistantPromptDrains.has(threadId) ||
        blipAssistantHost.isThreadRunning(threadId) ||
        (await assistantService.nativeThreadHasActiveRun(threadId)),
    });
    const approvalChats = chats.flatMap((chatName) => {
      const chatEntry = d.chats?.[chatName];
      const agent = inferChatAgent(chatEntry, d);
      if (agent.kind === 'native') {
        const threadId = String(chatEntry?.id ?? '').trim();
        return threadId && assistantService.threadRequiresApproval(threadId) ? [chatName] : [];
      }
      if (
        agent.kind === 'builtin' &&
        agent.id === 'codex' &&
        chatRequiresCodexApprovalForSummary({ droneId, chatName, entry: chatEntry })
      ) {
        return [chatName];
      }
      return [];
    });
    const chatReadStates = Object.fromEntries(
      chats.map((chatName) => {
        const state = storedReadStates[chatName];
        return [
          chatName,
          {
            unread: state?.unread === true,
            latestAgentTurnId: state?.latestAgentTurnId ?? null,
            latestAgentRevision: state?.latestAgentRevision ?? 0,
          },
        ];
      }),
    );
    const unreadChats = chats.filter((chatName) => chatReadStates[chatName]?.unread === true);
    const draftChats = Object.fromEntries(
      chats
        .filter((chatName) => isDraftChatEntry((d.chats ?? {})[chatName]))
        .map((chatName) => [chatName, true]),
    );
    const { hostPort, statusOk, status, statusError, statusChecking } =
      cachedDroneStatusSummaryForEntry(d);
    const workflowChild = workflowChildDroneMetadata(d);

    return {
      id: normalizeDroneIdentity(d?.id) || null,
      name: d.name,
      group: d.group ?? null,
      groupId: typeof d?.groupId === 'string' && d.groupId.trim() ? d.groupId.trim() : null,
      createdAt: d.createdAt,
      lastActivityAt: activity.lastActivityAt,
      lastMessageAt: activity.lastMessageAt,
      lastActivityChat: activity.lastActivityChat,
      fleetParentId: resolveStableDroneOrPendingIdFromRef(regAny, fleetActorConfig(d).createdBy),
      fleetAssignedIds: normalizeFleetAssignedRefsForSummary(
        regAny,
        d?.id,
        fleetActorConfig(d).assigned,
      ),
      ...(workflowChild ? { workflowChild } : {}),
      runtime,
      repoAttached,
      repoPath: repoAttached ? repoPath : '',
      repoBranch,
      cwd: normalizeDroneCwdForRuntime(d, null),
      ...(runtime === 'container' ? { persistVolume: d?.persistVolume !== false } : {}),
      containerPort: d.containerPort,
      hostPort: hostPort ?? null,
      statusOk,
      status,
      statusError,
      statusChecking: Boolean(statusChecking),
      chats,
      workflowChats,
      unreadChats,
      chatReadStates,
      draftChats,
      busyChats,
      approvalChats,
      approvalRequired: approvalChats.length > 0,
      hubPhase,
      hubMessage,
      busy: busyChats.length > 0,
    };
  }

  async function buildDroneRegistrySnapshot(source: string): Promise<DroneRegistrySnapshot> {
    const [regAny, canonicalGroups, preferences] = await Promise.all([
      loadPreparedDroneRegistryForSummary(source),
      listCanonicalGroups(),
      hubApplication.settings.uiPreferences.read(),
    ]);
    const groupIdByScopeAndName = new Map(
      canonicalGroups.map((group) => [`${group.repoPath}\0${group.name}`, group.id]),
    );
    const groupById = new Map(canonicalGroups.map((group) => [group.id, group]));
    const pendingSummaries = Object.values(regAny?.pending ?? {}).map((p) =>
      buildPendingDroneSummary(regAny, p),
    );
    const realDrones = Object.values(regAny.drones ?? {});
    const nativeChatIds = realDrones.flatMap((drone: any) =>
      Object.values(drone?.chats ?? {}).flatMap((chatEntry: any) => {
        if (inferChatAgent(chatEntry, drone).kind !== 'native') return [];
        const chatId = String(chatEntry?.id ?? '').trim();
        return chatId ? [chatId] : [];
      }),
    );
    const canonicalMessageAtByChatId =
      await blipAssistantHost.latestMessageTimestamps(nativeChatIds);
    const readStatesByDroneId = listChatReadStatesForDronesFromStore({
      droneIds: realDrones.map((drone: any) => normalizeDroneIdentity(drone?.id)).filter(Boolean),
    });
    const realSummaries = await mapDroneRegistrySummaryConcurrent(
      realDrones,
      DRONE_STATUS_SUMMARY_CONCURRENCY,
      async (d) => {
        const droneId = normalizeDroneIdentity((d as any)?.id);
        return buildRealDroneSummary(
          regAny,
          d,
          readStatesByDroneId.get(droneId) ?? {},
          canonicalMessageAtByChatId,
        );
      },
    );

    const byId = new Map<string, any>();
    for (const p of pendingSummaries) {
      const id = String(p?.id ?? '').trim();
      if (id) byId.set(id, p);
    }
    for (const d of realSummaries) {
      const id = String(d?.id ?? '').trim();
      if (id) byId.set(id, d);
    }
    const drones = Array.from(byId.values())
      .filter((x) => x?.id && x?.name)
      .map((drone) => {
        const group = String(drone?.group ?? '').trim();
        const repoPath = String(drone?.repoPath ?? '').trim();
        const existingGroupId = String(drone?.groupId ?? '').trim();
        const existingGroup = groupById.get(existingGroupId);
        return group
          ? {
              ...drone,
              groupId:
                existingGroup?.repoPath === repoPath
                  ? existingGroupId
                  : groupIdByScopeAndName.get(`${repoPath}\0${group}`) || null,
            }
          : drone;
      });
    return {
      ok: true,
      drones,
      groups: canonicalGroups,
      uiPreferences: preferences.uiPreferences,
      preferenceUpdatedAt: preferences.updatedAt,
      preferenceVersion: preferences.version,
    };
  }

  const droneChatBroadcaster = new DroneChatBroadcaster({
    loadModel: loadCanonicalActiveModel,
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    nowIso,
    writeSseEvent: writeHubSseEvent,
  });
  const droneRegistryBroadcaster = new DroneRegistryBroadcaster({
    buildSnapshot: async () => await buildDroneRegistrySnapshot('api:drones-events'),
    writeSseEvent: writeHubSseEvent,
  });
  registerBackgroundResource('drone projection broadcasters', async () => {
    droneChatBroadcaster.stop();
    droneRegistryBroadcaster.stop();
  });
  const droneChatSseClients = droneChatBroadcaster.clients;
  const droneChatSseLastByKey = droneChatBroadcaster.lastByKey;
  const droneRegistrySseClients = droneRegistryBroadcaster.clients;
  const refreshDroneChatEventSnapshot = (opts?: { broadcastSnapshot?: boolean }) =>
    droneChatBroadcaster.refresh(opts);
  const refreshDroneRegistryBroadcasterSnapshot = (opts?: { broadcastSnapshot?: boolean }) =>
    droneRegistryBroadcaster.refresh(opts);
  const scheduleDroneChatEventRefresh = (delayMs = 100) => droneChatBroadcaster.schedule(delayMs);
  const scheduleDroneRegistryBroadcasterRefresh = (delayMs = 150, restart = false) =>
    droneRegistryBroadcaster.schedule(delayMs, restart);
  const startDroneChatBroadcaster = () => droneChatBroadcaster.start();
  const startDroneRegistryBroadcaster = () => droneRegistryBroadcaster.start();
  const stopDroneChatBroadcasterIfIdle = () => droneChatBroadcaster.stopIfIdle();
  const stopDroneRegistryBroadcasterIfIdle = () => droneRegistryBroadcaster.stopIfIdle();

  const notifyCanonicalDroneRegistryWrite = () => {
    canonicalActiveModelCache = null;
    invalidateDroneSummaryRegistryCache();
    scheduleDroneSummaryMaintenance('registry-write', 0);
    scheduleDroneStatusRefresh('registry-write', 0);
    scheduleDroneRegistryBroadcasterRefresh();
    scheduleDroneChatEventRefresh();
    void deviceMesh.broadcastDroneListChange({ reason: 'registry_write', at: nowIso() });
    void deviceMesh.broadcastDroneChatChange({ reason: 'registry_write', at: nowIso() });
  };
  const unsubscribeRegistryWrites = hubChangeEvents.onRegistryWrite(
    notifyCanonicalDroneRegistryWrite,
  );
  const notifyCanonicalDroneSummaryChange = () => {
    canonicalActiveModelCache = null;
    invalidateDroneSummaryRegistryCache();
    scheduleDroneRegistryBroadcasterRefresh();
  };
  const unsubscribeSummaryChanges = hubChangeEvents.onSummaryChange(
    notifyCanonicalDroneSummaryChange,
  );
  const notifyHubApplicationEvent = (event: HubApplicationEvent) => {
    if (event.type !== 'ui-preferences.changed') return;
    const at = nowIso();
    if (event.notificationMode === 'sidebar-snapshot') {
      scheduleDroneRegistryBroadcasterRefresh(150, true);
    } else {
      assistantService.emitExternalUiAction({ type: 'reload_ui_preferences', at });
    }
    void deviceMesh.broadcastDroneListChange({ reason: 'ui_preferences_write', at });
  };
  handleHubApplicationEvent = notifyHubApplicationEvent;
  for (const event of pendingHubApplicationEvents.splice(0)) notifyHubApplicationEvent(event);
  const notifyCanonicalPromptQueueChatWrite = (droneId: string, chatName: string) => {
    // Prompt delivery state is canonical SQLite state and does not rewrite the
    // registry. Invalidate the projection and wake chat and sidebar SSE clients
    // explicitly so live state and native-message timestamps are not delayed
    // until the fallback poll.
    notifyCanonicalDroneSummaryChange();
    scheduleDroneChatEventRefresh();
    void deviceMesh.broadcastDroneChatChange({
      reason: 'chat_write',
      droneId,
      chatName,
      at: nowIso(),
    });
  };
  const unsubscribeChatWrites = hubChangeEvents.onChatWrite(({ droneId, chatName }) =>
    notifyCanonicalPromptQueueChatWrite(droneId, chatName),
  );
  registerBackgroundResource('Hub change subscriptions', async () => {
    unsubscribeChatWrites();
    unsubscribeRegistryWrites();
    unsubscribeSummaryChanges();
  });
  const initialSpeechSettings = await resolveEffectiveSpeechSettings();
  assistantService.setSpeechToolEnabled(initialSpeechSettings.enabled);
  const mcpHttpTransport = new DroneHubMcpHttpTransport({
    signingSecret: mcpToken,
    log: hubLog,
    speechEnabled: initialSpeechSettings.enabled,
    hubServices: hubApplication,
  });
  registerBackgroundResource('MCP HTTP transport', async () => {
    await mcpHttpTransport.close();
  });
  const handleDroneHubMcpRequest = (
    req: http.IncomingMessage,
    res: http.ServerResponse,
    method: string,
  ) => mcpHttpTransport.handle(req, res, method);

  const upsertDroneHubMcpServerPreset = async () => {
    if (!mcpToken) throw new Error('MCP endpoint is not enabled');
    const hostToken = await ensureHostMcpAccessToken({
      name: 'Drone Hub host token',
      signingSecret: mcpToken,
    });
    const payload = {
      name: 'drone-hub',
      description: 'Drone Hub MCP over HTTP for Hub agents.',
      enabled: true,
      transport: 'http',
      url: `http://127.0.0.1:${actualPort}/mcp`,
      headers: { Authorization: `Bearer ${hostToken.tokenValue}` },
      agents: ['codex', 'cursor', 'claude', 'opencode'],
    };
    const existing = (await listMcpServers()).find((server) => server.name === payload.name);
    return existing
      ? await updateMcpServerRecord(existing.id, payload)
      : await createMcpServer(payload);
  };

  const resourceSubscriptionDatabase = getHubDatabase();
  const resourceSubscriptionRepository = resourceSubscriptionDatabase
    ? new ResourceSubscriptionRepository(resourceSubscriptionDatabase)
    : null;
  const resourceSubscriptionService = resourceSubscriptionRepository
    ? new ResourceSubscriptionService({
        repository: resourceSubscriptionRepository,
        readChatStatus: async (location) => {
          const registry = await loadCanonicalActiveModel();
          return summarizeAssistantChatIdle(
            registry,
            { droneId: location.droneId, chatName: location.chatName },
            { requireChat: true },
          );
        },
        wakePromptQueue: (droneId, chatName) => {
          enqueuePendingPromptPump(droneId, chatName);
          notifyCanonicalPromptQueueChatWrite(droneId, chatName);
        },
        resolveChangeRequest: (requestNumber) =>
          getChangeRequestRepository().getByNumber(requestNumber),
        resolveChangeRequests: (requestNumbers) =>
          getChangeRequestRepository().getByNumbers(requestNumbers),
        authorizeDelivery: createResourceSubscriptionDeliveryAuthorizer({
          resolveChatResource: (resourceId) =>
            resourceSubscriptionRepository.resolveChatResource(resourceId),
          resolveChangeRequest: (requestNumber) =>
            getChangeRequestRepository().getByNumber(requestNumber),
          loadRegistry: loadCanonicalActiveModel,
        }),
        log: hubLog,
      })
    : null;
  if (resourceSubscriptionService) {
    releaseResourceSubscriptionRuntimePort = resourceSubscriptionRuntimePort.bind({
      pauseForDrone: async (droneId, chatIds) => {
        await resourceSubscriptionService.pauseForDrone(droneId, chatIds);
      },
      resumeForChat: async (chatId) => {
        await resourceSubscriptionService.resumeForChat(chatId);
      },
      resumeForDrone: async (droneId, chatIds) => {
        await resourceSubscriptionService.resumeForDrone(droneId, chatIds);
      },
    });
  }

  const apiRouter = new HubRouter(json, readJsonBody);

  registerSystemRoutes(apiRouter, {
    buildId: HUB_API_BUILD_ID,
    loadedAt: HUB_API_LOADED_AT,
    serverFilename: __filename,
    resolveSetupStatusResponse,
    readActiveProfileName,
    resolveHubSetupScopeKey,
    dismissWelcomeForScope,
  });

  registerSettingsRoutes(apiRouter, {
    resolveGroqApiKeySettings,
    resolveExaApiKeySettings,
    resolveEffectiveProviderApiKeySettings,
    logProviderApiKeyResolution,
    providerKeySettingsResponse,
    normalizeApiKey,
    upsertStoredProviderApiKey,
    clearStoredProviderApiKey,
    startCodexLogin,
    codexLoginStatus,
    cancelCodexLogin,
    resolveLlmSettingsResponse,
    parseLlmProvider,
    upsertStoredLlmProvider,
    resolveGithubSettingsResponse,
    hubSettings: hubApplication.settings,
    readManagedHubStateAtRootOrFallback,
    parseDroneDeleteMode,
    parseArchiveRetentionId,
    parseArchiveRuntimePolicy,
    upsertStoredDeleteActionSettings,
    resolveFilesystemSettingsResponse,
    parseFilesystemUploadMaxBytes,
    upsertStoredFilesystemSettings,
    resolveSpeechSettingsResponse,
    upsertStoredSpeechSettings,
    notifySpeechSettingsChanged: (speechSettings) => {
      assistantService.setSpeechToolEnabled(speechSettings.enabled);
      mcpHttpTransport.setSpeechEnabled(speechSettings.enabled);
      assistantService.emitExternalUiAction({
        type: 'speech_settings_changed',
        enabled: speechSettings.enabled,
        muted: speechSettings.muted,
        volume: speechSettings.volume,
        at: nowIso(),
      });
    },
    resolveVoiceInputSettingsResponse,
    upsertStoredVoiceInputSettings,
    FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
    FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
    resolveRegistryBackupStatusResponse,
    upsertStoredRegistryBackupSettings,
    createRegistryBackup,
    defaultAgentsPayload,
    normalizeAgentsMarkdown,
    upsertCanonicalDefaultAgentsConfig,
    resolveCanonicalAgentsLibraryFile,
    createCanonicalAgentsLibraryFile,
    updateCanonicalAgentsLibraryFile,
    deleteCanonicalAgentsLibraryFile,
    loadRegistry,
    syncSetService,
    parseSyncSetMutationInput,
    buildStoredSyncSet,
    ensureSyncSetSourceIsReadable,
    ensureHubManagedSyncSetSourceDir,
    removeHubManagedSyncSetSourceDir,
    nowIso,
    listProfilesState,
    createManagedProfile,
    useManagedProfile,
    renameManagedProfile,
    deleteManagedProfile,
    profileSettingsErrorStatus,
    apiToken,
    droneRootPath,
    resolveUserContextSettingsResponse,
    clampIntParam,
    readHubLogTail,
    HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES,
    HUB_SETTINGS_LOG_MAX_BYTES,
    HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES,
    HUB_SETTINGS_LOG_MAX_TAIL_LINES,
  });

  registerSidebarRoutes(apiRouter, sidebarCommands);

  registerCatalogRoutes(apiRouter, {
    mcpToken,
    upsertDroneHubMcpServerPreset,
  });

  registerMessageRoutes(apiRouter, {
    resolveNameSuggestionLlmSettings,
    logProviderApiKeyResolution,
    llmProviderEnvLogMeta,
    normalizeDroneIdentity,
    hubLog,
  });

  registerAssistantRoutes(apiRouter, {
    assistantService,
    blipAssistantHost,
    nowIso,
    writeAssistantSseEvent,
    resolveDroneOrPendingForReadRef,
    requireWhiteboardStore,
    submitAssistantPrompt,
    validateAssistantPromptImages,
    saveAssistantArtifactUploads,
    updateStoredUserTimeZone,
  });
  registerAgentRunDiffRoutes(apiRouter);
  const changeRequestFeature = registerChangeRequestFeature(apiRouter, {
    writeSseEvent: writeHubSseEvent,
    nowIso,
    resolveDrone: resolveDroneOrPendingForReadRef,
    withLockedDroneContainer,
    exportFullHeadBundleFromDrone,
    importBundleHeadToHostRef,
    createHostAuthoredMirrorCommit,
    updateHostRef,
    gitTopLevel,
    droneRepoBaseSha,
    dvmRepoHeadSha,
    runGitInDrone,
    runHostCommand,
    deleteHostRefBestEffort,
    storagePath: droneRootPath,
    now: nowIso,
    onGithubChanged: clearGithubPullRequestListCache,
    deliverEvent: async (event) => {
      await resourceSubscriptionService?.publishChangeRequest(event);
    },
    log: hubLog,
  });
  registerBackgroundResource('change request events', changeRequestFeature.stop);
  registerNativeChatRoutes(apiRouter, {
    nativeChatLifecycle,
    nativeChatHistoryPage: (threadId, input) => blipAssistantHost.historyPage(threadId, input),
    getChatEntry,
    inferChatAgent,
    resolveDroneOrPendingForReadRef,
  });

  registerWhiteboardRoutes(apiRouter, {
    nowIso,
    writeHubSseEvent,
    subscribeWhiteboardChanges,
    emitWhiteboardChange,
  });
  const stopWorkflowFeature = await registerWorkflowFeature(apiRouter, {
    nowIso,
    resolveDrone: resolveDroneOrPendingForReadRef,
    importDroneChats: importDroneChatsFromRegistry,
    createChat: createChatInStore,
    updateChat: updateChatInStore,
    readChat: readChatFromStore,
    listChats: listChatsFromStore,
    deleteChat: deleteChatFromStore,
    listArchivedChats: listArchivedChatsFromStore,
    deleteArchivedChat: deleteArchivedChatFromStore,
    projectChats: projectCanonicalChatsToRegistry,
    buildChatEntry: buildNewChatEntry,
    enqueuePrompt: createOrEnqueuePromptUnified,
    stopChatActivity: stopSingleDroneChatActivity,
    localApiRequest: callLocalHubApi,
    notifyChatWrite: notifyCanonicalPromptQueueChatWrite,
    notifyDroneWrite: notifyCanonicalDroneRegistryWrite,
    droneExists: async (droneId) => {
      const resolved = await resolveDroneOrPendingForReadRef(droneId);
      return resolved?.kind === 'real';
    },
    writeSseEvent: writeHubSseEvent,
  });
  registerBackgroundResource('workflows', async () => await stopWorkflowFeature?.());

  registerAgentModelCatalogRoutes(apiRouter, {
    normalizeBuiltinAgentId,
    nativeModelCatalog: async () => {
      const [snapshot, effectiveProvider] = await Promise.all([
        assistantService.defaultSettings(),
        resolveEffectiveLlmProvider(),
      ]);
      const provider = effectiveProvider.provider;
      const models = buildNativeModelCatalog(snapshot.models, snapshot.defaultModel, provider);
      const configuredDefault =
        snapshot.defaultModel.provider === provider
          ? snapshot.defaultModel
          : {
              provider,
              model: models[0]?.id ?? '',
              thinkingLevel: models[0]?.defaultReasoningLevel ?? '',
            };
      return {
        provider,
        defaultModel: configuredDefault,
        models,
      };
    },
    loadRegistry,
    droneRuntime,
    discoverModels: discoverAndRememberModelsForBuiltinAgent,
    hostAgentInstalled: isHostBuiltinAgentInstalled,
  });

  registerRepositoryRoutes(apiRouter, {
    loadRegistry,
    repositories: hubApplication.repositories,
    gitListRemoteBranches,
    removeCanonicalRepository,
    withCanonicalRepositories,
    repoEnvironmentPayload,
    normalizeEnvVarMap,
    nowIso,
    upsertCanonicalNonRepoEnvironmentConfig,
    updateCanonicalRepositoryEnvironment,
    repoAgentsPayload,
    normalizeRepoAgentsMode,
    normalizeAgentsMarkdown,
    updateCanonicalRepositoryAgents,
  });

  registerGroupRoutes(apiRouter, {
    groups: hubApplication.groups,
    nowIso,
  });

  registerOperationalRoutes(apiRouter, {
    resolveDroneOrPendingForReadRef,
    loadCanonicalActiveModel,
    summarizeAssistantChatIdle,
    resolveGroqApiKeySettings,
    resolveSpeechSettings: resolveEffectiveSpeechSettings,
    emitAssistantUiAction: (uiAction, threadId) =>
      assistantService.emitExternalUiAction(uiAction, threadId),
    hubLog,
  });

  registerResourceSubscriptionRoutes(apiRouter, resourceSubscriptionService);

  registerFleetRoutes(apiRouter, {
    fleet: hubApplication.fleet,
  });

  const handleDroneLifecycleRoute = createDroneLifecycleRouteHandler({
    archiveDroneById,
    archiveRetentionMs,
    cleanupExpiredArchivedChats,
    commitDroneMetadataPatch,
    deleteArchivedChatById,
    deleteCanonicalDroneLifecycle,
    deleteNativeChatSessionsForDrone: nativeChatRuntimePort.deleteSessions,
    dequeueProvisioning,
    droneEnvironmentPayload,
    droneRuntime,
    dvmBaseSet,
    dvmStop,
    enqueueProvisioning,
    findDroneIdByRef,
    hubLog,
    isDraftDroneEntry,
    listArchivedChatsFromStore,
    listCanonicalDroneLifecycleForRead,
    loadRegistry,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    normalizeArchiveRetention,
    normalizeArchiveRuntimePolicy,
    normalizeChatName,
    normalizeDisabledRepoKeys,
    normalizeDroneIdentity,
    normalizeDroneRuntime,
    normalizeEnvVarMap,
    nowIso,
    parseIsoToMs,
    readDroneChatCleanupProjectionFromStore,
    removeArchivedDroneById,
    removeDroneTreeById,
    renameDrone: renameDroneCommand,
    resolveArchiveDeleteAtIso,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveDeleteActionSettings,
    restoreArchivedChatById,
    restoreArchivedDroneById,
    revokeMcpAccessTokensForDrone,
    runDroneLifecycleAction,
    setDroneEnvironmentMetadata,
    setDroneGroup: hubApplication.groups.setDroneGroup,
    stopAllDroneChatActivity,
    triggerArchiveCleanup,
    withLockedDroneContainer,
  });

  const handleFilesystemRoute = createFilesystemRouteHandler({
    FS_EDITOR_MAX_BYTES,
    FS_LIST_TIMEOUT_MS,
    FS_MEDIA_MAX_BYTES,
    FS_QUICK_OPEN_MAX_RESULTS,
    FS_TEXT_CHUNK_MAX_BYTES,
    FS_THUMB_MAX_BYTES,
    NON_REPO_HOME_CWD,
    bufferLooksBinary,
    buildFsSearchScript,
    clampIntParam,
    defaultDroneHomeCwd,
    droneRuntime,
    dvmCopyFromContainer,
    dvmExec,
    dvmPorts,
    guessImageMimeType,
    guessVideoMimeType,
    handleFsActionRoute,
    handleFsUploadRoute,
    hostFsErrorStatus,
    hostMimeType,
    isLikelyImagePath,
    isLikelyTextMimeType,
    isLikelyVideoPath,
    listHostFsDirectory,
    looksLikeMissingContainerError,
    normalizeFsPathForRuntime,
    parseContainerFsListOutput,
    parseFsSearchOutput,
    readHostFileBytes,
    resolveDroneOrRespond,
    runHostCommand,
    withLockedDroneContainer,
    withReadonlyDroneContainer,
  });

  const localCheckoutService = new LocalCheckoutService({
    loadRegistry,
    updateRegistry,
    findDroneIdByRef,
    droneRuntime,
    droneRootPath,
    gitTopLevel,
    gitIsClean,
    gitResolveCommitSha,
    updateHostRef,
    importBundleHeadToHostRef,
    dvmExec,
    dvmRepoExport,
    runHostCommand,
    nowIso,
  });
  const handleLocalCheckoutRoute = createLocalCheckoutRouteHandler(localCheckoutService);

  const handleRepositoryRoute = createRepositoryRouteHandler({
    GITHUB_PULL_REQUEST_LIST_CACHE_TTL_MS,
    PULL_PREVIEW_HOST_MERGE_CACHE_TTL_MS,
    applyBranchMergeNoCommitToMainWorkingTree,
    attachReviewMetadataToPullEntries,
    buildReviewScopeId,
    clearGithubPullRequestListCache,
    closeGithubPullRequestForRepoRoot,
    commitDroneMetadataPatch,
    createHostAuthoredMirrorCommit,
    defaultRepoSeedTimeoutMs,
    deleteHostRefBestEffort,
    droneRepoBaseSha,
    droneRepoChangesSummary,
    droneRepoCommitDetails,
    droneRepoCommitDiffForPath,
    droneRepoCommitList,
    droneRepoDiffForPath,
    droneRepoPathInContainer,
    droneRepoPullChangesSummary,
    droneRepoPullDiffForPath,
    droneRootPath,
    droneRuntime,
    droneUnmergedFiles,
    dvmExec,
    dvmRepoExport,
    dvmRepoHeadSha,
    dvmRepoSeed,
    dvmRepoSetBaseSha,
    exportFullHeadBundleFromDrone,
    findDroneIdByRef,
    getGithubPullRequestCommitForRepoRoot,
    gitCurrentBranchOrSha,
    gitIsAncestor,
    gitIsClean,
    gitMergeBase,
    gitMergePreviewNameStatusEntries,
    gitRepoChangesSummary,
    gitRepoCommitDetails,
    gitRepoCommitDiffForPath,
    gitRepoCommitList,
    gitRepoDiffForPath,
    gitResolveCommitSha,
    gitTopLevel,
    githubPullRequestListCache,
    hubLog,
    importBundleHeadToDroneRef,
    importBundleHeadToHostRef,
    inspectGithubRepoForRepoRoot,
    isGithubPullRequestError,
    isRepoAttachedDrone,
    isRepoPatchApplyError,
    listGithubPullRequestChangesForRepoRoot,
    listGithubPullRequestCommitsForRepoRoot,
    listGithubPullRequestsForRepoRoot,
    loadRegistry,
    looksLikeBundleMissingPrerequisiteError,
    looksLikeEmptyBundleExportError,
    looksLikeMissingContainerError,
    looksLikeRepoUnavailableError,
    looksLikeUnrelatedHistoriesError,
    mergeGithubPullRequestForRepoRoot,
    nameStatusCharToType,
    normalizeGithubPullRequestListState,
    normalizeGithubPullRequestMergeMethod,
    nowIso,
    parseMergeConflictFilesFromText,
    parseShaFromText,
    pullPreviewHostMergeCache,
    reconcilePendingHostMirrorApply,
    repoBaseRefMatchesCurrentHostBranch,
    repoChangesScanCache,
    resolveDroneOrRespond,
    resolveLanguageDefinition,
    resolveLanguageReferences,
    createDroneDaemonGitRunner,
    createDroneDaemonWorktreeHasher,
    runGitInDrone,
    runGitInDroneOrThrow,
    runHostCommand,
    safeDroneRefSegment,
    setDroneHubMetaByIdentity,
    syncRepoAgentsInstructionsForDrone,
    updateHostRef,
    withLockedDroneContainer,
    withLockedDroneContainers,
  });

  const handleChatRoute = createChatRouteHandler({
    archiveChatById,
    attachmentOnlyPromptLabel,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    cancelQueuedPendingPrompt,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    cloneNativeChatSession: (input: {
      sourceId: string;
      sourceChatName: string;
      sourceProvider?: string;
      sourceModel?: string;
      sourceThinkingLevel?: string;
      targetId: string;
      droneId: string;
      chatName: string;
    }) => nativeChatLifecycle.clone({ ...input, id: input.targetId }),
    collectDockerSnapshotImageRefsFromChatEntry,
    createChatInStore,
    createDroneChat,
    createOrEnqueueNewChatAction,
    createOrEnqueuePromptUnified,
    createRequestTimer,
    defaultDaemonReadyTimeoutMs,
    deleteActiveChatFromStore,
    deleteNativeChatSession: (nativeChatId: string) => nativeChatLifecycle.delete(nativeChatId),
    discoverAndRememberModelsForBuiltinAgent,
    dockerSnapshotAfterAgentMessageEnabledForChat,
    droneRuntime,
    droneTerminalOutput,
    droneTerminalPrompt,
    dvmExec,
    dvmSessionRead,
    enqueuePendingPromptPump,
    ensureChatEntry,
    ensureHubChatSessionRunning,
    getChatEntry,
    hubChatSessionName,
    importDroneChatsFromRegistry,
    importResolvedChatToStore,
    importResolvedDroneChatsToStore,
    inferChatAgent,
    isManagedChatMcpAvailable,
    isDraftChatEntry,
    isSafePromptId,
    isStaleDockerExecErrorMessage,
    jsonWithEtag,
    jsonWithKnownEtag,
    listChatReadStatesFromStore,
    listChatsFromStore,
    listResourceSubscriptionsForChatId: (chatId: string) =>
      resourceSubscriptionService?.list(chatId, false) ?? [],
    logSlowHubRequest,
    markChatReadInStore,
    markChatUnreadInStore,
    migrateInMemoryChatStateForRename,
    nativeChatHasHistory: async (nativeChatId: string) => {
      if (await assistantService.nativeThreadHasHistory(nativeChatId)) return true;
      try {
        const history = await blipAssistantHost.historyPage(nativeChatId, { limit: 1 });
        return history.entries.length > 0;
      } catch {
        return false;
      }
    },
    normalizeAgentPermissionMode,
    normalizeAgentApprovalPolicy,
    normalizeBuiltinAgentId,
    normalizeChatImageAttachments,
    normalizeChatModel,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneIdentity,
    normalizePendingStartupPrompts,
    normalizeSubmittedAtIso,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseAgentApprovalPolicyForUpdate,
    parseChatModelForUpdate,
    parseChatReasoningForUpdate,
    parseChatNameForMutation,
    parseDraftFlag,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    promoteQueuedNewChatAction,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readChatFromStore,
    readChatReadStateFromStore,
    readChatSnapshot,
    resolveInterruptedPendingPrompt,
    removeDockerSnapshotImagesBestEffort,
    renameNativeChatSession: (input: { id: string; droneId: string; chatName: string }) =>
      nativeChatLifecycle.rename(input),
    renameChatInStore,
    resolveCanonicalDroneOrPendingForReadRef,
    resolveChatTmuxCommand,
    resolveCodexPromptApproval: (...args: any[]) =>
      promptRuntime.resolveCodexPromptApproval(...args),
    resolveDroneDaemonClientForEntry,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveDeleteActionSettings,
    restoreDockerSnapshotForTranscriptTurn,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
    stopChatResponse,
    stopSingleDroneChatActivity,
    updateStoredUserTimeZone,
    updateChatInStore,
    waitForDroneDaemonReady,
    withLockedDroneContainer,
  });

  const handleDroneProvisioningRoute = createDroneProvisioningRouteHandler({
    allocateUntitledDisplayName,
    assertReadOnlySupportedForAgent,
    buildAssistantDroneSummariesFromRegistry,
    buildDroneDockerSizeSummary,
    buildDroneRegistrySnapshot,
    canonicalRepositoriesMap,
    commitDroneMetadataPatch,
    createRequestTimer,
    deriveCanonicalCreatedDroneEnvironmentConfig,
    deriveCreatedDroneEnvironmentConfig,
    droneChatSseClients,
    droneChatSseLastByKey,
    droneDisplayNameExists,
    droneRegistrySseClients,
    enqueueProvisioning,
    ensureCanonicalGroup,
    resolveCanonicalGroupReference,
    findDroneEntryByIdentity,
    findDroneIdByRef,
    getDroneRegistrySseLastSnapshot: () => droneRegistryBroadcaster.snapshot,
    gitResolveRemoteBranchForCreate,
    isSafePromptId,
    loadCanonicalActiveModel,
    loadCanonicalLifecycleModel,
    loadRegistry,
    logSlowHubRequest,
    makeDroneIdentity,
    normalizeChatImageAttachments,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneDisplayName,
    normalizeDroneRuntime,
    normalizeSubmittedAtIso,
    notifyCanonicalDroneRegistryWrite,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseAgentApprovalPolicyForUpdate,
    parseChatModelForUpdate,
    parseCreateRuntime,
    parseDraftFlag,
    parsePersistVolume,
    parseRemoteBranchName,
    parseRepoBranchSourceMode,
    parseSeedAgent,
    refreshDroneChatEventSnapshot,
    refreshDroneRegistryBroadcasterSnapshot,
    resolveDroneOrRespond,
    resolveEffectiveLlmProvider,
    resolveStableDroneOrPendingIdFromRef,
    scheduleDroneRegistryBroadcasterRefresh,
    scheduleDroneStatusRefresh,
    setFleetActorConfig,
    startDroneChatBroadcaster,
    startDroneRegistryBroadcaster,
    stopDroneChatBroadcasterIfIdle,
    stopDroneRegistryBroadcasterIfIdle,
    upsertCanonicalDroneLifecycle,
    upsertCanonicalDroneLifecycleBatch,
    writeHubSseEvent,
  });

  const handleTerminalRoute = createTerminalRouteHandler({
    HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
    HUB_WEB_TERMINAL_MAX_BYTES,
    HUB_WEB_TERMINAL_MAX_TAIL_LINES,
    buildContainerManagedEnvLines,
    buildDockerExecShellCommand,
    buildDockerExecTmuxAttachCommand,
    buildEnvExportLines,
    clampIntParam,
    defaultDaemonReadyTimeoutMs,
    droneRuntime,
    droneTerminalInput,
    droneTerminalOutput,
    dvmExec,
    dvmSessionRead,
    dvmSessionStart,
    dvmSessionType,
    ensureChatEntry,
    ensureHubChatSessionRunning,
    ensureHubSessionRunning,
    isSafeTmuxSessionName,
    isStaleDockerExecErrorMessage,
    loadRegistry,
    normalizeChatName,
    normalizeDroneIdentity,
    normalizeDroneUiCwdForRuntime,
    parseOptionalNonNegativeInt,
    procStart,
    procStop,
    resolveChatTmuxCommand,
    resolveContainerManagedEnvVars,
    resolveDroneDaemonClientForEntry,
    resolveDroneEnvironmentConfig,
    resolveDroneOrRespond,
    resolveHostTerminalShellCommand,
    resolveHubAgentCommand,
    resolveHubTerminalShellCommand,
    spawnTerminalWithBash,
    syncMcpServersForDrone,
    syncRepoAgentsInstructionsForDrone,
    syncSkillLibraryForDrone,
    upgradeDroneDaemonInContainer,
    waitForDroneDaemonReady,
    withLockedDroneContainer,
  });

  const handleEditorRoute = createEditorRouteHandler({
    dockerContainerId,
    droneRuntime,
    normalizeDroneUiCwdForRuntime,
    resolveDroneOrRespond,
  });

  const handleHubHttpRequest: http.RequestListener = async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      if (prepareHubHttpRequest(req, res, allowedOrigins, json)) return;

      const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const pathname = u.pathname;
      if (await deviceMesh.handleHttp(req, res, u)) return;
      if (pathname === '/mcp') {
        await handleDroneHubMcpRequest(req, res, method);
        return;
      }

      if (
        rejectUnauthorizedHubApiRequest({ req, res, url: u, apiToken, log: hubLog, respond: json })
      )
        return;

      if (await apiRouter.handle(req, res, u)) return;

      const parts = pathname.split('/').filter(Boolean);

      if (await handleDroneProvisioningRoute({ req, res, url: u, method, parts })) return;

      if (await handleFilesystemRoute({ req, res, url: u, method, parts })) return;

      if (await handleLocalCheckoutRoute({ req, res, url: u, method, parts })) return;

      if (await handleRepositoryRoute({ req, res, url: u, method, parts })) return;

      if (await handleDroneLifecycleRoute({ req, res, url: u, method, parts })) return;

      if (await handleTerminalRoute({ req, res, url: u, method, parts })) return;

      if (await handleEditorRoute({ req, res, url: u, method, parts })) return;

      if (await handleChatRoute({ req, res, url: u, method, parts })) return;

      if (pathname.startsWith('/api/')) {
        hubLog('warn', 'api route not found', {
          method,
          path: pathname,
          query: u.search || '',
        });
      }
      json(res, 404, { ok: false, error: 'not found' });
    } catch (error) {
      handleHubRequestFailure({ req, res, error, log: hubLog, respond: json });
    }
  };
  const handleHubUpgrade = createTerminalWebSocketUpgradeHandler({
    apiToken,
    allowedOrigins,
    webSocketServer: wss,
    handleDeviceMeshUpgrade: (req, socket, head) => deviceMesh.handleUpgrade(req, socket, head),
    isSafeSessionName: isSafeTmuxSessionName,
    parseSince: parseOptionalNonNegativeInt,
    parseMaxBytes: (raw) =>
      clampIntParam(raw, HUB_WEB_TERMINAL_MAX_BYTES, 1, HUB_WEB_TERMINAL_MAX_BYTES),
    resolveDrone: resolveDroneOrRejectUpgrade,
    resolveHostPort,
  });

  const handleContainerMcpRequest: http.RequestListener = async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase();
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/mcp') {
        json(res, 404, { ok: false, error: 'not found' });
        return;
      }
      await handleDroneHubMcpRequest(req, res, method);
    } catch (error: any) {
      hubLog('warn', 'container mcp request failed', {
        error: String(error?.message ?? error ?? ''),
      });
      if (!res.headersSent && !res.writableEnded) {
        json(res, 500, { ok: false, error: error?.message ?? String(error) });
      }
    }
  };

  const httpTransport = await startHubHttpTransport({
    host,
    port: opts.port,
    requestListener: handleHubHttpRequest,
    upgradeListener: handleHubUpgrade,
    webSocketServer: wss,
    ...(mcpToken && containerMcpHost && containerMcpPort > 0
      ? {
          containerMcp: {
            host: containerMcpHost,
            port: Math.floor(containerMcpPort),
            requestedUrl: containerMcpRequestedUrl,
            requestListener: handleContainerMcpRequest,
          },
        }
      : {}),
  });
  actualPort = httpTransport.port;
  registerBackgroundResource('HTTP transport', httpTransport.close);
  releaseMcpProjectionConfig = bindMcpProjectionConfig({
    signingSecret: mcpToken,
    hostUrl: `http://127.0.0.1:${actualPort}/mcp`,
    containerUrl:
      httpTransport.containerMcp?.url || `http://host.docker.internal:${actualPort}/mcp`,
  });
  const outboxDatabase = getHubDatabase();
  const hubOutboxDispatchLoop = outboxDatabase
    ? new HubOutboxDispatchLoop(
        new HubOutboxDispatcher(new HubOutboxRepository(outboxDatabase), async (event) => {
          if (await changeRequestFeature.handleOutboxEvent(event)) return;
          // Canonical transactions only enqueue. Projection/SSE effects happen here,
          // after claim commit, and are coalesced by the existing refresh scheduler.
          hubChangeEvents.emitRegistryWrite();
        }),
        {
          intervalMs: 500,
          batchSize: 25,
          onError: (error) =>
            hubLog('warn', 'hub outbox dispatch failed', {
              error: error instanceof Error ? error.message : String(error),
            }),
        },
      )
    : null;
  hubOutboxDispatchLoop?.start();
  registerBackgroundResource('hub outbox', async () => await hubOutboxDispatchLoop?.stop());
  await resourceSubscriptionService?.start();
  registerBackgroundResource(
    'resource subscriptions',
    async () => await resourceSubscriptionService?.stop(),
  );
  void auditStartupRegistryPresence();
  droneStatusRuntime.start();
  droneSummaryMaintenanceStopped = false;
  scheduleDroneSummaryMaintenance('startup', 0);
  registerBackgroundResource('drone status refresh', async () => {
    droneSummaryMaintenanceStopped = true;
    await droneStatusRuntime.stop();
    if (droneSummaryMaintenanceTimeout) clearTimeout(droneSummaryMaintenanceTimeout);
    droneSummaryMaintenanceTimeout = null;
    await droneSummaryMaintenanceTask?.catch(() => {});
  });
  registerBackgroundResource('device mesh', async () => await deviceMesh.close());
  await deviceMesh.start();
  registerBackgroundResource('HTTP ingress', async () => httpTransport.stopAccepting());
  if (httpTransport.containerMcp) {
    hubLog('info', 'container mcp listener started', {
      host: httpTransport.containerMcp.host,
      port: httpTransport.containerMcp.port,
      url: httpTransport.containerMcp.url,
    });
  }
  return {
    host,
    port: actualPort,
    containerMcp: httpTransport.containerMcp,
    close: async () => {
      httpTransport.stopAccepting();
      cancelCodexLogin();
      await stopBackgroundResources();
    },
  };
}
