import http from 'node:http';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { URL } from 'node:url';

import { WebSocket } from 'ws';
import { BaseConfigManager } from 'dvm';

import { ensureContainerDroneDaemonSession } from '../host/container-daemon';
import { getFleetWorkflowStore, type FleetWorkflowStore } from '../host/fleet-workflow-store';
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
  loadRegistryCompatibilityBase,
  updateRegistry as updateHostRegistry,
} from '../host/registry';
import { getCatalogStore, type CatalogPlaybookRecord } from '../host/catalog-store';
import {
  createRegistryBackup,
  resolveRegistryBackupStatusResponse,
  startRegistryBackupScheduler,
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
  procStart,
  procStop,
  promptEnqueue as dronePromptEnqueue,
  promptCancel as dronePromptCancel,
  promptGet as dronePromptGet,
  status as droneStatus,
  terminalInput as droneTerminalInput,
  terminalOutput as droneTerminalOutput,
  terminalPrompt as droneTerminalPrompt,
} from '../host/api';
import { suggestDroneNameFromMessage } from './jobs-from-message';
import { buildAutoRenamedChatCandidate, isGeneratedChatName } from './chat-auto-rename';
import type {
  AgentPermissionMode,
  BuiltinAgentId,
  ChatAgentConfig,
  PromptAutomationStopMode,
} from './chat-types';
import { createDeviceMeshService } from './device-mesh';
import {
  PromptAutomationManager,
  type PromptAutomationJobState,
  type PromptAutomationLaneState,
} from './prompt-automation-manager';
import { PromptAutomationBroadcaster } from './prompt-automation-broadcaster';
import { PendingPromptPump } from './pending-prompt-pump';
import { PromptAutomationService } from './prompt-automation-service';
import {
  canonicalRepositoriesMap,
  ensureCanonicalGroup,
  listCanonicalGroups,
  listCanonicalRepositories,
  registerCanonicalRepository,
  removeCanonicalRepository,
  updateCanonicalRepositoryAgents,
  updateCanonicalRepositoryEnvironment,
} from './groups-repositories';
import {
  deleteCanonicalGroupArtifacts,
  renameCanonicalGroupOrchestration,
} from './group-orchestration';
import {
  classifyAgentMessageAutoContinue,
  type AgentMessageAutoContinueClassification,
} from './agent-message-auto-continue';
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
  listChatsFromStore,
  markChatReadInStore,
  markChatUnreadInStore,
  patchChatMetadataInStore,
  readChatFromStore,
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
import {
  extractAgentCopilotFromAgentMessage,
  type AgentCopilotRequest,
} from './agent-copilot-parser';
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
import { normalizeAgentPlan, sameAgentPlan, type AgentPlan } from './agent-plan';
import {
  normalizeAgentsMarkdown,
  normalizeRepoAgentsMode,
  resolveCanonicalDefaultAgentsConfig,
  resolveCanonicalRepoAgentsConfig,
  resolveRepoAgentsConfig,
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
  hasActivePriorPendingPrompt,
  looksLikeTransientPromptEnqueueError,
  shouldDeferQueuedPendingPrompt,
  shouldDeferQueuedTranscriptPrompt,
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
  gitPullHostBranchBeforeCreate,
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
  isHostRepoPullBeforeCreateError,
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
import { ChatReconciliationQueue } from './chat-reconciliation-queue';
import { createChatReconciliationExecutor } from './chat-reconciliation-executor';
import { AgentFollowupCoordinator } from './agent-followup-coordinator';
import { ChatStateMaintenanceScheduler } from './chat-state-maintenance';
import { DaemonPromptEventMonitor } from './daemon-prompt-event-monitor';
import { createAssistantFilesystemService } from './assistant-filesystem-service';
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
import { DroneRegistryBroadcaster } from './drone-registry-broadcaster';
import { createTerminalWebSocketServer } from './terminal-websocket-server';
import { createTerminalWebSocketUpgradeHandler } from './terminal-websocket-upgrade';
import { registerAssistantRoutes } from './routes/assistant-routes';
import { registerCatalogRoutes } from './routes/catalog-routes';
import { createChatAutomationRouteHandler } from './routes/chat-automation-routes';
import { createDroneLifecycleRouteHandler } from './routes/drone-lifecycle-routes';
import { createDroneProvisioningRouteHandler } from './routes/drone-provisioning-routes';
import { createFilesystemRouteHandler } from './routes/filesystem-routes';
import { registerFleetRoutes } from './routes/fleet-routes';
import { registerGroupRoutes } from './routes/group-routes';
import { registerMessageRoutes } from './routes/message-routes';
import { registerOperationalRoutes } from './routes/operational-routes';
import { registerPlaybookRoutes } from './routes/playbook-routes';
import { createRepositoryRouteHandler } from './routes/repository-operation-routes';
import { registerRepositoryRoutes } from './routes/repository-routes';
import { registerSettingsRoutes } from './routes/settings-routes';
import { registerSystemRoutes } from './routes/system-routes';
import { registerWhiteboardRoutes } from './routes/whiteboard-routes';
import { DroneHubMcpHttpTransport } from './mcp-http-transport';
import {
  assertDroneDaemonRuntimeReady,
  resolveDroneDaemonRuntimeDir,
} from './drone-daemon-runtime';
import {
  createHubShellSessionName,
  hubChatSessionName,
  hubShellSessionName,
  isHubShellSessionName,
  isHubWebTerminalSessionName,
  shouldAwaitTerminalSkillSync,
  type HubWebTerminalMode,
} from './terminal-open';
import {
  buildChatAttachmentsDirectory,
  buildChatImageAttachmentRefs,
  codexImageAttachmentFlags,
  copyChatAttachmentsToContainer,
  normalizeChatImageAttachments,
  promptWithImageAttachments,
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
  clearStoredProviderApiKey,
  collectProviderApiKeyDiagnostics,
  FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
  FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
  normalizeAgentMessageAutoContinuePrompt,
  normalizeAgentSuggestionPolicyMarkdown,
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
  resolveAgentMessageAutoContinueSettingsResponse,
  resolveAgentSuggestionSettingsResponse,
  resolveEffectiveAgentMessageAutoContinueSettings,
  resolveEffectiveAgentSuggestionSettings,
  resolveDeleteActionSettingsResponse,
  resolveEffectiveFilesystemSettings,
  resolveEffectiveDeleteActionSettings,
  resolveEffectiveLlmProvider,
  resolveFilesystemSettingsResponse,
  resolveEffectiveProviderApiKeySettings,
  resolveNameSuggestionLlmSettings,
  resolveExaApiKeySettings,
  resolveGroqApiKeySettings,
  resolveLlmSettingsResponse,
  resolveUiPreferencesSettingsResponse,
  upsertStoredDeleteActionSettings,
  upsertStoredFilesystemSettings,
  upsertStoredAgentMessageAutoContinueSettings,
  upsertStoredAgentSuggestionSettings,
  upsertStoredLlmProvider,
  upsertStoredProviderApiKey,
  upsertStoredUiPreferencesSettings,
  type ArchiveRetentionId,
  type ArchiveRuntimePolicy,
  type LlmProviderId,
  type StoredApiKeyProviderId,
  type UiPreferencesSettings,
} from './hub-settings';
import {
  createSkill,
  deleteSkillRecord,
  getSkillById,
  listSkills,
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
  type McpServerRecord,
  syncMcpServersToContainerTargets,
  syncMcpServersToHostTargets,
  type McpProjectionTarget,
  updateMcpServerRecord,
} from './mcp-servers';
import {
  createMcpAccessToken,
  ensureDroneMcpAccessToken,
  ensureHostMcpAccessToken,
  getMcpAccessTokenById,
  listMcpAccessTokens,
  regenerateMcpAccessToken,
  revokeMcpAccessToken,
  revokeMcpAccessTokensForDrone,
} from './mcp-tokens';
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
  listCanonicalDroneLifecycle,
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
import { readCanonicalActiveDroneModel } from './canonical-drone-read-model';
import {
  commitDroneMetadataPatch,
  renameDroneDisplayName,
  setDroneEnvironmentMetadata,
  setDroneGroupMetadata,
  setDronePresentationMetadata,
  updateDroneFleetMetadata,
} from './drone-metadata-commands';
import {
  createPendingDroneStateHelpers,
  type PendingPhase,
  type PendingPromptState,
  type PendingStartupPrompt,
} from './drone-pending-state';
import { createDronePendingPromptStore, type PendingPrompt } from './drone-pending-prompts';
import { createDroneProvisioningController } from './drone-provisioning';
import {
  HubAssistantService,
  summarizeAssistantChatIdle,
  type AssistantDroneSummary,
} from './assistant';
import { BlipAssistantHost } from './assistant/blip-assistant-host';
import { loadBlipMcp, loadBlipTools } from './assistant/blip-runtime-loader';
import { createInProcessDroneHubMcpClient } from './assistant/in-process-drone-hub-mcp';
import { AssistantArtifactsTarget } from './assistant/targets/assistant-artifacts-target';
import { DroneWorkspaceTarget } from './assistant/targets/workspace-targets';
import { saveAssistantArtifactUploads, validateAssistantPromptImages } from './assistant-artifacts';
import { fetchContent, searchWeb } from './web-search';

const HUB_API_LOADED_AT = new Date().toISOString();
const HUB_API_BUILD_ID = crypto.randomBytes(6).toString('hex');
const requireForHub = createRequire(__filename);

let notifyDroneRegistryWrite: (() => void) | null = null;
let notifyDroneChatWrite: ((droneId: string, chatName: string) => void) | null = null;
let notifyPromptAutomationLaneChange: ((droneId: string, chatName: string) => void) | null = null;

async function updateRegistry<T>(
  mutator: (reg: any) => T | Promise<T>,
  opts?: { timeoutMs?: number; staleAfterMs?: number },
): Promise<T> {
  const result = await updateHostRegistry(mutator as any, opts as any);
  notifyDroneRegistryWrite?.();
  return result as T;
}

const HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES = 600;
const HUB_SETTINGS_LOG_MAX_TAIL_LINES = 5000;
const HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES = 200_000;
const HUB_SETTINGS_LOG_MAX_BYTES = 1_000_000;

function normalizeApiKey(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

function parsePullHostBranchBeforeCreate(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw;
  if (raw == null) return true;
  if (typeof raw === 'number') return raw !== 0;
  const value = String(raw).trim().toLowerCase();
  if (!value) return true;
  if (value === '0' || value === 'false' || value === 'no' || value === 'off') return false;
  if (value === '1' || value === 'true' || value === 'yes' || value === 'on') return true;
  return true;
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

function formatPullHostBranchBeforeCreateError(error: unknown): {
  status: number;
  message: string;
  reason: string;
} {
  if (isHostRepoPullBeforeCreateError(error)) {
    switch (error.code) {
      case 'not_repo':
      case 'detached_head':
      case 'missing_upstream':
      case 'pull_non_fast_forward':
      case 'pull_failed':
        return {
          status: 409,
          message: error.message,
          reason: error.code,
        };
      default:
        break;
    }
  }
  const fallback = String((error as any)?.message ?? error ?? '').trim();
  return {
    status: 500,
    message: fallback || 'failed to pull host branch before create',
    reason: 'unknown',
  };
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
  const droneCount = Object.keys(dronesObj).length;
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
  return {
    ok: true as const,
    agents: {
      content: agents.content,
      enabled: agents.enabled,
      updatedAt: agents.updatedAt,
    },
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

const PLAYBOOK_RUN_QUEUE_INTERVAL_MS = 1500;
let PLAYBOOK_RUN_QUEUE_INTERVAL: ReturnType<typeof setInterval> | null = null;
let PLAYBOOK_RUN_QUEUE_BUSY = false;
const PROMPT_SKILL_SYNC_WARNINGS = new Set<string>();

async function workflowStoreOrCompatibility(): Promise<FleetWorkflowStore | null> {
  try {
    return await getFleetWorkflowStore();
  } catch (error) {
    if ((globalThis as any).Bun) return null;
    throw error;
  }
}

async function runPlaybookRunQueueCycle(): Promise<void> {
  if (PLAYBOOK_RUN_QUEUE_BUSY) return;
  PLAYBOOK_RUN_QUEUE_BUSY = true;
  try {
    await drainPlaybookRunLaunchQueue();
  } finally {
    PLAYBOOK_RUN_QUEUE_BUSY = false;
  }
}

function fleetError(message: string, status: number = 400): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

async function handleFsUploadRoute(opts: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  u: URL;
  resolved: ResolvedDrone;
  droneRef: string;
}): Promise<void> {
  const { req, res, u, resolved, droneRef } = opts;
  const droneId = resolved.id;
  const droneName = String(resolved.drone?.name ?? droneRef).trim() || droneRef;
  const runtime = droneRuntime(resolved.drone);
  const fail = (statusCode: number, message: string) => {
    const err = new Error(message) as Error & { statusCode?: number };
    err.statusCode = statusCode;
    return err;
  };
  const { uploadMaxBytes: fsUploadMaxBytes } = await resolveEffectiveFilesystemSettings();
  const headerValue = (name: string): string => {
    const raw = req.headers[name.toLowerCase()];
    if (Array.isArray(raw)) return String(raw[0] ?? '').trim();
    return String(raw ?? '').trim();
  };
  const failFileTooLarge = (sizeBytes: number) =>
    fail(
      413,
      `file too large (${sizeBytes} bytes, max ${fsUploadMaxBytes}). Increase "Upload max file size" in Settings.`,
    );
  const normalizeUploadFileName = (raw: string): string =>
    path.posix
      .basename(raw)
      .replace(/[\0\r\n\t]/g, '')
      .replace(/[\/\\]+/g, '')
      .trim();
  const decodeUploadNameHeader = (): string => {
    const encoded = headerValue('x-upload-name');
    if (!encoded) return '';
    try {
      return decodeURIComponent(encoded);
    } catch {
      throw fail(400, 'invalid x-upload-name header');
    }
  };
  const writeUploadStreamToTmpPath = async (tmpPath: string): Promise<void> => {
    const fh = await fs.open(tmpPath, 'w');
    try {
      let total = 0;
      for await (const chunkRaw of req) {
        const chunk = Buffer.isBuffer(chunkRaw) ? chunkRaw : Buffer.from(chunkRaw as any);
        total += chunk.length;
        if (total > fsUploadMaxBytes) throw failFileTooLarge(total);
        await fh.write(chunk);
      }
      await fh.sync();
    } finally {
      await fh.close();
    }
  };
  const copyTmpFileToRuntimeAndReadMeta = async (opts: {
    tmpPath: string;
    targetDir: string;
    fileName: string;
  }): Promise<{
    path: string;
    size: number;
    mtimeMs: number | null;
  }> => {
    const { tmpPath, targetDir, fileName } = opts;
    if (runtime === 'host') {
      const hostTargetDir = path.resolve(
        String(targetDir ?? '').trim() || normalizeDroneCwdForRuntime(resolved.drone, null),
      );
      const preflight = await fs.stat(hostTargetDir);
      if (!preflight.isDirectory()) throw fail(404, `path is not a directory: ${hostTargetDir}`);
      const hostTargetPath = path.join(hostTargetDir, fileName);
      await fs.copyFile(tmpPath, hostTargetPath);
      const st = await fs.stat(hostTargetPath);
      if (!st.isFile()) throw fail(404, `uploaded file not found: ${hostTargetPath}`);
      return {
        path: path.resolve(hostTargetPath),
        size: Number.isFinite(st.size) ? Math.max(0, Math.floor(st.size)) : 0,
        mtimeMs: Number.isFinite(st.mtimeMs) ? Math.max(0, Math.floor(st.mtimeMs)) : null,
      };
    }
    return await withLockedDroneContainer(
      { requestedDroneName: droneName, droneEntry: resolved.drone },
      async ({ containerName }) => {
        const preflightScript = [
          'set -euo pipefail',
          `target_dir=${bashQuote(targetDir)}`,
          'if [ ! -d "$target_dir" ]; then',
          '  echo "__ERR__\tnot-dir"',
          '  exit 3',
          'fi',
        ].join('\n');
        const preflight = await dvmExec(containerName, 'bash', ['-lc', preflightScript]);
        if (preflight.code !== 0) {
          const out = `${String(preflight.stdout ?? '')}\n${String(preflight.stderr ?? '')}`;
          if (/\bnot-dir\b/i.test(out)) throw fail(404, `path is not a directory: ${targetDir}`);
          throw new Error(
            (preflight.stderr || preflight.stdout || 'failed checking upload path').trim(),
          );
        }

        await dvmCopyToContainer(containerName, tmpPath, targetDir);

        const targetPath = normalizeContainerPath(path.posix.join(targetDir, fileName));
        const statScript = [
          'set -euo pipefail',
          `target=${bashQuote(targetPath)}`,
          'if [ ! -f "$target" ]; then',
          '  echo "__ERR__\tnot-file"',
          '  exit 3',
          'fi',
          'size=$(stat -c %s -- "$target" 2>/dev/null || echo 0)',
          'mtime=$(stat -c %Y -- "$target" 2>/dev/null || echo 0)',
          'printf "__META__\t%s\t%s\n" "$size" "$mtime"',
        ].join('\n');
        const statOut = await dvmExec(containerName, 'bash', ['-lc', statScript]);
        if (statOut.code !== 0) {
          const out = `${String(statOut.stdout ?? '')}\n${String(statOut.stderr ?? '')}`;
          if (/\bnot-file\b/i.test(out)) throw fail(404, `uploaded file not found: ${targetPath}`);
          throw new Error(
            (statOut.stderr || statOut.stdout || 'failed reading uploaded file metadata').trim(),
          );
        }
        const line = String(statOut.stdout ?? '').trim();
        const parts = line.split('\t');
        const sizeNum = Number(parts[1] ?? 0);
        const mtimeSec = Number(parts[2] ?? 0);
        return {
          path: targetPath,
          size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : 0,
          mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
        };
      },
    );
  };
  const respondUploadSuccess = (result: { path: string; size: number; mtimeMs: number | null }) => {
    json(res, 200, {
      ok: true,
      id: droneId,
      name: droneName,
      path: result.path,
      size: result.size,
      mtimeMs: result.mtimeMs,
    });
  };

  const contentType = headerValue('content-type').toLowerCase();
  const isJsonUpload = contentType.includes('application/json');
  let targetDir = normalizeFsPathForRuntime(resolved.drone, u.searchParams.get('path') ?? '', {
    fallbackToHome: true,
  });
  let fileNameRaw = String(u.searchParams.get('name') ?? '').trim();

  const tmpDir = path.join(
    os.tmpdir(),
    `drone-hub-fs-upload-${process.pid}-${Date.now()}-${crypto.randomBytes(6).toString('hex')}`,
  );

  try {
    if (isJsonUpload) {
      let body: any = null;
      try {
        body = await readJsonBody(req);
      } catch (e: any) {
        throw fail(400, e?.message ?? String(e));
      }
      if (!targetDir)
        targetDir = normalizeFsPathForRuntime(resolved.drone, body?.path ?? '', {
          fallbackToHome: true,
        });
      if (!fileNameRaw) fileNameRaw = String(body?.name ?? '').trim();
      if (typeof body?.dataBase64 !== 'string') throw fail(400, 'dataBase64 must be a string');
      const dataBase64 = String(body?.dataBase64 ?? '').replace(/\s+/g, '');
      if (
        dataBase64.length > 0 &&
        (!/^[A-Za-z0-9+/=]+$/.test(dataBase64) || dataBase64.length % 4 !== 0)
      ) {
        throw fail(400, 'invalid base64 payload');
      }
      let bytes: Buffer;
      try {
        bytes = Buffer.from(dataBase64, 'base64');
      } catch {
        throw fail(400, 'invalid base64 payload');
      }
      if (bytes.length > fsUploadMaxBytes) throw failFileTooLarge(bytes.length);
      const fileName = normalizeUploadFileName(fileNameRaw);
      if (!targetDir) throw fail(400, 'missing directory path');
      if (!fileName || fileName === '.' || fileName === '..') throw fail(400, 'invalid file name');
      const tmpPath = path.join(tmpDir, fileName);
      await fs.mkdir(tmpDir, { recursive: true });
      await fs.writeFile(tmpPath, bytes);
      const result = await copyTmpFileToRuntimeAndReadMeta({ tmpPath, targetDir, fileName });
      respondUploadSuccess(result);
      return;
    }

    if (!targetDir)
      targetDir = normalizeFsPathForRuntime(resolved.drone, headerValue('x-upload-path'), {
        fallbackToHome: true,
      });
    if (!fileNameRaw) fileNameRaw = decodeUploadNameHeader();
    const fileName = normalizeUploadFileName(fileNameRaw);
    if (!targetDir) throw fail(400, 'missing directory path');
    if (!fileName || fileName === '.' || fileName === '..') throw fail(400, 'invalid file name');
    const tmpPath = path.join(tmpDir, fileName);
    await fs.mkdir(tmpDir, { recursive: true });
    await writeUploadStreamToTmpPath(tmpPath);
    const result = await copyTmpFileToRuntimeAndReadMeta({ tmpPath, targetDir, fileName });
    respondUploadSuccess(result);
    return;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const explicitStatus = Number((e as any)?.statusCode ?? 0);
    const code =
      explicitStatus > 0
        ? explicitStatus
        : runtime === 'host'
          ? hostFsErrorStatus(e)
          : looksLikeMissingContainerError(msg)
            ? 404
            : 500;
    json(res, code, {
      ok: false,
      error: msg,
      id: droneId,
      name: droneName,
      path: targetDir || undefined,
    });
    return;
  } finally {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup failures
    }
  }
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

let activeDroneHubMcpProjectionConfig: ActiveDroneHubMcpProjectionConfig | null = null;

function setActiveDroneHubMcpProjectionConfig(config: ActiveDroneHubMcpProjectionConfig): void {
  activeDroneHubMcpProjectionConfig = config;
}

function isDroneHubMcpServer(server: McpServerRecord): boolean {
  return server.name === 'drone-hub' && server.transport === 'http';
}

async function mcpServersForProjection(opts: {
  runtime: 'host' | 'container';
  droneId?: string;
  droneEntry?: any;
}): Promise<McpServerRecord[]> {
  const servers = await listMcpServers();
  const config = activeDroneHubMcpProjectionConfig;
  if (!config) return servers;
  const out: McpServerRecord[] = [];
  for (const server of servers) {
    if (!isDroneHubMcpServer(server)) {
      out.push(server);
      continue;
    }
    const next: McpServerRecord = {
      ...server,
      url: opts.runtime === 'container' ? config.containerUrl : config.hostUrl,
    };
    if (opts.runtime === 'container' && server.enabled !== false) {
      const token = await ensureDroneMcpAccessToken({
        droneId: opts.droneId ?? '',
        droneName: String(opts.droneEntry?.name ?? opts.droneId ?? '').trim() || opts.droneId,
        signingSecret: config.signingSecret,
      });
      next.headers = {
        ...(server.headers ?? {}),
        Authorization: `Bearer ${token.tokenValue}`,
      };
    }
    out.push(next);
  }
  return out;
}

async function syncSkillLibraryForDrone(opts: { droneId: string; droneEntry: any }): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const droneEntry = opts.droneEntry;
  if (!droneId || !droneEntry) return;
  const runtime = droneRuntime(droneEntry);
  if (runtime === 'host') {
    await syncSkillLibraryToHostTargets({ targets: buildHostSkillProjectionTargets(droneEntry) });
    return;
  }
  const requestedDroneName = String((droneEntry as any)?.name ?? droneId).trim() || droneId;
  await withLockedDroneContainer({ requestedDroneName, droneEntry }, async ({ containerName }) => {
    await syncSkillLibraryToContainerTargets({
      containerName,
      targets: buildContainerSkillProjectionTargets(droneEntry),
    });
  });
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
  await withLockedDroneContainer({ requestedDroneName, droneEntry }, async ({ containerName }) => {
    await syncMcpServersToContainerTargets({
      containerName,
      targets: buildContainerMcpProjectionTargets(droneEntry),
      servers: await mcpServersForProjection({ runtime: 'container', droneId, droneEntry }),
    });
  });
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

  const regAny: any = await loadRegistry();
  const repoAgents = await resolveCanonicalRepoAgentsConfig(regAny, (droneEntry as any)?.repoPath);
  const effectiveContent = repoAgents.effectiveContent;
  if (!effectiveContent) return;

  const requestedDroneName = String((droneEntry as any)?.name ?? droneId).trim() || droneId;
  const repoRoot = droneRepoPathInContainer(droneEntry);
  const targetPath = path.posix.join(repoRoot, 'AGENTS.md');

  await withLockedDroneContainer({ requestedDroneName, droneEntry }, async ({ containerName }) => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'drone-agents-sync-'));
    try {
      const localPath = path.join(tempRoot, 'AGENTS.md');
      await fs.writeFile(localPath, effectiveContent, 'utf8');
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
});

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


function normalizeFsPathForRuntime(
  drone: any,
  raw: unknown,
  opts?: { fallbackToHome?: boolean },
): string {
  const runtime = droneRuntime(drone);
  if (runtime === 'host') {
    const text = typeof raw === 'string' ? String(raw).trim() : '';
    if (!text && opts?.fallbackToHome === false) return '';
    return normalizeDroneCwdForRuntime(drone, text || null);
  }
  const text = typeof raw === 'string' ? String(raw) : '';
  return normalizeContainerPath(text || '/');
}

function hostFsErrorStatus(error: unknown): number {
  const code = String((error as any)?.code ?? '')
    .trim()
    .toUpperCase();
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  return 500;
}

async function hostMimeType(pathRaw: string): Promise<string | null> {
  const targetPath = String(pathRaw ?? '').trim();
  if (!targetPath) return null;
  try {
    const r = await runHostCommand('file', ['-Lb', '--mime-type', '--', targetPath], {
      timeoutMs: 2500,
    });
    if (r.code !== 0) return null;
    const mime = String(r.stdout ?? '')
      .trim()
      .toLowerCase();
    if (!mime) return null;
    return mime.split(/\s+/)[0] || null;
  } catch {
    return null;
  }
}

async function listHostFsDirectory(
  targetPathRaw: string,
): Promise<{ resolvedPath: string; entries: ContainerFsEntry[] }> {
  const resolvedPath = path.resolve(
    String(targetPathRaw ?? '').trim() || path.resolve(os.homedir()),
  );
  const dirStat = await fs.stat(resolvedPath);
  if (!dirStat.isDirectory()) {
    const err = new Error(`path is not a directory: ${resolvedPath}`) as Error & { code?: string };
    err.code = 'ENOTDIR';
    throw err;
  }

  const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });
  const entries: ContainerFsEntry[] = [];
  for (const d of dirents) {
    const name = String(d?.name ?? '').trim();
    if (!name || name === '.' || name === '..') continue;
    const fullPath = path.join(resolvedPath, name);
    let stat: any = null;
    try {
      stat = await fs.lstat(fullPath);
    } catch {
      stat = null;
    }
    const kind: ContainerFsEntry['kind'] =
      d.isDirectory() || Boolean(stat?.isDirectory())
        ? 'directory'
        : d.isFile() || Boolean(stat?.isFile())
          ? 'file'
          : 'other';
    const ext = kind === 'file' ? extensionLower(name) || null : null;
    entries.push({
      name,
      path: fullPath,
      kind,
      size: stat && Number.isFinite(stat.size) ? Math.max(0, Math.floor(stat.size)) : null,
      mtimeMs: stat && Number.isFinite(stat.mtimeMs) ? Math.max(0, Math.floor(stat.mtimeMs)) : null,
      ext,
      isImage: kind === 'file' ? isLikelyImagePath(name) : false,
      isVideo: kind === 'file' ? isLikelyVideoPath(name) : false,
    });
  }
  sortFsEntries(entries);
  return { resolvedPath, entries };
}

function parseFsSearchOutput(
  text: string,
  fallbackRoot: string,
): { root: string; entries: ContainerFsEntry[] } {
  const lines = String(text ?? '')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter(Boolean);
  let root = normalizeContainerPath(fallbackRoot) || fallbackRoot || '/';
  const entries: ContainerFsEntry[] = [];

  for (const line of lines) {
    if (line.startsWith('__ROOT__\t')) {
      root = line.slice('__ROOT__\t'.length).trim() || root;
      continue;
    }
    const parts = line.split('\t');
    if (parts.length < 4) continue;
    const relativePath = String(parts[0] ?? '').trim();
    const fullPath = String(parts[1] ?? '').trim();
    if (!relativePath || !fullPath) continue;
    const sizeNum = Number(parts[2] ?? 0);
    const mtimeSec = Number(parts[3] ?? 0);
    const name =
      path.posix.basename(relativePath.replace(/\\/g, '/')) || path.basename(fullPath) || fullPath;
    entries.push({
      name,
      path: fullPath,
      relativePath,
      kind: 'file',
      size: Number.isFinite(sizeNum) ? Math.max(0, Math.floor(sizeNum)) : null,
      mtimeMs: Number.isFinite(mtimeSec) ? Math.max(0, Math.floor(mtimeSec * 1000)) : null,
      ext: extensionLower(name) || null,
      isImage: isLikelyImagePath(name),
      isVideo: isLikelyVideoPath(name),
    });
  }

  return { root, entries };
}

function buildFsSearchScript(opts: {
  root: string;
  query: string;
  limit: number;
  pathFlavor: 'posix' | 'host';
}): string {
  const excludeCase = [
    '.git/*',
    'node_modules/*',
    'dist/*',
    'build/*',
    '.next/*',
    '.turbo/*',
    'coverage/*',
    '.cache/*',
  ].join('|');
  const rgGlobs = [
    '--glob "!.git/**"',
    '--glob "!node_modules/**"',
    '--glob "!dist/**"',
    '--glob "!build/**"',
    '--glob "!.next/**"',
    '--glob "!.turbo/**"',
    '--glob "!coverage/**"',
    '--glob "!.cache/**"',
  ].join(' ');
  const joinFullPath =
    opts.pathFlavor === 'host'
      ? 'full="$resolved/$rel"'
      : 'if [ "$resolved" = "/" ]; then full="/$rel"; else full="$resolved/$rel"; fi';
  return [
    'set -euo pipefail',
    `root=${bashQuote(opts.root)}`,
    `query=${bashQuote(opts.query.toLowerCase())}`,
    `limit=${String(opts.limit)}`,
    `if [ "$root" = ${bashQuote(NON_REPO_HOME_CWD)} ]; then mkdir -p ${bashQuote(NON_REPO_HOME_CWD)} 2>/dev/null || true; fi`,
    'if [ ! -d "$root" ]; then echo "__ERR__\tnot-dir"; exit 3; fi',
    'cd "$root"',
    'resolved=$(pwd -P)',
    'printf "__ROOT__\t%s\n" "$resolved"',
    'list_files() {',
    '  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then',
    '    git ls-files -co --exclude-standard -- . 2>/dev/null || true',
    '  elif command -v rg >/dev/null 2>&1; then',
    `    rg --files --hidden ${rgGlobs} . 2>/dev/null || true`,
    '  else',
    '    find . \\( -path "*/.git/*" -o -path "*/node_modules/*" -o -path "*/dist/*" -o -path "*/build/*" -o -path "*/.next/*" -o -path "*/.turbo/*" -o -path "*/coverage/*" -o -path "*/.cache/*" \\) -prune -o -type f -print 2>/dev/null || true',
    '  fi',
    '}',
    'count=0',
    'while IFS= read -r rel; do',
    '  rel="${rel#./}"',
    '  [ -n "$rel" ] || continue',
    `  case "$rel" in ${excludeCase}) continue ;; esac`,
    '  if [ -n "$query" ]; then',
    '    lower=$(printf "%s" "$rel" | tr "[:upper:]" "[:lower:]")',
    '    case "$lower" in *"$query"*) ;; *) continue ;; esac',
    '  fi',
    '  [ -f "$rel" ] || continue',
    `  ${joinFullPath}`,
    '  size=$(stat -c %s -- "$rel" 2>/dev/null || stat -f %z -- "$rel" 2>/dev/null || echo 0)',
    '  mtime=$(stat -c %Y -- "$rel" 2>/dev/null || stat -f %m -- "$rel" 2>/dev/null || echo 0)',
    '  printf "%s\t%s\t%s\t%s\n" "$rel" "$full" "$size" "$mtime"',
    '  count=$((count + 1))',
    '  [ "$count" -lt "$limit" ] || break',
    'done < <(list_files)',
  ].join('\n');
}

type FsMutationAction = 'create-file' | 'create-directory' | 'rename' | 'delete' | 'move' | 'copy';

type FsMutationResult = {
  action: FsMutationAction;
  path?: string;
  targetPath?: string;
  paths?: string[];
  targetDir?: string;
};

function fsMutationError(statusCode: number, message: string): Error & { statusCode?: number } {
  const err = new Error(message) as Error & { statusCode?: number };
  err.statusCode = statusCode;
  return err;
}

function fsMutationStatus(error: unknown): number {
  const explicit = Number((error as any)?.statusCode ?? 0);
  if (explicit > 0) return explicit;
  const code = String((error as any)?.code ?? '')
    .trim()
    .toUpperCase();
  if (code === 'ENOENT' || code === 'ENOTDIR') return 404;
  if (code === 'EEXIST' || code === 'ENOTEMPTY') return 409;
  if (code === 'EACCES' || code === 'EPERM') return 403;
  return 500;
}

function normalizeFsChildName(raw: unknown): string {
  const name = String(raw ?? '')
    .replace(/[\0\r\n\t]/g, '')
    .trim();
  if (/[\/\\]/.test(name)) return '';
  return name;
}

function assertValidFsChildName(name: string): void {
  if (!name || name === '.' || name === '..') {
    throw fsMutationError(400, 'invalid name');
  }
}

function fsPathBaseNameForRuntime(runtime: 'host' | 'container', rawPath: string): string {
  const text = String(rawPath ?? '').replace(/[\/\\]+$/g, '');
  return runtime === 'host' ? path.basename(text) : path.posix.basename(text);
}

function fsPathParentForRuntime(runtime: 'host' | 'container', rawPath: string): string {
  return runtime === 'host'
    ? path.dirname(rawPath)
    : normalizeContainerPath(path.posix.dirname(rawPath));
}

function fsJoinChildForRuntime(
  runtime: 'host' | 'container',
  parentPath: string,
  name: string,
): string {
  return runtime === 'host'
    ? path.resolve(path.join(parentPath, name))
    : normalizeContainerPath(path.posix.join(parentPath, name));
}

function fsPathStartsWithOrEqualsForRuntime(
  runtime: 'host' | 'container',
  parentPath: string,
  childPath: string,
): boolean {
  const parent =
    runtime === 'host'
      ? path.resolve(parentPath)
      : normalizeContainerPath(parentPath).replace(/\/+$/g, '') || '/';
  const child =
    runtime === 'host'
      ? path.resolve(childPath)
      : normalizeContainerPath(childPath).replace(/\/+$/g, '') || '/';
  if (parent === child) return true;
  const sep = runtime === 'host' ? path.sep : '/';
  return child.startsWith(parent.endsWith(sep) ? parent : `${parent}${sep}`);
}

function normalizeFsMutationPathsForRuntime(drone: any, rawPaths: unknown): string[] {
  const values = Array.isArray(rawPaths) ? rawPaths : rawPaths == null ? [] : [rawPaths];
  return values
    .map((value) => normalizeFsPathForRuntime(drone, value, { fallbackToHome: false }))
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

async function assertHostDirectory(targetPath: string): Promise<void> {
  const st = await fs.stat(targetPath);
  if (!st.isDirectory()) {
    throw fsMutationError(404, `path is not a directory: ${targetPath}`);
  }
}

async function assertHostPathDoesNotExist(targetPath: string): Promise<void> {
  try {
    await fs.lstat(targetPath);
    throw fsMutationError(409, `path already exists: ${targetPath}`);
  } catch (e: any) {
    if (String(e?.code ?? '').toUpperCase() === 'ENOENT') return;
    throw e;
  }
}

async function mutateHostFs(
  action: FsMutationAction,
  body: any,
  drone: any,
): Promise<FsMutationResult> {
  const runtime = 'host' as const;
  if (action === 'create-file' || action === 'create-directory') {
    const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? body?.path ?? '', {
      fallbackToHome: true,
    });
    const name = normalizeFsChildName(body?.name);
    assertValidFsChildName(name);
    await assertHostDirectory(targetDir);
    const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
    await assertHostPathDoesNotExist(targetPath);
    if (action === 'create-file') {
      const fh = await fs.open(targetPath, 'wx');
      await fh.close();
    } else {
      await fs.mkdir(targetPath);
    }
    return { action, path: targetPath, targetDir };
  }

  if (action === 'rename') {
    const sourcePath = normalizeFsPathForRuntime(drone, body?.path ?? '', {
      fallbackToHome: false,
    });
    if (!sourcePath || sourcePath === path.parse(sourcePath).root)
      throw fsMutationError(400, 'missing path');
    const name = normalizeFsChildName(body?.name);
    assertValidFsChildName(name);
    const targetPath = fsJoinChildForRuntime(
      runtime,
      fsPathParentForRuntime(runtime, sourcePath),
      name,
    );
    await assertHostPathDoesNotExist(targetPath);
    await fs.rename(sourcePath, targetPath);
    return { action, path: sourcePath, targetPath };
  }

  if (action === 'delete') {
    const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
    if (paths.length === 0) throw fsMutationError(400, 'missing paths');
    for (const sourcePath of paths) {
      if (!sourcePath || sourcePath === path.parse(sourcePath).root)
        throw fsMutationError(400, 'cannot delete root');
      await fs.rm(sourcePath, { recursive: true, force: false });
    }
    return { action, paths };
  }

  if (action === 'move' || action === 'copy') {
    const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
    const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? '', {
      fallbackToHome: false,
    });
    if (paths.length === 0) throw fsMutationError(400, 'missing paths');
    if (!targetDir) throw fsMutationError(400, 'missing target directory');
    await assertHostDirectory(targetDir);
    for (const sourcePath of paths) {
      if (!sourcePath || sourcePath === path.parse(sourcePath).root)
        throw fsMutationError(400, 'invalid source path');
      const name = fsPathBaseNameForRuntime(runtime, sourcePath);
      assertValidFsChildName(name);
      const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
      if (fsPathStartsWithOrEqualsForRuntime(runtime, sourcePath, targetPath)) {
        throw fsMutationError(
          400,
          `cannot ${action === 'move' ? 'move' : 'copy'} a directory into itself`,
        );
      }
      await assertHostPathDoesNotExist(targetPath);
      if (action === 'move') {
        await fs.rename(sourcePath, targetPath);
      } else {
        await fs.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
      }
    }
    return { action, paths, targetDir };
  }

  throw fsMutationError(400, 'unsupported filesystem action');
}

function containerFsMutationScript(
  action: FsMutationAction,
  body: any,
  drone: any,
): { script: string; result: FsMutationResult } {
  const runtime = 'container' as const;
  const failFn = [
    'fail() {',
    '  code="$1"; shift',
    '  printf "__ERR__\\t%s\\t%s\\n" "$code" "$*"',
    '  exit "$code"',
    '}',
  ];

  const lines = ['set -euo pipefail', ...failFn];

  if (action === 'create-file' || action === 'create-directory') {
    const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? body?.path ?? '', {
      fallbackToHome: true,
    });
    const name = normalizeFsChildName(body?.name);
    assertValidFsChildName(name);
    const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
    lines.push(
      `target_dir=${bashQuote(targetDir)}`,
      `target=${bashQuote(targetPath)}`,
      '[ -d "$target_dir" ] || fail 4 "path is not a directory: $target_dir"',
      '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
      action === 'create-file' ? ': > "$target"' : 'mkdir -- "$target"',
      'printf "__OK__\\n"',
    );
    return { script: lines.join('\n'), result: { action, path: targetPath, targetDir } };
  }

  if (action === 'rename') {
    const sourcePath = normalizeFsPathForRuntime(drone, body?.path ?? '', {
      fallbackToHome: false,
    });
    if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'missing path');
    const name = normalizeFsChildName(body?.name);
    assertValidFsChildName(name);
    const targetPath = fsJoinChildForRuntime(
      runtime,
      fsPathParentForRuntime(runtime, sourcePath),
      name,
    );
    lines.push(
      `source=${bashQuote(sourcePath)}`,
      `target=${bashQuote(targetPath)}`,
      '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
      '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
      'mv -- "$source" "$target"',
      'printf "__OK__\\n"',
    );
    return { script: lines.join('\n'), result: { action, path: sourcePath, targetPath } };
  }

  if (action === 'delete') {
    const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
    if (paths.length === 0) throw fsMutationError(400, 'missing paths');
    for (const sourcePath of paths) {
      if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'cannot delete root');
      lines.push(
        `source=${bashQuote(sourcePath)}`,
        '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
        'rm -rf -- "$source"',
      );
    }
    lines.push('printf "__OK__\\n"');
    return { script: lines.join('\n'), result: { action, paths } };
  }

  if (action === 'move' || action === 'copy') {
    const paths = normalizeFsMutationPathsForRuntime(drone, body?.paths ?? body?.path);
    const targetDir = normalizeFsPathForRuntime(drone, body?.targetDir ?? '', {
      fallbackToHome: false,
    });
    if (paths.length === 0) throw fsMutationError(400, 'missing paths');
    if (!targetDir) throw fsMutationError(400, 'missing target directory');
    lines.push(
      `target_dir=${bashQuote(targetDir)}`,
      '[ -d "$target_dir" ] || fail 4 "path is not a directory: $target_dir"',
    );
    for (const sourcePath of paths) {
      if (!sourcePath || sourcePath === '/') throw fsMutationError(400, 'invalid source path');
      const name = fsPathBaseNameForRuntime(runtime, sourcePath);
      assertValidFsChildName(name);
      const targetPath = fsJoinChildForRuntime(runtime, targetDir, name);
      lines.push(
        `source=${bashQuote(sourcePath)}`,
        `target=${bashQuote(targetPath)}`,
        '[ -e "$source" ] || [ -L "$source" ] || fail 4 "path not found: $source"',
        '[ ! -e "$target" ] && [ ! -L "$target" ] || fail 5 "path already exists: $target"',
      );
      if (action === 'move') {
        lines.push(
          'case "$target" in "$source"|"$source"/*) fail 2 "cannot move a directory into itself" ;; esac',
        );
        lines.push('mv -- "$source" "$target"');
      } else {
        lines.push(
          'case "$target" in "$source"|"$source"/*) fail 2 "cannot copy a directory into itself" ;; esac',
        );
        lines.push('cp -a -- "$source" "$target"');
      }
    }
    lines.push('printf "__OK__\\n"');
    return { script: lines.join('\n'), result: { action, paths, targetDir } };
  }

  throw fsMutationError(400, 'unsupported filesystem action');
}

async function mutateContainerFs(
  action: FsMutationAction,
  body: any,
  resolved: ResolvedDrone,
  droneName: string,
): Promise<FsMutationResult> {
  const { script, result } = containerFsMutationScript(action, body, resolved.drone);
  await withLockedDroneContainer(
    { requestedDroneName: droneName, droneEntry: resolved.drone },
    async ({ containerName }) => {
      const out = await dvmExec(containerName, 'bash', ['-lc', script]);
      if (out.code === 0) return;
      const text = `${String(out.stdout ?? '')}\n${String(out.stderr ?? '')}`;
      const errMatch = text.match(/__ERR__\t(\d+)\t([^\n\r]*)/);
      if (errMatch) {
        const code = Number(errMatch[1] ?? 0);
        const status = code === 4 ? 404 : code === 5 ? 409 : code === 2 ? 400 : 500;
        throw fsMutationError(
          status,
          String(errMatch[2] ?? '').trim() || 'filesystem action failed',
        );
      }
      throw new Error((out.stderr || out.stdout || 'filesystem action failed').trim());
    },
  );
  return result;
}

async function handleFsActionRoute(opts: {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  resolved: ResolvedDrone;
  droneRef: string;
}): Promise<void> {
  const { req, res, resolved, droneRef } = opts;
  const droneId = resolved.id;
  const drone = resolved.drone;
  const runtime = droneRuntime(drone);
  const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

  let body: any = null;
  try {
    body = await readJsonBody(req);
  } catch (e: any) {
    json(res, 400, { ok: false, error: e?.message ?? String(e) });
    return;
  }

  const action = String(body?.action ?? '').trim() as FsMutationAction;
  const allowedActions: FsMutationAction[] = [
    'create-file',
    'create-directory',
    'rename',
    'delete',
    'move',
    'copy',
  ];
  if (!allowedActions.includes(action)) {
    json(res, 400, {
      ok: false,
      error: 'unsupported filesystem action',
      id: droneId,
      name: droneName,
    });
    return;
  }

  try {
    const result =
      runtime === 'host'
        ? await mutateHostFs(action, body, drone)
        : await mutateContainerFs(action, body, resolved, droneName);
    json(res, 200, {
      ok: true,
      id: droneId,
      name: droneName,
      ...result,
    });
    return;
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    const code =
      runtime === 'host'
        ? fsMutationStatus(e)
        : Number((e as any)?.statusCode ?? 0) || (looksLikeMissingContainerError(msg) ? 404 : 500);
    json(res, code, { ok: false, error: msg, id: droneId, name: droneName });
    return;
  }
}

const assistantFilesystemService = createAssistantFilesystemService({
  nonRepoHomeCwd: NON_REPO_HOME_CWD,
  droneRuntime,
  defaultDroneHomeCwd,
  normalizeDroneCwdForRuntime,
  hostMimeType,
  listHostFsDirectory,
  isRepoAttachedDrone,
  droneRepoPathInContainer,
  withReadonlyDroneContainer,
  withLockedDroneContainer,
});
const {
  assistantAbortDroneTransferFile,
  assistantCommitDroneTransferFile,
  assistantCreateDroneDirectory,
  assistantCreateDroneTransferDirectory,
  assistantDeleteDroneDirectory,
  assistantDeleteDroneFile,
  assistantFindDroneFiles,
  assistantListDroneChangedFiles,
  assistantListDroneFiles,
  assistantMoveDroneFile,
  assistantMoveDronePath,
  assistantPrepareDroneTransferFile,
  assistantReadDroneFile,
  assistantReadDroneFileChunk,
  assistantRunDroneBash,
  assistantSearchDroneFiles,
  assistantStatDronePath,
  assistantWriteDroneFile,
  assistantWriteDroneTransferChunk,
  readHostFileBytes,
} = assistantFilesystemService;

function isUngroupedGroupName(name: string): boolean {
  return (
    String(name ?? '')
      .trim()
      .toLowerCase() === 'ungrouped'
  );
}

const GROUP_NAME_MAX_LEN = 64;
function normalizeGroupName(raw: any): string {
  return String(raw ?? '').trim();
}
function validateGroupNameOrThrow(raw: any, label: string = 'group'): string {
  const name = normalizeGroupName(raw);
  if (!name) throw new Error(`invalid ${label} (must be non-empty)`);
  if (name.length > GROUP_NAME_MAX_LEN)
    throw new Error(`invalid ${label} (max ${GROUP_NAME_MAX_LEN} chars)`);
  if (isUngroupedGroupName(name)) throw new Error(`invalid ${label} ("Ungrouped" is reserved)`);
  return name;
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

function listAllKnownGroups(regAny: any): string[] {
  const out = new Set<string>();
  for (const k of Object.keys(regAny?.groups ?? {})) {
    const g = normalizeGroupName(k);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  for (const d of Object.values(regAny?.drones ?? {}) as any[]) {
    const g = normalizeGroupName(d?.group);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  for (const d of Object.values(regAny?.pending ?? {}) as any[]) {
    const g = normalizeGroupName(d?.group);
    if (g && !isUngroupedGroupName(g)) out.add(g);
  }
  return Array.from(out.values()).sort((a, b) => a.localeCompare(b));
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

async function sleepMs(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
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

async function waitForDroneDaemonReady(client: ReturnType<typeof makeClient>, timeoutMs: number) {
  const start = Date.now();
  // Keep retrying briefly; daemon may not be ready immediately after container start.
  // NOTE: droneStatus already has its own per-request timeout.
  while (Date.now() - start < timeoutMs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await droneStatus(client);
      return;
    } catch {
      // eslint-disable-next-line no-await-in-loop
      await sleepMs(250);
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
  return String(raw ?? '').trim() === 'read-only' ? 'read-only' : 'full-access';
}

function parseAgentPermissionModeForUpdate(raw: unknown): AgentPermissionMode {
  const value = String(raw ?? '').trim();
  if (value === 'full-access' || value === 'read-only') return value;
  throw new Error('agentPermissionMode must be full-access or read-only');
}

type PromptAutomationMeta = {
  kind: 'prompt-loop';
  stage?: 'run' | 'final-message';
  jobKey?: string;
  automationId?: string;
  automationLabel?: string;
  runIndex?: number;
  runsTotal?: number;
  sleepBetweenRunsSeconds?: number;
  stopPhrase?: string;
  stopPhraseCaseSensitive?: boolean;
  stopMatchedRunIndex?: number;
  promptPreview?: string;
};

type DiscoveredModelOption = {
  id: string;
  label: string;
  isDefault?: boolean;
  isCurrent?: boolean;
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
};

type TranscriptTurn = {
  at: string;
  id?: string;
  prompt: string;
  model?: string;
  reasoning?: string;
  ok: boolean;
  output: string;
  error?: string;
  promptAt?: string;
  completedAt?: string;
  attachments?: ChatImageAttachmentRef[];
  automation?: PromptAutomationMeta;
  inheritedFromClone?: boolean;
  agentMessageAutoContinue?: {
    status?: 'pending' | 'classified' | 'failed';
    bucket?: 'user-turn' | 'continue';
    source?: 'llm' | 'agent-copilot-json' | 'heuristic';
    classifiedAt?: string;
    continuedAt?: string;
    error?: string;
    updatedAt?: string;
  };
  agentSuggestion?: {
    usedDirectAt?: string;
    suggestionHash?: string;
    policyFingerprint?: string;
    updatedAt?: string;
  };
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

type PlaybookMessageDefinition = {
  id: string;
  name: string | null;
  prompt: string;
};

type PlaybookDefinition = {
  id: string;
  label: string;
  agent: ChatAgentConfig;
  model?: string | null;
  messages: PlaybookMessageDefinition[];
  artifacts: string[];
  actions: Array<{
    id: string;
    label: string;
    messages: string[];
  }>;
  createdAt: string;
  updatedAt?: string;
};

type PlaybookRunStatus = 'starting' | 'running' | 'completed' | 'failed';
type PlaybookRunQueueState = 'queued' | 'waiting' | 'launching' | 'error';

type PlaybookRunQueueItem = {
  id: string;
  playbookId: string;
  playbookLabel: string;
  repoPath: string;
  requestedCount: number;
  launchedCount: number;
  inFlightCount: number;
  serializeFirstMessageGroup: boolean;
  pullHostBranchBeforeCreate: boolean;
  createdAt: string;
  updatedAt: string;
  error?: string;
};

type PlaybookRunQueueGate = {
  queueItemId: string;
  playbookId: string;
  chatName: string;
  initialPromptIds: string[];
  releasedAt?: string;
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

const PLAYBOOK_LABEL_MAX_CHARS = 72;
const PLAYBOOK_ACTION_LABEL_MAX_CHARS = 40;
const PLAYBOOK_MESSAGE_NAME_MAX_CHARS = 80;
const PLAYBOOK_MESSAGE_MAX_CHARS = 8_000;
const PLAYBOOK_MAX_MESSAGES = 20;
const PLAYBOOK_MAX_ACTIONS = 12;
const PLAYBOOK_MAX_ITEMS = 60;

function normalizeDroneEntryKind(raw: unknown): 'standard' | 'playbook-run' {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'playbook-run'
    ? 'playbook-run'
    : 'standard';
}

function normalizeDroneEntryVisibility(raw: unknown): 'visible' | 'hidden' {
  return String(raw ?? '')
    .trim()
    .toLowerCase() === 'hidden'
    ? 'hidden'
    : 'visible';
}

function playbookMetaFromEntry(raw: unknown): {
  id: string;
  label: string;
  messageCount: number;
  chatName: string;
  artifacts: string[];
  actions: Array<{ id: string; label: string; messages: string[] }>;
} | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = String((raw as any).id ?? '').trim();
  if (!id) return null;
  const label = String((raw as any).label ?? '').trim() || id;
  const messageCountRaw = Number((raw as any).messageCount);
  const messageCount =
    Number.isFinite(messageCountRaw) && messageCountRaw > 0 ? Math.floor(messageCountRaw) : 1;
  const chatName = normalizeChatName((raw as any).chatName ?? 'default');
  const artifacts = normalizePlaybookArtifacts((raw as any).artifacts);
  const actions = normalizePlaybookActions((raw as any).actions);
  return { id, label, messageCount, chatName, artifacts, actions };
}

function normalizePlaybookLabel(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .slice(0, PLAYBOOK_LABEL_MAX_CHARS);
}

function normalizePlaybookActionLabel(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .slice(0, PLAYBOOK_ACTION_LABEL_MAX_CHARS);
}

function normalizePlaybookMessageId(raw: unknown, fallbackIndex: number): string {
  const id = String(raw ?? '').trim();
  return id || `message-${fallbackIndex + 1}`;
}

function normalizePlaybookMessageName(raw: unknown): string | null {
  const name = String(raw ?? '')
    .trim()
    .slice(0, PLAYBOOK_MESSAGE_NAME_MAX_CHARS);
  return name || null;
}

function normalizePlaybookMessages(raw: unknown): PlaybookMessageDefinition[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PlaybookMessageDefinition[] = [];
  for (let index = 0; index < list.length; index += 1) {
    const item = list[index];
    const prompt =
      item && typeof item === 'object' && !Array.isArray(item)
        ? String((item as any).prompt ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS)
        : String(item ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
    if (!prompt.trim()) continue;
    out.push({
      id:
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizePlaybookMessageId((item as any).id, index)
          : normalizePlaybookMessageId('', index),
      name:
        item && typeof item === 'object' && !Array.isArray(item)
          ? normalizePlaybookMessageName((item as any).name ?? '')
          : null,
      prompt,
    });
    if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
  }
  return out;
}

function normalizePlaybookActionMessages(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    const message =
      item && typeof item === 'object' && !Array.isArray(item)
        ? String((item as any).prompt ?? (item as any).message ?? '').slice(
            0,
            PLAYBOOK_MESSAGE_MAX_CHARS,
          )
        : String(item ?? '').slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
    if (!message.trim()) continue;
    out.push(message);
    if (out.length >= PLAYBOOK_MAX_MESSAGES) break;
  }
  return out;
}

function normalizePlaybookArtifacts(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: string[] = [];
  for (const item of list) {
    const artifact = String(item ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+/, '')
      .replace(/^\/+/, '')
      .slice(0, PLAYBOOK_MESSAGE_MAX_CHARS);
    if (!artifact) continue;
    out.push(artifact);
    if (out.length >= PLAYBOOK_MAX_ITEMS) break;
  }
  return out;
}

function normalizePlaybookActions(
  raw: unknown,
): Array<{ id: string; label: string; messages: string[] }> {
  const list = Array.isArray(raw) ? raw : [];
  const out: Array<{ id: string; label: string; messages: string[] }> = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const id = String((item as any).id ?? '').trim() || crypto.randomUUID();
    const label = normalizePlaybookActionLabel((item as any).label ?? '');
    const messages = normalizePlaybookActionMessages((item as any).messages);
    if (!label || messages.length === 0) continue;
    out.push({ id, label, messages });
    if (out.length >= PLAYBOOK_MAX_ACTIONS) break;
  }
  return out;
}

function normalizePlaybookAgent(raw: unknown): ChatAgentConfig {
  return parseSeedAgent(raw) ?? { kind: 'builtin', id: 'cursor' };
}

function normalizePlaybookModel(raw: unknown, agent: ChatAgentConfig): string | null {
  if (agent.kind !== 'builtin') return null;
  return normalizeChatModel(raw);
}

function normalizePlaybookDefinitions(regAny: any): PlaybookDefinition[] {
  const out: PlaybookDefinition[] = [];
  const seen = new Set<string>();
  for (const [key, raw] of Object.entries(regAny?.playbooks ?? {})) {
    if (!raw || typeof raw !== 'object') continue;
    const id = String((raw as any).id ?? key).trim();
    if (!id || seen.has(id)) continue;
    const label = normalizePlaybookLabel((raw as any).label ?? '');
    const agent = normalizePlaybookAgent((raw as any).agent);
    const model = normalizePlaybookModel((raw as any).model, agent);
    const messages = normalizePlaybookMessages((raw as any).messages);
    const artifacts = normalizePlaybookArtifacts((raw as any).artifacts);
    const actions = normalizePlaybookActions((raw as any).actions);
    seen.add(id);
    out.push({
      id,
      label,
      agent,
      model,
      messages,
      artifacts,
      actions,
      createdAt:
        typeof (raw as any).createdAt === 'string' && String((raw as any).createdAt).trim()
          ? String((raw as any).createdAt)
          : nowIso(),
      updatedAt:
        typeof (raw as any).updatedAt === 'string' && String((raw as any).updatedAt).trim()
          ? String((raw as any).updatedAt)
          : undefined,
    });
    if (out.length >= PLAYBOOK_MAX_ITEMS) break;
  }
  return out.sort((a, b) => {
    const aMs = Date.parse(a.updatedAt ?? a.createdAt);
    const bMs = Date.parse(b.updatedAt ?? b.createdAt);
    if (Number.isFinite(aMs) && Number.isFinite(bMs) && aMs !== bMs) return bMs - aMs;
    return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
  });
}

function catalogPlaybookRecord(playbook: PlaybookDefinition): CatalogPlaybookRecord {
  return {
    ...playbook,
    model: playbook.model ?? undefined,
    updatedAt: playbook.updatedAt ?? playbook.createdAt,
  };
}

async function listCanonicalPlaybookDefinitions(): Promise<PlaybookDefinition[]> {
  try {
    const store = await getCatalogStore();
    if (!store.isBackfillComplete('playbooks')) {
      const legacy = normalizePlaybookDefinitions(await loadRegistry());
      await store.backfillPlaybooks(legacy.map(catalogPlaybookRecord));
    }
    const rows = store.listPlaybooks();
    return normalizePlaybookDefinitions({
      playbooks: Object.fromEntries(rows.map((playbook) => [playbook.id, playbook])),
    });
  } catch (error) {
    if ((globalThis as any).Bun) return normalizePlaybookDefinitions(await loadRegistry());
    throw error;
  }
}

function lastTranscriptTurnFromEntry(entry: any): any | null {
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  return turns.length > 0 ? (turns[turns.length - 1] ?? null) : null;
}

function parseIsoOrZero(raw: unknown): number {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

function summarizeDroneActivity(entry: any): {
  lastActivityAt: string | null;
  lastMessageAt: string | null;
  lastActivityChat: string | null;
} {
  let lastActivityMs = Math.max(
    parseIsoOrZero(entry?.createdAt),
    parseIsoOrZero(entry?.updatedAt),
    parseIsoOrZero(entry?.hub?.updatedAt),
  );
  let lastMessageMs = 0;
  let lastActivityChat: string | null = null;
  let lastMessageChat: string | null = null;

  const chats = entry?.chats && typeof entry.chats === 'object' ? entry.chats : {};
  for (const [chatName, chatEntry] of Object.entries(chats) as Array<[string, any]>) {
    const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
    for (const turn of turns) {
      const turnMs = Math.max(
        parseIsoOrZero((turn as any)?.completedAt),
        parseIsoOrZero((turn as any)?.promptAt),
        parseIsoOrZero((turn as any)?.at),
      );
      if (turnMs > lastMessageMs) {
        lastMessageMs = turnMs;
        lastMessageChat = chatName;
      }
      if (turnMs > lastActivityMs) {
        lastActivityMs = turnMs;
        lastActivityChat = chatName;
      }
    }

    const pendingPrompts = Array.isArray(chatEntry?.pendingPrompts) ? chatEntry.pendingPrompts : [];
    for (const prompt of pendingPrompts) {
      const promptMs = Math.max(
        parseIsoOrZero((prompt as any)?.updatedAt),
        parseIsoOrZero((prompt as any)?.at),
        parseIsoOrZero((prompt as any)?.createdAt),
      );
      if (promptMs > lastActivityMs) {
        lastActivityMs = promptMs;
        lastActivityChat = chatName;
      }
    }
  }

  return {
    lastActivityAt: lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null,
    lastMessageAt: lastMessageMs > 0 ? new Date(lastMessageMs).toISOString() : null,
    lastActivityChat:
      lastActivityChat ?? (lastActivityMs === lastMessageMs ? lastMessageChat : null),
  };
}

function isDraftDroneEntry(entry: any): boolean {
  return (
    entry?.draft === true ||
    String(entry?.phase ?? '')
      .trim()
      .toLowerCase() === 'draft'
  );
}

function isDraftChatEntry(entry: any): boolean {
  return entry?.draft === true;
}

function summarizePlaybookRunEntry(args: {
  droneId: string;
  name: string;
  createdAt: string;
  repoPath: string;
  runtime: DroneRuntime;
  playbook: {
    id: string;
    label: string;
    messageCount: number;
    chatName: string;
    artifacts: string[];
    actions: Array<{ id: string; label: string; messages: string[] }>;
  };
  pendingEntry?: any | null;
  droneEntry?: any | null;
}): {
  id: string;
  droneId: string;
  droneName: string;
  playbookId: string;
  playbookLabel: string;
  chatName: string;
  repoPath: string;
  runtime: DroneRuntime;
  visibility: 'hidden' | 'visible';
  kind: 'playbook-run';
  status: PlaybookRunStatus;
  createdAt: string;
  updatedAt: string;
  lastMessage: string;
  artifacts: string[];
  actions: Array<{ id: string; label: string; messages: string[] }>;
  pendingCount: number;
  failedCount: number;
  runsCompleted: number;
  statusError: string | null;
} {
  const pendingEntry = args.pendingEntry ?? null;
  const droneEntry = args.droneEntry ?? null;
  const playbook = args.playbook;
  const chatName = playbook.chatName || 'default';
  const chatEntry = droneEntry?.chats?.[chatName] ?? null;
  const pendingPrompts = pendingEntry
    ? normalizePendingStartupPrompts(pendingEntry.startupQueuedPrompts, chatName).map(
        startupPromptToPendingPrompt,
      )
    : pendingPromptsFromChatEntry(chatEntry, { keepRecentlyCompleted: true });
  const failedCount = pendingPrompts.filter((item) => item.state === 'failed').length;
  const activePendingCount = pendingPrompts.filter((item) => item.state !== 'failed').length;
  const lastTurn = lastTranscriptTurnFromEntry(chatEntry);
  const lastMessage = String(lastTurn?.output ?? '').trim();
  const statusError =
    typeof pendingEntry?.error === 'string' && pendingEntry.error.trim()
      ? pendingEntry.error.trim()
      : typeof droneEntry?.hub?.message === 'string' && String(droneEntry.hub.message).trim()
        ? String(droneEntry.hub.message).trim()
        : failedCount > 0
          ? String(pendingPrompts.find((item) => item.state === 'failed')?.error ?? '').trim() ||
            'One or more playbook prompts failed.'
          : null;
  let status: PlaybookRunStatus = 'starting';
  if (pendingEntry) {
    status = String(pendingEntry.phase ?? '').trim() === 'error' ? 'failed' : 'starting';
  } else if (String(droneEntry?.hub?.phase ?? '').trim() === 'error' || failedCount > 0) {
    status = 'failed';
  } else if (
    String(droneEntry?.hub?.phase ?? '').trim() === 'starting' ||
    String(droneEntry?.hub?.phase ?? '').trim() === 'seeding' ||
    String(droneEntry?.hub?.phase ?? '').trim() === 'creating'
  ) {
    status = 'starting';
  } else if (
    activePendingCount > 0 ||
    Boolean(busyChatNamesForDrone(droneEntry, args.droneId).length > 0)
  ) {
    status = 'running';
  } else if (lastTurn) {
    status = 'completed';
  }
  const updatedAtMs = Math.max(
    parseIsoOrZero(pendingEntry?.updatedAt),
    parseIsoOrZero(droneEntry?.hub?.updatedAt),
    parseIsoOrZero(lastTurn?.completedAt),
    parseIsoOrZero(lastTurn?.promptAt),
    parseIsoOrZero(lastTurn?.at),
    ...pendingPrompts.map((item) => parseIsoOrZero(item.updatedAt ?? item.at)),
  );
  return {
    id: args.droneId,
    droneId: args.droneId,
    droneName: args.name,
    playbookId: playbook.id,
    playbookLabel: playbook.label,
    chatName,
    repoPath: args.repoPath,
    runtime: args.runtime,
    visibility: 'hidden',
    kind: 'playbook-run',
    status,
    createdAt: args.createdAt,
    updatedAt: updatedAtMs > 0 ? new Date(updatedAtMs).toISOString() : args.createdAt,
    lastMessage: lastMessage || (statusError ?? ''),
    artifacts: playbook.artifacts,
    actions: playbook.actions,
    pendingCount: activePendingCount,
    failedCount,
    runsCompleted: Array.isArray(chatEntry?.turns) ? chatEntry.turns.length : 0,
    statusError: status === 'failed' ? statusError : null,
  };
}

const PLAYBOOK_RUN_QUEUE_BATCH_MIN = 1;
const PLAYBOOK_RUN_QUEUE_BATCH_MAX = 50;

function normalizePlaybookRunQueueItem(raw: unknown): PlaybookRunQueueItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const item = raw as Record<string, unknown>;
  const id = String(item.id ?? '').trim();
  const playbookId = String(item.playbookId ?? '').trim();
  const playbookLabel = String(item.playbookLabel ?? '').trim();
  const repoPath = String(item.repoPath ?? '').trim();
  const requestedCount = Math.max(
    PLAYBOOK_RUN_QUEUE_BATCH_MIN,
    Math.min(PLAYBOOK_RUN_QUEUE_BATCH_MAX, Math.floor(Number(item.requestedCount ?? 1) || 1)),
  );
  const launchedCount = Math.max(
    0,
    Math.min(requestedCount, Math.floor(Number(item.launchedCount ?? 0) || 0)),
  );
  const maxInflight = Math.max(0, requestedCount - launchedCount);
  const inFlightCount = Math.max(
    0,
    Math.min(maxInflight, Math.floor(Number(item.inFlightCount ?? 0) || 0)),
  );
  if (!id || !playbookId || !playbookLabel || !repoPath) return null;
  return {
    id,
    playbookId,
    playbookLabel,
    repoPath,
    requestedCount,
    launchedCount,
    inFlightCount,
    serializeFirstMessageGroup: item.serializeFirstMessageGroup === true,
    pullHostBranchBeforeCreate: item.pullHostBranchBeforeCreate === true,
    createdAt:
      typeof item.createdAt === 'string' && item.createdAt.trim()
        ? item.createdAt.trim()
        : nowIso(),
    updatedAt:
      typeof item.updatedAt === 'string' && item.updatedAt.trim()
        ? item.updatedAt.trim()
        : nowIso(),
    ...(typeof item.error === 'string' && item.error.trim() ? { error: item.error.trim() } : {}),
  };
}

function normalizePlaybookRunQueueItems(raw: unknown): PlaybookRunQueueItem[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: PlaybookRunQueueItem[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const normalized = normalizePlaybookRunQueueItem(item);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    out.push(normalized);
  }
  return out.sort(
    (a, b) => parseIsoOrZero(a.createdAt) - parseIsoOrZero(b.createdAt) || a.id.localeCompare(b.id),
  );
}

function readPlaybookRunQueueItems(regAny: any): PlaybookRunQueueItem[] {
  return normalizePlaybookRunQueueItems(regAny?.playbookRunQueue?.items);
}

function writePlaybookRunQueueItems(regAny: any, itemsRaw: PlaybookRunQueueItem[]): void {
  const items = normalizePlaybookRunQueueItems(itemsRaw).filter(
    (item) => item.requestedCount - item.launchedCount > 0 || item.inFlightCount > 0,
  );
  if (items.length === 0) {
    if (regAny && typeof regAny === 'object') delete regAny.playbookRunQueue;
    return;
  }
  regAny.playbookRunQueue = { items };
}

async function canonicalPlaybookQueueItems(registry?: any): Promise<PlaybookRunQueueItem[]> {
  const store = await workflowStoreOrCompatibility();
  if (!store) return readPlaybookRunQueueItems(registry ?? (await loadRegistry()));
  if (!store.isQueueBackfilled()) {
    const legacyRegistry = registry?.playbookRunQueue
      ? registry
      : await loadRegistryCompatibilityBase();
    await store.backfillQueue(readPlaybookRunQueueItems(legacyRegistry));
  }
  return store
    .listQueue<PlaybookRunQueueItem>(true)
    .filter((item) => (item as any).state !== 'cancelled' && (item as any).state !== 'completed');
}

async function enqueueCanonicalPlaybookQueueItem(item: PlaybookRunQueueItem): Promise<void> {
  const store = await workflowStoreOrCompatibility();
  if (store) {
    if (!store.isQueueBackfilled()) {
      await store.backfillQueue(readPlaybookRunQueueItems(await loadRegistryCompatibilityBase()));
    }
    await store.enqueue(item);
    return;
  }
  await updateRegistry((regAny: any) => {
    const items = readPlaybookRunQueueItems(regAny);
    items.push(item);
    writePlaybookRunQueueItems(regAny, items);
  });
}

function normalizePlaybookRunQueueGate(raw: unknown): PlaybookRunQueueGate | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const gate = raw as Record<string, unknown>;
  const queueItemId = String(gate.queueItemId ?? '').trim();
  const playbookId = String(gate.playbookId ?? '').trim();
  const chatName = normalizeChatName(gate.chatName ?? 'default');
  const initialPromptIds = Array.isArray(gate.initialPromptIds)
    ? Array.from(
        new Set(gate.initialPromptIds.map((item) => String(item ?? '').trim()).filter(Boolean)),
      ).slice(0, 120)
    : [];
  if (!queueItemId || !playbookId) return null;
  return {
    queueItemId,
    playbookId,
    chatName,
    initialPromptIds,
    ...(typeof gate.releasedAt === 'string' && gate.releasedAt.trim()
      ? { releasedAt: gate.releasedAt.trim() }
      : {}),
  };
}

function isPlaybookRunQueueGateReleasedForDroneEntry(
  droneEntry: any,
  gate: PlaybookRunQueueGate,
): boolean {
  if (typeof gate.releasedAt === 'string' && gate.releasedAt.trim()) return true;
  if (
    String(droneEntry?.hub?.phase ?? '')
      .trim()
      .toLowerCase() === 'error'
  )
    return true;
  if (gate.initialPromptIds.length === 0) return true;
  const chatEntry = droneEntry?.chats?.[gate.chatName] ?? null;
  if (!chatEntry) return false;
  const turnIds = transcriptTurnIdsFromEntry(chatEntry);
  const failedIds = new Set(
    pendingPromptsFromChatEntry(chatEntry, { keepRecentlyCompleted: true })
      .filter((item) => item.state === 'failed')
      .map((item) => item.id),
  );
  return gate.initialPromptIds.every(
    (promptId) => turnIds.has(promptId) || failedIds.has(promptId),
  );
}

function reconcilePlaybookRunQueueGates(regAny: any): boolean {
  let changed = false;
  for (const pendingEntry of Object.values(regAny?.pending ?? {})) {
    if (normalizeDroneEntryKind((pendingEntry as any)?.kind) !== 'playbook-run') continue;
    const gate = normalizePlaybookRunQueueGate((pendingEntry as any)?.playbookQueueGate);
    if (!gate || gate.releasedAt) continue;
    if (
      String((pendingEntry as any)?.phase ?? '')
        .trim()
        .toLowerCase() === 'error'
    ) {
      (pendingEntry as any).playbookQueueGate = { ...gate, releasedAt: nowIso() };
      changed = true;
    }
  }
  for (const droneEntry of Object.values(regAny?.drones ?? {})) {
    if (normalizeDroneEntryKind((droneEntry as any)?.kind) !== 'playbook-run') continue;
    const gate = normalizePlaybookRunQueueGate((droneEntry as any)?.playbookQueueGate);
    if (!gate || gate.releasedAt) continue;
    if (isPlaybookRunQueueGateReleasedForDroneEntry(droneEntry, gate)) {
      (droneEntry as any).playbookQueueGate = { ...gate, releasedAt: nowIso() };
      changed = true;
    }
  }
  return changed;
}

function hasActivePlaybookRunQueueGate(regAny: any, playbookIdRaw: unknown): boolean {
  const playbookId = String(playbookIdRaw ?? '').trim();
  if (!playbookId) return false;
  for (const pendingEntry of Object.values(regAny?.pending ?? {})) {
    if (normalizeDroneEntryKind((pendingEntry as any)?.kind) !== 'playbook-run') continue;
    const gate = normalizePlaybookRunQueueGate((pendingEntry as any)?.playbookQueueGate);
    if (!gate || gate.playbookId !== playbookId || gate.releasedAt) continue;
    return true;
  }
  for (const droneEntry of Object.values(regAny?.drones ?? {})) {
    if (normalizeDroneEntryKind((droneEntry as any)?.kind) !== 'playbook-run') continue;
    const gate = normalizePlaybookRunQueueGate((droneEntry as any)?.playbookQueueGate);
    if (!gate || gate.playbookId !== playbookId || gate.releasedAt) continue;
    return true;
  }
  return false;
}

async function summarizePlaybookRunQueueItems(regAny: any): Promise<
  Array<
    PlaybookRunQueueItem & {
      remainingCount: number;
      state: PlaybookRunQueueState;
    }
  >
> {
  return (await canonicalPlaybookQueueItems(regAny))
    .map((item) => {
      const remainingCount = Math.max(
        0,
        item.requestedCount - item.launchedCount - item.inFlightCount,
      );
      const state: PlaybookRunQueueState = item.error
        ? 'error'
        : item.inFlightCount > 0
          ? 'launching'
          : item.serializeFirstMessageGroup &&
              hasActivePlaybookRunQueueGate(regAny, item.playbookId)
            ? 'waiting'
            : 'queued';
      return {
        ...item,
        remainingCount,
        state,
      };
    })
    .filter((item) => item.remainingCount > 0 || Boolean(item.error));
}
function makeDroneIdentity(): string {
  return crypto.randomUUID();
}

async function startPlaybookRunLaunch(opts: {
  playbookId: string;
  repoPath: string;
  pullHostBranchBeforeCreate: boolean;
  queueItemId?: string | null;
  serializeFirstMessageGroup?: boolean;
  renderedMessages?: PlaybookMessageDefinition[] | null;
  renderedActions?: Array<{ id: string; label: string; messages: string[] }> | null;
}): Promise<{
  ok: true;
  droneId: string;
  playbookId: string;
  playbookLabel: string;
  chatName: string;
  repoPath: string;
  phase: 'starting';
}> {
  const playbookId = String(opts.playbookId ?? '').trim();
  if (!playbookId) throw new Error('missing playbook id');
  let repoPath = String(opts.repoPath ?? '').trim();
  if (!repoPath) throw new Error('missing repoPath');
  if (!path.isAbsolute(repoPath)) throw new Error('invalid repoPath (expected absolute path)');
  if (opts.pullHostBranchBeforeCreate) {
    const pulled = await gitPullHostBranchBeforeCreate(repoPath);
    repoPath = pulled.repoRoot;
  }
  const droneCli = resolveDroneCliPath();
  if (!(await fileExists(droneCli))) throw new Error(`drone CLI not found at ${droneCli}`);
  const regAny: any = await loadRegistry();
  const playbook =
    (await listCanonicalPlaybookDefinitions()).find((item) => item.id === playbookId) ?? null;
  if (!playbook) throw new Error(`unknown playbook: ${playbookId}`);
  const playbookMessages = Array.isArray(opts.renderedMessages)
    ? opts.renderedMessages
    : playbook.messages;
  const playbookActions = Array.isArray(opts.renderedActions)
    ? opts.renderedActions
    : playbook.actions;
  if (playbookMessages.length === 0) throw new Error('playbook has no messages');
  const playbookAgent = normalizePlaybookAgent(playbook.agent);
  const playbookModel = normalizePlaybookModel(playbook.model, playbookAgent);
  const droneId = makeDroneIdentity();
  const name = allocateUntitledDisplayName(regAny);
  const at = nowIso();
  const runtime: DroneRuntime = 'container';
  const containerPort = 7777;
  const createdEnvironment = await deriveCanonicalCreatedDroneEnvironmentConfig(regAny, {
    repoPath,
    runtime,
  });
  const startupQueuedPrompts = playbookMessages.map((message, index) => ({
    id: `${droneId.replace(/[^A-Za-z0-9._-]+/g, '').slice(0, 24)}-${String(index + 1).padStart(2, '0')}`,
    chatName: 'default',
    at,
    prompt: message.prompt,
    ...(message.id ? { messageId: message.id } : {}),
    state: 'queued' as const,
    updatedAt: at,
  }));
  const queueGate =
    opts.serializeFirstMessageGroup && opts.queueItemId
      ? {
          queueItemId: String(opts.queueItemId).trim(),
          playbookId: playbook.id,
          chatName: 'default',
          initialPromptIds: startupQueuedPrompts.map((item) => item.id),
        }
      : null;
  await upsertCanonicalDroneLifecycle('pending', droneId, {
    id: droneId,
    name,
    kind: 'playbook-run',
    visibility: 'hidden',
    playbook: {
      id: playbook.id,
      label: playbook.label,
      messageCount: playbookMessages.length,
      chatName: 'default',
      artifacts: playbook.artifacts,
      actions: playbookActions,
    },
    repoPath,
    runtime,
    containerPort,
    build: false,
    createdAt: at,
    updatedAt: at,
    phase: 'starting',
    message: `Launching ${playbook.label}…`,
    environment: createdEnvironment,
    seed: {
      chatName: 'default',
      agent: playbookAgent,
      ...(playbookModel ? { model: playbookModel } : {}),
    },
    startupQueuedPrompts,
    ...(queueGate ? { playbookQueueGate: queueGate } : {}),
  });
  enqueueProvisioning(droneId);
  return {
    ok: true,
    droneId,
    playbookId: playbook.id,
    playbookLabel: playbook.label,
    chatName: 'default',
    repoPath,
    phase: 'starting',
  };
}

async function drainPlaybookRunLaunchQueue(): Promise<void> {
  const regLatest: any = (globalThis as any).Bun
    ? await loadRegistry()
    : (readCanonicalActiveDroneModel() ?? (await loadRegistry()));
  const previousGates = new Map<string, string>();
  for (const [state, bucket] of [
    ['pending', regLatest?.pending],
    ['real', regLatest?.drones],
  ] as const) {
    for (const [droneId, entry] of Object.entries(bucket ?? {}) as Array<[string, any]>) {
      previousGates.set(`${state}:${droneId}`, JSON.stringify(entry?.playbookQueueGate ?? null));
    }
  }
  if (reconcilePlaybookRunQueueGates(regLatest)) {
    for (const [state, bucket] of [
      ['pending', regLatest?.pending],
      ['real', regLatest?.drones],
    ] as const) {
      for (const [droneId, entry] of Object.entries(bucket ?? {}) as Array<[string, any]>) {
        if (
          previousGates.get(`${state}:${droneId}`) ===
          JSON.stringify(entry?.playbookQueueGate ?? null)
        )
          continue;
        await commitDroneMetadataPatch({
          droneId,
          state,
          eventType: 'drone.playbook-queue-gate.released',
          transform: (lifecycle) => ({ ...lifecycle, playbookQueueGate: entry.playbookQueueGate }),
        });
      }
    }
  }
  const items = await canonicalPlaybookQueueItems(regLatest);
  const store = await workflowStoreOrCompatibility();
  const claimedSerialPlaybookIds = new Set<string>();
  const plans: Array<{
    queueItemId: string;
    playbookId: string;
    repoPath: string;
    pullHostBranchBeforeCreate: boolean;
    serializeFirstMessageGroup: boolean;
  }> = [];
  for (const item of items) {
    const remainingCount = Math.max(
      0,
      item.requestedCount - item.launchedCount - item.inFlightCount,
    );
    if (remainingCount <= 0 || item.error) continue;
    const blockedBySerialGate =
      item.serializeFirstMessageGroup &&
      (claimedSerialPlaybookIds.has(item.playbookId) ||
        hasActivePlaybookRunQueueGate(regLatest, item.playbookId));
    if (blockedBySerialGate) continue;
    const claimCount = item.serializeFirstMessageGroup ? 1 : remainingCount;
    item.inFlightCount += claimCount;
    item.updatedAt = nowIso();
    if (store) await store.updateQueue<PlaybookRunQueueItem>(item.id, () => ({ ...item }));
    if (item.serializeFirstMessageGroup) claimedSerialPlaybookIds.add(item.playbookId);
    for (let index = 0; index < claimCount; index += 1) {
      plans.push({
        queueItemId: item.id,
        playbookId: item.playbookId,
        repoPath: item.repoPath,
        pullHostBranchBeforeCreate: item.pullHostBranchBeforeCreate,
        serializeFirstMessageGroup: item.serializeFirstMessageGroup,
      });
    }
  }
  if (!store) await updateRegistry((registry: any) => writePlaybookRunQueueItems(registry, items));
  for (const plan of plans) {
    try {
      await startPlaybookRunLaunch({
        playbookId: plan.playbookId,
        repoPath: plan.repoPath,
        pullHostBranchBeforeCreate: plan.pullHostBranchBeforeCreate,
        queueItemId: plan.queueItemId,
        serializeFirstMessageGroup: plan.serializeFirstMessageGroup,
      });
      if (store) {
        await store.updateQueue<PlaybookRunQueueItem>(plan.queueItemId, (item) => {
          const nextInflight = Math.max(0, item.inFlightCount - 1);
          const nextLaunched = Math.min(item.requestedCount, item.launchedCount + 1);
          return {
            ...item,
            inFlightCount: nextInflight,
            launchedCount: nextLaunched,
            updatedAt: nowIso(),
            error: undefined,
          };
        });
      } else
        await updateRegistry((registry: any) => {
          const rows = readPlaybookRunQueueItems(registry).map((item) =>
            item.id === plan.queueItemId
              ? {
                  ...item,
                  inFlightCount: Math.max(0, item.inFlightCount - 1),
                  launchedCount: Math.min(item.requestedCount, item.launchedCount + 1),
                  updatedAt: nowIso(),
                  error: undefined,
                }
              : item,
          );
          writePlaybookRunQueueItems(registry, rows);
        });
    } catch (error: any) {
      const message = error?.message ?? String(error);
      if (store) {
        await store.updateQueue<PlaybookRunQueueItem>(plan.queueItemId, (item) => ({
          ...item,
          inFlightCount: Math.max(0, item.inFlightCount - 1),
          updatedAt: nowIso(),
          error: message,
        }));
      } else
        await updateRegistry((registry: any) => {
          const rows = readPlaybookRunQueueItems(registry).map((item) =>
            item.id === plan.queueItemId
              ? {
                  ...item,
                  inFlightCount: Math.max(0, item.inFlightCount - 1),
                  updatedAt: nowIso(),
                  error: message,
                }
              : item,
          );
          writePlaybookRunQueueItems(registry, rows);
        });
      hubLog('warn', 'playbook run queue launch failed', {
        queueItemId: plan.queueItemId,
        playbookId: plan.playbookId,
        repoPath: plan.repoPath,
        error: message,
      });
    }
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
} = createPendingDroneStateHelpers({ normalizeChatName, nowIso });

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

function normalizePromptAutomationRuns(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return PROMPT_AUTOMATION_RUNS_DEFAULT;
  return Math.max(PROMPT_AUTOMATION_RUNS_MIN, Math.min(PROMPT_AUTOMATION_RUNS_MAX, Math.round(n)));
}

function normalizePromptAutomationSleepBetweenRunsSeconds(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_DEFAULT;
  return Math.max(
    PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_MIN,
    Math.min(PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_MAX, Math.round(n)),
  );
}

function normalizePromptAutomationSleepBetweenRunsSecondsFromBody(raw: unknown): number {
  const body = raw && typeof raw === 'object' ? (raw as any) : {};
  const directSecondsRaw = Number(body?.sleepBetweenRunsSeconds);
  if (Number.isFinite(directSecondsRaw)) {
    return normalizePromptAutomationSleepBetweenRunsSeconds(directSecondsRaw);
  }

  const amountRaw = Number(body?.sleepAmount);
  if (!Number.isFinite(amountRaw)) return PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_DEFAULT;
  const amount = Math.max(0, Math.round(amountRaw));
  const unitRaw = String(body?.sleepUnit ?? '')
    .trim()
    .toLowerCase();
  const multiplier =
    unitRaw === 'days'
      ? 24 * 60 * 60
      : unitRaw === 'hours'
        ? 60 * 60
        : unitRaw === 'minutes'
          ? 60
          : 1;
  return normalizePromptAutomationSleepBetweenRunsSeconds(amount * multiplier);
}

function normalizePromptAutomationStopPhrase(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .slice(0, PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS);
}

function normalizePromptAutomationStopPhraseCaseSensitive(raw: unknown): boolean {
  return raw === true;
}

function normalizePromptAutomationOnFailurePrompt(raw: unknown): string {
  return String(raw ?? '')
    .slice(0, PROMPT_AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS)
    .trim();
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
const CHAT_MODEL_DISCOVERY_CACHE_TTL_MS = 5 * 60 * 1000;
const chatModelDiscoveryCache = new Map<
  string,
  {
    atMs: number;
    models: DiscoveredModelOption[];
    error?: string;
  }
>();
const latestChatModelDiscoveryByAgent = new Map<
  string,
  {
    atMs: number;
    models: DiscoveredModelOption[];
    source: 'live' | 'cache';
  }
>();
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

const PROMPT_AUTOMATION_RUNS_MIN = 1;
const PROMPT_AUTOMATION_RUNS_MAX = 20;
const PROMPT_AUTOMATION_RUNS_DEFAULT = 5;
const PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_MIN = 0;
const PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_MAX = 10 * 365 * 24 * 60 * 60;
const PROMPT_AUTOMATION_SLEEP_BETWEEN_RUNS_SECONDS_DEFAULT = 0;
const PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS = 320;
const PROMPT_AUTOMATION_WAIT_POLL_MS = 120;
const PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS = 30 * 60_000;
const PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS = 30 * 60_000;
const PROMPT_AUTOMATION_ON_FAILURE_PROMPT_MAX_CHARS = 8_000;
const PROMPT_AUTOMATION_INTER_RUN_SLEEP_CHUNK_MS = 120;
const AGENT_COPILOT_HANDLED_CAP = 500;
const agentFollowupCoordinator = new AgentFollowupCoordinator();

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
const PROMPT_AUTOMATION_COMPLETION_STALL_RECOVERY_GRACE_MS = 15_000;

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

function stripAnsiFromCliOutput(text: string): string {
  // eslint-disable-next-line no-control-regex
  return String(text ?? '')
    .replace(
      /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()][A-Z0-9]|\x1b[A-Z@-_]/g,
      '',
    )
    .replace(/\r/g, '');
}

function modelDiscoveryCacheKey(opts: {
  droneName: string;
  chatName: string;
  agent: BuiltinAgentId;
}): string {
  return `${opts.droneName}::${opts.chatName}::${opts.agent}`;
}

function normalizeDiscoveredReasoningLevels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const levels: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object'
          ? ((item as any).reasoning_effort ??
            (item as any).reasoningEffort ??
            (item as any).effort ??
            (item as any).level ??
            (item as any).name)
          : '';
    const level = normalizeChatReasoning(value);
    if (!level || seen.has(level)) continue;
    seen.add(level);
    levels.push(level);
  }
  return levels;
}

function reasoningMetadataFromDiscoveredModel(value: any): {
  reasoningLevels?: string[];
  defaultReasoningLevel?: string;
} {
  const reasoningLevels = normalizeDiscoveredReasoningLevels(
    value?.reasoningLevels ??
      value?.reasoning_levels ??
      value?.supportedReasoningLevels ??
      value?.supported_reasoning_levels ??
      value?.supportedReasoningEfforts ??
      value?.supported_reasoning_efforts,
  );
  const defaultReasoningLevel = normalizeChatReasoning(
    value?.defaultReasoningLevel ??
      value?.default_reasoning_level ??
      value?.defaultReasoningEffort ??
      value?.default_reasoning_effort,
  );
  return {
    ...(reasoningLevels.length > 0 ? { reasoningLevels } : {}),
    ...(defaultReasoningLevel ? { defaultReasoningLevel } : {}),
  };
}

function parseDiscoveredModelsFromOutput(raw: string): DiscoveredModelOption[] {
  const text = stripAnsiFromCliOutput(raw);
  const out: DiscoveredModelOption[] = [];
  const seen = new Set<string>();

  const add = (
    idRaw: any,
    labelRaw?: any,
    opts?: {
      isDefault?: boolean;
      isCurrent?: boolean;
      reasoningLevels?: string[];
      defaultReasoningLevel?: string;
    },
  ) => {
    const id = String(idRaw ?? '').trim();
    if (!id) return;
    if (id.length > CHAT_MODEL_MAX_LEN) return;
    if (seen.has(id)) return;
    seen.add(id);
    const label = String(labelRaw ?? '').trim() || id;
    out.push({
      id,
      label,
      ...(opts?.isDefault ? { isDefault: true } : {}),
      ...(opts?.isCurrent ? { isCurrent: true } : {}),
      ...(opts?.reasoningLevels?.length ? { reasoningLevels: opts.reasoningLevels } : {}),
      ...(opts?.defaultReasoningLevel ? { defaultReasoningLevel: opts.defaultReasoningLevel } : {}),
    });
  };

  const addFromUnknown = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) addFromUnknown(item);
      return;
    }
    if (typeof value === 'string') {
      add(value, value);
      return;
    }
    if (typeof value !== 'object') return;
    const id =
      (value as any).id ?? (value as any).model ?? (value as any).name ?? (value as any).slug;
    const label =
      (value as any).label ??
      (value as any).displayName ??
      (value as any).name ??
      (value as any).model ??
      id;
    add(id, label, {
      isDefault: Boolean((value as any).default),
      isCurrent: Boolean((value as any).current),
      ...reasoningMetadataFromDiscoveredModel(value),
    });
    const nested = (value as any).models ?? (value as any).items ?? (value as any).data ?? null;
    if (nested) addFromUnknown(nested);
  };

  const trimmed = text.trim();
  if (!trimmed) return out;

  // Try full JSON payload first.
  try {
    const parsed = JSON.parse(trimmed);
    addFromUnknown(parsed);
  } catch {
    // ignore
  }

  // Try JSONL-ish lines.
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!(line.startsWith('{') || line.startsWith('['))) continue;
    try {
      const parsed = JSON.parse(line);
      addFromUnknown(parsed);
    } catch {
      // ignore
    }
  }

  // Parse human-readable model lists (e.g. "id - Label (default)").
  for (const rawLine of lines) {
    const line = rawLine.replace(/^\s*[-*]\s+/, '');
    if (!line) continue;
    const low = line.toLowerCase();
    if (
      low.startsWith('usage:') ||
      low.startsWith('available models') ||
      low.startsWith('loading models') ||
      low.startsWith('tip:') ||
      low.startsWith('options:')
    ) {
      continue;
    }
    const withLabel = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})\s*-\s*(.+)$/);
    if (withLabel) {
      const label = String(withLabel[2] ?? '')
        .replace(/\s+\((default|current)\)\s*$/i, '')
        .trim();
      add(withLabel[1], label || withLabel[1], {
        isDefault: /\(default\)\s*$/i.test(line),
        isCurrent: /\(current\)\s*$/i.test(line),
      });
      continue;
    }
    const idOnly = line.match(/^([A-Za-z0-9][A-Za-z0-9._:/+-]{0,159})$/);
    if (idOnly) add(idOnly[1], idOnly[1]);
  }

  return out;
}

function parseCodexModelsCache(raw: string): DiscoveredModelOption[] {
  const out: DiscoveredModelOption[] = [];
  const seen = new Set<string>();
  const add = (
    idRaw: any,
    labelRaw?: any,
    opts?: {
      isDefault?: boolean;
      isCurrent?: boolean;
      reasoningLevels?: string[];
      defaultReasoningLevel?: string;
    },
  ) => {
    const id = String(idRaw ?? '').trim();
    if (!id || seen.has(id) || id.length > CHAT_MODEL_MAX_LEN) return;
    seen.add(id);
    const label = String(labelRaw ?? '').trim() || id;
    out.push({
      id,
      label,
      ...(opts?.isDefault ? { isDefault: true } : {}),
      ...(opts?.isCurrent ? { isCurrent: true } : {}),
      ...(opts?.reasoningLevels?.length ? { reasoningLevels: opts.reasoningLevels } : {}),
      ...(opts?.defaultReasoningLevel ? { defaultReasoningLevel: opts.defaultReasoningLevel } : {}),
    });
  };
  try {
    const parsed = JSON.parse(String(raw ?? ''));
    const list = Array.isArray((parsed as any)?.models) ? (parsed as any).models : [];
    const current = String(
      (parsed as any)?.current_model ?? (parsed as any)?.currentModel ?? '',
    ).trim();
    const def = String(
      (parsed as any)?.default_model ?? (parsed as any)?.defaultModel ?? '',
    ).trim();
    for (const m of list) {
      const id = (m as any)?.slug ?? (m as any)?.id ?? (m as any)?.model ?? (m as any)?.name;
      const label = (m as any)?.display_name ?? (m as any)?.displayName ?? (m as any)?.label ?? id;
      const modelId = String(id ?? '').trim();
      add(modelId, label, {
        isCurrent: current ? modelId === current : false,
        isDefault: def ? modelId === def : false,
        ...reasoningMetadataFromDiscoveredModel(m),
      });
    }
  } catch {
    return [];
  }
  return out;
}
async function discoverModelsForBuiltinAgent(opts: {
  containerName: string;
  containerPort?: number;
  runtime?: DroneRuntime;
  droneName: string;
  chatName: string;
  agentId: BuiltinAgentId;
  forceRefresh?: boolean;
}): Promise<{
  models: DiscoveredModelOption[];
  source: 'live' | 'cache' | 'none';
  discoveredAt: string;
  error?: string;
}> {
  const key = modelDiscoveryCacheKey({
    droneName: opts.droneName,
    chatName: opts.chatName,
    agent: opts.agentId,
  });
  const now = Date.now();
  const cached = chatModelDiscoveryCache.get(key);
  if (!opts.forceRefresh && cached && now - cached.atMs < CHAT_MODEL_DISCOVERY_CACHE_TTL_MS) {
    return {
      models: cached.models,
      source: 'cache',
      discoveredAt: new Date(cached.atMs).toISOString(),
      ...(cached.error ? { error: cached.error } : {}),
    };
  }

  const binByAgent: Record<BuiltinAgentId, string> = {
    cursor: 'agent',
    codex: 'codex',
    claude: 'claude',
    opencode: 'opencode',
    pi: 'pi',
    blip: 'blip',
  };
  const bin = binByAgent[opts.agentId];
  const runtime = opts.runtime ?? 'container';

  if (runtime === 'host') {
    if (opts.agentId !== 'blip') {
      const error = `${bin} model discovery is not supported for host runtime`;
      chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
      return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
    }
    const r = await runHostCommand(
      'bash',
      ['-lc', `${resolveBlipPromptCommand('host')} --list-models`],
      {
        timeoutMs: defaultSeedBootstrapTimeoutMs(),
      },
    );
    const parsed = parseDiscoveredModelsFromOutput(`${r.stdout || ''}\n${r.stderr || ''}`);
    if (parsed.length > 0) {
      chatModelDiscoveryCache.set(key, { atMs: now, models: parsed });
      return { models: parsed, source: 'live', discoveredAt: new Date(now).toISOString() };
    }
    const error = r.stderr || r.stdout || 'failed discovering Blip models';
    chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
    return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
  }

  let exists = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    `command -v ${bin} >/dev/null 2>&1`,
  ]);
  if (exists.code !== 0 && opts.agentId === 'blip') {
    try {
      await upgradeDroneDaemonInContainer({
        containerName: opts.containerName,
        containerPort: Number(opts.containerPort ?? 7777),
      });
      exists = await dvmExec(opts.containerName, 'bash', [
        '-lc',
        `command -v ${bin} >/dev/null 2>&1`,
      ]);
    } catch {
      // Fall through to the normal "not installed" response below.
    }
  }
  if (exists.code !== 0) {
    const error = `${bin} is not installed in this drone`;
    chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
    return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
  }

  const help = await dvmExec(opts.containerName, 'bash', ['-lc', `${bin} --help`]);
  const helpText = stripAnsiFromCliOutput(`${help.stdout || ''}\n${help.stderr || ''}`);
  const hasModelsCommand = helpText
    .split('\n')
    .map((l) => l.trim())
    .some((l) => /^models?(?:\s{2,}.*)?$/i.test(l));
  const candidates: string[] = [];
  if (/\b--list-models\b/i.test(helpText)) candidates.push(`${bin} --list-models`);
  if (hasModelsCommand) {
    candidates.push(`${bin} models --json`);
    candidates.push(`${bin} models list --json`);
    candidates.push(`${bin} models`);
    candidates.push(`${bin} models list`);
  }
  // Explicit fallbacks for known CLIs.
  if (opts.agentId === 'cursor') {
    candidates.push('agent --list-models');
    candidates.push('agent models');
  }
  if (opts.agentId === 'codex') {
    // Probe common Codex model-list commands even when `--help` doesn't advertise them.
    candidates.push('codex models --json');
    candidates.push('codex models list --json');
    candidates.push('codex models');
    candidates.push('codex models list');
  }
  if (opts.agentId === 'claude') {
    candidates.push('claude models --json');
    candidates.push('claude models');
  }
  if (opts.agentId === 'opencode') {
    candidates.push('opencode models --json');
    candidates.push('opencode models');
  }
  if (opts.agentId === 'pi') {
    candidates.push('pi --list-models');
  }
  if (opts.agentId === 'blip') {
    candidates.push('blip --list-models');
  }

  const deduped = Array.from(new Set(candidates.map((c) => c.trim()).filter(Boolean)));
  for (const cmd of deduped) {
    const r = await dvmExec(opts.containerName, 'bash', ['-lc', cmd], {
      timeoutMs: defaultSeedBootstrapTimeoutMs(),
    });
    const parsed = parseDiscoveredModelsFromOutput(`${r.stdout || ''}\n${r.stderr || ''}`);
    if (parsed.length > 0) {
      chatModelDiscoveryCache.set(key, { atMs: now, models: parsed });
      return { models: parsed, source: 'live', discoveredAt: new Date(now).toISOString() };
    }
  }

  // Codex fallback: read Codex's local model cache file when direct CLI listing is unavailable.
  if (opts.agentId === 'codex') {
    const cacheProbeScript = [
      'set -euo pipefail',
      'paths=("$HOME/.codex/models_cache.json" "/root/.codex/models_cache.json" "/dvm-data/home/.codex/models_cache.json")',
      'for p in "${paths[@]}"; do',
      '  if [ -f "$p" ]; then',
      '    echo "__PATH__\\t$p"',
      '    cat "$p"',
      '    exit 0',
      '  fi',
      'done',
      'exit 1',
    ].join('\n');
    const r = await dvmExec(opts.containerName, 'bash', ['-lc', cacheProbeScript], {
      timeoutMs: defaultSeedBootstrapTimeoutMs(),
    });
    if (r.code === 0) {
      const combined = String(r.stdout || '');
      const jsonStart = combined.indexOf('{');
      if (jsonStart >= 0) {
        const parsedCache = parseCodexModelsCache(combined.slice(jsonStart));
        if (parsedCache.length > 0) {
          chatModelDiscoveryCache.set(key, { atMs: now, models: parsedCache });
          return { models: parsedCache, source: 'live', discoveredAt: new Date(now).toISOString() };
        }
      }
    }

    // Final Codex fallback: host-side cache file (helps when drone cache is cold).
    const hostCandidates = Array.from(
      new Set([
        path.join(os.homedir(), '.codex', 'models_cache.json'),
        '/root/.codex/models_cache.json',
      ]),
    );
    for (const p of hostCandidates) {
      try {
        const raw = await fs.readFile(p, 'utf8');
        const parsedCache = parseCodexModelsCache(raw);
        if (parsedCache.length > 0) {
          chatModelDiscoveryCache.set(key, { atMs: now, models: parsedCache });
          return { models: parsedCache, source: 'live', discoveredAt: new Date(now).toISOString() };
        }
      } catch {
        // ignore and continue
      }
    }
  }
  const error =
    deduped.length > 0
      ? `no models discovered for ${opts.agentId} (tried ${deduped.length} command${deduped.length === 1 ? '' : 's'})`
      : `no model discovery command available for ${opts.agentId}`;
  chatModelDiscoveryCache.set(key, { atMs: now, models: [], error });
  return { models: [], source: 'none', discoveredAt: new Date(now).toISOString(), error };
}

function modelCatalogCacheKey(runtime: DroneRuntime, agentId: BuiltinAgentId): string {
  return `${runtime}:${agentId}`;
}

async function discoverAndRememberModelsForBuiltinAgent(
  opts: Parameters<typeof discoverModelsForBuiltinAgent>[0],
): ReturnType<typeof discoverModelsForBuiltinAgent> {
  const discovered = await discoverModelsForBuiltinAgent(opts);
  const runtime = opts.runtime ?? 'container';
  const models = discovered.models.map((model) =>
    opts.agentId === 'codex' || opts.agentId === 'blip'
      ? model
      : {
          id: model.id,
          label: model.label,
          ...(model.isDefault ? { isDefault: true } : {}),
          ...(model.isCurrent ? { isCurrent: true } : {}),
        },
  );
  if (models.length > 0) {
    const discoveredAtMs = Date.parse(discovered.discoveredAt);
    latestChatModelDiscoveryByAgent.set(modelCatalogCacheKey(runtime, opts.agentId), {
      atMs: Number.isFinite(discoveredAtMs) ? discoveredAtMs : Date.now(),
      models,
      source: discovered.source === 'cache' ? 'cache' : 'live',
    });
  }
  return { ...discovered, models };
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
  if (cached && now - cached.atMs < CHAT_MODEL_DISCOVERY_CACHE_TTL_MS) return cached.supported;
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

async function enqueueTranscriptPrompt(opts: {
  id?: string;
  drone: any;
  waitForDaemonMs?: number;
  kind: string;
  script: string;
  prompt?: string;
}) {
  const d = opts.drone;
  const containerName = String(d?.containerName ?? d?.name ?? '').trim();
  const token = typeof d.token === 'string' ? d.token : '';
  const hostPort =
    typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
      ? d.hostPort
      : await resolveHostPort(containerName, d.containerPort);
  if (!hostPort || !token) throw new Error('drone daemon not reachable (missing hostPort/token)');
  const daemonReadyTimeoutMs =
    typeof opts.waitForDaemonMs === 'number' &&
    Number.isFinite(opts.waitForDaemonMs) &&
    opts.waitForDaemonMs > 0
      ? Math.floor(opts.waitForDaemonMs)
      : defaultDaemonReadyTimeoutMs();
  const daemonReadyAfterUpgradeTimeoutMs =
    typeof opts.waitForDaemonMs === 'number' &&
    Number.isFinite(opts.waitForDaemonMs) &&
    opts.waitForDaemonMs > 0
      ? Math.floor(opts.waitForDaemonMs)
      : Math.max(daemonReadyTimeoutMs, UPGRADE_DAEMON_READY_TIMEOUT_MS);
  const client = makeClient(hostPort, token);
  await waitForDroneDaemonReady(client, daemonReadyTimeoutMs);
  const droneId = normalizeDroneIdentity(d?.id) || String(d?.name ?? '');
  try {
    await dronePromptEnqueue(client, {
      id: String(opts.id ?? ''),
      kind: opts.kind,
      cmd: 'bash',
      args: ['-lc', opts.script],
      ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
    });
    ensureDaemonPromptEventSubscription(droneId);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (isNotFoundErrorMessage(msg)) {
      await upgradeDroneDaemonInContainer({ containerName, containerPort: d.containerPort });
      await waitForDroneDaemonReady(client, daemonReadyAfterUpgradeTimeoutMs);
      await dronePromptEnqueue(client, {
        id: String(opts.id ?? ''),
        kind: opts.kind,
        cmd: 'bash',
        args: ['-lc', opts.script],
        ...(typeof opts.prompt === 'string' ? { prompt: opts.prompt } : {}),
      });
      ensureDaemonPromptEventSubscription(droneId);
      return;
    }
    throw e;
  }
}

async function sendPromptToChat(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  attachmentRefs?: ChatImageAttachmentRef[];
  cwd?: string | null;
  waitForDaemonMs?: number;
  skipManagedRepoSync?: boolean;
  mark?: (name: string) => void;
}) {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing droneId');

  const regAny: any = await loadRegistry();
  if (regAny?.pending?.[droneId] && !regAny?.drones?.[droneId]) {
    throw new Error(`drone "${droneId}" is still starting`);
  }
  const dSeed = (regAny as any).drones?.[droneId];
  if (!dSeed) throw new Error(`unknown drone: ${droneId}`);

  if (opts.skipManagedRepoSync !== true) {
    try {
      await syncSkillLibraryForDrone({ droneId, droneEntry: dSeed });
      await syncMcpServersForDrone({ droneId, droneEntry: dSeed });
      await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: dSeed });
      opts.mark?.('skillSync');
    } catch (e: any) {
      const error = String(e?.message ?? String(e));
      const warningKey = `${droneId}\u0000${error}`;
      if (!PROMPT_SKILL_SYNC_WARNINGS.has(warningKey)) {
        PROMPT_SKILL_SYNC_WARNINGS.add(warningKey);
        hubLog('warn', 'managed repo sync failed before prompt enqueue; continuing', {
          droneId,
          chatName: opts.chatName || 'default',
          error,
        });
      }
    }
  }

  const lockKey = `drone:${droneId}`;

  return await withDroneOpLock(lockKey, async () => {
    const regLatest: any = await loadRegistry();
    if (regLatest?.pending?.[droneId] && !regLatest?.drones?.[droneId]) {
      throw new Error(`drone "${droneId}" is still starting`);
    }
    const d: any = (regLatest as any).drones?.[droneId] ?? null;
    if (!d) throw new Error(`unknown drone: ${droneId}`);
    const droneLabel = String(d?.name ?? '').trim() || droneId;
    const runtime = droneRuntime(d);
    const containerName =
      String(d?.containerName ?? '').trim() || String(d?.name ?? '').trim() || droneId;

    const normalizedChat = opts.chatName || 'default';
    await ensureChatEntry({ droneId, chatName: normalizedChat });

    const { d: dWithChat, chat } = await getChatEntry({ droneId, chatName: normalizedChat });
    const agent = inferChatAgent(chat, dWithChat);
    const chatModel = normalizeChatModel((chat as any)?.model);
    const chatReasoning = normalizeChatReasoning((chat as any)?.reasoning);
    const agentPermissionMode = normalizeAgentPermissionMode((chat as any)?.agentPermissionMode);
    if (agentPermissionMode === 'read-only') assertReadOnlySupportedForAgent(agent);
    const managedEnv = resolveDroneEnvironmentConfig(regLatest, d).resolvedVars;
    const managedEnvLines = buildEnvExportLines(managedEnv);

    const cwd = normalizeDroneCwdForRuntime(d, typeof opts.cwd === 'string' ? opts.cwd : null);
    const cdCommand =
      runtime === 'host'
        ? `cd ${bashQuote(cwd)} 2>/dev/null || cd /`
        : `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data || cd /`;

    const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
    const providedAttachmentRefs = normalizeChatImageAttachmentRefs(opts.attachmentRefs);
    const promptId = String(opts.id ?? '').trim() || crypto.randomBytes(9).toString('hex');
    const attachmentsStorageRoot = chatAttachmentsStorageRootForDrone(d);
    const attachmentsForPrompt =
      providedAttachmentRefs.length > 0
        ? providedAttachmentRefs
        : buildChatImageAttachmentRefs({
            attachments,
            cwd,
            chatName: normalizedChat,
            promptId,
            storageRoot: attachmentsStorageRoot,
          });
    const effectivePrompt = promptWithImageAttachments(opts.prompt, attachmentsForPrompt);
    const codexImageArgs = codexImageAttachmentFlags(attachmentsForPrompt);
    const promptWithHistory =
      agent.kind === 'builtin'
        ? maybeBootstrapPromptFromTranscript({
            agentId: agent.id,
            prompt: effectivePrompt,
            chatEntry: chat,
          })
        : effectivePrompt;
    if (attachments.length > 0) {
      const attachmentsDir = buildChatAttachmentsDirectory({
        cwd,
        chatName: normalizedChat,
        promptId,
        storageRoot: attachmentsStorageRoot,
      });
      if (runtime === 'host') {
        await copyChatAttachmentsToHost({ hostDir: attachmentsDir, attachments });
      } else {
        await copyChatAttachmentsToContainer({
          containerName,
          containerDir: attachmentsDir,
          attachments,
        });
      }
    }

    if (agent.kind === 'builtin' && agent.id === 'cursor') {
      const chatId = await ensureCursorChatId({
        droneId,
        containerName,
        chatName: normalizedChat,
        runtime,
        cwd,
        promptId,
      });
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `agent${modelArg} --resume ${bashQuote(chatId)} -f --approve-mcps --print --output-format stream-json ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'cursor',
        script,
        prompt: effectivePrompt,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        turnOk: true as const,
      };
    }

    if (agent.kind === 'builtin' && agent.id === 'codex') {
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const reasoningArg = chatReasoning
        ? ` -c ${bashQuote(`model_reasoning_effort="${chatReasoning}"`)}`
        : '';
      const sandboxArg = agentPermissionMode === 'read-only' ? 'read-only' : 'danger-full-access';
      const existingThreadId = readBuiltinTranscriptSessionId(chat, 'codex');
      if (!existingThreadId) {
        const script = [
          'set -euo pipefail',
          ...buildContainerManagedEnvLines(d),
          ...managedEnvLines,
          `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
          cdCommand,
          `codex --ask-for-approval never${reasoningArg} exec${modelArg} --skip-git-repo-check --sandbox ${sandboxArg} --json --color never${codexImageArgs} ${bashQuote(promptWithHistory)}`,
        ].join('\n');
        await enqueueTranscriptPrompt({
          id: opts.id,
          drone: d,
          waitForDaemonMs: opts.waitForDaemonMs,
          kind: 'codex',
          script,
          prompt: effectivePrompt,
        });
        return {
          ok: true as const,
          agent,
          mode: 'transcript' as const,
          chat: normalizedChat,
          codexThreadId: null,
          turnOk: true as const,
        };
      }

      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `codex --ask-for-approval never${reasoningArg} exec${modelArg} --skip-git-repo-check --sandbox ${sandboxArg} --json --color never resume${codexImageArgs} ${bashQuote(existingThreadId)} ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'codex',
        script,
        prompt: effectivePrompt,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        codexThreadId: existingThreadId,
        turnOk: true as const,
      };
    }

    if (agent.kind === 'builtin' && agent.id === 'claude') {
      const claudeSessionId = await ensureClaudeSessionId({ droneId, chatName: normalizedChat });
      const supportsModel = chatModel
        ? await cliSupportsModelFlag({ runtime, containerName, cwd, bin: 'claude' })
        : false;
      const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `claude --print --dangerously-skip-permissions --output-format stream-json --verbose${modelArg} --session-id ${bashQuote(claudeSessionId)} ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'claude',
        script,
        prompt: effectivePrompt,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        claudeSessionId,
        turnOk: true as const,
      };
    }

    if (agent.kind === 'builtin' && agent.id === 'opencode') {
      const supportsModel = chatModel
        ? await cliSupportsModelFlag({ runtime, containerName, cwd, bin: 'opencode' })
        : false;
      const modelArg = chatModel && supportsModel ? ` --model ${bashQuote(chatModel)}` : '';
      const openCodeSessionId = readBuiltinTranscriptSessionId(chat, 'opencode');
      const title = openCodeSessionTitle(droneLabel, normalizedChat);
      const resumeArg = openCodeSessionId ? ` --session ${bashQuote(openCodeSessionId)}` : '';
      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `opencode run --format json --title ${bashQuote(title)}${modelArg}${resumeArg} ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'opencode',
        script,
        prompt: effectivePrompt,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        openCodeSessionId: openCodeSessionId || null,
        turnOk: true as const,
      };
    }

    if (agent.kind === 'builtin' && agent.id === 'pi') {
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const piSessionId = readBuiltinTranscriptSessionId(chat, 'pi');
      const sessionArg = piSessionId ? ` --session ${bashQuote(piSessionId)}` : '';
      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `pi --mode json${modelArg}${sessionArg} ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'pi',
        script,
        prompt: effectivePrompt,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        piSessionId: piSessionId || null,
        turnOk: true as const,
      };
    }

    if (agent.kind === 'builtin' && agent.id === 'blip') {
      const modelArg = chatModel ? ` --model ${bashQuote(chatModel)}` : '';
      const reasoningArg = chatReasoning ? ` --reasoning ${bashQuote(chatReasoning)}` : '';
      const permissionArgs =
        agentPermissionMode === 'read-only'
          ? '--permission read-only --profile read-only'
          : '--permission full-access --profile local-trusted-write';
      const blipSessionId = readBuiltinTranscriptSessionId(chat, 'blip');
      const sessionArg = blipSessionId ? ` --session ${bashQuote(blipSessionId)}` : '';
      const blipCommand = resolveBlipPromptCommand(runtime);
      const script = [
        'set -euo pipefail',
        ...buildContainerManagedEnvLines(d),
        ...managedEnvLines,
        `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
        cdCommand,
        `${blipCommand} --jsonl ${permissionArgs}${modelArg}${reasoningArg}${sessionArg} ${bashQuote(promptWithHistory)}`,
      ].join('\n');
      await enqueueTranscriptPrompt({
        id: opts.id,
        drone: d,
        waitForDaemonMs: opts.waitForDaemonMs,
        kind: 'blip',
        script,
      });
      return {
        ok: true as const,
        agent,
        mode: 'transcript' as const,
        chat: normalizedChat,
        blipSessionId: blipSessionId || null,
        turnOk: true as const,
      };
    }

    // Custom agent: keep tmux-backed full CLI behavior.
    if (runtime === 'host') {
      throw unsupportedHostCustomAgentError();
    }
    const tmuxCmd = await resolveChatTmuxCommand({ droneId, chatName: normalizedChat });
    const { sessionName } = await ensureHubChatSessionRunning({
      containerName,
      chatName: normalizedChat,
      command: tmuxCmd,
      cwd,
      envVars: managedEnv,
    });
    await dvmSessionType(containerName, sessionName, { text: effectivePrompt });
    await sleepMs(60);
    await dvmSessionType(containerName, sessionName, { keys: ['C-m'] });
    return {
      ok: true as const,
      agent,
      mode: 'cli' as const,
      chat: normalizedChat,
      sessionName,
      turnOk: true as const,
    };
  });
}

// Reconcile pending prompt completion (drone daemon → registry transcript turns).
//
// Without this, the Hub can show a stale "typing" badge for drones whose pending prompts
// have completed in the daemon but haven't been reconciled into registry turns yet.
const chatReconciliationQueue = new ChatReconciliationQueue({
  normalizeDroneId: normalizeDroneIdentity,
  normalizeChatName,
  key: droneChatMapKey,
  execute: (input) => reconcileChatFromDaemon(input),
  concurrency: () => {
    const raw = String(process.env.DRONE_HUB_RECONCILE_CONCURRENCY ?? '').trim();
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) && value >= 1 ? value : 6;
  },
});
const daemonPromptEventMonitor = new DaemonPromptEventMonitor({
  normalizeDroneId: normalizeDroneIdentity,
  resolveClient: async (droneId) => {
    const registry: any = await loadRegistry();
    const drone = registry?.drones?.[droneId] ?? null;
    if (!drone) return { exists: false, client: null };
    const daemon = await resolveDroneDaemonClientForEntry(drone);
    return { exists: true, client: daemon?.client ?? null };
  },
  onTerminalPrompt: enqueueReconcileForDaemonPromptEvent,
  sleep: sleepMs,
});

function enqueueReconcile(droneId: string, chatName: string): void {
  chatReconciliationQueue.enqueue(droneId, chatName);
}

async function enqueueReconcileForDaemonPromptEvent(
  droneIdRaw: string,
  promptIdRaw: string,
): Promise<void> {
  const droneId = normalizeDroneIdentity(droneIdRaw);
  const promptId = String(promptIdRaw ?? '').trim();
  if (!droneId || !promptId) return;
  const regAny: any = await loadRegistry();
  const chats = regAny?.drones?.[droneId]?.chats;
  if (!chats || typeof chats !== 'object') return;
  for (const [chatNameRaw, entry] of Object.entries(chats) as Array<[string, any]>) {
    const chatName = normalizeChatName(chatNameRaw);
    if (!chatName) continue;
    const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
    if (!pending.some((item: any) => String(item?.id ?? '').trim() === promptId)) continue;
    enqueueReconcile(droneId, chatName);
    enqueuePendingPromptPump(droneId, chatName);
  }
}

function ensureDaemonPromptEventSubscription(droneId: string): void {
  daemonPromptEventMonitor.ensure(droneId);
}

function clearScheduledReconcileRetryByKey(key: string): void {
  chatReconciliationQueue.clearRetryByKey(key);
}

function scheduleReconcileRetry(
  droneId: string,
  chatName: string,
  delayMs = 2_000,
): void {
  chatReconciliationQueue.scheduleRetry(droneId, chatName, delayMs);
}

function looksLikeMissingContainerError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('no such container') ||
    s.includes('not found') ||
    s.includes('unknown container') ||
    s.includes('could not find') ||
    s.includes('does not exist')
  );
}

function looksLikeContainerNotRunningError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('is not running') ||
    s.includes('already stopped') ||
    (s.includes('cannot stop') && s.includes('not running'))
  );
}

function looksLikeContainerAlreadyRunningError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return s.includes('already running') || (s.includes('cannot start') && s.includes('running'));
}

function looksLikeContainerPausedError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('is paused') ||
    s.includes('container stopped/paused') ||
    s.includes('unpause the container')
  );
}

function looksLikeRepoUnavailableError(msg: string): boolean {
  const s = String(msg ?? '').toLowerCase();
  return (
    s.includes('not a git repository') ||
    s.includes('cannot change to') ||
    s.includes('unable to read current working directory')
  );
}

const STOPPED_BY_USER_ERROR = 'Stopped by user.';
const STOPPED_BEFORE_SUBMISSION_ERROR = 'Stopped before submission.';
const STOPPED_BY_ARCHIVE_ERROR = 'Stopped because the drone was archived.';
const STOPPED_BY_DELETE_ERROR = 'Stopped because the drone was deleted.';
const STOPPED_BY_LIFECYCLE_STOP_ERROR = 'Stopped because the drone was stopped.';
const STOPPED_BY_LIFECYCLE_RESTART_ERROR = 'Stopped because the drone was restarted.';

// NOTE: Pending prompts are executed in the drone daemon (tmux-backed) and are restart-resumable.

function normalizeChatImageAttachmentRefs(raw: unknown): ChatImageAttachmentRef[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: ChatImageAttachmentRef[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const name = String((item as any).name ?? '').trim();
    const mime = String((item as any).mime ?? '')
      .trim()
      .toLowerCase();
    const sizeNum = Number((item as any).size ?? 0);
    const fileName = String((item as any).fileName ?? '').trim();
    const pathRaw = String((item as any).path ?? '').trim();
    const relRaw = String((item as any).relativePath ?? '').trim();
    if (!name || (!mime.startsWith('image/') && mime !== 'text/plain')) continue;
    if (!Number.isFinite(sizeNum) || sizeNum <= 0) continue;
    if (!pathRaw || !pathRaw.startsWith('/')) continue;
    out.push({
      name,
      mime,
      size: Math.floor(sizeNum),
      fileName: fileName || path.posix.basename(pathRaw),
      path: normalizeContainerPath(pathRaw),
      relativePath: relRaw || normalizeContainerPath(pathRaw),
    });
  }
  return out.slice(0, 8);
}

function attachmentOnlyPromptLabel(
  attachmentsRaw: ChatImageAttachment[] | ChatImageAttachmentRef[],
): string {
  const attachments = Array.isArray(attachmentsRaw) ? attachmentsRaw : [];
  if (attachments.length === 0) return '';
  const imageCount = attachments.filter((item) =>
    String(item?.mime ?? '')
      .trim()
      .toLowerCase()
      .startsWith('image/'),
  ).length;
  const textCount = attachments.filter(
    (item) =>
      String(item?.mime ?? '')
        .trim()
        .toLowerCase() === 'text/plain',
  ).length;
  if (imageCount === attachments.length) {
    return imageCount === 1 ? '[image attachment]' : `[${imageCount} image attachments]`;
  }
  if (textCount === attachments.length) {
    return textCount === 1 ? '[text attachment]' : `[${textCount} text attachments]`;
  }
  return attachments.length === 1 ? '[attachment]' : `[${attachments.length} attachments]`;
}

function normalizePromptAutomationMeta(raw: unknown): PromptAutomationMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const kind = String((raw as any).kind ?? '')
    .trim()
    .toLowerCase();
  if (kind !== 'prompt-loop') return undefined;
  const stageRaw = String((raw as any).stage ?? '')
    .trim()
    .toLowerCase();
  const stage =
    stageRaw === 'final-message' ? 'final-message' : stageRaw === 'run' ? 'run' : undefined;
  const jobKeyRaw = String((raw as any).jobKey ?? '').trim();
  const automationIdRaw = String((raw as any).automationId ?? '').trim();
  const automationLabelRaw = String((raw as any).automationLabel ?? '').trim();
  const runIndexRaw = Number((raw as any).runIndex);
  const runsTotalRaw = Number((raw as any).runsTotal);
  const sleepBetweenRunsSecondsRaw = Number((raw as any).sleepBetweenRunsSeconds);
  const stopPhraseRaw = String((raw as any).stopPhrase ?? '').trim();
  const stopPhraseCaseSensitive = (raw as any)?.stopPhraseCaseSensitive === true;
  const stopMatchedRunIndexRaw = Number((raw as any).stopMatchedRunIndex);
  const promptPreviewRaw = String((raw as any).promptPreview ?? '').trim();
  const runIndex =
    Number.isFinite(runIndexRaw) && runIndexRaw > 0 ? Math.floor(runIndexRaw) : undefined;
  const runsTotal =
    Number.isFinite(runsTotalRaw) && runsTotalRaw > 0 ? Math.floor(runsTotalRaw) : undefined;
  const sleepBetweenRunsSeconds =
    Number.isFinite(sleepBetweenRunsSecondsRaw) && sleepBetweenRunsSecondsRaw >= 0
      ? Math.floor(sleepBetweenRunsSecondsRaw)
      : undefined;
  const stopMatchedRunIndex =
    Number.isFinite(stopMatchedRunIndexRaw) && stopMatchedRunIndexRaw > 0
      ? Math.floor(stopMatchedRunIndexRaw)
      : undefined;
  return {
    kind: 'prompt-loop',
    ...(stage ? { stage } : {}),
    ...(jobKeyRaw ? { jobKey: jobKeyRaw } : {}),
    ...(automationIdRaw ? { automationId: automationIdRaw } : {}),
    ...(automationLabelRaw ? { automationLabel: automationLabelRaw.slice(0, 120) } : {}),
    ...(typeof runIndex === 'number' ? { runIndex } : {}),
    ...(typeof runsTotal === 'number' ? { runsTotal } : {}),
    ...(typeof sleepBetweenRunsSeconds === 'number' ? { sleepBetweenRunsSeconds } : {}),
    ...(stopPhraseRaw
      ? { stopPhrase: stopPhraseRaw.slice(0, PROMPT_AUTOMATION_STOP_PHRASE_MAX_CHARS) }
      : {}),
    ...(stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
    ...(typeof stopMatchedRunIndex === 'number' ? { stopMatchedRunIndex } : {}),
    ...(promptPreviewRaw ? { promptPreview: promptPreviewRaw.slice(0, 600) } : {}),
  };
}

const {
  cancelQueuedPendingPrompt,
  claimQueuedPendingPromptForSending,
  isSafePromptId,
  pendingPromptsFromChatEntry,
  pruneCompletedPendingPrompts,
  readPendingPrompts,
  readPendingStartupPrompts,
  resumePendingPromptChats,
  retryPendingPrompt,
  transcriptTurnIdsFromEntry,
  pushPendingPrompt,
  pushPendingStartupPrompt,
  updatePendingPrompt,
} = createDronePendingPromptStore({
  normalizeChatImageAttachmentRefs,
  normalizeChatName,
  normalizePendingPromptState,
  normalizePendingPromptText,
  normalizePendingStartupPrompts,
  normalizePromptAutomationMeta,
  nowIso,
  onPendingPromptChanged: ({ droneId, chatName }) => notifyDroneChatWrite?.(droneId, chatName),
  startupPromptToPendingPrompt,
});

function promptJobTmuxSessionName(promptIdRaw: string): string {
  // Keep this aligned with daemon.ts `promptSessionName`.
  const cleaned = String(promptIdRaw ?? '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, 48);
  return `drone-prompt-${cleaned || 'job'}`;
}

async function recoverStalePromptJobSession(opts: {
  droneId: string;
  droneEntry: any;
  promptId: string;
}): Promise<{ job: any | null; jobState: string | null }> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const promptId = String(opts.promptId ?? '').trim();
  if (!droneId || !promptId || !isSafePromptId(promptId)) return { job: null, jobState: null };
  const droneEntry = opts.droneEntry;
  const requestedDroneName = String(droneEntry?.name ?? droneId).trim() || droneId;
  const sessionName = promptJobTmuxSessionName(promptId);

  try {
    await withLockedDroneContainer(
      { requestedDroneName, droneEntry },
      async ({ containerName }) => {
        const script = `tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`;
        await dvmExec(containerName, 'bash', ['-lc', script]);
      },
    );
  } catch {
    // Keep best-effort behavior: reconciliation below can still fail stale rows.
  }

  const regAfterKill: any = await loadRegistry();
  const dAfterKill = regAfterKill?.drones?.[droneId] ?? null;
  const token = typeof dAfterKill?.token === 'string' ? String(dAfterKill.token).trim() : '';
  const containerName =
    String(dAfterKill?.containerName ?? dAfterKill?.name ?? droneId).trim() || droneId;
  const hostPort =
    typeof dAfterKill?.hostPort === 'number' && Number.isFinite(dAfterKill.hostPort)
      ? dAfterKill.hostPort
      : await resolveHostPort(containerName, dAfterKill?.containerPort);
  if (!token || !hostPort) return { job: null, jobState: null };

  const client = makeClient(hostPort, token);
  let job: any = null;
  let jobState: string | null = null;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const r: any = await dronePromptGet(client, promptId);
      const nextJob = r?.job ?? null;
      const nextState = String(nextJob?.state ?? '').trim();
      if (nextState) {
        job = nextJob;
        jobState = nextState;
      }
      if (nextState && nextState !== 'queued' && nextState !== 'running') break;
    } catch {
      // keep best-effort behavior
    }
    // eslint-disable-next-line no-await-in-loop
    await sleepMs(250);
  }
  return { job, jobState };
}

type StopChatResponseResult = {
  mode: 'transcript' | 'cli';
  stopped: boolean;
  stoppedPromptIds: string[];
  clearedPromptIds: string[];
  sessionName?: string | null;
};

async function stopTranscriptPendingPrompts(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
  promptIds?: string[] | null;
  includeAutomation?: boolean;
}): Promise<StopChatResponseResult> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId) throw new Error('missing droneId');

  await ensureChatEntry({ droneId, chatName });
  await reconcileChatFromDaemon({ droneId, chatName });

  const regAny: any = await loadRegistry();
  const entry = regAny?.drones?.[droneId]?.chats?.[chatName] ?? null;
  const transcriptIds = transcriptTurnIdsFromEntry(entry);
  const pending = (await readPendingPrompts({ droneId, chatName })).filter(
    (item) => !transcriptIds.has(item.id),
  );
  const explicitPromptIds = new Set(
    Array.isArray(opts.promptIds)
      ? opts.promptIds.map((id) => String(id ?? '').trim()).filter(Boolean)
      : [],
  );
  const filterByPromptIds = explicitPromptIds.size > 0;
  const includeAutomation = opts.includeAutomation === true;
  const cancelable = pending.filter((item) => {
    if (!item?.id) return false;
    if (filterByPromptIds) return explicitPromptIds.has(item.id);
    if (!includeAutomation && item.automation) return false;
    return item.state === 'queued' || item.state === 'sending' || item.state === 'sent';
  });
  if (cancelable.length === 0) {
    return { mode: 'transcript', stopped: false, stoppedPromptIds: [], clearedPromptIds: [] };
  }

  const queuedIds = cancelable.filter((item) => item.state === 'queued').map((item) => item.id);
  const activeIds = cancelable
    .filter((item) => item.state === 'sending' || item.state === 'sent')
    .map((item) => item.id);

  if (activeIds.length > 0) {
    const token =
      typeof opts.droneEntry?.token === 'string' ? String(opts.droneEntry.token).trim() : '';
    const containerName =
      String(opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? droneId).trim() || droneId;
    const hostPort =
      typeof opts.droneEntry?.hostPort === 'number' && Number.isFinite(opts.droneEntry.hostPort)
        ? opts.droneEntry.hostPort
        : await resolveHostPort(containerName, opts.droneEntry?.containerPort);
    if (!token || !hostPort) throw new Error('drone daemon not reachable (missing hostPort/token)');

    const client = makeClient(hostPort, token);
    for (const promptId of activeIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await dronePromptCancel(client, promptId);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!isNotFoundErrorMessage(msg)) throw e;
      }
    }
  }

  const stoppedPromptIds: string[] = [];
  const clearedPromptIds: string[] = [];
  for (const id of queuedIds) {
    // eslint-disable-next-line no-await-in-loop
    const cancelled = await cancelQueuedPendingPrompt({ droneId, chatName, promptId: id });
    if (cancelled.status === 'cancelled') clearedPromptIds.push(id);
  }
  for (const id of activeIds) {
    // eslint-disable-next-line no-await-in-loop
    await updatePendingPrompt({
      droneId,
      chatName,
      id,
      patch: { state: 'failed', error: STOPPED_BY_USER_ERROR, updatedAt: nowIso() },
    });
    stoppedPromptIds.push(id);
  }

  enqueuePendingPromptPump(droneId, chatName);
  return {
    mode: 'transcript',
    stopped: stoppedPromptIds.length > 0 || clearedPromptIds.length > 0,
    stoppedPromptIds,
    clearedPromptIds,
  };
}

async function activePromptAutomationPendingPromptIds(opts: {
  droneId: string;
  chatName: string;
  jobKey?: string | null;
}): Promise<string[]> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const jobKey = String(opts.jobKey ?? '').trim();
  if (!droneId || !chatName || !jobKey) return [];
  const pending = await readPendingPrompts({ droneId, chatName }).catch(() => []);
  return pending
    .filter((item) => {
      const id = String(item?.id ?? '').trim();
      if (!id) return false;
      const state = String(item?.state ?? '').trim();
      if (state !== 'queued' && state !== 'sending' && state !== 'sent') return false;
      const automation = (item as any)?.automation ?? null;
      if (String(automation?.kind ?? '') !== 'prompt-loop') return false;
      if (String(automation?.stage ?? '') !== 'run') return false;
      if (String(automation?.jobKey ?? '').trim() !== jobKey) return false;
      return true;
    })
    .map((item) => String(item?.id ?? '').trim())
    .filter(Boolean);
}

type DroneChatStopReason = 'archive' | 'delete' | 'stop' | 'restart';
type DroneChatStopPlan = {
  chatNames: string[];
  builtinChatNames: string[];
  promptIds: string[];
  sessionNames: string[];
};

function droneChatStopError(reason: DroneChatStopReason): string {
  if (reason === 'archive') return STOPPED_BY_ARCHIVE_ERROR;
  if (reason === 'delete') return STOPPED_BY_DELETE_ERROR;
  return reason === 'restart'
    ? STOPPED_BY_LIFECYCLE_RESTART_ERROR
    : STOPPED_BY_LIFECYCLE_STOP_ERROR;
}

async function clearDroneHubState(droneIdRaw: string): Promise<void> {
  const droneId = normalizeDroneIdentity(droneIdRaw);
  if (!droneId) return;
  await setDroneHubMetaByIdentity({ droneId, hub: null });
}

async function runDroneLifecycleAction(opts: {
  droneId: string;
  droneEntry: any;
  action: 'start' | 'stop' | 'restart';
  source?: Record<string, unknown>;
}) {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing droneId');
  const droneEntry = opts.droneEntry;
  if (!droneEntry || typeof droneEntry !== 'object')
    throw new Error(`unknown drone: ${opts.droneId}`);
  if (droneRuntime(droneEntry) === 'host') {
    throw new Error('lifecycle controls are not yet supported for host runtime drones');
  }

  const droneName = String(droneEntry?.name ?? droneId).trim() || droneId;
  const containerName =
    String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() ||
    `drone-${droneId}`;

  const beforeDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
    (error) => ({
      diagnosticError: compactDiagnosticError(error),
    }),
  );
  hubLog('info', 'drone lifecycle action requested', {
    droneId,
    droneName,
    action: opts.action,
    containerName,
    ...(opts.source ? { source: opts.source } : {}),
    before: beforeDiagnostics,
  });

  try {
    if (opts.action === 'stop' || opts.action === 'restart') {
      await stopAllDroneChatActivity({
        droneId,
        droneEntry,
        reason: opts.action === 'restart' ? 'restart' : 'stop',
        updateLiveRegistry: true,
      });
      try {
        await dvmStop(containerName);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!looksLikeContainerNotRunningError(msg)) throw e;
      }
    }

    if (opts.action === 'start' || opts.action === 'restart') {
      try {
        await dvmStart(containerName);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!looksLikeContainerAlreadyRunningError(msg)) throw e;
      }
      await ensureContainerDroneDaemonSession({
        containerName,
        containerPort: Number(droneEntry?.containerPort ?? 7777),
      });
    }

    await clearDroneHubState(droneId);
    const afterDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
      (error) => ({
        diagnosticError: compactDiagnosticError(error),
      }),
    );
    hubLog('info', 'drone lifecycle action completed', {
      droneId,
      droneName,
      action: opts.action,
      containerName,
      ...(opts.source ? { source: opts.source } : {}),
      after: afterDiagnostics,
    });
    return {
      ok: true as const,
      id: droneId,
      name: droneName,
      action: opts.action,
      runtime: 'container' as const,
      containerName,
    };
  } catch (error) {
    const afterDiagnostics = await collectDroneRuntimeDiagnostics({ droneId, droneEntry }).catch(
      (diagnosticError) => ({
        diagnosticError: compactDiagnosticError(diagnosticError),
      }),
    );
    hubLog('warn', 'drone lifecycle action failed', {
      droneId,
      droneName,
      action: opts.action,
      containerName,
      ...(opts.source ? { source: opts.source } : {}),
      error: compactDiagnosticError(error),
      after: afterDiagnostics,
    });
    throw error;
  }
}

function listStoppablePromptIdsFromChatEntry(entry: any): string[] {
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const transcriptIds = new Set(
    turns.map((turn: any) => String(turn?.id ?? '').trim()).filter(Boolean),
  );
  return (Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [])
    .map((item: any) => ({
      id: String(item?.id ?? '').trim(),
      state: String(item?.state ?? '').trim(),
    }))
    .filter((item: { id: string; state: string }) => {
      if (!item.id || transcriptIds.has(item.id)) return false;
      return item.state === 'queued' || item.state === 'sending' || item.state === 'sent';
    })
    .map((item: { id: string; state: string }) => item.id);
}

function buildDroneChatStopPlan(opts: { droneId: string; droneEntry: any }): DroneChatStopPlan {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId || !opts.droneEntry || typeof opts.droneEntry !== 'object') {
    return { chatNames: [], builtinChatNames: [], promptIds: [], sessionNames: [] };
  }

  const runtime = droneRuntime(opts.droneEntry);
  const chats =
    opts.droneEntry?.chats && typeof opts.droneEntry.chats === 'object'
      ? Object.entries(opts.droneEntry.chats)
      : [];
  const chatNames = new Set<string>();
  const builtinChatNames = new Set<string>();
  const promptIds = new Set<string>();
  const sessionNames = new Set<string>();

  for (const [chatNameRaw, entry] of chats as Array<[string, any]>) {
    const chatName = normalizeChatName(chatNameRaw);
    if (!chatName) continue;
    chatNames.add(chatName);

    const agent = inferChatAgent(entry, opts.droneEntry);
    if (agent.kind === 'custom') {
      if (runtime !== 'host') sessionNames.add(hubChatSessionName(chatName));
      continue;
    }
    builtinChatNames.add(chatName);

    for (const id of listStoppablePromptIdsFromChatEntry(entry)) {
      promptIds.add(id);
      if (runtime !== 'host') sessionNames.add(promptJobTmuxSessionName(id));
    }
  }

  return {
    chatNames: [...chatNames],
    builtinChatNames: [...builtinChatNames],
    promptIds: [...promptIds],
    sessionNames: [...sessionNames],
  };
}

function markChatPendingPromptsStopped(
  entry: any,
  opts: {
    runtime: ReturnType<typeof droneRuntime>;
    stopError: string;
  },
): { promptIds: string[]; sessionNames: string[] } {
  const promptIds = listStoppablePromptIdsFromChatEntry(entry);
  if (promptIds.length === 0) return { promptIds: [], sessionNames: [] };

  const stoppableIds = new Set(promptIds);
  entry.pendingPrompts = (Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : []).map(
    (item: any) => {
      const id = String(item?.id ?? '').trim();
      if (!stoppableIds.has(id)) return item;
      return {
        ...item,
        state: 'failed',
        error: opts.stopError,
        updatedAt: nowIso(),
      };
    },
  );

  return {
    promptIds,
    sessionNames:
      opts.runtime === 'host'
        ? []
        : promptIds.map((promptId) => promptJobTmuxSessionName(promptId)),
  };
}

async function markDronePendingPromptsStopped(opts: {
  droneId: string;
  reason: DroneChatStopReason;
}): Promise<{ promptIds: string[]; sessionNames: string[] }> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) return { promptIds: [], sessionNames: [] };
  const stopError = droneChatStopError(opts.reason);
  const regAny = await loadRegistry();
  const d = (regAny as any)?.drones?.[droneId] ?? null;
  if (!d) return { promptIds: [], sessionNames: [] };
  const promptIds = new Set<string>();
  const sessionNames = new Set<string>();
  const runtime = droneRuntime(d);
  const chats = d?.chats && typeof d.chats === 'object' ? Object.keys(d.chats) : [];
  for (const chatNameRaw of chats) {
    const chatName = normalizeChatName(chatNameRaw);
    const stored = readChatFromStore({ droneId, chatName });
    const entry = stored.available && stored.chat ? stored.chat : d.chats[chatName];
    if (inferChatAgent(entry, d).kind !== 'builtin') continue;
    // eslint-disable-next-line no-await-in-loop
    const pending = await readPendingPrompts({ droneId, chatName });
    const ids = listStoppablePromptIdsFromChatEntry({ pendingPrompts: pending });
    for (const promptId of ids) {
      // eslint-disable-next-line no-await-in-loop
      await updatePendingPrompt({
        droneId,
        chatName,
        id: promptId,
        patch: { state: 'failed', error: stopError, updatedAt: nowIso() },
      });
      promptIds.add(promptId);
      if (runtime !== 'host') sessionNames.add(promptJobTmuxSessionName(promptId));
    }
  }
  return { promptIds: [...promptIds], sessionNames: [...sessionNames] };
}

async function cancelDronePromptJobsBestEffort(opts: {
  droneEntry: any;
  promptIds: string[];
}): Promise<void> {
  const promptIds = Array.from(
    new Set((opts.promptIds ?? []).map((id) => String(id ?? '').trim()).filter(Boolean)),
  );
  if (promptIds.length === 0) return;

  const daemon = await resolveDroneDaemonClientForEntry(opts.droneEntry).catch(() => null);
  if (!daemon) return;

  for (const promptId of promptIds) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await dronePromptCancel(daemon.client, promptId);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (!isNotFoundErrorMessage(msg)) throw e;
    }
  }
}

async function killDroneTmuxSessionsBestEffort(opts: {
  droneId: string;
  droneEntry: any;
  sessionNames: string[];
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId || droneRuntime(opts.droneEntry) === 'host') return;

  const sessionNames = Array.from(
    new Set((opts.sessionNames ?? []).map((name) => String(name ?? '').trim()).filter(Boolean)),
  );
  if (sessionNames.length === 0) return;

  const requestedDroneName = String(opts.droneEntry?.name ?? droneId).trim() || droneId;
  try {
    await withLockedDroneContainer(
      { requestedDroneName, droneEntry: opts.droneEntry },
      async ({ containerName }) => {
        const script = [
          'set -euo pipefail',
          ...sessionNames.map(
            (sessionName) => `tmux kill-session -t ${bashQuote(sessionName)} 2>/dev/null || true`,
          ),
        ].join('\n');
        await dvmExec(containerName, 'bash', ['-lc', script]);
      },
    );
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (!looksLikeMissingContainerError(msg) && !looksLikeContainerNotRunningError(msg)) throw e;
  }
}

async function stopAllDroneChatActivity(opts: {
  droneId: string;
  droneEntry: any;
  reason: DroneChatStopReason;
  updateLiveRegistry?: boolean;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId || !opts.droneEntry || typeof opts.droneEntry !== 'object') return;

  const plan = buildDroneChatStopPlan({ droneId, droneEntry: opts.droneEntry });
  if (plan.chatNames.length === 0 && plan.promptIds.length === 0 && plan.sessionNames.length === 0)
    return;

  const promptIds = new Set(plan.promptIds);
  const sessionNames = new Set(plan.sessionNames);

  for (const chatName of plan.builtinChatNames) {
    stopPromptAutomationJob({ droneId, chatName, stopMode: 'all', clearQueued: true });
  }
  for (const chatName of plan.chatNames) {
    clearInMemoryChatStateForDelete({ droneId, chatName });
  }

  if (opts.updateLiveRegistry !== false) {
    for (let pass = 0; pass < 2; pass += 1) {
      const marked = await markDronePendingPromptsStopped({ droneId, reason: opts.reason });
      for (const promptId of marked.promptIds) promptIds.add(promptId);
      for (const sessionName of marked.sessionNames) sessionNames.add(sessionName);
    }
  }

  await cancelDronePromptJobsBestEffort({ droneEntry: opts.droneEntry, promptIds: [...promptIds] });
  await killDroneTmuxSessionsBestEffort({
    droneId,
    droneEntry: opts.droneEntry,
    sessionNames: [...sessionNames],
  });
}

async function stopSingleDroneChatActivity(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId || !chatName || !opts.droneEntry || typeof opts.droneEntry !== 'object') return;
  if (!chatNameExists(opts.droneEntry, chatName)) return;

  stopPromptAutomationJob({ droneId, chatName, stopMode: 'all', clearQueued: true });
  try {
    await stopChatResponse({ droneId, chatName, droneEntry: opts.droneEntry });
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    if (
      /unknown chat/i.test(msg) ||
      /missing hostPort\/token/i.test(msg) ||
      /drone daemon not reachable/i.test(msg) ||
      /custom agents are not supported on host runtime/i.test(msg)
    ) {
      // Best-effort: continue removing/archive chat state even if live runtime cleanup is unavailable.
    } else {
      throw e;
    }
  }
  clearInMemoryChatStateForDelete({ droneId, chatName });
}

async function stopTranscriptChatResponse(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
}): Promise<StopChatResponseResult> {
  return await stopTranscriptPendingPrompts({
    droneId: opts.droneId,
    chatName: opts.chatName,
    droneEntry: opts.droneEntry,
  });
}

async function stopCliChatResponse(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
}): Promise<StopChatResponseResult> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId) throw new Error('missing droneId');
  if (droneRuntime(opts.droneEntry) === 'host') throw unsupportedHostCustomAgentError();

  const requestedDroneName = String(opts.droneEntry?.name ?? droneId).trim() || droneId;
  const sessionName = hubChatSessionName(chatName);
  let stopped = false;
  await withLockedDroneContainer(
    { requestedDroneName, droneEntry: opts.droneEntry },
    async ({ containerName }) => {
      const script = [
        'set -euo pipefail',
        `session=${bashQuote(sessionName)}`,
        'tmux has-session -t "$session" 2>/dev/null || exit 3',
        'tmux send-keys -t "$session:0.0" C-c',
      ].join('\n');
      const result = await dvmExec(containerName, 'bash', ['-lc', script]);
      if (result.code === 0) {
        stopped = true;
        return;
      }
      if (result.code === 3) return;
      const msg =
        `${String(result.stderr ?? '')}\n${String(result.stdout ?? '')}`.trim() ||
        `failed to stop session ${sessionName}`;
      throw new Error(msg);
    },
  );

  return {
    mode: 'cli',
    stopped,
    stoppedPromptIds: [],
    clearedPromptIds: [],
    sessionName,
  };
}

async function stopChatResponse(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
}): Promise<StopChatResponseResult> {
  await ensureChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const agent = inferChatAgent(chat, opts.droneEntry);
  if (agent.kind === 'builtin') {
    return await stopTranscriptChatResponse(opts);
  }
  return await stopCliChatResponse(opts);
}

const promptAutomationManager = new PromptAutomationManager({
  normalizeDroneId: normalizeDroneIdentity,
  normalizeChatName,
  nowIso,
  runJob: runPromptAutomationJob,
  onLaneChanged(droneId, chatName) {
    notifyPromptAutomationLaneChange?.(droneId, chatName);
  },
  onLaneIdle: enqueuePendingPromptPump,
});

const notifyPromptAutomationChatChanged = (droneId: string, chatName: string): void =>
  promptAutomationManager.notifyChatChanged(droneId, chatName);
const promptAutomationJobKey = (droneId: string, chatName: string): string =>
  promptAutomationManager.key(droneId, chatName);
const getPromptAutomationLane = (droneId: string, chatName: string) =>
  promptAutomationManager.get(droneId, chatName);
const promptAutomationLaneBusy = (
  lane: PromptAutomationLaneState | null | undefined,
  opts?: { includeQueued?: boolean },
): boolean => promptAutomationManager.isBusy(lane, opts);
const anyBusyPromptAutomationLaneForDrone = (droneId: string): boolean =>
  promptAutomationManager.anyBusyForDrone(droneId);
const promptAutomationJobResponse = (lane: PromptAutomationLaneState | null) =>
  promptAutomationManager.response(lane);

function appendPromptAutomationHistoryRows(
  list: PendingPrompt[],
  lane: PromptAutomationLaneState | null,
): PendingPrompt[] {
  const job = lane?.runningJob ?? lane?.lastJob ?? null;
  if (!job) return list;
  let out = list;
  const existingRunIndexes = new Set<number>();
  for (const item of out) {
    const automation = normalizePromptAutomationMeta((item as any)?.automation);
    if (
      automation &&
      String(automation.kind ?? '') === 'prompt-loop' &&
      String(automation.stage ?? '') === 'run' &&
      String(automation.jobKey ?? '') === job.executionKey &&
      typeof automation.runIndex === 'number'
    ) {
      existingRunIndexes.add(automation.runIndex);
    }
  }
  const updatedAt = String(job.updatedAt ?? nowIso());
  const safeJobId = job.executionKey.replace(/[^A-Za-z0-9._-]+/g, '-').slice(-48) || 'automation';
  for (let runIndex = 1; runIndex <= job.runsCompleted; runIndex += 1) {
    if (existingRunIndexes.has(runIndex)) continue;
    out = [
      ...out,
      {
        id: `${safeJobId}-run-${runIndex}`,
        at: updatedAt,
        prompt: job.prompt,
        automation: {
          kind: 'prompt-loop',
          stage: 'run',
          jobKey: job.executionKey,
          automationId: job.automationId,
          automationLabel: job.automationLabel,
          runIndex,
          runsTotal: job.runsTotal,
          sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
          ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
          ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
          promptPreview: previewPromptAutomationPrompt(job.prompt),
        },
        state: 'sent',
        updatedAt,
      },
    ];
  }

  if (!job.onFailurePrompt || job.runsCompleted <= 0) return out.slice(-50);
  const id = String(job.lastPromptId ?? '').trim();
  if (!id || out.some((item) => item.id === id)) return out.slice(-50);
  const finalRow: PendingPrompt = {
    id,
    at: updatedAt,
    prompt: job.onFailurePrompt,
    automation: {
      kind: 'prompt-loop',
      stage: 'final-message',
      jobKey: job.executionKey,
      automationId: job.automationId,
      automationLabel: job.automationLabel,
      runsTotal: job.runsTotal,
      sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
      ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
      ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
      ...(typeof job.finishedEarlyRunIndex === 'number'
        ? { stopMatchedRunIndex: job.finishedEarlyRunIndex }
        : {}),
      promptPreview: previewPromptAutomationPrompt(job.onFailurePrompt),
    },
    state: 'sent',
    updatedAt,
  };
  return [...out, finalRow].slice(-50);
}

function parsePromptAutomationIsoMs(raw: string | null | undefined): number {
  const ms = Date.parse(String(raw ?? '').trim());
  return Number.isFinite(ms) ? ms : 0;
}

function readPromptAutomationFinalMessageSnapshot(
  regAny: any,
  job: PromptAutomationJobState,
): {
  hasFinalTranscriptTurn: boolean;
  pendingFinalState: string;
  pendingFinalUpdatedAt: string | null;
} {
  const turns = Array.isArray(regAny?.drones?.[job.droneId]?.chats?.[job.chatName]?.turns)
    ? regAny.drones[job.droneId].chats[job.chatName].turns
    : [];
  const pending = Array.isArray(
    regAny?.drones?.[job.droneId]?.chats?.[job.chatName]?.pendingPrompts,
  )
    ? regAny.drones[job.droneId].chats[job.chatName].pendingPrompts
    : [];
  const jobKey = String(job.executionKey ?? '').trim();
  const hasFinalTranscriptTurn = turns.some((turn: any) => {
    const automation = normalizePromptAutomationMeta((turn as any)?.automation);
    if (!automation) return false;
    return (
      String(automation.kind ?? '').trim() === 'prompt-loop' &&
      String(automation.stage ?? '').trim() === 'final-message' &&
      String(automation.jobKey ?? '').trim() === jobKey
    );
  });
  const pendingFinal = pending.find((item: any) => {
    const automation = normalizePromptAutomationMeta((item as any)?.automation);
    if (!automation) return false;
    return (
      String(automation.kind ?? '').trim() === 'prompt-loop' &&
      String(automation.stage ?? '').trim() === 'final-message' &&
      String(automation.jobKey ?? '').trim() === jobKey
    );
  });
  return {
    hasFinalTranscriptTurn,
    pendingFinalState: String((pendingFinal as any)?.state ?? '')
      .trim()
      .toLowerCase(),
    pendingFinalUpdatedAt:
      typeof (pendingFinal as any)?.updatedAt === 'string'
        ? String((pendingFinal as any).updatedAt).trim() || null
        : typeof (pendingFinal as any)?.at === 'string'
          ? String((pendingFinal as any).at).trim() || null
          : null,
  };
}

function previewPromptAutomationPrompt(raw: string, maxLen: number = 280): string {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}...`;
}

function chatHasActivePendingPrompts(
  entry: any,
  opts?: {
    ignoreQueuedBlockedByAutomation?: boolean;
  },
): boolean {
  const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  if (pending.length === 0) return false;
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  for (const p of pending) {
    const state = String(p?.state ?? '').trim();
    if (state === 'failed') continue;
    if (
      opts?.ignoreQueuedBlockedByAutomation &&
      state === 'queued' &&
      Boolean((p as any)?.blockedByAutomation)
    ) {
      continue;
    }
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    if (doneIds.has(id)) continue;
    return true;
  }
  return false;
}

function chatHasTranscriptTurn(
  regAny: any,
  opts: { droneId: string; chatName: string; promptId: string },
): boolean {
  const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
  const turns =
    stored.available && stored.chat
      ? stored.chat.turns
      : Array.isArray(regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.turns)
        ? regAny.drones[opts.droneId].chats[opts.chatName].turns
        : [];
  return turns.some((t: any) => String(t?.id ?? '').trim() === opts.promptId);
}

async function waitForPromptAutomationChatIdle(opts: {
  droneId: string;
  chatName: string;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<void> {
  const timeoutMs = Math.max(
    5_000,
    Math.floor(opts.timeoutMs || PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS),
  );
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (opts.signal.aborted) throw new Error('automation stopped');
    const regAny: any = await loadRegistry();
    const entry = regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName] ?? null;
    if (!entry) return;
    if (!chatHasActivePendingPrompts(entry, { ignoreQueuedBlockedByAutomation: true })) return;
    await reconcileChatFromDaemon({ droneId: opts.droneId, chatName: opts.chatName }).catch(
      () => {},
    );
    await sleepMs(PROMPT_AUTOMATION_WAIT_POLL_MS);
  }
  throw new Error('timed out waiting for chat to become idle');
}

async function waitForPromptAutomationPromptCompletion(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  timeoutMs: number;
  signal: AbortSignal;
  requireTranscript?: boolean;
}): Promise<void> {
  const timeoutMs = Math.max(
    10_000,
    Math.floor(opts.timeoutMs || PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS),
  );
  const requireTranscript = opts.requireTranscript !== false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (opts.signal.aborted) throw new Error('automation stopped');
    await reconcileChatFromDaemon({ droneId: opts.droneId, chatName: opts.chatName }).catch(
      () => {},
    );
    const pending = await readPendingPrompts({
      droneId: opts.droneId,
      chatName: opts.chatName,
    }).catch(() => []);
    const target = pending.find((p) => p.id === opts.promptId) ?? null;
    if (target) {
      if (target.state === 'failed')
        throw new Error(target.error || `prompt ${opts.promptId} failed`);
      if (target.state === 'sent') {
        if (!requireTranscript) return;
        const regAny: any = await loadRegistry();
        if (chatHasTranscriptTurn(regAny, opts)) return;
      }
    } else {
      const regAny: any = await loadRegistry();
      if (!requireTranscript || chatHasTranscriptTurn(regAny, opts)) return;
    }
    await sleepMs(PROMPT_AUTOMATION_WAIT_POLL_MS);
  }
  throw new Error(`timed out waiting for prompt ${opts.promptId} completion`);
}

async function waitForPromptAutomationInterRunSleep(opts: {
  sleepBetweenRunsSeconds: number;
  signal: AbortSignal;
}): Promise<void> {
  const sleepSeconds = normalizePromptAutomationSleepBetweenRunsSeconds(
    opts.sleepBetweenRunsSeconds,
  );
  if (sleepSeconds <= 0) return;
  let remainingMs = sleepSeconds * 1000;
  while (remainingMs > 0) {
    if (opts.signal.aborted) throw new Error('automation stopped');
    const chunkMs = Math.min(PROMPT_AUTOMATION_INTER_RUN_SLEEP_CHUNK_MS, remainingMs);
    await sleepMs(chunkMs);
    remainingMs -= chunkMs;
  }
}

async function readPromptAutomationTurnOutput(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): Promise<string> {
  const found = getTranscriptTurnByPromptId(opts);
  if (!found) return '';
  const output = String(found?.output ?? '');
  const error = String(found?.error ?? '');
  return [output, error].filter(Boolean).join('\n');
}

function getTranscriptTurnByPromptId(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): TranscriptTurn | null {
  const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
  const turns =
    stored.available && stored.chat && Array.isArray(stored.chat.turns) ? stored.chat.turns : [];
  return (turns.find((turn: any) => String(turn?.id ?? '').trim() === opts.promptId) ??
    null) as TranscriptTurn | null;
}

function getTranscriptTurnByPromptIdFromRegistry(
  regAny: any,
  opts: { droneId: string; chatName: string; promptId: string },
): TranscriptTurn | null {
  const turns = Array.isArray(regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.turns)
    ? regAny.drones[opts.droneId].chats[opts.chatName].turns
    : [];
  return (turns.find((t: any) => String(t?.id ?? '').trim() === opts.promptId) ??
    null) as TranscriptTurn | null;
}

function chatAgentMessageAutoContinueEnabled(chatEntry: any): boolean {
  return chatEntry?.agentMessageAutoContinueEnabled === true;
}

function buildAgentMessageAutoContinueSourceMessageId(opts: {
  droneId: string;
  chatName: string;
  turn: TranscriptTurn | null | undefined;
}): string {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const turnId = String(opts.turn?.id ?? '').trim();
  if (droneId && turnId) return `${droneId}:${turnId}`;
  const at = String(opts.turn?.completedAt ?? opts.turn?.promptAt ?? opts.turn?.at ?? '').trim();
  if (!droneId || !chatName || !at) return '';
  return `${droneId}:${chatName}:${at}`;
}

function buildAgentMessageAutoContinueChatLockId(opts: {
  droneId: string;
  chatName: string;
}): string {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId || !chatName) return '';
  return `${droneId}:${chatName}`;
}

function normalizeAgentMessageAutoContinueTurnState(
  raw: TranscriptTurn['agentMessageAutoContinue'] | undefined,
): NonNullable<TranscriptTurn['agentMessageAutoContinue']> | null {
  if (!raw || typeof raw !== 'object') return null;
  const status = String(raw.status ?? '').trim();
  if (status !== 'pending' && status !== 'classified' && status !== 'failed') return null;
  const bucketRaw = String(raw.bucket ?? '').trim();
  const sourceRaw = String(raw.source ?? '').trim();
  const classifiedAt = String(raw.classifiedAt ?? '').trim();
  const continuedAt = String(raw.continuedAt ?? '').trim();
  const error = String(raw.error ?? '').trim();
  const updatedAt = String(raw.updatedAt ?? '').trim();
  return {
    status,
    ...(bucketRaw === 'user-turn' || bucketRaw === 'continue' ? { bucket: bucketRaw } : {}),
    ...(sourceRaw === 'llm' || sourceRaw === 'agent-copilot-json' || sourceRaw === 'heuristic'
      ? { source: sourceRaw }
      : {}),
    ...(classifiedAt ? { classifiedAt } : {}),
    ...(continuedAt ? { continuedAt } : {}),
    ...(error ? { error } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function normalizeAgentSuggestionTurnState(
  raw: TranscriptTurn['agentSuggestion'] | undefined,
): NonNullable<TranscriptTurn['agentSuggestion']> | null {
  if (!raw || typeof raw !== 'object') return null;
  const usedDirectAt = String(raw.usedDirectAt ?? '').trim();
  const suggestionHash = String(raw.suggestionHash ?? '').trim();
  const policyFingerprint = String(raw.policyFingerprint ?? '').trim();
  const updatedAt = String(raw.updatedAt ?? '').trim();
  if (!usedDirectAt && !suggestionHash && !policyFingerprint && !updatedAt) return null;
  return {
    ...(usedDirectAt ? { usedDirectAt } : {}),
    ...(suggestionHash ? { suggestionHash } : {}),
    ...(policyFingerprint ? { policyFingerprint } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function turnNeedsAgentMessageAutoContinueProcessing(
  turn: TranscriptTurn | null | undefined,
  enabledAtMs: number,
): boolean {
  if (!turn?.ok || turn?.inheritedFromClone === true) return false;
  if (!String(turn?.id ?? '').trim()) return false;
  const turnIso = String(turn?.completedAt ?? turn?.at ?? '').trim();
  const turnMs = turnIso ? new Date(turnIso).getTime() : Number.NaN;
  if (!Number.isFinite(turnMs) || turnMs < enabledAtMs) return false;
  const state = normalizeAgentMessageAutoContinueTurnState(turn.agentMessageAutoContinue);
  return !state || state.status === 'pending';
}

async function markTranscriptTurnAgentMessageAutoContinuePending(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): Promise<void> {
  const updatedAt = nowIso();
  await updateTranscriptTurnById({
    droneId: opts.droneId,
    chatName: opts.chatName,
    promptId: opts.promptId,
    update: (turn) => ({
      ...turn,
      agentMessageAutoContinue: {
        status: 'pending',
        updatedAt,
      },
    }),
  });
}

async function markTranscriptTurnAgentMessageAutoContinueResult(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  classification: AgentMessageAutoContinueClassification;
  continuedAt?: string | null;
}): Promise<void> {
  const updatedAt = nowIso();
  await updateTranscriptTurnById({
    droneId: opts.droneId,
    chatName: opts.chatName,
    promptId: opts.promptId,
    update: (turn) => ({
      ...turn,
      agentMessageAutoContinue: {
        status: 'classified',
        bucket: opts.classification.bucket,
        source: opts.classification.source,
        classifiedAt: updatedAt,
        ...(opts.continuedAt ? { continuedAt: opts.continuedAt } : {}),
        updatedAt,
      },
    }),
  });
}

async function markTranscriptTurnAgentMessageAutoContinueFailed(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  error: string;
}): Promise<void> {
  const updatedAt = nowIso();
  await updateTranscriptTurnById({
    droneId: opts.droneId,
    chatName: opts.chatName,
    promptId: opts.promptId,
    update: (turn) => ({
      ...turn,
      agentMessageAutoContinue: {
        status: 'failed',
        error: opts.error,
        updatedAt,
      },
    }),
  });
}

async function markTranscriptTurnAgentSuggestionUsedDirect(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  suggestionHash: string;
  policyFingerprint: string;
}): Promise<void> {
  const updatedAt = nowIso();
  await updateTranscriptTurnById({
    droneId: opts.droneId,
    chatName: opts.chatName,
    promptId: opts.promptId,
    update: (turn) => ({
      ...turn,
      agentSuggestion: {
        usedDirectAt: updatedAt,
        suggestionHash: String(opts.suggestionHash ?? '').trim(),
        policyFingerprint: String(opts.policyFingerprint ?? '').trim(),
        updatedAt,
      },
    }),
  });
}

async function processPendingAgentMessageAutoContinueTurns(opts: {
  droneId: string;
  chatName: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId || !chatName) return;
  const chatLockId = buildAgentMessageAutoContinueChatLockId({ droneId, chatName });
  if (!chatLockId || agentFollowupCoordinator.isAutoContinueChatActive(chatLockId)) return;

  const stored = readChatFromStore({ droneId, chatName });
  const chatEntry = stored.available ? stored.chat : null;
  if (!chatEntry || !chatAgentMessageAutoContinueEnabled(chatEntry)) return;
  const turns: TranscriptTurn[] = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
  if (turns.length === 0) return;
  const enabledAtIso = String(chatEntry?.agentMessageAutoContinueEnabledAt ?? '').trim();
  const enabledAtMs = enabledAtIso ? new Date(enabledAtIso).getTime() : Number.NaN;
  if (!Number.isFinite(enabledAtMs)) return;

  const llmProvider = await resolveEffectiveLlmProvider();
  const providerSettings = await resolveEffectiveProviderApiKeySettings(llmProvider.provider);
  const autoContinueSettings = await resolveEffectiveAgentMessageAutoContinueSettings();

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex] ?? null;
    if (!turnNeedsAgentMessageAutoContinueProcessing(turn, enabledAtMs)) continue;
    const promptId = String(turn?.id ?? '').trim();
    if (!promptId) continue;
    const sourceMessageId = buildAgentMessageAutoContinueSourceMessageId({
      droneId,
      chatName,
      turn,
    });
    if (!agentFollowupCoordinator.startAutoContinue(sourceMessageId, chatLockId)) continue;
    await markTranscriptTurnAgentMessageAutoContinuePending({
      droneId,
      chatName,
      promptId,
    });

    void (async () => {
      try {
        const output = stripAnsiFromCliOutput(String(turn?.output ?? ''));
        const classification = await classifyAgentMessageAutoContinue(output, {
          provider: llmProvider.provider,
          apiKey: providerSettings.apiKey ?? undefined,
        });

        await markTranscriptTurnAgentMessageAutoContinueResult({
          droneId,
          chatName,
          promptId,
          classification,
        });

        let continuedAt: string | null = null;
        if (classification.bucket === 'continue') {
          const enqueued = await createOrEnqueuePromptUnified({
            droneId,
            chatName,
            prompt: autoContinueSettings.prompt,
          });
          if (enqueued.kind === 'error') throw new Error(enqueued.error);
          continuedAt = nowIso();
        }

        await markTranscriptTurnAgentMessageAutoContinueResult({
          droneId,
          chatName,
          promptId,
          classification,
          ...(continuedAt ? { continuedAt } : {}),
        });
      } catch (error: any) {
        await markTranscriptTurnAgentMessageAutoContinueFailed({
          droneId,
          chatName,
          promptId,
          error: String(error?.message ?? error ?? 'Unknown error.'),
        });
      } finally {
        agentFollowupCoordinator.finishAutoContinue(sourceMessageId, chatLockId);
      }
    })();
    return;
  }
}

function buildAgentCopilotSourceMessageId(opts: {
  droneId: string;
  chatName: string;
  turn: TranscriptTurn | null | undefined;
  turnIndex: number;
}): string {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const turnId = String(opts.turn?.id ?? '').trim();
  if (droneId && turnId) return `${droneId}:${turnId}`;
  const at = String(opts.turn?.completedAt ?? opts.turn?.promptAt ?? opts.turn?.at ?? '').trim();
  if (!droneId || !chatName || !at) return '';
  return `${droneId}:${chatName}:${opts.turnIndex}:${at}`;
}

function readHandledAgentCopilotSourceMessageIds(chatEntry: any): string[] {
  return Array.from(
    new Set(
      (Array.isArray(chatEntry?.agentCopilotHandledSourceMessageIds)
        ? chatEntry.agentCopilotHandledSourceMessageIds
        : []
      )
        .map((item: any) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function hasHandledAgentCopilotSourceMessage(chatEntry: any, sourceMessageIdRaw: string): boolean {
  const sourceMessageId = String(sourceMessageIdRaw ?? '').trim();
  if (!sourceMessageId) return false;
  return readHandledAgentCopilotSourceMessageIds(chatEntry).includes(sourceMessageId);
}

async function markAgentCopilotSourceMessageHandled(opts: {
  droneId: string;
  chatName: string;
  sourceMessageId: string;
}): Promise<void> {
  const sourceMessageId = String(opts.sourceMessageId ?? '').trim();
  if (!sourceMessageId) return;
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const stored = readChatFromStore({ droneId, chatName });
  if (!stored.available || !stored.chat) return;
  const handledIds = readHandledAgentCopilotSourceMessageIds(stored.chat);
  if (handledIds.includes(sourceMessageId)) return;
  handledIds.push(sourceMessageId);
  await patchChatMetadataInStore({
    droneId,
    chatName,
    patch: {
      set: {
        agentCopilotHandledSourceMessageIds:
          handledIds.length > AGENT_COPILOT_HANDLED_CAP
            ? handledIds.slice(-AGENT_COPILOT_HANDLED_CAP)
            : handledIds,
      },
    },
  });
  await projectCanonicalChatToRegistry(droneId, chatName);
}

function buildAgentCopilotResponsePrompt(nameRaw: string, responseRaw: string): string {
  const name = String(nameRaw ?? '').trim();
  const response = String(responseRaw ?? '').trim();
  return `This is what copilot '${name}' responded with:\n${response}`;
}

function buildAgentCopilotErrorPrompt(errorRaw: string, nameRaw?: string): string {
  const error = String(errorRaw ?? '').trim() || 'Unknown error.';
  const name = String(nameRaw ?? '').trim();
  if (!name) return `Agent copilot error: ${error}`;
  return `Copilot '${name}' failed: ${error}`;
}

function buildAgentCopilotPromptId(opts: {
  sourceMessageId: string;
  stage: 'copilot' | 'source-result' | 'source-error' | 'source-parse-error';
}): string {
  const sourceMessageId = String(opts.sourceMessageId ?? '').trim();
  const digest = crypto.createHash('sha1').update(sourceMessageId).digest('hex').slice(0, 24);
  return `agent-copilot-${opts.stage}-${digest}`;
}

function getPendingPromptByIdFromRegistry(
  regAny: any,
  opts: { droneId: string; chatName: string; promptId: string },
): PendingPrompt | null {
  const pending = Array.isArray(
    regAny?.drones?.[opts.droneId]?.chats?.[opts.chatName]?.pendingPrompts,
  )
    ? regAny.drones[opts.droneId].chats[opts.chatName].pendingPrompts
    : [];
  return (pending.find((item: any) => String(item?.id ?? '').trim() === opts.promptId) ??
    null) as PendingPrompt | null;
}

async function ensureAgentCopilotPromptCompleted(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  prompt: string;
}): Promise<TranscriptTurn> {
  const existingTurn = getTranscriptTurnByPromptId(opts);
  if (existingTurn) return existingTurn;

  const existingPending =
    (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).find(
      (pending) => pending.id === opts.promptId,
    ) ?? null;
  if (!existingPending || existingPending.state === 'failed') {
    const enqueued = await createOrEnqueuePromptUnified({
      id: opts.promptId,
      droneId: opts.droneId,
      chatName: opts.chatName,
      prompt: opts.prompt,
    });
    if (enqueued.kind === 'error') throw new Error(enqueued.error);
  }

  await waitForPromptAutomationPromptCompletion({
    droneId: opts.droneId,
    chatName: opts.chatName,
    promptId: opts.promptId,
    timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
    signal: new AbortController().signal,
  });

  const turn = getTranscriptTurnByPromptId(opts);
  if (turn) return turn;
  const pending =
    (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).find(
      (item) => item.id === opts.promptId,
    ) ?? null;
  if (pending?.state === 'failed') {
    throw new Error(
      String(pending.error ?? `prompt ${opts.promptId} failed`).trim() ||
        `prompt ${opts.promptId} failed`,
    );
  }
  throw new Error(`Timed out waiting for prompt ${opts.promptId} completion`);
}

async function ensureAgentCopilotSourcePromptCompleted(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  prompt: string;
}): Promise<void> {
  await ensureAgentCopilotPromptCompleted(opts);
}

async function processAgentCopilotRequest(opts: {
  sourceDroneId: string;
  sourceChatName: string;
  sourceMessageId: string;
  copilot: AgentCopilotRequest | null;
  parseError: string | null;
}): Promise<void> {
  if (opts.parseError) {
    const parseErrorPromptId = buildAgentCopilotPromptId({
      sourceMessageId: opts.sourceMessageId,
      stage: 'source-parse-error',
    });
    await ensureAgentCopilotSourcePromptCompleted({
      droneId: opts.sourceDroneId,
      chatName: opts.sourceChatName,
      promptId: parseErrorPromptId,
      prompt: buildAgentCopilotErrorPrompt(opts.parseError),
    });
    await markAgentCopilotSourceMessageHandled({
      droneId: opts.sourceDroneId,
      chatName: opts.sourceChatName,
      sourceMessageId: opts.sourceMessageId,
    });
    return;
  }

  if (!opts.copilot) return;

  const copilotChatName = parseChatNameForMutation(opts.copilot.name, 'agent copilot name');
  const copilotPromptId = buildAgentCopilotPromptId({
    sourceMessageId: opts.sourceMessageId,
    stage: 'copilot',
  });
  const sourceResultPromptId = buildAgentCopilotPromptId({
    sourceMessageId: opts.sourceMessageId,
    stage: 'source-result',
  });

  await ensureChatEntryCopiedFromChat({
    droneId: opts.sourceDroneId,
    chatName: copilotChatName,
    copyFromChatName: opts.sourceChatName,
  });
  const responseTurn = await ensureAgentCopilotPromptCompleted({
    droneId: opts.sourceDroneId,
    chatName: copilotChatName,
    promptId: copilotPromptId,
    prompt: opts.copilot.message,
  });

  const followupPrompt = responseTurn.ok
    ? buildAgentCopilotResponsePrompt(
        copilotChatName,
        stripAnsiFromCliOutput(String(responseTurn.output ?? '')),
      )
    : buildAgentCopilotErrorPrompt(
        String(responseTurn.error ?? 'Copilot failed.'),
        copilotChatName,
      );
  await ensureAgentCopilotSourcePromptCompleted({
    droneId: opts.sourceDroneId,
    chatName: opts.sourceChatName,
    promptId: sourceResultPromptId,
    prompt: followupPrompt,
  });

  await markAgentCopilotSourceMessageHandled({
    droneId: opts.sourceDroneId,
    chatName: opts.sourceChatName,
    sourceMessageId: opts.sourceMessageId,
  });
}

async function processPendingAgentCopilotTurns(opts: {
  droneId: string;
  chatName: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId || !chatName) return;

  const stored = readChatFromStore({ droneId, chatName });
  const chatEntry = stored.available ? stored.chat : null;
  if (!chatEntry) return;
  const turns: TranscriptTurn[] = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];

  for (let turnIndex = 0; turnIndex < turns.length; turnIndex += 1) {
    const turn = turns[turnIndex] ?? null;
    if (!turn?.ok || turn?.inheritedFromClone === true) continue;
    const sourceMessageId = buildAgentCopilotSourceMessageId({
      droneId,
      chatName,
      turn,
      turnIndex,
    });
    if (!sourceMessageId) continue;
    if (hasHandledAgentCopilotSourceMessage(chatEntry, sourceMessageId)) continue;

    const extracted = extractAgentCopilotFromAgentMessage(
      stripAnsiFromCliOutput(String(turn.output ?? '')),
    );
    if (!extracted.copilot && !extracted.error) continue;
    if (!agentFollowupCoordinator.startCopilot(sourceMessageId)) continue;

    void processAgentCopilotRequest({
      sourceDroneId: droneId,
      sourceChatName: chatName,
      sourceMessageId,
      copilot: extracted.copilot,
      parseError: extracted.error,
    })
      .catch(async (error: any) => {
        try {
          const sourceErrorPromptId = buildAgentCopilotPromptId({
            sourceMessageId,
            stage: 'source-error',
          });
          await ensureAgentCopilotSourcePromptCompleted({
            droneId,
            chatName,
            promptId: sourceErrorPromptId,
            prompt: buildAgentCopilotErrorPrompt(
              String(error?.message ?? error ?? 'Unknown error.'),
              extracted.copilot?.name,
            ),
          });
          await markAgentCopilotSourceMessageHandled({
            droneId,
            chatName,
            sourceMessageId,
          });
        } catch {
          // Leave the source message unhandled so a later reconcile can retry.
        }
      })
      .finally(() => {
        agentFollowupCoordinator.finishCopilot(sourceMessageId);
      });
  }
}

function promptAutomationOutputContainsStopPhrase(opts: {
  output: string;
  stopPhrase: string;
  caseSensitive: boolean;
}): boolean {
  const phrase = normalizePromptAutomationStopPhrase(opts.stopPhrase);
  if (!phrase) return false;
  const output = String(opts.output ?? '');
  if (!output) return false;
  const normalizedOutput = stripAnsiFromCliOutput(output);
  if (opts.caseSensitive) return output.includes(phrase) || normalizedOutput.includes(phrase);
  const lowerPhrase = phrase.toLowerCase();
  return (
    output.toLowerCase().includes(lowerPhrase) ||
    normalizedOutput.toLowerCase().includes(lowerPhrase)
  );
}

async function preservePromptAutomationPendingHistory(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  prompt: string;
  automation: PromptAutomationMeta;
}): Promise<void> {
  const now = nowIso();
  await pushPendingPrompt({
    droneId: opts.droneId,
    chatName: opts.chatName,
    pending: {
      id: opts.promptId,
      at: now,
      prompt: opts.prompt,
      automation: normalizePromptAutomationMeta(opts.automation),
      state: 'sent',
      updatedAt: now,
    },
  }).catch(() => {});
}

async function sendPromptAutomationFinalMessage(
  job: PromptAutomationJobState,
  opts?: { ignoreAbortSignal?: boolean },
): Promise<void> {
  const finalPrompt = String(job.onFailurePrompt ?? '').trim();
  if (!finalPrompt) return;
  const ignoreAbortSignal = opts?.ignoreAbortSignal === true;
  const signal = ignoreAbortSignal ? null : job.abortController?.signal;
  if (!ignoreAbortSignal && signal?.aborted) return;
  const automation: PromptAutomationMeta = {
    kind: 'prompt-loop',
    stage: 'final-message',
    jobKey: job.executionKey,
    automationId: job.automationId,
    automationLabel: job.automationLabel,
    runsTotal: job.runsTotal,
    sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
    ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
    ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
    ...(typeof job.finishedEarlyRunIndex === 'number'
      ? { stopMatchedRunIndex: job.finishedEarlyRunIndex }
      : {}),
    promptPreview: previewPromptAutomationPrompt(finalPrompt),
  };
  const enqueued = await createOrEnqueuePromptUnified({
    droneId: job.droneId,
    chatName: job.chatName,
    prompt: finalPrompt,
    automation,
  });
  if (enqueued.kind === 'error') throw new Error(enqueued.error);
  job.lastPromptId = enqueued.id;
  job.updatedAt = nowIso();
  await waitForPromptAutomationPromptCompletion({
    droneId: job.droneId,
    chatName: job.chatName,
    promptId: enqueued.id,
    timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
    signal: signal ?? new AbortController().signal,
    requireTranscript: false,
  });
  await preservePromptAutomationPendingHistory({
    droneId: job.droneId,
    chatName: job.chatName,
    promptId: enqueued.id,
    prompt: finalPrompt,
    automation,
  });
  job.updatedAt = nowIso();
}

async function runPromptAutomationJob(job: PromptAutomationJobState): Promise<void> {
  let lastRunError = '';
  let hadRunFailure = false;
  try {
    for (let runIdx = 0; runIdx < job.runsTotal; runIdx++) {
      const signal = job.abortController?.signal;
      if (signal?.aborted) throw new Error('automation stopped');
      try {
        await waitForPromptAutomationChatIdle({
          droneId: job.droneId,
          chatName: job.chatName,
          timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_IDLE_TIMEOUT_MS,
          signal: signal ?? new AbortController().signal,
        });

        const automation: PromptAutomationMeta = {
          kind: 'prompt-loop',
          stage: 'run',
          jobKey: job.executionKey,
          automationId: job.automationId,
          automationLabel: job.automationLabel,
          runIndex: runIdx + 1,
          runsTotal: job.runsTotal,
          sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
          ...(job.stopPhrase ? { stopPhrase: job.stopPhrase } : {}),
          ...(job.stopPhraseCaseSensitive ? { stopPhraseCaseSensitive: true } : {}),
          promptPreview: previewPromptAutomationPrompt(job.prompt),
        };
        const enqueued = await createOrEnqueuePromptUnified({
          droneId: job.droneId,
          chatName: job.chatName,
          prompt: job.prompt,
          automation,
        });
        if (enqueued.kind === 'error') throw new Error(enqueued.error);
        job.lastPromptId = enqueued.id;
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);

        await waitForPromptAutomationPromptCompletion({
          droneId: job.droneId,
          chatName: job.chatName,
          promptId: enqueued.id,
          timeoutMs: PROMPT_AUTOMATION_WAIT_FOR_PROMPT_TIMEOUT_MS,
          signal: signal ?? new AbortController().signal,
        });
        await preservePromptAutomationPendingHistory({
          droneId: job.droneId,
          chatName: job.chatName,
          promptId: enqueued.id,
          prompt: job.prompt,
          automation,
        });
        job.runsCompleted += 1;
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);

        if (job.stopPhrase) {
          let output = '';
          try {
            output = await readPromptAutomationTurnOutput({
              droneId: job.droneId,
              chatName: job.chatName,
              promptId: enqueued.id,
            });
          } catch {
            output = '';
          }
          if (
            promptAutomationOutputContainsStopPhrase({
              output,
              stopPhrase: job.stopPhrase,
              caseSensitive: job.stopPhraseCaseSensitive,
            })
          ) {
            job.finishedEarly = true;
            job.finishedEarlyReason = 'stop-phrase';
            job.finishedEarlyRunIndex = job.runsCompleted;
            job.runsTotal = job.runsCompleted;
            job.updatedAt = nowIso();
            notifyPromptAutomationChatChanged(job.droneId, job.chatName);
            break;
          }
        }
      } catch (e: any) {
        const msg = String(e?.message ?? e ?? '').trim();
        if (job.abortController?.signal.aborted || /automation stopped/i.test(msg)) throw e;
        hadRunFailure = true;
        lastRunError = msg || 'automation run failed';
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);
      }

      if (job.finishedEarly) break;
      if (runIdx < job.runsTotal - 1 && job.sleepBetweenRunsSeconds > 0) {
        const waitSignal = job.abortController?.signal ?? new AbortController().signal;
        await waitForPromptAutomationInterRunSleep({
          sleepBetweenRunsSeconds: job.sleepBetweenRunsSeconds,
          signal: waitSignal,
        });
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);
      }
    }

    if (job.runsCompleted > 0 && job.onFailurePrompt) {
      try {
        await sendPromptAutomationFinalMessage(job);
      } catch (followupError: any) {
        const followupMsg =
          String(followupError?.message ?? followupError ?? '').trim() ||
          'failed sending final message';
        hubLog('warn', 'prompt automation final message failed', {
          droneId: job.droneId,
          chatName: job.chatName,
          automationId: job.automationId,
          jobKey: job.executionKey,
          error: followupMsg,
        });
        if (!hadRunFailure) {
          hadRunFailure = true;
          lastRunError = `final message failed: ${followupMsg}`;
        } else {
          lastRunError = lastRunError
            ? `${lastRunError}; final message failed: ${followupMsg}`
            : `final message failed: ${followupMsg}`;
        }
      }
    }

    if (hadRunFailure) {
      job.status = 'failed';
      job.error = lastRunError || 'automation failed';
    } else {
      job.status = 'completed';
      job.error = null;
    }
    job.updatedAt = nowIso();
    notifyPromptAutomationChatChanged(job.droneId, job.chatName);
  } catch (e: any) {
    const msg = String(e?.message ?? e ?? '').trim();
    if (job.abortController?.signal.aborted || /automation stopped/i.test(msg)) {
      const stopMode = job.stopMode === 'runs-only' ? 'runs-only' : 'all';
      if (stopMode === 'runs-only') {
        let finalMessageError = '';
        if (job.runsCompleted > 0 && job.onFailurePrompt) {
          try {
            await sendPromptAutomationFinalMessage(job, { ignoreAbortSignal: true });
          } catch (followupError: any) {
            finalMessageError =
              String(followupError?.message ?? followupError ?? '').trim() ||
              'final message failed';
          }
        }
        job.finishedEarly = true;
        if (!job.finishedEarlyReason) job.finishedEarlyReason = 'manual-stop-runs-only';
        if (job.runsCompleted > 0) job.finishedEarlyRunIndex = job.runsCompleted;
        if (finalMessageError) {
          job.status = 'failed';
          job.error = `final message failed: ${finalMessageError}`;
        } else {
          job.status = 'stopped';
          job.error = null;
        }
        job.updatedAt = nowIso();
        notifyPromptAutomationChatChanged(job.droneId, job.chatName);
        return;
      }
      job.status = 'stopped';
      job.error = null;
      job.updatedAt = nowIso();
      notifyPromptAutomationChatChanged(job.droneId, job.chatName);
      return;
    }
    job.status = 'failed';
    job.error = msg || 'automation failed';
    job.updatedAt = nowIso();
    notifyPromptAutomationChatChanged(job.droneId, job.chatName);
  } finally {
    job.stopMode = null;
    job.abortController = null;
    job.task = null;
  }
}

function finalizePromptAutomationLaneJob(
  lane: PromptAutomationLaneState,
  job: PromptAutomationJobState,
): void {
  promptAutomationManager.finalize(lane, job);
}

async function recoverStalledPromptAutomationLane(
  lane: PromptAutomationLaneState | null | undefined,
): Promise<void> {
  if (!lane || !lane.runningJob) return;
  const job = lane.runningJob;
  if (job.status !== 'running') return;
  if (job.runsTotal <= 0 || job.runsCompleted < job.runsTotal) return;

  const updatedMs = parsePromptAutomationIsoMs(job.updatedAt || job.startedAt);
  if (!updatedMs) return;
  const ageMs = Date.now() - updatedMs;
  if (ageMs < PROMPT_AUTOMATION_COMPLETION_STALL_RECOVERY_GRACE_MS) return;

  const finalPrompt = String(job.onFailurePrompt ?? '').trim();
  if (!finalPrompt) {
    job.status = 'completed';
    job.error = null;
    job.updatedAt = nowIso();
    finalizePromptAutomationLaneJob(lane, job);
    return;
  }

  const regAny: any = await loadRegistry().catch(() => null);
  if (!regAny || typeof regAny !== 'object') return;
  const finalSnapshot = readPromptAutomationFinalMessageSnapshot(regAny, job);

  if (finalSnapshot.hasFinalTranscriptTurn) {
    job.status = 'completed';
    job.error = null;
    job.updatedAt = nowIso();
    finalizePromptAutomationLaneJob(lane, job);
    return;
  }

  if (finalSnapshot.pendingFinalState === 'failed') {
    job.status = 'failed';
    job.error = 'final message failed';
    job.updatedAt = nowIso();
    finalizePromptAutomationLaneJob(lane, job);
    return;
  }

  if (!finalSnapshot.pendingFinalState) {
    job.status = 'failed';
    job.error = 'final message was not enqueued after automation runs completed';
    job.updatedAt = nowIso();
    finalizePromptAutomationLaneJob(lane, job);
    return;
  }

  if (finalSnapshot.pendingFinalState === 'queued') {
    const queuedUpdatedMs = parsePromptAutomationIsoMs(finalSnapshot.pendingFinalUpdatedAt);
    const queuedAgeMs = queuedUpdatedMs > 0 ? Date.now() - queuedUpdatedMs : 0;
    const queuedStaleAfterMs = Math.max(defaultPromptEnqueueTimeoutMs() * 2, 5 * 60_000);
    if (queuedUpdatedMs > 0 && queuedAgeMs >= queuedStaleAfterMs) {
      job.status = 'failed';
      job.error = 'final message remained queued for too long';
      job.updatedAt = nowIso();
      finalizePromptAutomationLaneJob(lane, job);
    }
    return;
  }

  const staleFinalState = stalePendingPromptState({
    state: finalSnapshot.pendingFinalState,
    updatedAt: finalSnapshot.pendingFinalUpdatedAt,
    at: finalSnapshot.pendingFinalUpdatedAt,
    enqueueTimeoutMs: defaultPromptEnqueueTimeoutMs(),
  });
  if (staleFinalState === 'sending' || staleFinalState === 'sent') {
    job.status = 'failed';
    job.error = 'final message stalled before transcript reconciliation';
    job.updatedAt = nowIso();
    finalizePromptAutomationLaneJob(lane, job);
  }
}

function stopPromptAutomationJob(opts: {
  droneId: string;
  chatName: string;
  stopMode?: PromptAutomationStopMode;
  clearQueued?: boolean;
}): PromptAutomationLaneState | null {
  return promptAutomationManager.stop(opts);
}

// Hub-side pump for `pendingPrompts` entries that are persisted but not yet enqueued
// into the drone daemon (state: 'queued'). This is used to preserve session continuity
// for agents where the continuation/session id is only known after the first turn.
function pendingPromptPumpConcurrencyLimit(): number {
  const raw = String(process.env.DRONE_HUB_PENDING_PROMPT_PUMP_CONCURRENCY ?? '').trim();
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 1) return Math.max(1, Math.min(16, Math.floor(n)));
  return 6;
}

function interruptedPromptDeliveryError(raw: unknown): string {
  const detail = String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 240);
  return detail
    ? `Prompt delivery was interrupted; retrying when the drone daemon is available. Last error: ${detail}`
    : 'Prompt delivery was interrupted; retrying when the drone daemon is available.';
}

async function pumpQueuedPendingPromptsForChat(opts: {
  droneId: string;
  chatName: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = String(opts.chatName ?? '').trim() || 'default';
  if (!droneId) return;

  // Avoid unbounded loops if state keeps changing due to concurrent requests.
  for (let attempts = 0; attempts < 50; attempts++) {
    const { d, chat } = await getChatEntry({ droneId, chatName });
    if (isDraftChatEntry(chat)) return;
    const agent = inferChatAgent(chat, d);
    if (!agent || agent.kind !== 'builtin') return;

    const entry: any = chat;
    // Prompt rows are canonical in SQLite; the registry-backed chat projection
    // is compatibility metadata and can lag queue transitions.
    const pendingList: any[] = await readPendingPrompts({ droneId, chatName });
    if (pendingList.length === 0) return;

    const turns: any[] = Array.isArray(entry?.turns) ? entry.turns : [];
    const transcriptDoneIds = new Set(
      turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean),
    );

    const idx = pendingList.findIndex(
      (p: any) => String(p?.state ?? '') === 'queued' && String(p?.id ?? '').trim(),
    );
    if (idx === -1) return;

    const p = pendingList[idx] ?? {};
    const id = String(p?.id ?? '').trim();
    const prompt = String(p?.prompt ?? '');
    const cwd = typeof p?.cwd === 'string' ? String(p.cwd) : null;
    const blockedByAutomation = Boolean((p as any)?.blockedByAutomation);
    if (!id || !prompt.trim()) {
      // Mark invalid entries as failed so they don't block forever.
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: 'invalid queued prompt' },
      }).catch(() => {});
      continue;
    }

    if (blockedByAutomation) {
      const lane = getPromptAutomationLane(droneId, chatName);
      if (promptAutomationLaneBusy(lane, { includeQueued: true })) {
        // Held intentionally behind automation lane completion.
        return;
      }
    }

    const sessionKnown = hasKnownBuiltinTranscriptSession(entry, agent.id);
    const prior = pendingList
      .slice(0, idx)
      .map((x: any) => ({ id: String(x?.id ?? '').trim(), state: String(x?.state ?? '') }))
      .filter((x: any) => x.id);
    // Keep manual follow-ups cancellable until the earlier response reaches the transcript.
    // A known agent session makes continuation possible, but does not make concurrent delivery safe.
    const defer = shouldDeferQueuedPendingPrompt({
      agentId: agent.id,
      sessionKnown,
      priorPendingPrompts: prior,
      transcriptDoneIds,
    });
    if (defer) return;

    // Transition queued -> sending before we attempt any daemon work.
    // This claim is atomic to prevent a race where a user cancels a queued row.
    const claimed = await claimQueuedPendingPromptForSending({ droneId, chatName, id });
    if (!claimed) {
      continue;
    }

    try {
      const enqueueTimeoutMs = defaultPromptEnqueueTimeoutMs();
      const r: any = await withTimeout(
        sendPromptToChat({
          id,
          droneId,
          chatName,
          prompt,
          attachmentRefs: normalizeChatImageAttachmentRefs(p?.attachments),
          cwd,
          waitForDaemonMs: undefined,
          skipManagedRepoSync: String((p as any)?.automation?.kind ?? '').trim() === 'prompt-loop',
        }),
        enqueueTimeoutMs,
        `queued prompt enqueue failed for ${droneId}/${chatName}`,
      );
      if (r?.turnOk === false) {
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: String(r?.error ?? 'failed') },
        });
      } else {
        await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
        // Best-effort: reconcile soon after enqueue to keep UI fresh.
        enqueueReconcile(droneId, chatName);
      }
    } catch (e: any) {
      const errorText = e?.message ?? String(e);
      const diagnostics =
        looksLikeTransientPromptEnqueueError(errorText) || looksLikeContainerPausedError(errorText)
          ? await collectDroneRuntimeDiagnostics({ droneId, droneEntry: d }).catch((error) => ({
              diagnosticError: compactDiagnosticError(error),
            }))
          : null;
      hubLog('warn', 'queued pending prompt enqueue failed', {
        droneId,
        chatName,
        promptId: id,
        error: String(errorText ?? 'unknown error'),
        ...(diagnostics ? { diagnostics } : {}),
      });
      if (looksLikeTransientPromptEnqueueError(errorText)) {
        const retry = await retryPendingPrompt({
          droneId,
          chatName,
          id,
          error: interruptedPromptDeliveryError(errorText),
        });
        if (retry.disposition === 'retry') {
          const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
          schedulePendingPromptPumpRetry(
            droneId,
            chatName,
            Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
          );
        }
        return;
      }
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: errorText },
      });
    }
  }
}

const pendingPromptPump = new PendingPromptPump({
  normalizeDroneId: normalizeDroneIdentity,
  normalizeChatName,
  concurrencyLimit: pendingPromptPumpConcurrencyLimit,
  defaultRetryDelayMs: defaultPendingPromptEnqueueRetryDelayMs,
  run: pumpQueuedPendingPromptsForChat,
});

export async function resetPromptAutomationStateForTests(): Promise<void> {
  await promptAutomationManager.reset();
  await pendingPromptPump.reset();
  resetTranscriptStoreForTests();
}

function enqueuePendingPromptPump(droneIdRaw: string, chatName: string) {
  pendingPromptPump.enqueue(droneIdRaw, chatName);
}

function schedulePendingPromptPumpRetry(
  droneIdRaw: string,
  chatNameRaw: string,
  delayMs: number = defaultPendingPromptEnqueueRetryDelayMs(),
) {
  pendingPromptPump.scheduleRetry(droneIdRaw, chatNameRaw, delayMs);
}

function droneChatMapKey(droneIdRaw: string, chatNameRaw: string): string {
  const droneId = normalizeDroneIdentity(droneIdRaw);
  if (!droneId) return '';
  const chatName = normalizeChatName(chatNameRaw);
  return `${droneId}:${chatName}`;
}

function clearInMemoryChatStateForDelete(opts: { droneId: string; chatName: string }) {
  const key = droneChatMapKey(opts.droneId, opts.chatName);
  if (!key) return;

  promptAutomationManager.delete(opts.droneId, opts.chatName);

  chatReconciliationQueue.delete(opts.droneId, opts.chatName);

  pendingPromptPump.delete(opts.droneId, opts.chatName);
}

function migrateInMemoryChatStateForRename(opts: {
  droneId: string;
  fromChatName: string;
  toChatName: string;
}) {
  const fromKey = droneChatMapKey(opts.droneId, opts.fromChatName);
  const toKey = droneChatMapKey(opts.droneId, opts.toChatName);
  if (!fromKey || !toKey || fromKey === toKey) return;

  promptAutomationManager.migrate(opts.droneId, opts.fromChatName, opts.toChatName);

  chatReconciliationQueue.migrate(opts.droneId, opts.fromChatName, opts.toChatName);

  pendingPromptPump.migrate(opts.droneId, opts.fromChatName, opts.toChatName);
}

function chatHasActivePendingPromptsForSummary(entry: any): boolean {
  const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  if (pending.length === 0) return false;
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  for (const p of pending) {
    const st = String(p?.state ?? '').trim();
    if (st === 'failed') continue;
    const id = String(p?.id ?? '').trim();
    if (!id || !doneIds.has(id)) return true;
  }
  return false;
}

type BusyChatDebugEntry = {
  chatName: string;
  reasons: string[];
  pendingPrompts: Array<{ id: string; state: string; hasTurn: boolean }>;
};

const droneBusyDebugLastById = new Map<string, string>();

function droneBusyDebugEnabled(): boolean {
  return String(process.env.DRONE_HUB_BUSY_DEBUG ?? '').trim() !== '0';
}

function busyChatDebugForEntry(droneId: string, chatName: string, entry: any): BusyChatDebugEntry {
  const reasons: string[] = [];
  const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  const pendingPrompts = pending
    .map((p: any) => {
      const id = String(p?.id ?? '').trim();
      return {
        id,
        state: String(p?.state ?? '').trim(),
        hasTurn: Boolean(id && doneIds.has(id)),
      };
    })
    .filter((p: { id: string }) => p.id);
  if (chatHasActivePendingPromptsForSummary(entry)) reasons.push('active-pending-prompt');
  if (
    promptAutomationLaneBusy(getPromptAutomationLane(droneId, chatName), { includeQueued: true })
  ) {
    reasons.push('prompt-automation');
  }
  if (chatHasActiveDockerSnapshot(entry)) reasons.push('docker-snapshot');
  return { chatName, reasons, pendingPrompts };
}

function logDroneBusyDebugChange(d: any, droneId: string, diagnostics: BusyChatDebugEntry[]): void {
  if (!droneBusyDebugEnabled()) return;
  const busyChats = diagnostics.filter((item) => item.reasons.length > 0);
  const signature = JSON.stringify(busyChats);
  if (droneBusyDebugLastById.get(droneId) === signature) return;
  droneBusyDebugLastById.set(droneId, signature);
  console.log('[DroneHub][busy-debug] summary busy changed', {
    droneId,
    name: String(d?.name ?? droneId).trim() || droneId,
    busy: busyChats.length > 0,
    busyChats,
  });
}

function busyChatNamesForDrone(d: any, droneIdRaw: string): string[] {
  const droneId = normalizeDroneIdentity(droneIdRaw);
  if (!droneId) return [];
  const chats = d?.chats && typeof d.chats === 'object' ? Object.entries(d.chats) : [];
  const out: string[] = [];
  const diagnostics: BusyChatDebugEntry[] = [];
  for (const [chatNameRaw, entry] of chats as Array<[string, any]>) {
    const chatName = normalizeChatName(chatNameRaw);
    if (!chatName || out.includes(chatName)) continue;
    const debug = busyChatDebugForEntry(droneId, chatName, entry);
    diagnostics.push(debug);
    if (debug.reasons.length > 0) out.push(chatName);
  }
  logDroneBusyDebugChange(d, droneId, diagnostics);
  return out;
}

function chatHasReconcilablePendingPrompts(entry: any): boolean {
  const pending = Array.isArray(entry?.pendingPrompts) ? entry.pendingPrompts : [];
  if (pending.length === 0) return false;
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  const doneIds = new Set(turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean));
  for (const p of pending) {
    const st = String(p?.state ?? '');
    if (st === 'failed') {
      if (
        !shouldRetryFailedPendingPrompt({
          error: p?.error,
          updatedAt: typeof p?.updatedAt === 'string' ? p.updatedAt : null,
          at: typeof p?.at === 'string' ? p.at : null,
        })
      ) {
        continue;
      }
    }
    // `queued` entries haven't been enqueued into the daemon yet, so there's nothing
    // to reconcile from daemon → transcript for them.
    if (st === 'queued') continue;
    const id = String(p?.id ?? '').trim();
    if (!id) continue;
    if (!doneIds.has(id)) return true;
  }
  return false;
}

const chatReconciliationExecutor = createChatReconciliationExecutor({
  applyChatReconciliationInStore,
  chatHasReconcilablePendingPrompts,
  clearScheduledReconcileRetryByKey,
  collectDroneRuntimeDiagnostics,
  compactDiagnosticError,
  defaultPromptEnqueueTimeoutMs,
  droneChatMapKey,
  dronePromptGet,
  droneRuntime,
  enqueuePendingPromptPump,
  ensureOpenCodeSessionId,
  formatTranscriptJobFailure,
  hubLog,
  importChatFromRegistry,
  inferChatAgent,
  interruptedPromptDeliveryError,
  loadRegistry,
  makeClient,
  maybeStartDockerSnapshotForTranscriptTurn,
  normalizeBuiltinAgentId,
  normalizeChatImageAttachmentRefs,
  normalizeChatModel,
  normalizeChatName,
  normalizeChatReasoning,
  normalizeDroneIdentity,
  normalizePromptAutomationMeta,
  nowIso,
  parseBlipJobTranscript,
  parseCodexJobTranscript,
  parsePiJobTranscript,
  parseStructuredAgentJobTranscript,
  processPendingAgentCopilotTurns,
  processPendingAgentMessageAutoContinueTurns,
  projectCanonicalChatToRegistry,
  pruneCompletedPendingPrompts,
  readChatFromStore,
  recoverStalePromptJobSession,
  resolveCanonicalDroneOrPendingForReadRef,
  resolveCodexTurnRuntime,
  resolveHostPort,
  resolveTranscriptPromptAt,
  sameAgentPlan,
  schedulePendingPromptPumpRetry,
  scheduleReconcileRetry,
  shouldRetryFailedPendingPrompt,
  stalePendingPromptState,
  updatePendingPrompt,
  STOPPED_BY_USER_ERROR,
});
const { reconcileChatFromDaemon } = chatReconciliationExecutor;

async function enqueuePrompt(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  automation?: PromptAutomationMeta | null;
  cwd?: string | null;
  submittedAt?: string | null;
  waitForDaemonMs?: number;
  deliveryMode?: 'background' | 'immediate';
  mark?: (name: string) => void;
}): Promise<{ id: string; pendingState: PendingPromptState; blockedByAutomation: boolean }> {
  const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
  if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
    throw new Error('invalid promptId');
  }
  const id = preferredIdRaw || crypto.randomBytes(9).toString('hex');
  const at = normalizeSubmittedAtIso(opts.submittedAt);
  const chatName = normalizeChatName(opts.chatName);
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing droneId');

  // Make sure chat exists before we write pending state.
  await ensureChatEntry({ droneId, chatName });
  opts.mark?.('ensureChat');
  const { d, chat } = await getChatEntry({ droneId, chatName });
  const canonicalPendingPrompts = await readPendingPrompts({ droneId, chatName });
  const runtime = droneRuntime(d);
  const configuredModel = normalizeChatModel((chat as any)?.model);
  const disposition = getPromptEnqueueDisposition({
    droneId,
    chatName,
    droneEntry: d,
    chatEntry: { ...chat, pendingPrompts: canonicalPendingPrompts },
    automation: opts.automation,
  });
  const { defer, blockedByAutomation } = disposition;
  opts.mark?.('disposition');

  const cwd = normalizeDroneCwdForRuntime(d, typeof opts.cwd === 'string' ? opts.cwd : null);
  const rawAttachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const attachmentsStorageRoot = chatAttachmentsStorageRootForDrone(d);
  const attachmentsForPending = buildChatImageAttachmentRefs({
    attachments: rawAttachments,
    cwd,
    chatName,
    promptId: id,
    storageRoot: attachmentsStorageRoot,
  });

  await pushPendingPrompt({
    droneId,
    chatName,
    pending: {
      id,
      at,
      prompt: opts.prompt,
      ...(configuredModel ? { model: configuredModel } : {}),
      cwd: opts.cwd ?? null,
      ...(attachmentsForPending.length > 0 ? { attachments: attachmentsForPending } : {}),
      ...(opts.automation ? { automation: normalizePromptAutomationMeta(opts.automation) } : {}),
      ...(blockedByAutomation ? { blockedByAutomation: true } : {}),
      state: defer || opts.deliveryMode === 'background' ? 'queued' : 'sending',
      updatedAt: at,
    },
  });
  opts.mark?.('persistPending');

  if (defer || opts.deliveryMode === 'background') {
    if (rawAttachments.length > 0 && attachmentsForPending.length > 0) {
      const attachmentsDir = buildChatAttachmentsDirectory({
        cwd,
        chatName,
        promptId: id,
        storageRoot: attachmentsStorageRoot,
      });
      try {
        if (runtime === 'host') {
          await copyChatAttachmentsToHost({
            hostDir: attachmentsDir,
            attachments: rawAttachments,
          });
        } else {
          const containerName =
            String((d as any)?.containerName ?? (d as any)?.name ?? droneId).trim() || droneId;
          await copyChatAttachmentsToContainer({
            containerName,
            containerDir: attachmentsDir,
            attachments: rawAttachments,
          });
        }
        opts.mark?.('attachments');
      } catch (e: any) {
        const errText = e?.message ?? String(e);
        await updatePendingPrompt({
          droneId,
          chatName,
          id,
          patch: { state: 'failed', error: `failed staging queued attachments: ${errText}` },
        });
        throw new Error(`failed staging queued attachments: ${errText}`);
      }
    }
    // Persisted as queued; the background pump will claim it when the chat is deliverable.
    enqueuePendingPromptPump(droneId, chatName);
    opts.mark?.('queuePump');
    return { id, pendingState: 'queued', blockedByAutomation };
  }

  try {
    const enqueueTimeoutMs = Math.max(
      defaultPromptEnqueueTimeoutMs(),
      (typeof opts.waitForDaemonMs === 'number' && Number.isFinite(opts.waitForDaemonMs)
        ? Math.floor(opts.waitForDaemonMs)
        : 0) + 30_000,
    );
    // Enqueue work in the drone daemon (restart-resumable).
    // eslint-disable-next-line no-await-in-loop
    const r: any = await withTimeout(
      sendPromptToChat({
        id,
        droneId,
        chatName,
        prompt: opts.prompt,
        attachments: rawAttachments,
        cwd: opts.cwd ?? null,
        waitForDaemonMs: opts.waitForDaemonMs,
        skipManagedRepoSync: Boolean(
          opts.automation && String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
        ),
        mark: opts.mark,
      }),
      enqueueTimeoutMs,
      `prompt enqueue failed for ${droneId}/${chatName}`,
    );
    opts.mark?.('daemonEnqueue');
    if (r?.turnOk === false) {
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: String(r?.error ?? 'failed') },
      });
    } else {
      await updatePendingPrompt({ droneId, chatName, id, patch: { state: 'sent' } });
      enqueueReconcile(droneId, chatName);
    }
    opts.mark?.('persistDelivery');
  } catch (e: any) {
    const errorText = e?.message ?? String(e);
    const diagnostics =
      looksLikeTransientPromptEnqueueError(errorText) || looksLikeContainerPausedError(errorText)
        ? await collectDroneRuntimeDiagnostics({ droneId, droneEntry: d }).catch((error) => ({
            diagnosticError: compactDiagnosticError(error),
          }))
        : null;
    hubLog('warn', 'prompt enqueue delivery failed', {
      droneId,
      chatName,
      promptId: id,
      deliveryMode: opts.deliveryMode ?? 'immediate',
      error: errorText,
      ...(diagnostics ? { diagnostics } : {}),
    });
    if (looksLikeTransientPromptEnqueueError(errorText)) {
      const retry = await retryPendingPrompt({
        droneId,
        chatName,
        id,
        error: interruptedPromptDeliveryError(errorText),
      });
      if (retry.disposition === 'retry') {
        const nextMs = retry.nextAttemptAt ? Date.parse(retry.nextAttemptAt) : NaN;
        schedulePendingPromptPumpRetry(
          droneId,
          chatName,
          Number.isFinite(nextMs) ? Math.max(1_000, nextMs - Date.now()) : undefined,
        );
      }
    } else {
      await updatePendingPrompt({
        droneId,
        chatName,
        id,
        patch: { state: 'failed', error: errorText },
      });
    }
  }

  // Best-effort: if there are any deferred follow-ups, try to enqueue now.
  enqueuePendingPromptPump(droneId, chatName);
  return { id, pendingState: 'sending', blockedByAutomation };
}

type PromptEnqueueDisposition = {
  defer: boolean;
  blockedByAutomation: boolean;
  hasPriorActive: boolean;
  hasPriorQueued: boolean;
  waitingForSession: boolean;
};

function getPromptEnqueueDisposition(opts: {
  droneId: string;
  chatName: string;
  droneEntry: any;
  chatEntry: any;
  automation?: PromptAutomationMeta | null;
}): PromptEnqueueDisposition {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const agent = inferChatAgent(opts.chatEntry, opts.droneEntry);
  const turns: any[] = Array.isArray((opts.chatEntry as any)?.turns)
    ? (opts.chatEntry as any).turns
    : [];
  const transcriptDoneIds = new Set(
    turns.map((t: any) => String(t?.id ?? '').trim()).filter(Boolean),
  );
  const priorPending: any[] = Array.isArray((opts.chatEntry as any)?.pendingPrompts)
    ? (opts.chatEntry as any).pendingPrompts
    : [];
  const sessionKnown =
    agent.kind !== 'builtin' ? true : hasKnownBuiltinTranscriptSession(opts.chatEntry, agent.id);
  const automationLane = getPromptAutomationLane(droneId, chatName);
  const automationLaneBusy = promptAutomationLaneBusy(automationLane, { includeQueued: true });
  const isAutomationPrompt = Boolean(
    opts.automation && String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
  );
  const blockedByAutomation = automationLaneBusy && !isAutomationPrompt;
  const hasPriorActive = !isAutomationPrompt
    ? hasActivePriorPendingPrompt({
        priorPendingPrompts: priorPending
          .map((p: any) => ({ id: String(p?.id ?? '').trim(), state: String(p?.state ?? '') }))
          .filter((p: any) => p.id),
        transcriptDoneIds,
      })
    : false;
  const hasPriorQueued = priorPending.some((p: any) => {
    if (String(p?.state ?? '') !== 'queued') return false;
    if (isAutomationPrompt) return !Boolean((p as any)?.blockedByAutomation);
    return true;
  });
  const waitingForSession =
    agent.kind === 'builtin'
      ? shouldDeferQueuedTranscriptPrompt({
          agentId: agent.id,
          sessionKnown,
          priorPendingPrompts: priorPending
            .map((p: any) => ({ id: String(p?.id ?? '').trim(), state: String(p?.state ?? '') }))
            .filter((p: any) => p.id),
          transcriptDoneIds,
        })
      : false;
  return {
    defer: blockedByAutomation || hasPriorActive || hasPriorQueued || waitingForSession,
    blockedByAutomation,
    hasPriorActive,
    hasPriorQueued,
    waitingForSession,
  };
}

type UnifiedPromptCreateOpts = {
  group?: string | null;
  repoPath?: string | null;
  build?: boolean;
  containerPort?: number | null;
};

async function createOrEnqueuePromptUnified(opts: {
  id?: string;
  droneId: string;
  chatName: string;
  prompt: string;
  attachments?: ChatImageAttachment[];
  automation?: PromptAutomationMeta | null;
  cwd?: string | null;
  submittedAt?: string | null;
  mark?: (name: string) => void;
}): Promise<
  | { kind: 'enqueued'; id: string; pendingState: PendingPromptState; blockedByAutomation: boolean }
  | { kind: 'error'; status: number; error: string }
> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(String(opts.chatName ?? '').trim() || 'default');
  const prompt = String(opts.prompt ?? '').trim();
  const attachments = Array.isArray(opts.attachments) ? opts.attachments : [];
  const preferredIdRaw = typeof opts.id === 'string' ? opts.id.trim() : '';
  if (preferredIdRaw && !isSafePromptId(preferredIdRaw)) {
    return { kind: 'error', status: 400, error: 'invalid promptId' };
  }
  const fallbackId = preferredIdRaw || crypto.randomBytes(9).toString('hex');

  if (!droneId) return { kind: 'error', status: 400, error: 'missing drone id' };
  if (!prompt) return { kind: 'error', status: 400, error: 'missing prompt' };

  const isAutomationPrompt = Boolean(
    opts.automation && String((opts.automation as any)?.kind ?? '').trim() === 'prompt-loop',
  );
  let regSnap: any = await loadRegistry();
  opts.mark?.('loadRegistry');
  if (regSnap?.drones?.[droneId]) {
    let liveDroneEntry = regSnap?.drones?.[droneId] ?? null;
    if (!liveDroneEntry) return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
    let chatEntry = liveDroneEntry?.chats?.[chatName] ?? null;
    if (chatHasActiveDockerSnapshot(chatEntry)) {
      await failStaleDockerSnapshotsForChat({ droneId, chatName });
      opts.mark?.('snapshotMaintenance');
      regSnap = await loadRegistry();
      opts.mark?.('reloadRegistry');
      liveDroneEntry = regSnap?.drones?.[droneId] ?? null;
      if (!liveDroneEntry)
        return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
      chatEntry = liveDroneEntry?.chats?.[chatName] ?? null;
    }
    if (chatHasActiveDockerSnapshot(chatEntry)) {
      return {
        kind: 'error',
        status: 409,
        error:
          'Docker snapshot is in progress for this chat; wait for it to finish before sending another message',
      };
    }
    const r = await enqueuePrompt({
      id: fallbackId,
      droneId,
      chatName,
      prompt,
      attachments,
      automation: opts.automation,
      cwd: opts.cwd ?? null,
      submittedAt: opts.submittedAt ?? null,
      deliveryMode: isAutomationPrompt ? 'immediate' : 'background',
      mark: opts.mark,
    });
    return {
      kind: 'enqueued',
      id: r.id,
      pendingState: r.pendingState,
      blockedByAutomation: r.blockedByAutomation,
    };
  }

  // If the drone is still provisioning, stage prompt rows on the pending entry and
  // migrate them into normal chat `pendingPrompts` once startup finishes.
  if (regSnap?.pending?.[droneId] && !regSnap?.drones?.[droneId]) {
    if (attachments.length > 0) {
      return {
        kind: 'error',
        status: 409,
        error: `drone "${droneId}" is still starting (attachments require an active drone)`,
      };
    }
    const submittedAt = normalizeSubmittedAtIso(opts.submittedAt);
    const queuedPending: PendingPrompt = {
      id: fallbackId,
      at: submittedAt,
      prompt,
      ...(opts.cwd != null ? { cwd: opts.cwd } : {}),
      state: 'queued',
      updatedAt: submittedAt,
    };
    const queuedStatus = await pushPendingStartupPrompt({
      droneId,
      chatName,
      pending: queuedPending,
    });
    if (queuedStatus === 'active') {
      const r = await enqueuePrompt({
        id: fallbackId,
        droneId,
        chatName,
        prompt,
        attachments,
        automation: opts.automation ?? null,
        cwd: opts.cwd ?? null,
        submittedAt: opts.submittedAt ?? null,
        deliveryMode: isAutomationPrompt ? 'immediate' : 'background',
        mark: opts.mark,
      });
      return {
        kind: 'enqueued',
        id: r.id,
        pendingState: r.pendingState,
        blockedByAutomation: r.blockedByAutomation,
      };
    }
    if (queuedStatus !== 'queued') {
      return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
    }
    return {
      kind: 'enqueued',
      id: fallbackId,
      pendingState: 'queued',
      blockedByAutomation: false,
    };
  }
  return { kind: 'error', status: 404, error: `unknown drone: ${droneId}` };
}

const { dequeueProvisioning, enqueueProvisioning, enqueueProvisioningForAllPending } =
  createDroneProvisioningController({
    NON_REPO_HOME_CWD,
    applyPendingDisplayNameToProvisionedDrone,
    cloneChatEntryForDroneClone,
    defaultDaemonReadyTimeoutMs,
    defaultRepoSeedTimeoutMs,
    ensureChatEntry,
    enqueuePrompt,
    enqueuePendingPromptPump,
    hubLog,
    inferChatAgent,
    isSafePromptId,
    normalizeChatModel,
    normalizeChatReasoning,
    normalizeChatName,
    normalizeDroneEntryKind,
    normalizeDroneEntryVisibility,
    normalizePlaybookRunQueueGate,
    normalizePendingStartupPrompts,
    nowIso,
    parseSeedAgent,
    playbookMetaFromEntry,
    resolveAgentSuggestionEnabledByDefault: async () =>
      (await resolveEffectiveAgentSuggestionSettings()).enabledByDefault,
    resolveDroneCliPath,
    resolvePendingDroneDisplayName,
    runNodeCli,
    setChatAgentConfig,
    startupPromptToPendingPrompt,
    syncMcpServersForDrone,
    syncRepoAgentsInstructionsForDrone,
    syncSkillLibraryForDrone,
    syncSharedPathsToDrone: (opts) => syncSetService.applyAllSyncSetsToDrone(opts),
  });

function resolveDroneCliPath(): string {
  // Prefer built CLI when available. In source/dev mode, fall back to src/cli.ts.
  const jsPath = path.resolve(__dirname, '..', 'cli.js');
  if (existsSync(jsPath)) return jsPath;
  return path.resolve(__dirname, '..', 'cli.ts');
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
  await dvmCopyToContainer(opts.containerName, runtimeDir, '/dvm-data/drone/dist.next', {
    clean: false,
  });
  const verifyStagedDaemonRuntime = await dvmExec(opts.containerName, 'bash', [
    '-lc',
    'test -f /dvm-data/drone/dist.next/daemon.js || { echo "staged daemon runtime is missing /dvm-data/drone/dist.next/daemon.js" 1>&2; exit 1; }',
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

async function dockerContainerId(name: string): Promise<string> {
  const container = String(name || '').trim();
  if (!container) throw new Error('missing container name');
  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('docker', ['inspect', '-f', '{{.Id}}', container], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) =>
      resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }),
    );
    child.once('close', (code) =>
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr }),
    );
  });
  if (r.code !== 0)
    throw new Error((r.stderr || r.stdout || `docker inspect ${container} failed`).trim());
  const id = String(r.stdout || '').trim();
  if (!/^[0-9a-f]{12,64}$/i.test(id)) throw new Error(`unexpected docker id: ${id || '(empty)'}`);
  return id;
}

async function runDocker(
  args: string[],
  opts?: { timeoutMs?: number },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : 2 * 60_000;
  return await new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 1500).unref();
    }, timeoutMs);
    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));
    child.once('error', (err: any) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve({ code: typeof code === 'number' ? code : 1, stdout, stderr });
    });
  });
}

async function runDockerOrThrow(args: string[], opts?: { timeoutMs?: number }): Promise<string> {
  const result = await runDocker(args, opts);
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout || `docker ${args.join(' ')} failed`).trim());
  }
  return result.stdout;
}

async function dockerInspectOne(ref: string): Promise<any | null> {
  const name = String(ref ?? '').trim();
  if (!name) return null;
  const stdout = await runDockerOrThrow(['inspect', name], { timeoutMs: 30_000 });
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed[0] ?? null) : null;
}

function compactDiagnosticError(raw: unknown): string {
  return String((raw as any)?.message ?? raw ?? 'unknown error')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 500);
}

async function collectDroneRuntimeDiagnostics(opts: {
  droneId: string;
  droneEntry: any;
  hostPort?: number | null;
  token?: string | null;
}): Promise<Record<string, unknown>> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const droneEntry = opts.droneEntry;
  const runtime = droneRuntime(droneEntry);
  const containerName =
    String(
      droneEntry?.containerName ?? droneEntry?.name ?? (droneId ? `drone-${droneId}` : ''),
    ).trim() || null;
  const out: Record<string, unknown> = {
    inspectedAt: nowIso(),
    droneId: droneId || String(opts.droneId ?? '').trim() || null,
    runtime,
    containerName,
  };
  if (runtime === 'host') {
    const hostPort = Number(opts.hostPort ?? droneEntry?.hostPort ?? NaN);
    out.hostPort = Number.isFinite(hostPort) && hostPort > 0 ? Math.floor(hostPort) : null;
    out.tokenPresent = Boolean(String(opts.token ?? droneEntry?.token ?? '').trim());
    return out;
  }

  if (!containerName) return out;
  try {
    const inspect = await dockerInspectOne(containerName);
    const state = inspect?.State ?? null;
    out.containerId = typeof inspect?.Id === 'string' ? String(inspect.Id).slice(0, 12) : null;
    out.dockerState = typeof state?.Status === 'string' ? state.Status : null;
    out.running = Boolean(state?.Running);
    out.paused = Boolean(state?.Paused);
    out.restarting = Boolean(state?.Restarting);
    out.dead = Boolean(state?.Dead);
    out.oomKilled = Boolean(state?.OOMKilled);
    out.exitCode = Number.isFinite(Number(state?.ExitCode)) ? Number(state.ExitCode) : null;
    out.pid = Number.isFinite(Number(state?.Pid)) ? Number(state.Pid) : null;
    out.startedAt = typeof state?.StartedAt === 'string' ? state.StartedAt : null;
    out.finishedAt = typeof state?.FinishedAt === 'string' ? state.FinishedAt : null;
    out.restartPolicy = String(inspect?.HostConfig?.RestartPolicy?.Name ?? '').trim() || null;
  } catch (error) {
    out.dockerInspectError = compactDiagnosticError(error);
  }

  let hostPort =
    typeof opts.hostPort === 'number' && Number.isFinite(opts.hostPort) && opts.hostPort > 0
      ? Math.floor(opts.hostPort)
      : typeof droneEntry?.hostPort === 'number' &&
          Number.isFinite(droneEntry.hostPort) &&
          droneEntry.hostPort > 0
        ? Math.floor(droneEntry.hostPort)
        : 0;
  if (!hostPort) {
    try {
      const containerPort = Number(droneEntry?.containerPort ?? NaN);
      if (Number.isFinite(containerPort) && containerPort > 0) {
        const resolved = await resolveHostPort(containerName, Math.floor(containerPort));
        hostPort =
          Number.isFinite(resolved as number) && (resolved as number) > 0
            ? Math.floor(resolved as number)
            : 0;
      }
    } catch (error) {
      out.hostPortResolutionError = compactDiagnosticError(error);
    }
  }
  out.hostPort = hostPort || null;
  const token = String(opts.token ?? droneEntry?.token ?? '').trim();
  out.tokenPresent = Boolean(token);
  if (hostPort && token) {
    try {
      await droneStatus(makeClient(hostPort, token));
      out.daemonStatusOk = true;
    } catch (error) {
      out.daemonStatusOk = false;
      out.daemonStatusError = compactDiagnosticError(error);
    }
  }
  return out;
}

async function dockerImageSizeBytes(imageRef: string): Promise<number | null> {
  try {
    const stdout = await runDockerOrThrow(
      ['image', 'inspect', imageRef, '--format', '{{json .Size}}'],
      {
        timeoutMs: 30_000,
      },
    );
    const value = Number(JSON.parse(String(stdout ?? '').trim() || 'null'));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

type DockerImageDiskUsage = {
  virtualBytes: number | null;
  sharedBytes: number | null;
  uniqueBytes: number | null;
};

let dockerImageDiskUsageCache: { at: number; usage: Map<string, DockerImageDiskUsage> } | null =
  null;
const DOCKER_IMAGE_DISK_USAGE_CACHE_MS = 5000;

function parseDockerDfSizeBytes(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : null;
  const text = String(raw ?? '').trim();
  if (!text || text.toLowerCase() === 'n/a') return null;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)\s*([a-zA-Z]+)?$/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return null;
  const unit = String(match[2] ?? 'B').toLowerCase();
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1000,
    mb: 1000 ** 2,
    gb: 1000 ** 3,
    tb: 1000 ** 4,
  };
  const multiplier = multipliers[unit];
  if (!multiplier) return null;
  return Math.floor(value * multiplier);
}

function dockerDfImageKeys(raw: any): string[] {
  const keys: string[] = [];
  const repo = String(raw?.Repository ?? raw?.Repo ?? '').trim();
  const tag = String(raw?.Tag ?? '').trim();
  if (repo && repo !== '<none>' && tag && tag !== '<none>') keys.push(`${repo}:${tag}`);
  const id = String(raw?.ID ?? raw?.ImageID ?? '').trim();
  if (id) {
    keys.push(id);
    if (id.startsWith('sha256:')) keys.push(id.slice('sha256:'.length));
  }
  return Array.from(new Set(keys));
}

function dockerDfImageDiskUsage(raw: any): DockerImageDiskUsage {
  return {
    virtualBytes: parseDockerDfSizeBytes(raw?.Size),
    sharedBytes: parseDockerDfSizeBytes(raw?.SharedSize),
    uniqueBytes: parseDockerDfSizeBytes(raw?.UniqueSize),
  };
}

async function dockerImageDiskUsageByRef(): Promise<Map<string, DockerImageDiskUsage>> {
  const now = Date.now();
  if (
    dockerImageDiskUsageCache &&
    now - dockerImageDiskUsageCache.at < DOCKER_IMAGE_DISK_USAGE_CACHE_MS
  ) {
    return dockerImageDiskUsageCache.usage;
  }
  const usage = new Map<string, DockerImageDiskUsage>();
  try {
    const stdout = await runDockerOrThrow(['system', 'df', '-v', '--format', '{{json .}}'], {
      timeoutMs: 10_000,
    });
    const trimmed = String(stdout ?? '').trim();
    if (trimmed) {
      const payloads: any[] = [];
      try {
        payloads.push(JSON.parse(trimmed));
      } catch {
        for (const line of trimmed.split(/\r?\n/)) {
          const clean = line.trim();
          if (!clean) continue;
          try {
            payloads.push(JSON.parse(clean));
          } catch {
            // Ignore malformed lines from older Docker versions.
          }
        }
      }
      for (const payload of payloads) {
        const images = Array.isArray(payload?.Images)
          ? payload.Images
          : payload?.Repository
            ? [payload]
            : [];
        for (const image of images) {
          const entry = dockerDfImageDiskUsage(image);
          for (const key of dockerDfImageKeys(image)) usage.set(key, entry);
        }
      }
    }
  } catch {
    // Fall back to the stored virtual image sizes below.
  }
  dockerImageDiskUsageCache = { at: now, usage };
  return usage;
}

async function dockerContainerSizeBytes(containerName: string): Promise<number | null> {
  try {
    const stdout = await runDockerOrThrow(
      ['inspect', '--size', containerName, '--format', '{{json .SizeRw}}'],
      {
        timeoutMs: 2500,
      },
    );
    const value = Number(JSON.parse(String(stdout ?? '').trim() || 'null'));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
  } catch {
    return null;
  }
}

function dockerSnapshotImageRef(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): string {
  const droneId =
    normalizeDroneIdentity(opts.droneId) ||
    crypto
      .createHash('sha1')
      .update(String(opts.droneId ?? ''))
      .digest('hex')
      .slice(0, 12);
  const chatHash = crypto
    .createHash('sha1')
    .update(String(opts.chatName ?? 'default'))
    .digest('hex')
    .slice(0, 10);
  const promptId =
    String(opts.promptId ?? '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_.-]/g, '-')
      .slice(0, 48) || 'turn';
  return `drone-hub-snapshot-${droneId}-${chatHash}:${promptId}`;
}

function normalizeDockerSnapshot(raw: any): TranscriptTurn['dockerSnapshot'] | undefined {
  const id = String(raw?.id ?? '').trim();
  const status = String(raw?.status ?? '').trim();
  if (!id) return undefined;
  if (status !== 'creating' && status !== 'ready' && status !== 'failed' && status !== 'restoring')
    return undefined;
  const createdAt = String(raw?.createdAt ?? '').trim() || nowIso();
  const out: NonNullable<TranscriptTurn['dockerSnapshot']> = { id, status, createdAt };
  const imageRef = String(raw?.imageRef ?? '').trim();
  const imageId = String(raw?.imageId ?? '').trim();
  const readyAt = String(raw?.readyAt ?? '').trim();
  const restoredAt = String(raw?.restoredAt ?? '').trim();
  const error = String(raw?.error ?? '').trim();
  const sizeBytes = Number(raw?.sizeBytes);
  if (imageRef) out.imageRef = imageRef;
  if (imageId) out.imageId = imageId;
  if (readyAt) out.readyAt = readyAt;
  if (restoredAt) out.restoredAt = restoredAt;
  if (error) out.error = error;
  if (Number.isFinite(sizeBytes) && sizeBytes >= 0) out.sizeBytes = Math.floor(sizeBytes);
  return out;
}

function dockerSnapshotAfterAgentMessageEnabledForChat(droneEntry: any, chatEntry: any): boolean {
  if (droneRuntime(droneEntry) === 'host') return false;
  if (droneEntry?.persistVolume !== false) return false;
  const raw = chatEntry?.dockerSnapshotAfterAgentMessageEnabled;
  const agent = inferChatAgent(chatEntry, droneEntry);
  if (agent.kind !== 'builtin') return false;
  return raw === true;
}

function chatHasActiveDockerSnapshot(entry: any): boolean {
  const turns = Array.isArray(entry?.turns) ? entry.turns : [];
  return turns.some((turn: any) => {
    const status = String(turn?.dockerSnapshot?.status ?? '').trim();
    return status === 'creating' || status === 'restoring';
  });
}

function isStaleDockerExecErrorMessage(raw: unknown): boolean {
  const msg = String(raw ?? '').trim();
  if (!msg) return false;
  return /no such exec/i.test(msg) || /no such exec instance/i.test(msg);
}

const DOCKER_SNAPSHOT_ACTIVE_STALE_MS = 30 * 60_000;

async function inspectDockerSnapshotImage(
  imageRef: string,
): Promise<{ imageId: string | null; sizeBytes: number | null } | null> {
  const ref = String(imageRef ?? '').trim();
  if (!ref) return null;
  try {
    const stdout = await runDockerOrThrow(['image', 'inspect', ref, '--format', '{{json .}}'], {
      timeoutMs: 30_000,
    });
    const inspect = JSON.parse(String(stdout ?? '').trim() || 'null');
    const imageId = String(inspect?.Id ?? '').trim() || null;
    const size = Number(inspect?.Size);
    const sizeBytes = Number.isFinite(size) && size >= 0 ? Math.floor(size) : null;
    return imageId || sizeBytes != null ? { imageId, sizeBytes } : null;
  } catch {
    return null;
  }
}

async function failStaleDockerSnapshotsForChat(opts: {
  droneId: string;
  chatName: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  if (!droneId || !chatName) return;
  const cutoffMs = Date.now() - DOCKER_SNAPSHOT_ACTIVE_STALE_MS;
  const candidates: Array<{
    promptId: string;
    snapshotId: string;
    status: 'creating' | 'restoring';
    imageRef: string;
  }> = [];

  const regSnap: any = await loadRegistry();
  const initialTurns: TranscriptTurn[] = Array.isArray(
    regSnap?.drones?.[droneId]?.chats?.[chatName]?.turns,
  )
    ? regSnap.drones[droneId].chats[chatName].turns
    : [];
  for (const turn of initialTurns as any[]) {
    const promptId = String(turn?.id ?? '').trim();
    const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
    if (!promptId || !snap || (snap.status !== 'creating' && snap.status !== 'restoring')) continue;
    const createdMs = Date.parse(String(snap.createdAt ?? ''));
    if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
    candidates.push({
      promptId,
      snapshotId: snap.id,
      status: snap.status,
      imageRef: String(snap.imageRef ?? '').trim(),
    });
  }
  if (candidates.length === 0) return;

  const recoveredBySnapshotId = new Map<
    string,
    { imageId: string | null; sizeBytes: number | null }
  >();
  for (const candidate of candidates) {
    if (candidate.status !== 'creating' || !candidate.imageRef) continue;
    // eslint-disable-next-line no-await-in-loop
    const image = await inspectDockerSnapshotImage(candidate.imageRef);
    if (image) recoveredBySnapshotId.set(candidate.snapshotId, image);
  }

  let syncedTurns: TranscriptTurn[] | null = null;
  {
    const turns: TranscriptTurn[] = initialTurns.map((turn) => ({ ...turn }));
    let changed = false;
    for (let i = 0; i < turns.length; i += 1) {
      const turn: any = turns[i];
      const promptId = String(turn?.id ?? '').trim();
      const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
      if (!snap || (snap.status !== 'creating' && snap.status !== 'restoring')) continue;
      const createdMs = Date.parse(String(snap.createdAt ?? ''));
      if (!Number.isFinite(createdMs) || createdMs > cutoffMs) continue;
      if (
        !candidates.some(
          (candidate) => candidate.promptId === promptId && candidate.snapshotId === snap.id,
        )
      )
        continue;
      const recovered = recoveredBySnapshotId.get(snap.id);
      if (snap.status === 'creating' && recovered) {
        turn.dockerSnapshot = {
          ...snap,
          status: 'ready',
          ...(String(snap.imageRef ?? '').trim() ? { imageRef: String(snap.imageRef).trim() } : {}),
          ...(recovered.imageId ? { imageId: recovered.imageId } : {}),
          ...(typeof recovered.sizeBytes === 'number' ? { sizeBytes: recovered.sizeBytes } : {}),
          readyAt: nowIso(),
        };
        turns[i] = turn;
        changed = true;
        continue;
      }
      turn.dockerSnapshot = {
        ...snap,
        status: 'failed',
        error: `${snap.status === 'restoring' ? 'Rollback' : 'Snapshot'} did not finish before Hub lost track of it`,
      };
      turns[i] = turn;
      changed = true;
    }
    if (changed) syncedTurns = turns;
  }
  if (syncedTurns) {
    for (const candidate of candidates) {
      const updated = (syncedTurns as TranscriptTurn[]).find(
        (turn: any) => String(turn?.id ?? '').trim() === candidate.promptId,
      );
      if (!updated) continue;
      await upsertTranscriptTurnInStore({ droneId, chatName, turn: updated });
    }
  }
}

async function dockerSnapshotTotalsForDroneEntry(
  droneEntry: any,
): Promise<{ count: number; sizeBytes: number; virtualSizeBytes: number | null }> {
  let count = 0;
  let sizeBytes = 0;
  let virtualSizeBytes = 0;
  let hasVirtualSize = false;
  const imageRefs: string[] = [];
  const fallbackVirtualSizes = new Map<string, number>();
  const visitChat = (chat: any) => {
    const turns = Array.isArray(chat?.turns) ? chat.turns : [];
    for (const turn of turns) {
      const snap = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
      if (!snap || snap.status !== 'ready') continue;
      count += 1;
      const imageRef = String(snap.imageRef ?? '').trim();
      const size = Number(snap.sizeBytes);
      if (imageRef) {
        imageRefs.push(imageRef);
        if (Number.isFinite(size) && size > 0) fallbackVirtualSizes.set(imageRef, Math.floor(size));
      } else if (Number.isFinite(size) && size > 0) {
        sizeBytes += Math.floor(size);
        virtualSizeBytes += Math.floor(size);
        hasVirtualSize = true;
      }
    }
  };
  for (const chat of Object.values(droneEntry?.chats ?? {})) visitChat(chat);
  for (const chat of Object.values(droneEntry?.archivedChats ?? {})) visitChat(chat);
  const usageByRef = imageRefs.length
    ? await dockerImageDiskUsageByRef()
    : new Map<string, DockerImageDiskUsage>();
  for (const imageRef of Array.from(new Set(imageRefs))) {
    const usage = usageByRef.get(imageRef);
    const fallback = fallbackVirtualSizes.get(imageRef) ?? null;
    const unique = usage?.uniqueBytes ?? null;
    const virtual = usage?.virtualBytes ?? fallback;
    if (unique != null && Number.isFinite(unique) && unique >= 0) {
      sizeBytes += Math.floor(unique);
    } else if (fallback != null) {
      sizeBytes += fallback;
    }
    if (virtual != null && Number.isFinite(virtual) && virtual >= 0) {
      virtualSizeBytes += Math.floor(virtual);
      hasVirtualSize = true;
    }
  }
  return { count, sizeBytes, virtualSizeBytes: hasVirtualSize ? virtualSizeBytes : null };
}

function collectDockerSnapshotImageRefsFromChatEntry(chatEntry: any): string[] {
  const out: string[] = [];
  const turns = Array.isArray(chatEntry?.turns) ? chatEntry.turns : [];
  for (const turn of turns) {
    const imageRef = String((turn as any)?.dockerSnapshot?.imageRef ?? '').trim();
    if (imageRef && !out.includes(imageRef)) out.push(imageRef);
  }
  return out;
}

function collectDockerSnapshotImageRefsFromDroneEntry(droneEntry: any): string[] {
  const out: string[] = [];
  const add = (refs: string[]) => {
    for (const ref of refs) {
      if (ref && !out.includes(ref)) out.push(ref);
    }
  };
  for (const chat of Object.values(droneEntry?.chats ?? {}))
    add(collectDockerSnapshotImageRefsFromChatEntry(chat));
  for (const chat of Object.values(droneEntry?.archivedChats ?? {}))
    add(collectDockerSnapshotImageRefsFromChatEntry(chat));
  return out;
}

async function removeDockerSnapshotImagesBestEffort(
  imageRefs: string[],
  context: Record<string, unknown>,
): Promise<void> {
  const refs = Array.from(new Set(imageRefs.map((x) => String(x ?? '').trim()).filter(Boolean)));
  for (const imageRef of refs) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await runDockerOrThrow(['image', 'rm', '-f', imageRef], { timeoutMs: 60_000 });
    } catch (e: any) {
      hubLog('warn', 'failed removing docker snapshot image', {
        ...context,
        imageRef,
        error: String(e?.message ?? e ?? 'unknown error'),
      });
    }
  }
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
    String(opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? `drone-${droneId}`).trim() ||
    `drone-${droneId}`;

  await stopAllDroneChatActivity({
    droneId,
    droneEntry: opts.droneEntry,
    reason: 'delete',
    updateLiveRegistry: opts.updateLiveRegistry,
  });

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

const DEFAULT_ARCHIVE_RETENTION: ArchiveRetentionId = '1d';
const DEFAULT_ARCHIVE_RUNTIME_POLICY: ArchiveRuntimePolicy = 'keep-running';

function normalizeArchiveRetention(raw: unknown): ArchiveRetentionId {
  return parseArchiveRetentionId(raw) ?? DEFAULT_ARCHIVE_RETENTION;
}

function normalizeArchiveRuntimePolicy(raw: unknown): ArchiveRuntimePolicy {
  return parseArchiveRuntimePolicy(raw) ?? DEFAULT_ARCHIVE_RUNTIME_POLICY;
}

function parseIsoToMs(raw: unknown): number | null {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return ms;
}

function resolveArchiveDeleteAtIso(archivedEntry: any): string {
  const explicit = String(archivedEntry?.deleteAt ?? '').trim();
  if (explicit && Number.isFinite(Date.parse(explicit))) return explicit;
  const archivedAtMs = parseIsoToMs(archivedEntry?.archivedAt) ?? Date.now();
  const retention = normalizeArchiveRetention(archivedEntry?.archiveRetention);
  return new Date(archivedAtMs + archiveRetentionMs(retention)).toISOString();
}

function allocateRestoredDroneName(regAny: any, preferredRaw: unknown): string {
  const preferred = String(preferredRaw ?? '').trim();
  const fallback = preferred || allocateUntitledDisplayName(regAny);
  if (!droneDisplayNameExists(regAny, fallback)) return fallback;

  const maxBaseLen = Math.max(8, DRONE_DISPLAY_NAME_MAX_LEN - 8);
  const base = fallback.length > maxBaseLen ? fallback.slice(0, maxBaseLen).trim() : fallback;
  for (let i = 2; i <= 999; i += 1) {
    const candidate = `${base} (${i})`;
    if (candidate.length > DRONE_DISPLAY_NAME_MAX_LEN) continue;
    if (!droneDisplayNameExists(regAny, candidate)) return candidate;
  }
  return allocateUntitledDisplayName(regAny);
}

async function archiveChatById(opts: {
  droneId: string;
  chatName: string;
  archiveRetention: ArchiveRetentionId;
}): Promise<{
  hadDrone: boolean;
  hadChat: boolean;
  archived: boolean;
  droneId: string;
  chatName: string;
  archiveRetention: ArchiveRetentionId;
  archivedAt: string | null;
  deleteAt: string | null;
  chats: string[];
}> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const retention = normalizeArchiveRetention(opts.archiveRetention);
  const autoContinueEnabledByDefault = (await resolveEffectiveAgentMessageAutoContinueSettings())
    .enabledByDefault;
  const agentSuggestionEnabledByDefault = (await resolveEffectiveAgentSuggestionSettings())
    .enabledByDefault;
  if (!droneId || !chatName) {
    return {
      hadDrone: false,
      hadChat: false,
      archived: false,
      droneId: String(opts.droneId ?? ''),
      chatName,
      archiveRetention: retention,
      archivedAt: null,
      deleteAt: null,
      chats: [],
    };
  }

  const registry: any = await loadRegistry();
  const droneEntry = registry?.drones?.[droneId] ?? null;
  if (!droneEntry) {
    return {
      hadDrone: false,
      hadChat: false,
      archived: false,
      droneId,
      chatName,
      archiveRetention: retention,
      archivedAt: null,
      deleteAt: null,
      chats: [] as string[],
    };
  }
  await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
  await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
  if (!readChatFromStore({ droneId, chatName }).chat) {
    return {
      hadDrone: true,
      hadChat: false,
      archived: false,
      droneId,
      chatName,
      archiveRetention: retention,
      archivedAt: null,
      deleteAt: null,
      chats: listChatsFromStore({ droneId }).chats,
    };
  }

  const archivedAt = nowIso();
  const deleteAt = new Date(Date.now() + archiveRetentionMs(retention)).toISOString();
  const fallbackChat = {
    chatName: 'default',
    chatEntry: buildNewChatEntry({
      droneEntry,
      createdAt: nowIso(),
      autoContinueEnabledByDefault,
      agentSuggestionEnabledByDefault,
    }),
  };
  const stored = await archiveChatInStore({
    droneId,
    chatName,
    archivedAt,
    deleteAt,
    archiveRetention: retention,
    fallbackChat,
  });
  if (stored.archived && (globalThis as any).Bun) {
    await updateRegistry((regAny: any) => {
      const entry = regAny?.drones?.[droneId];
      if (!entry) return;
      entry.chats = entry.chats ?? {};
      delete entry.chats[chatName];
      entry.archivedChats = entry.archivedChats ?? {};
      entry.archivedChats[chatName] = {
        ...(stored.archivedChat?.chat ?? {}),
        archivedAt,
        deleteAt,
        archiveRetention: retention,
      };
      if (Object.keys(entry.chats).length === 0) entry.chats.default = fallbackChat.chatEntry;
    });
  }
  return {
    hadDrone: true,
    hadChat: stored.archived,
    archived: stored.archived,
    droneId,
    chatName,
    archiveRetention: retention,
    archivedAt: stored.archived ? archivedAt : null,
    deleteAt: stored.archived ? deleteAt : null,
    chats: stored.chats,
  };
}

async function restoreArchivedChatById(opts: {
  droneId: string;
  archivedChatName: string;
}): Promise<{
  hadDrone: boolean;
  hadChat: boolean;
  restored: boolean;
  droneId: string;
  chatName: string;
  renamed: boolean;
  chats: string[];
}> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const archivedChatName = normalizeChatName(opts.archivedChatName);
  if (!droneId || !archivedChatName) {
    return {
      hadDrone: false,
      hadChat: false,
      restored: false,
      droneId: String(opts.droneId ?? ''),
      chatName: archivedChatName,
      renamed: false,
      chats: [],
    };
  }

  const registry: any = await loadRegistry();
  const droneEntry = registry?.drones?.[droneId] ?? null;
  if (!droneEntry) {
    return {
      hadDrone: false,
      hadChat: false,
      restored: false,
      droneId,
      chatName: archivedChatName,
      renamed: false,
      chats: [] as string[],
    };
  }
  await importDroneChatsFromRegistry({ droneId, chats: droneEntry.chats });
  await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
  const stored = await restoreArchivedChatInStore({
    droneId,
    archivedChatName,
    maxChatNameLength: CHAT_NAME_MAX_LEN,
  });
  if (stored.restored && (globalThis as any).Bun) {
    await updateRegistry((regAny: any) => {
      const entry = regAny?.drones?.[droneId];
      if (!entry) return;
      entry.chats = entry.chats ?? {};
      entry.chats[stored.chatName] = stored.chat ?? {};
      if (entry.archivedChats?.[archivedChatName]) delete entry.archivedChats[archivedChatName];
      if (entry.archivedChats && Object.keys(entry.archivedChats).length === 0)
        delete entry.archivedChats;
    });
  }
  return {
    hadDrone: true,
    hadChat: stored.restored,
    restored: stored.restored,
    droneId,
    chatName: stored.chatName,
    renamed: stored.renamed,
    chats: stored.chats,
  };
}

async function deleteArchivedChatById(opts: {
  droneId: string;
  archivedChatName: string;
}): Promise<{
  hadDrone: boolean;
  hadChat: boolean;
  deleted: boolean;
  droneId: string;
  chatName: string;
}> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const archivedChatName = normalizeChatName(opts.archivedChatName);
  if (!droneId || !archivedChatName) {
    return {
      hadDrone: false,
      hadChat: false,
      deleted: false,
      droneId: String(opts.droneId ?? ''),
      chatName: archivedChatName,
    };
  }

  const registry: any = await loadRegistry();
  const droneEntry = registry?.drones?.[droneId] ?? null;
  if (!droneEntry) {
    return {
      hadDrone: false,
      hadChat: false,
      deleted: false,
      droneId,
      chatName: archivedChatName,
    };
  }
  await importArchivedChatsFromRegistry({ droneId, archivedChats: droneEntry.archivedChats });
  const stored = await deleteArchivedChatFromStore({ droneId, archivedChatName });
  if (stored.deleted && (globalThis as any).Bun) {
    await updateRegistry((regAny: any) => {
      const entry = regAny?.drones?.[droneId];
      if (entry?.archivedChats?.[archivedChatName]) delete entry.archivedChats[archivedChatName];
      if (entry?.archivedChats && Object.keys(entry.archivedChats).length === 0)
        delete entry.archivedChats;
    });
  }
  if (stored.deleted) {
    const snapshotImageRefs = collectDockerSnapshotImageRefsFromChatEntry(
      stored.archivedChat?.chat,
    );
    await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
      droneId,
      chatName: archivedChatName,
      reason: 'delete-archived-chat',
    });
  }
  return {
    hadDrone: true,
    hadChat: stored.deleted,
    deleted: stored.deleted,
    droneId,
    chatName: archivedChatName,
  };
}

async function cleanupExpiredArchivedChats(opts?: { reason?: string }): Promise<void> {
  const regSnapshot: any = await loadRegistry();
  const nowMs = Date.now();
  const expired = (Object.entries(regSnapshot?.drones ?? {}) as Array<[string, any]>).flatMap(
    ([droneIdRaw, droneEntry]) => {
      const droneId = normalizeDroneIdentity(droneIdRaw);
      if (!droneId) return [];
      return (Object.entries(droneEntry?.archivedChats ?? {}) as Array<[string, any]>)
        .map(([chatNameRaw, entry]) => {
          const chatName = normalizeChatName(chatNameRaw);
          const deleteAtMs = parseIsoToMs(resolveArchiveDeleteAtIso(entry));
          if (!chatName || deleteAtMs == null || deleteAtMs > nowMs) return null;
          return { droneId, chatName };
        })
        .filter((item): item is { droneId: string; chatName: string } => Boolean(item));
    },
  );

  for (const item of expired) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await deleteArchivedChatById({ droneId: item.droneId, archivedChatName: item.chatName });
      hubLog('info', 'archive TTL deleted chat', {
        droneId: item.droneId,
        chat: item.chatName,
        reason: opts?.reason ?? null,
      });
    } catch (e: any) {
      hubLog('warn', 'archive TTL delete chat failed', {
        droneId: item.droneId,
        chat: item.chatName,
        reason: opts?.reason ?? null,
        error: e?.message ?? String(e),
      });
    }
  }
}

async function archiveDroneById(opts: {
  id: string;
  archiveRetention: ArchiveRetentionId;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
}): Promise<{
  hadEntry: boolean;
  archived: boolean;
  id: string;
  name: string;
  archiveRetention: ArchiveRetentionId;
  archiveRuntimePolicy: ArchiveRuntimePolicy;
  archivedAt: string | null;
  deleteAt: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      archived: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      archiveRetention: normalizeArchiveRetention(opts.archiveRetention),
      archiveRuntimePolicy: normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy),
      archivedAt: null,
      deleteAt: null,
    };
  }
  const retention = normalizeArchiveRetention(opts.archiveRetention);
  const runtimePolicy = normalizeArchiveRuntimePolicy(opts.archiveRuntimePolicy);
  const registry: any = await loadRegistry();
  const droneEntry = registry?.drones?.[droneId];
  if (!droneEntry) {
    return {
      hadEntry: false,
      archived: false,
      id: droneId,
      name: droneId,
      archiveRetention: retention,
      archiveRuntimePolicy: runtimePolicy,
      archivedAt: null,
      deleteAt: null,
    };
  }
  const archivedAt = nowIso();
  const deleteAt = new Date(Date.now() + archiveRetentionMs(retention)).toISOString();
  const name = String(droneEntry?.name ?? '').trim() || droneId;
  const containerName =
    String(droneEntry?.containerName ?? droneEntry?.name ?? `drone-${droneId}`).trim() ||
    `drone-${droneId}`;
  await upsertCanonicalDroneLifecycle('archived', droneId, {
    ...droneEntry,
    id: droneId,
    name,
    containerName,
    archivedAt,
    deleteAt,
    archiveRetention: retention,
    archiveRuntimePolicy: runtimePolicy,
  });
  return {
    hadEntry: true,
    archived: true,
    id: droneId,
    name,
    archiveRetention: retention,
    archiveRuntimePolicy: runtimePolicy,
    archivedAt,
    deleteAt,
  };
}

async function restoreArchivedDroneById(opts: { id: string }): Promise<{
  hadEntry: boolean;
  restored: boolean;
  id: string;
  name: string;
  renamed: boolean;
  error: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      restored: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      renamed: false,
      error: `invalid drone id: ${String(opts.id ?? '')}`,
    };
  }

  const regSnapshot: any = await loadRegistry();
  const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
  if (!archivedEntry) {
    return {
      hadEntry: false,
      restored: false,
      id: droneId,
      name: droneId,
      renamed: false,
      error: `unknown archived drone: ${droneId}`,
    };
  }

  const containerName =
    String(archivedEntry?.containerName ?? archivedEntry?.name ?? `drone-${droneId}`).trim() ||
    `drone-${droneId}`;
  const runtime = droneRuntime(archivedEntry);
  const archiveRuntimePolicy = normalizeArchiveRuntimePolicy(archivedEntry?.archiveRuntimePolicy);
  if (runtime !== 'host') {
    const containerExists = await dvmContainerExists(containerName);
    if (!containerExists) {
      return {
        hadEntry: true,
        restored: false,
        id: droneId,
        name: String(archivedEntry?.name ?? '').trim() || droneId,
        renamed: false,
        error: `container "${containerName}" no longer exists`,
      };
    }

    if (archiveRuntimePolicy === 'stop') {
      try {
        await dvmStart(containerName);
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        if (!looksLikeContainerAlreadyRunningError(msg)) {
          return {
            hadEntry: true,
            restored: false,
            id: droneId,
            name: String(archivedEntry?.name ?? '').trim() || droneId,
            renamed: false,
            error: `failed to start archived drone container "${containerName}": ${msg}`,
          };
        }
      }
    }
  }

  const previousName = String(archivedEntry?.name ?? '').trim() || droneId;
  const restoredName = allocateRestoredDroneName(regSnapshot, previousName);
  const restoredEntry: any = {
    ...archivedEntry,
    id: droneId,
    name: restoredName,
    containerName,
  };
  delete restoredEntry.archivedAt;
  delete restoredEntry.deleteAt;
  delete restoredEntry.archiveRetention;
  delete restoredEntry.archiveRuntimePolicy;
  await upsertCanonicalDroneLifecycle('real', droneId, restoredEntry);
  return {
    hadEntry: true,
    restored: true,
    id: droneId,
    name: restoredName,
    renamed: restoredName !== previousName,
    error: null,
  };
}

async function removeArchivedDroneById(opts: { id: string; keepVolume: boolean }): Promise<{
  hadEntry: boolean;
  removedArchive: boolean;
  id: string;
  name: string;
  removeErr: string | null;
}> {
  const droneId = normalizeDroneIdentity(opts.id);
  if (!droneId) {
    return {
      hadEntry: false,
      removedArchive: false,
      id: String(opts.id ?? ''),
      name: String(opts.id ?? ''),
      removeErr: `invalid drone id: ${String(opts.id ?? '')}`,
    };
  }

  const regSnapshot: any = await loadRegistry();
  const archivedEntry = regSnapshot?.archived?.[droneId] ?? null;
  const hadEntry = Boolean(archivedEntry);
  const name = String(archivedEntry?.name ?? '').trim() || droneId;
  if (!archivedEntry) {
    return {
      hadEntry: false,
      removedArchive: false,
      id: droneId,
      name,
      removeErr: `unknown archived drone: ${droneId}`,
    };
  }

  const { containerGone, removeErr } = await removeDroneRuntimeArtifacts({
    droneId,
    droneEntry: archivedEntry,
    keepVolume: opts.keepVolume,
    updateLiveRegistry: false,
  });

  let removedArchive = false;
  if (containerGone) {
    const snapshotImageRefs = collectDockerSnapshotImageRefsFromDroneEntry(archivedEntry);
    removedArchive = (
      await permanentlyDeleteCanonicalDrone({ droneId, lifecycleState: 'archived' })
    ).removedLifecycle;
    if (removedArchive) {
      await revokeMcpAccessTokensForDrone(droneId);
      await removeDockerSnapshotImagesBestEffort(snapshotImageRefs, {
        droneId,
        reason: 'delete-archived-drone',
      });
    }
  }

  return { hadEntry, removedArchive, id: droneId, name, removeErr };
}

let ARCHIVE_CLEANUP_TASK: Promise<void> | null = null;
const ARCHIVE_CLEANUP_INTERVAL_MS = 5 * 60_000;
const ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN = 25;
let ARCHIVE_CLEANUP_INTERVAL: ReturnType<typeof setInterval> | null = null;

function triggerArchiveCleanup(reason: string) {
  void cleanupExpiredArchivedDrones({ reason }).catch((e: any) => {
    hubLog('warn', 'archive cleanup failed', {
      reason,
      error: e?.message ?? String(e),
    });
  });
}

async function cleanupExpiredArchivedDrones(opts?: {
  maxDeletes?: number;
  reason?: string;
}): Promise<void> {
  if (ARCHIVE_CLEANUP_TASK) {
    await ARCHIVE_CLEANUP_TASK;
    return;
  }
  const maxDeletes =
    typeof opts?.maxDeletes === 'number' && Number.isFinite(opts.maxDeletes)
      ? Math.max(1, Math.floor(opts.maxDeletes))
      : ARCHIVE_CLEANUP_MAX_DELETES_PER_RUN;

  ARCHIVE_CLEANUP_TASK = (async () => {
    const regAny: any = await loadRegistry();
    const canonicalArchived = await listCanonicalDroneLifecycle('archived');
    const nowMs = Date.now();
    const archiveEntries: Array<[string, any]> = canonicalArchived
      ? canonicalArchived.map((record) => [record.id, record.lifecycle])
      : (Object.entries(regAny?.archived ?? {}) as Array<[string, any]>);
    const expiredIds = archiveEntries
      .map(([id, entry]) => {
        const parsedId = normalizeDroneIdentity(id);
        if (!parsedId) return null;
        const deleteAtIso = resolveArchiveDeleteAtIso(entry);
        const deleteAtMs = parseIsoToMs(deleteAtIso);
        if (deleteAtMs == null || deleteAtMs > nowMs) return null;
        return parsedId;
      })
      .filter((id): id is string => Boolean(id))
      .slice(0, maxDeletes);

    for (const droneId of expiredIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const r = await removeArchivedDroneById({ id: droneId, keepVolume: false });
        if (r.removeErr) {
          hubLog('warn', 'archive TTL delete failed', {
            id: droneId,
            error: r.removeErr,
            reason: opts?.reason ?? null,
          });
        } else {
          hubLog('info', 'archive TTL deleted drone', {
            id: droneId,
            reason: opts?.reason ?? null,
          });
        }
      } catch (e: any) {
        hubLog('warn', 'archive TTL delete failed (exception)', {
          id: droneId,
          error: e?.message ?? String(e),
          reason: opts?.reason ?? null,
        });
      }
    }
  })().finally(() => {
    ARCHIVE_CLEANUP_TASK = null;
  });

  await ARCHIVE_CLEANUP_TASK;
}

async function renameDroneByName(opts: {
  oldName: string;
  newName: string;
  startMode?: 'preserve' | 'always' | 'never';
  migrateVolumeName?: boolean;
}) {
  return {
    ok: false as const,
    status: 410 as const,
    error:
      'deprecated: renames are id-based; use /api/drones/:id/rename to update the display name (containers are never renamed)',
  };
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

function looksLikeUnauthorizedDaemonError(raw: unknown): boolean {
  const msg = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!msg) return false;
  return (
    msg === 'unauthorized' ||
    msg.includes(' 401') ||
    msg.startsWith('401 ') ||
    msg.includes('forbidden')
  );
}

async function readDroneTokenFromContainer(containerName: string): Promise<string> {
  const r = await dvmExec(containerName, 'bash', [
    '-lc',
    'cat /dvm-data/drone/token 2>/dev/null || true',
  ]);
  return String(r.stdout ?? '').trim();
}

async function refreshRegistryTokenFromContainer(opts: {
  droneId: string;
}): Promise<string | null> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) return null;
  const lockKey = `drone:${droneId}`;

  return await withDroneOpLock(lockKey, async () => {
    const regAny: any = await loadRegistry();
    const entry: any = regAny?.drones?.[droneId] ?? null;
    if (!entry) return null;

    let token = '';
    try {
      token = await readDroneTokenFromContainer(
        String(entry?.containerName ?? entry?.name ?? `drone-${droneId}`),
      );
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (looksLikeMissingContainerError(msg)) {
        try {
          const reg2: any = await loadRegistry();
          const entry2: any = reg2?.drones?.[droneId] ?? null;
          if (entry2) {
            token = await readDroneTokenFromContainer(
              String(entry2?.containerName ?? entry2?.name ?? `drone-${droneId}`),
            );
          }
        } catch {
          token = '';
        }
      }
    }
    token = String(token ?? '').trim();
    if (!token) return null;

    await commitDroneMetadataPatch({
      droneId,
      state: 'real',
      eventType: 'drone.token.refreshed',
      transform: (lifecycle) => ({ ...lifecycle, token }),
    });

    return token;
  });
}

function resolveHubAgentCommand(): string {
  // CLI-agnostic by design: this is just a command run inside tmux.
  // Override via env for other CLIs (e.g. "my-agent --foo").
  return String(process.env.DRONE_HUB_AGENT_CMD ?? '').trim() || 'agent --approve-mcps';
}

function resolveBuiltinTmuxCommand(agent: ChatAgentConfig['id']): string {
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

function buildNewChatEntry(opts: {
  droneEntry: any;
  createdAt: string;
  sourceChatEntry?: any;
  autoContinueEnabledByDefault: boolean;
  agentSuggestionEnabledByDefault?: boolean;
}) {
  const agent = opts.sourceChatEntry
    ? inferChatAgent(opts.sourceChatEntry, opts.droneEntry)
    : defaultChatAgentConfigForDrone(opts.droneEntry);
  const entry: any = {
    createdAt: opts.createdAt,
    agent,
    ...(opts.sourceChatEntry &&
    normalizeAgentPermissionMode(opts.sourceChatEntry?.agentPermissionMode) === 'read-only'
      ? { agentPermissionMode: 'read-only' }
      : {}),
    ...(opts.sourceChatEntry && normalizeChatModel(opts.sourceChatEntry?.model)
      ? { model: normalizeChatModel(opts.sourceChatEntry?.model) }
      : {}),
    ...(opts.sourceChatEntry && normalizeChatReasoning(opts.sourceChatEntry?.reasoning)
      ? { reasoning: normalizeChatReasoning(opts.sourceChatEntry?.reasoning) }
      : {}),
  };
  if (opts.autoContinueEnabledByDefault && agent.kind === 'builtin') {
    entry.agentMessageAutoContinueEnabled = true;
    entry.agentMessageAutoContinueEnabledAt = opts.createdAt;
  }
  if (opts.agentSuggestionEnabledByDefault && agent.kind === 'builtin') {
    entry.agentSuggestionEnabled = true;
    entry.agentSuggestionEnabledAt = opts.createdAt;
  }
  return entry;
}

const HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES = 300;
const HUB_WEB_TERMINAL_MAX_TAIL_LINES = 1000;
const HUB_WEB_TERMINAL_MAX_BYTES = 200_000;

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseOptionalNonNegativeInt(raw: string | null): number | undefined {
  if (raw == null) return undefined;
  const v = Number(String(raw).trim());
  if (!Number.isFinite(v) || v < 0) return undefined;
  return Math.floor(v);
}

function clampIntParam(raw: string | null, defaultValue: number, min: number, max: number): number {
  const parsed = parseOptionalNonNegativeInt(raw);
  return clampInt(parsed ?? defaultValue, min, max);
}

function buildHubSessionShell(opts: {
  command: string;
  cwd: string;
  envVars?: Record<string, string> | null;
}): string {
  const cmd =
    String(opts.command || '').trim() || resolveContainerTerminalShellCommand(process.env);
  const cwd = normalizeContainerPath(String(opts.cwd ?? '').trim() || '/dvm-data');
  const baseEnv = ['export TERM=xterm-256color', 'export COLORTERM=truecolor'].join('; ');
  const managedEnv = buildEnvExportLines(opts.envVars).join('; ');
  return [
    'set -e',
    baseEnv,
    managedEnv,
    `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
    `cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data`,
    cmd,
  ]
    .filter((part) => Boolean(String(part).trim()))
    .join('; ');
}

async function ensureHubSessionRunning(opts: {
  containerName: string;
  sessionName: string;
  command: string;
  cwd?: string | null;
  envVars?: Record<string, string> | null;
}) {
  const sessionName = sanitizeTmuxSessionName(opts.sessionName || 'default');
  // If a tmux session exists but its pane is dead (e.g. shell got terminated),
  // kill and recreate it so the web terminal always attaches to a live shell.
  try {
    const deadCheckScript = [
      'set -euo pipefail',
      `s=${bashQuote(sessionName)}`,
      'tmux has-session -t "$s" 2>/dev/null || exit 0',
      'dead="$(tmux display-message -p -t "$s:0.0" \'#{pane_dead}\' 2>/dev/null || echo 0)"',
      '[ "$dead" = "1" ] && tmux kill-session -t "$s" 2>/dev/null || true',
    ].join('\n');
    await dvmExec(opts.containerName, 'bash', ['-lc', deadCheckScript]);
  } catch {
    // Best-effort safety check; continue with normal start logic.
  }
  const shell = buildHubSessionShell({
    command: opts.command,
    cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
    envVars: opts.envVars ?? null,
  });
  try {
    await dvmSessionStart(opts.containerName, sessionName, 'bash', ['-lc', shell], true);
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    // `--reuse` should avoid duplicates, but there can still be a small TOCTOU race.
    if (/duplicate session:/i.test(msg) || /Session already exists:/i.test(msg)) {
      // Treat as success; the session is running (or is being created).
    } else {
      throw e;
    }
  }
  return { sessionName };
}

async function ensureChatEntry(opts: { droneId: string; chatName: string }): Promise<void> {
  const autoContinueEnabledByDefault = (await resolveEffectiveAgentMessageAutoContinueSettings())
    .enabledByDefault;
  const agentSuggestionEnabledByDefault = (await resolveEffectiveAgentSuggestionSettings())
    .enabledByDefault;
  const reg: any = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? reg?.drones?.[droneId] : null;
  if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
  if (!(globalThis as any).Bun) {
    await importDroneChatsFromRegistry({ droneId, chats: d.chats });
    if (readChatFromStore({ droneId, chatName: opts.chatName }).chat) return;
    await upsertChatInStore({
      droneId,
      chatName: opts.chatName,
      chatEntry: buildNewChatEntry({
        droneEntry: d,
        createdAt: new Date().toISOString(),
        autoContinueEnabledByDefault,
        agentSuggestionEnabledByDefault,
      }),
    });
    return;
  }
  await updateRegistry((registry: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const drone = droneId ? registry?.drones?.[droneId] : null;
    if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
    drone.chats = drone.chats ?? {};
    if (!drone.chats[opts.chatName]) {
      // Child drones default to Codex; other drones keep Cursor.
      // NOTE: chatId is intentionally omitted (it is created lazily on first prompt).
      drone.chats[opts.chatName] = buildNewChatEntry({
        droneEntry: drone,
        createdAt: new Date().toISOString(),
        autoContinueEnabledByDefault,
        agentSuggestionEnabledByDefault,
      }) as any;
      registry.drones = registry.drones ?? {};
      registry.drones[droneId] = drone;
    }
  });
}

async function ensureChatEntryCopiedFromChat(opts: {
  droneId: string;
  chatName: string;
  copyFromChatName: string;
}): Promise<void> {
  const autoContinueEnabledByDefault = (await resolveEffectiveAgentMessageAutoContinueSettings())
    .enabledByDefault;
  const agentSuggestionEnabledByDefault = (await resolveEffectiveAgentSuggestionSettings())
    .enabledByDefault;
  if (!(globalThis as any).Bun) {
    const registry: any = await loadRegistry();
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = parseChatNameForMutation(opts.chatName, 'chat name');
    const copyFromChatName = normalizeChatName(opts.copyFromChatName);
    const drone = droneId ? registry?.drones?.[droneId] : null;
    if (!drone) throw new Error(`unknown drone: ${opts.droneId}`);
    await importDroneChatsFromRegistry({ droneId, chats: drone.chats });
    if (readChatFromStore({ droneId, chatName }).chat) return;
    const createdAt = nowIso();
    const source = copyFromChatName
      ? readChatFromStore({ droneId, chatName: copyFromChatName }).chat
      : null;
    if (
      copyFromChatName &&
      !source &&
      !(copyFromChatName === 'default' && listChatsFromStore({ droneId }).chats.length === 0)
    ) {
      throw new Error(`unknown chat: ${copyFromChatName}`);
    }
    await upsertChatInStore({
      droneId,
      chatName,
      chatEntry: buildNewChatEntry({
        droneEntry: drone,
        createdAt,
        ...(source ? { sourceChatEntry: source } : {}),
        autoContinueEnabledByDefault,
        agentSuggestionEnabledByDefault,
      }),
    });
    return;
  }
  let syncedDroneId = '';
  let syncedChats: any = null;
  await updateRegistry((reg: any) => {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const chatName = parseChatNameForMutation(opts.chatName, 'chat name');
    const copyFromChatName = normalizeChatName(opts.copyFromChatName);
    const d = droneId ? reg?.drones?.[droneId] : null;
    if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
    syncedDroneId = droneId;
    d.chats = d.chats ?? {};
    if (d.chats[chatName]) {
      syncedChats = d.chats;
      return;
    }
    const createdAt = nowIso();
    if (copyFromChatName && !d.chats[copyFromChatName]) {
      if (copyFromChatName === 'default' && Object.keys(d.chats).length === 0) {
        d.chats.default = buildNewChatEntry({
          droneEntry: d,
          createdAt,
          autoContinueEnabledByDefault,
          agentSuggestionEnabledByDefault,
        });
      } else {
        throw new Error(`unknown chat: ${copyFromChatName}`);
      }
    }
    let entry: any = buildNewChatEntry({
      droneEntry: d,
      createdAt,
      autoContinueEnabledByDefault,
      agentSuggestionEnabledByDefault,
    });
    if (copyFromChatName) {
      const source = d.chats?.[copyFromChatName];
      if (!source) throw new Error(`unknown chat: ${copyFromChatName}`);
      entry = buildNewChatEntry({
        droneEntry: d,
        createdAt,
        sourceChatEntry: source,
        autoContinueEnabledByDefault,
        agentSuggestionEnabledByDefault,
      });
    }
    d.chats[chatName] = entry;
    reg.drones = reg.drones ?? {};
    reg.drones[droneId] = d;
    syncedChats = d.chats;
  });
  if (syncedDroneId && syncedChats)
    await importDroneChatsFromRegistry({ droneId: syncedDroneId, chats: syncedChats });
}

function inferChatAgent(entry: any, droneEntry?: any): ChatAgentConfig {
  const agent = entry?.agent as ChatAgentConfig | undefined;
  if (agent && agent.kind === 'builtin') {
    const builtinId = normalizeBuiltinAgentId(agent.id);
    if (builtinId) return { kind: 'builtin', id: builtinId };
  }
  if (agent && agent.kind === 'custom') {
    const id = String((agent as any).id ?? '').trim();
    const label = String((agent as any).label ?? '').trim() || id || 'Custom';
    const command = String((agent as any).command ?? '').trim() || resolveHubAgentCommand();
    return { kind: 'custom', id: id || 'custom', label, command };
  }
  return defaultChatAgentConfigForDrone(droneEntry);
}

function assertReadOnlySupportedForAgent(agent: ChatAgentConfig): void {
  if (agent.kind === 'builtin' && (agent.id === 'codex' || agent.id === 'blip')) return;
  const label = agent.kind === 'builtin' ? agent.id : agent.label || agent.id || 'custom agent';
  const error: Error & { statusCode?: number } = new Error(
    `read-only mode is currently supported for Codex and Blip chats only (selected: ${label})`,
  );
  error.statusCode = 400;
  throw error;
}

async function getChatEntry(opts: { droneId: string; chatName: string }) {
  if (!(globalThis as any).Bun) {
    const droneId = normalizeDroneIdentity(opts.droneId);
    const resolved = droneId ? await resolveCanonicalDroneOrPendingForReadRef(droneId) : null;
    if (resolved?.kind !== 'real') throw new Error(`unknown drone: ${opts.droneId}`);
    const stored = readChatFromStore({ droneId, chatName: opts.chatName });
    if (!stored.available || !stored.chat) throw new Error(`unknown chat: ${opts.chatName}`);
    return { reg: null, d: resolved.drone, chat: stored.chat, droneId };
  }
  const reg = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? (reg as any).drones?.[droneId] : null;
  if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
  const chat = d.chats?.[opts.chatName];
  if (!chat) throw new Error(`unknown chat: ${opts.chatName}`);
  await importChatFromRegistry({ droneId, chatName: opts.chatName, chatEntry: chat });
  const read = readChatFromStore({ droneId, chatName: opts.chatName });
  return { reg, d, chat: read.available && read.chat ? read.chat : chat, droneId };
}

async function projectCanonicalChatToRegistry(
  droneIdRaw: string,
  chatNameRaw: string,
): Promise<void> {
  if (!(globalThis as any).Bun) return;
  const droneId = normalizeDroneIdentity(droneIdRaw);
  const chatName = normalizeChatName(chatNameRaw);
  const stored = readChatFromStore({ droneId, chatName });
  if (!stored.available || !stored.chat) return;
  const { turns, pendingPrompts: _canonicalPendingPrompts, ...canonicalMetadata } = stored.chat;
  await updateRegistry((registry: any) => {
    const drone = registry?.drones?.[droneId];
    const current = drone?.chats?.[chatName];
    if (!drone || !current) return;
    drone.chats[chatName] = {
      ...canonicalMetadata,
      turns: Array.isArray(turns) ? turns : [],
      // PromptQueueRepository remains authoritative; retain this field only as
      // a compatibility projection for older registry readers.
      pendingPrompts: Array.isArray(current.pendingPrompts) ? current.pendingPrompts : [],
    };
  });
}

async function projectCanonicalChatsToRegistry(droneIdRaw: string): Promise<void> {
  if (!(globalThis as any).Bun) return;
  const droneId = normalizeDroneIdentity(droneIdRaw);
  const chats = Object.fromEntries(
    listChatsFromStore({ droneId }).chats.flatMap((chatName) => {
      const stored = readChatFromStore({ droneId, chatName });
      return stored.available && stored.chat ? [[chatName, stored.chat]] : [];
    }),
  );
  await updateRegistry((registry: any) => {
    const drone = registry?.drones?.[droneId];
    if (!drone) return;
    drone.chats = chats;
  });
}

const CHAT_AUTO_RENAME_IN_FLIGHT = new Set<string>();
const CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD = 'firstMessageNameSuggestionAttemptedAt';

async function shouldAutoRenameChatOnPrompt(opts: {
  droneId: string;
  chatName: string;
  chatEntry: any;
}): Promise<boolean> {
  if (!isGeneratedChatName(opts.chatName)) return false;
  try {
    await importResolvedChatToStore(opts.droneId, opts.chatName, opts.chatEntry);
    const stored = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
    if (String(stored.chat?.[CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD] ?? '').trim()) return false;
    const transcript = countTranscriptTurnsFromStore({
      droneId: opts.droneId,
      chatName: opts.chatName,
    });
    const pending = await readPendingPrompts({
      droneId: opts.droneId,
      chatName: opts.chatName,
    });
    return transcript.count === 0 && pending.length === 0;
  } catch (error: any) {
    hubLog('warn', 'chat auto-rename first-message check failed', {
      droneId: opts.droneId,
      chatName: opts.chatName,
      error: error?.message ?? String(error),
    });
    return false;
  }
}

async function claimChatAutoRenameFromFirstPrompt(opts: {
  droneId: string;
  chatName: string;
}): Promise<boolean> {
  try {
    const attemptedAt = nowIso();
    const patched = await patchChatMetadataInStore({
      droneId: opts.droneId,
      chatName: opts.chatName,
      patch: {
        setIfMissing: {
          [CHAT_AUTO_RENAME_ATTEMPTED_AT_FIELD]: attemptedAt,
        },
      },
    });
    if (!patched.changed) return false;
    await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
    return true;
  } catch (error: any) {
    hubLog('warn', 'chat auto-rename first-message claim failed', {
      droneId: opts.droneId,
      chatName: opts.chatName,
      error: error?.message ?? String(error),
    });
    return false;
  }
}

async function autoRenameGeneratedChatFromFirstPrompt(opts: {
  droneId: string;
  chatName: string;
  prompt: string;
  expectedCreatedAt: string;
}): Promise<void> {
  if (!isGeneratedChatName(opts.chatName)) return;
  const key = `${opts.droneId}\u0000${opts.chatName}`;
  if (CHAT_AUTO_RENAME_IN_FLIGHT.has(key)) return;
  CHAT_AUTO_RENAME_IN_FLIGHT.add(key);

  try {
    const llm = await resolveNameSuggestionLlmSettings();
    if (!llm.apiKey) {
      hubLog('warn', 'chat auto-rename skipped: missing Codex connection and OpenAI key', {
        droneId: opts.droneId,
        chatName: opts.chatName,
      });
      return;
    }

    const base = await suggestDroneNameFromMessage(opts.prompt, {
      provider: llm.provider,
      apiKey: llm.apiKey,
    });
    const current = readChatFromStore({ droneId: opts.droneId, chatName: opts.chatName });
    if (!current.chat || String(current.chat?.createdAt ?? '') !== opts.expectedCreatedAt) return;

    const existing = new Set(listChatsFromStore({ droneId: opts.droneId }).chats);
    let candidate = '';
    let renamed = false;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const next = buildAutoRenamedChatCandidate(base, attempt);
      if (!next || next === opts.chatName || existing.has(next)) continue;
      try {
        renamed = await renameChatInStore({
          droneId: opts.droneId,
          chatName: opts.chatName,
          newChatName: next,
        });
        candidate = next;
        break;
      } catch (error: any) {
        const message = String(error?.message ?? error ?? '');
        if (/already exists/i.test(message)) {
          existing.add(next);
          continue;
        }
        if (/unknown chat/i.test(message)) return;
        throw error;
      }
    }
    if (!candidate) throw new Error('could not find an available suggested chat name');
    if (!renamed) return;
    migrateInMemoryChatStateForRename({
      droneId: opts.droneId,
      fromChatName: opts.chatName,
      toChatName: candidate,
    });
    await projectCanonicalChatsToRegistry(opts.droneId);
    hubLog('info', 'chat auto-renamed from first message', {
      droneId: opts.droneId,
      oldChatName: opts.chatName,
      chatName: candidate,
      provider: llm.provider,
    });
  } catch (error: any) {
    hubLog('warn', 'chat auto-rename failed', {
      droneId: opts.droneId,
      chatName: opts.chatName,
      error: error?.message ?? String(error),
    });
  } finally {
    CHAT_AUTO_RENAME_IN_FLIGHT.delete(key);
  }
}

async function importResolvedDroneChatsToStore(
  droneId: string,
  droneEntry: any,
): Promise<string[]> {
  const chats = droneEntry?.chats && typeof droneEntry.chats === 'object' ? droneEntry.chats : {};
  const imported = await importDroneChatsFromRegistry({ droneId, chats });
  if (imported.available) return imported.chats;
  return Object.keys(chats);
}

async function importResolvedChatToStore(
  droneId: string,
  chatName: string,
  chatEntry: any,
): Promise<any> {
  await importChatFromRegistry({ droneId, chatName, chatEntry });
  const read = readChatFromStore({ droneId, chatName });
  return read.available ? read.chat : chatEntry;
}

type ChatStateContext =
  | {
      kind: 'pending';
      droneId: string;
      droneName: string;
      chatName: string;
      pendingEntry: any;
    }
  | {
      kind: 'real';
      droneId: string;
      droneName: string;
      chatName: string;
      droneEntry: any;
      projectedChatEntry: any;
    };

async function buildChatStateContext(opts: {
  droneRef: string;
  chatName: string;
  resolved: ResolvedOrPendingDrone;
}): Promise<ChatStateContext | { kind: 'missing-chat'; droneId: string; chatName: string }> {
  if (opts.resolved.kind === 'pending') {
    const droneName = String(opts.resolved.pending?.name ?? opts.droneRef).trim() || opts.droneRef;
    return {
      kind: 'pending',
      droneId: opts.resolved.id,
      droneName,
      chatName: opts.chatName,
      pendingEntry: opts.resolved.pending,
    };
  }

  const droneId = opts.resolved.id;
  const droneEntry = opts.resolved.drone;
  const registryChatEntry = (droneEntry as any)?.chats?.[opts.chatName] ?? null;
  if (!registryChatEntry) return { kind: 'missing-chat', droneId, chatName: opts.chatName };
  const droneName = String(droneEntry?.name ?? opts.droneRef).trim() || opts.droneRef;
  const projectedChatEntry =
    (await importResolvedChatToStore(droneId, opts.chatName, registryChatEntry)) ??
    registryChatEntry;
  return {
    kind: 'real',
    droneId,
    droneName,
    chatName: opts.chatName,
    droneEntry,
    projectedChatEntry,
  };
}

type BuiltChatTranscriptRows =
  | {
      ok: true;
      selection: string;
      transcripts: any[];
      agent: ChatAgentConfig;
      turnCount: number;
      etag: string;
    }
  | {
      ok: false;
      statusCode: 410;
      error: string;
      agent: ChatAgentConfig;
    };

type ChatSnapshotRead =
  | {
      ok: true;
      id: string;
      name: string;
      chat: string;
      selection: string;
      transcripts: any[];
      pending: PendingPrompt[];
      agent?: ChatAgentConfig;
      model: string | null;
      turnCount: number;
      transcriptEtag: string | null;
      responseEtag?: string;
      notModified?: boolean;
    }
  | {
      ok: false;
      statusCode: number;
      error: string;
      agent?: ChatAgentConfig;
    };

type ChatSnapshotMaintenance = 'none' | 'run' | 'schedule';

function runChatReadMaintenance(opts: {
  droneId: string;
  chatName: string;
  chatEntry: any;
  includeDockerSnapshotMaintenance?: boolean;
}): void {
  if (chatHasReconcilablePendingPrompts(opts.chatEntry)) {
    ensureDaemonPromptEventSubscription(opts.droneId);
    enqueueReconcile(opts.droneId, opts.chatName);
  }
  if (
    opts.includeDockerSnapshotMaintenance === true &&
    chatHasActiveDockerSnapshot(opts.chatEntry)
  ) {
    void failStaleDockerSnapshotsForChat({ droneId: opts.droneId, chatName: opts.chatName }).catch(
      (error: any) => {
        hubLog('warn', 'failed stale docker snapshot maintenance after transcript read', {
          droneId: opts.droneId,
          chatName: opts.chatName,
          error: String(error?.message ?? error ?? 'unknown error'),
        });
      },
    );
  }
}

const chatStateMaintenanceScheduler = new ChatStateMaintenanceScheduler({
  normalizeDroneId: normalizeDroneIdentity,
  normalizeChatName,
  run: runChatReadMaintenance,
  logError: ({ droneId, chatName, error }) => {
    hubLog('warn', 'failed scheduled chat state read maintenance', {
      droneId,
      chatName,
      error: String((error as any)?.message ?? error ?? 'unknown error'),
    });
  },
});

function scheduleChatStateReadMaintenance(
  opts: Parameters<typeof runChatReadMaintenance>[0],
): void {
  chatStateMaintenanceScheduler.schedule(opts);
}

async function buildPendingRowsForChat(opts: {
  droneId: string;
  chatName: string;
}): Promise<PendingPrompt[]> {
  return appendPromptAutomationHistoryRows(
    (await readPendingPrompts({ droneId: opts.droneId, chatName: opts.chatName })).slice(-50),
    getPromptAutomationLane(opts.droneId, opts.chatName),
  );
}

function formatTranscriptRow(turnIndex: number, turn: any): any {
  const at = String(turn?.at ?? new Date().toISOString());
  const promptAt =
    typeof turn?.promptAt === 'string' && turn.promptAt.trim()
      ? String(turn.promptAt).trim()
      : undefined;
  const completedAt =
    typeof turn?.completedAt === 'string' && turn.completedAt.trim()
      ? String(turn.completedAt).trim()
      : undefined;
  const id = typeof turn?.id === 'string' && turn.id.trim() ? String(turn.id).trim() : undefined;
  const prompt = String(turn?.prompt ?? '');
  const model = normalizeChatModel((turn as any)?.model);
  const reasoning = normalizeChatReasoning((turn as any)?.reasoning);
  const attachments = normalizeChatImageAttachmentRefs((turn as any)?.attachments);
  const automation = normalizePromptAutomationMeta((turn as any)?.automation);
  const agentMessageAutoContinue = normalizeAgentMessageAutoContinueTurnState(
    (turn as any)?.agentMessageAutoContinue,
  );
  const agentSuggestion = normalizeAgentSuggestionTurnState((turn as any)?.agentSuggestion);
  const dockerSnapshot = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
  const agentPlanRaw = (turn as any)?.agentPlan;
  const agentPlanSource = String(agentPlanRaw?.source ?? '').trim();
  const agentPlan =
    agentPlanSource === 'cursor' ||
    agentPlanSource === 'codex' ||
    agentPlanSource === 'claude' ||
    agentPlanSource === 'opencode'
      ? normalizeAgentPlan(agentPlanRaw, agentPlanSource, String(agentPlanRaw?.updatedAt ?? ''))
      : undefined;
  const ok = Boolean(turn?.ok);
  const output = ok ? String(turn?.output ?? '') : '';
  const error = ok ? undefined : String(turn?.error ?? 'failed');
  return {
    turn: turnIndex + 1,
    at,
    ...(promptAt ? { promptAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(id ? { id } : {}),
    prompt,
    ...(model ? { model } : {}),
    ...(reasoning ? { reasoning } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(automation ? { automation } : {}),
    ...(agentMessageAutoContinue ? { agentMessageAutoContinue } : {}),
    ...(agentSuggestion ? { agentSuggestion } : {}),
    ...(agentPlan ? { agentPlan } : {}),
    ...(dockerSnapshot
      ? {
          dockerSnapshot: {
            id: dockerSnapshot.id,
            status: dockerSnapshot.status,
            createdAt: dockerSnapshot.createdAt,
            ...(dockerSnapshot.readyAt ? { readyAt: dockerSnapshot.readyAt } : {}),
            ...(dockerSnapshot.restoredAt ? { restoredAt: dockerSnapshot.restoredAt } : {}),
            ...(dockerSnapshot.error ? { error: dockerSnapshot.error } : {}),
            ...(typeof dockerSnapshot.sizeBytes === 'number'
              ? { sizeBytes: dockerSnapshot.sizeBytes }
              : {}),
          },
        }
      : {}),
    ...((turn as any)?.inheritedFromClone === true ? { inheritedFromClone: true } : {}),
    ok,
    ...(ok ? { output } : { output: '', error }),
  };
}

async function buildTranscriptRowsForChat(opts: {
  droneId: string;
  droneName: string;
  chatName: string;
  chatEntry: any;
  droneEntry: any;
  selection: string;
  tailRaw?: string | null;
}): Promise<BuiltChatTranscriptRows> {
  const agent = inferChatAgent(opts.chatEntry as any, opts.droneEntry);
  if (agent.kind === 'custom') {
    return {
      ok: false,
      statusCode: 410,
      error:
        'transcript is only available for builtin agents (cursor/codex/claude/opencode/pi/blip). Use /output for custom agents.',
      agent,
    };
  }

  const turns = (opts.chatEntry as any).turns as TranscriptTurn[] | undefined;
  const rawList = Array.isArray(turns) ? turns : [];
  const sourceHash = transcriptTurnsSourceHash(rawList);
  const imported = await importTranscriptTurnsFromRegistry({
    droneId: opts.droneId,
    chatName: opts.chatName,
    turns: rawList,
    sourceHash,
  });
  // Sort by prompt time (promptAt/at) so "last" means most recent chronologically,
  // even if reconciliation appends older completions later.
  const list = rawList
    .map((t, idx) => ({ t, idx }))
    .sort((a, b) => {
      const aIso = String((a.t as any)?.promptAt ?? (a.t as any)?.at ?? '');
      const bIso = String((b.t as any)?.promptAt ?? (b.t as any)?.at ?? '');
      const aMs = new Date(aIso).getTime();
      const bMs = new Date(bIso).getTime();
      const aa = Number.isFinite(aMs) ? aMs : 0;
      const bb = Number.isFinite(bMs) ? bMs : 0;
      if (aa !== bb) return aa - bb;
      return a.idx - b.idx;
    })
    .map((x) => x.t);
  const storeCount = imported.available
    ? countTranscriptTurnsFromStore({ droneId: opts.droneId, chatName: opts.chatName })
    : {
        available: false as const,
        count: list.length,
        transcriptVersion: imported.transcriptVersion,
        sourceHash,
      };
  const effectiveTurnCount = storeCount.available ? storeCount.count : list.length;
  const effectiveSourceHash = storeCount.available
    ? storeCount.sourceHash
    : imported.sourceHash || sourceHash;
  const effectiveTranscriptVersion = storeCount.available
    ? storeCount.transcriptVersion
    : imported.transcriptVersion;
  const idxs = parseTurnSelection(opts.selection, effectiveTurnCount, opts.tailRaw);
  const etagSeed = stableResponseFingerprint({
    droneId: opts.droneId,
    droneName: opts.droneName,
    chatName: opts.chatName,
    selection: opts.selection,
    tail: opts.tailRaw ?? '',
    sourceHash: effectiveSourceHash,
    transcriptVersion: effectiveTranscriptVersion,
    agent,
  });
  const etag = `"transcript-${etagSeed}"`;

  const storeRead = imported.available
    ? readTranscriptTurnsFromStore({
        droneId: opts.droneId,
        chatName: opts.chatName,
        indexes: idxs,
      })
    : { available: false as const, turns: [] };
  const selectedTurns = storeRead.available
    ? storeRead.turns.map((item) => ({ i: item.index, t: item.turn as any }))
    : idxs.map((i) => ({ i, t: list[i] as any }));

  const transcripts: any[] = [];
  for (const item of selectedTurns) {
    transcripts.push(formatTranscriptRow(item.i, item.t));
  }

  return {
    ok: true,
    selection: opts.selection,
    transcripts,
    agent,
    turnCount: effectiveTurnCount,
    etag,
  };
}

async function readChatSnapshot(opts: {
  droneRef: string;
  chatName: string;
  selection: string;
  tailRaw?: string | null;
  includeTranscript: boolean;
  includePending: boolean;
  maintenance?: ChatSnapshotMaintenance;
  includeDockerSnapshotMaintenance?: boolean;
  ifNoneMatch?: string;
  mark?: (name: string) => void;
}): Promise<ChatSnapshotRead> {
  if (!(globalThis as any).Bun) return await readCanonicalChatSnapshot(opts);

  const resolved = await resolveDroneOrPendingForReadRef(opts.droneRef);
  if (!resolved) {
    return { ok: false, statusCode: 404, error: `unknown drone: ${opts.droneRef}` };
  }

  const context = await buildChatStateContext({
    droneRef: opts.droneRef,
    chatName: opts.chatName,
    resolved,
  });
  if (context.kind === 'pending') {
    return {
      ok: true,
      id: context.droneId,
      name: context.droneName,
      chat: opts.chatName,
      selection: opts.selection,
      transcripts: [],
      pending: opts.includePending
        ? await readPendingStartupPrompts({ droneId: context.droneId, chatName: opts.chatName })
        : [],
      model: normalizeChatModel((context.pendingEntry as any)?.model),
      turnCount: 0,
      transcriptEtag: null,
    };
  }
  if (context.kind === 'missing-chat') {
    return { ok: false, statusCode: 404, error: `unknown chat: ${opts.chatName}` };
  }

  const droneId = context.droneId;
  const entry = context.projectedChatEntry;
  const transcriptResult = opts.includeTranscript
    ? await buildTranscriptRowsForChat({
        droneId,
        droneName: context.droneName,
        chatName: opts.chatName,
        chatEntry: entry,
        droneEntry: context.droneEntry,
        selection: opts.selection,
        tailRaw: opts.tailRaw,
      })
    : null;
  if (transcriptResult && !transcriptResult.ok) return transcriptResult;

  if (opts.maintenance === 'run') {
    runChatReadMaintenance({
      droneId,
      chatName: opts.chatName,
      chatEntry: entry,
      includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
    });
  } else if (opts.maintenance === 'schedule') {
    scheduleChatStateReadMaintenance({
      droneId,
      chatName: opts.chatName,
      chatEntry: entry,
      includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
    });
  }

  const agent = transcriptResult?.agent ?? inferChatAgent(entry as any, context.droneEntry);
  const pending = opts.includePending
    ? await buildPendingRowsForChat({ droneId, chatName: opts.chatName })
    : [];
  return {
    ok: true,
    id: droneId,
    name: context.droneName,
    chat: opts.chatName,
    selection: transcriptResult?.selection ?? opts.selection,
    transcripts: transcriptResult?.transcripts ?? [],
    pending,
    agent,
    model: normalizeChatModel((entry as any)?.model),
    turnCount: transcriptResult?.turnCount ?? 0,
    transcriptEtag: transcriptResult?.etag ?? null,
  };
}

async function readCanonicalChatSnapshot(opts: {
  droneRef: string;
  chatName: string;
  selection: string;
  tailRaw?: string | null;
  includeTranscript: boolean;
  includePending: boolean;
  maintenance?: ChatSnapshotMaintenance;
  includeDockerSnapshotMaintenance?: boolean;
  ifNoneMatch?: string;
  mark?: (name: string) => void;
}): Promise<ChatSnapshotRead> {
  const resolved = await resolveCanonicalDroneOrPendingForReadRef(opts.droneRef);
  opts.mark?.('lifecycle');
  if (!resolved) return { ok: false, statusCode: 404, error: `unknown drone: ${opts.droneRef}` };
  const droneName =
    String(
      (resolved.kind === 'real' ? resolved.drone : resolved.pending)?.name ?? opts.droneRef,
    ).trim() || opts.droneRef;
  if (resolved.kind === 'pending') {
    const pending = opts.includePending
      ? normalizePendingStartupPrompts(
          (resolved.pending as any)?.startupQueuedPrompts,
          opts.chatName,
        ).map(startupPromptToPendingPrompt)
      : [];
    return {
      ok: true,
      id: resolved.id,
      name: droneName,
      chat: opts.chatName,
      selection: opts.selection,
      transcripts: [],
      pending,
      model: normalizeChatModel((resolved.pending as any)?.model),
      turnCount: 0,
      transcriptEtag: null,
    };
  }

  const version = readChatVersionFromStore({
    droneId: resolved.id,
    chatName: opts.chatName,
    includePending: opts.includePending,
  });
  opts.mark?.('version');
  if (!version.chat) return { ok: false, statusCode: 404, error: `unknown chat: ${opts.chatName}` };
  const agent = inferChatAgent(version.chat, resolved.drone);
  if (opts.includeTranscript && agent.kind === 'custom') {
    return {
      ok: false,
      statusCode: 410,
      error:
        'transcript is only available for builtin agents (cursor/codex/claude/opencode/pi/blip). Use /output for custom agents.',
      agent,
    };
  }
  const indexes = opts.includeTranscript
    ? parseTurnSelection(opts.selection, version.turnCount, opts.tailRaw)
    : [];
  const automationLane = opts.includePending
    ? getPromptAutomationLane(resolved.id, opts.chatName)
    : null;
  const responseEtag = `"sha256-${stableResponseFingerprint({
    droneId: resolved.id,
    droneName,
    chatName: opts.chatName,
    selection: opts.selection,
    tail: opts.tailRaw ?? '',
    includeTranscript: opts.includeTranscript,
    includePending: opts.includePending,
    chatSourceHash: version.chatSourceHash,
    transcriptVersion: version.transcriptVersion,
    transcriptSourceHash: version.transcriptSourceHash,
    pendingVersion: version.pendingVersion,
    automationLane,
  })}"`;
  const requestedEtags = String(opts.ifNoneMatch ?? '')
    .split(',')
    .map((item) => item.trim());
  if (requestedEtags.includes(responseEtag) || requestedEtags.includes('*')) {
    opts.mark?.('conditional');
    return {
      ok: true,
      id: resolved.id,
      name: droneName,
      chat: opts.chatName,
      selection: opts.selection,
      transcripts: [],
      pending: [],
      agent,
      model: normalizeChatModel((version.chat as any)?.model),
      turnCount: version.turnCount,
      transcriptEtag: responseEtag,
      responseEtag,
      notModified: true,
    };
  }

  const rows = readChatRowsFromStore({
    droneId: resolved.id,
    chatName: opts.chatName,
    indexes,
    includePending: opts.includePending,
  });
  opts.mark?.('rows');
  const transcripts = rows.turns.map((item) => formatTranscriptRow(item.index, item.turn));
  const pending = opts.includePending
    ? appendPromptAutomationHistoryRows(
        pruneCompletedPendingPrompts(rows.pending as PendingPrompt[], rows.pendingTurns, {
          keepRecentlyCompleted: true,
        }),
        automationLane,
      )
    : [];
  opts.mark?.('format');
  const maintenanceEntry = { ...version.chat, pendingPrompts: pending };
  if (opts.maintenance === 'run') {
    runChatReadMaintenance({
      droneId: resolved.id,
      chatName: opts.chatName,
      chatEntry: maintenanceEntry,
      includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
    });
  } else if (opts.maintenance === 'schedule') {
    scheduleChatStateReadMaintenance({
      droneId: resolved.id,
      chatName: opts.chatName,
      chatEntry: maintenanceEntry,
      includeDockerSnapshotMaintenance: opts.includeDockerSnapshotMaintenance,
    });
  }
  return {
    ok: true,
    id: resolved.id,
    name: droneName,
    chat: opts.chatName,
    selection: opts.selection,
    transcripts,
    pending,
    agent,
    model: normalizeChatModel((version.chat as any)?.model),
    turnCount: version.turnCount,
    transcriptEtag: responseEtag,
    responseEtag,
  };
}

function chatSnapshotResponseBody(
  snapshot: Extract<ChatSnapshotRead, { ok: true }>,
  opts?: { includeTranscriptMeta?: boolean },
) {
  return {
    ok: true,
    id: snapshot.id,
    name: snapshot.name,
    chat: snapshot.chat,
    selection: snapshot.selection,
    transcripts: snapshot.transcripts,
    pending: snapshot.pending,
    ...(snapshot.agent ? { agent: snapshot.agent } : {}),
    model: snapshot.model,
    ...(opts?.includeTranscriptMeta
      ? {
          transcript: {
            selection: snapshot.selection,
            total: snapshot.turnCount,
            etag: snapshot.transcriptEtag,
            items: snapshot.transcripts,
          },
          pendingPrompts: {
            items: snapshot.pending,
          },
        }
      : {}),
  };
}

async function setChatAgentConfig(opts: {
  droneId: string;
  chatName: string;
  agent?: ChatAgentConfig;
  setModel?: boolean;
  model?: string | null;
  setReasoning?: boolean;
  reasoning?: string | null;
  setAgentPermissionMode?: boolean;
  agentPermissionMode?: AgentPermissionMode;
  setAgentMessageAutoContinueEnabled?: boolean;
  agentMessageAutoContinueEnabled?: boolean;
  setAgentSuggestionEnabled?: boolean;
  agentSuggestionEnabled?: boolean;
  setDockerSnapshotAfterAgentMessageEnabled?: boolean;
  dockerSnapshotAfterAgentMessageEnabled?: boolean;
  setBlipClonesEnabled?: boolean;
  blipClonesEnabled?: boolean;
}) {
  const registry: any = await loadRegistry();
  const droneId = normalizeDroneIdentity(opts.droneId);
  const d = droneId ? registry?.drones?.[droneId] : null;
  if (!d) throw new Error(`unknown drone: ${opts.droneId}`);
  await importDroneChatsFromRegistry({ droneId, chats: d.chats });
  await updateChatInStore({
    droneId,
    chatName: opts.chatName,
    update: (current) => {
      const cur = { ...current };
      const effectiveAgent = opts.agent ?? inferChatAgent(cur, d);
      if (
        opts.setAgentMessageAutoContinueEnabled &&
        opts.agentMessageAutoContinueEnabled &&
        effectiveAgent.kind !== 'builtin'
      ) {
        const error: Error & { statusCode?: number } = new Error(
          'agentMessageAutoContinueEnabled is only supported for builtin transcript chats',
        );
        error.statusCode = 400;
        throw error;
      }
      if (
        opts.setAgentSuggestionEnabled &&
        opts.agentSuggestionEnabled &&
        effectiveAgent.kind !== 'builtin'
      ) {
        const error: Error & { statusCode?: number } = new Error(
          'agentSuggestionEnabled is only supported for builtin transcript chats',
        );
        error.statusCode = 400;
        throw error;
      }
      if (
        opts.setDockerSnapshotAfterAgentMessageEnabled &&
        opts.dockerSnapshotAfterAgentMessageEnabled
      ) {
        if (droneRuntime(d) === 'host') {
          const error: Error & { statusCode?: number } = new Error(
            'Docker snapshots are only supported for container drones',
          );
          error.statusCode = 400;
          throw error;
        }
        if (d?.persistVolume !== false) {
          const error: Error & { statusCode?: number } = new Error(
            'Docker snapshots require this drone to be created with Persist volume off',
          );
          error.statusCode = 400;
          throw error;
        }
        if (effectiveAgent.kind !== 'builtin') {
          const error: Error & { statusCode?: number } = new Error(
            'Docker snapshots are only supported for builtin transcript chats',
          );
          error.statusCode = 400;
          throw error;
        }
      }
      if (opts.agent) {
        assertChatAgentSupportedForDrone(d, opts.agent);
        cur.agent = opts.agent as any;
        if (normalizeAgentPermissionMode(cur.agentPermissionMode) === 'read-only') {
          try {
            assertReadOnlySupportedForAgent(opts.agent);
          } catch {
            delete cur.agentPermissionMode;
          }
        }
      }
      if (opts.setModel) {
        if (opts.model) cur.model = opts.model;
        else delete cur.model;
      }
      if (opts.setReasoning) {
        const reasoning = normalizeChatReasoning(opts.reasoning);
        if (reasoning) {
          if (
            effectiveAgent.kind !== 'builtin' ||
            (effectiveAgent.id !== 'codex' && effectiveAgent.id !== 'blip')
          ) {
            const error: Error & { statusCode?: number } = new Error(
              'reasoning is only supported for Codex and Blip chats',
            );
            error.statusCode = 400;
            throw error;
          }
          cur.reasoning = reasoning;
        } else {
          delete cur.reasoning;
        }
      }
      if (opts.setAgentPermissionMode) {
        const mode = normalizeAgentPermissionMode(opts.agentPermissionMode);
        if (mode === 'read-only') assertReadOnlySupportedForAgent(effectiveAgent);
        if (mode === 'read-only') cur.agentPermissionMode = 'read-only';
        else delete cur.agentPermissionMode;
      }
      if (opts.setAgentMessageAutoContinueEnabled) {
        if (opts.agentMessageAutoContinueEnabled) {
          cur.agentMessageAutoContinueEnabled = true;
          if (
            typeof cur.agentMessageAutoContinueEnabledAt !== 'string' ||
            !String(cur.agentMessageAutoContinueEnabledAt).trim()
          ) {
            cur.agentMessageAutoContinueEnabledAt = nowIso();
          }
        } else {
          delete cur.agentMessageAutoContinueEnabled;
          delete cur.agentMessageAutoContinueEnabledAt;
        }
      }
      if (opts.setAgentSuggestionEnabled) {
        if (opts.agentSuggestionEnabled) {
          cur.agentSuggestionEnabled = true;
          if (
            typeof cur.agentSuggestionEnabledAt !== 'string' ||
            !String(cur.agentSuggestionEnabledAt).trim()
          ) {
            cur.agentSuggestionEnabledAt = nowIso();
          }
        } else {
          delete cur.agentSuggestionEnabled;
          delete cur.agentSuggestionEnabledAt;
        }
      }
      if (opts.setDockerSnapshotAfterAgentMessageEnabled) {
        if (opts.dockerSnapshotAfterAgentMessageEnabled) {
          cur.dockerSnapshotAfterAgentMessageEnabled = true;
          if (
            typeof cur.dockerSnapshotAfterAgentMessageEnabledAt !== 'string' ||
            !String(cur.dockerSnapshotAfterAgentMessageEnabledAt).trim()
          ) {
            cur.dockerSnapshotAfterAgentMessageEnabledAt = nowIso();
          }
        } else {
          cur.dockerSnapshotAfterAgentMessageEnabled = false;
          delete cur.dockerSnapshotAfterAgentMessageEnabledAt;
        }
      }
      if (opts.setBlipClonesEnabled) {
        cur.blipClonesEnabled = opts.blipClonesEnabled !== false;
      }
      return cur;
    },
  });
  await projectCanonicalChatToRegistry(droneId, opts.chatName);
}

async function resolveChatTmuxCommand(opts: {
  droneId: string;
  chatName: string;
}): Promise<string> {
  const { d, chat } = await getChatEntry(opts);
  const agent = inferChatAgent(chat, d);
  if (agent.kind === 'builtin') return resolveBuiltinTmuxCommand(agent.id);
  return agent.command || resolveHubAgentCommand();
}

async function ensureHubChatSessionRunning(opts: {
  containerName: string;
  chatName: string;
  command: string;
  cwd?: string | null;
  envVars?: Record<string, string> | null;
}) {
  const sessionName = hubChatSessionName(opts.chatName || 'default');
  const agentCmd = String(opts.command || '').trim() || resolveHubAgentCommand();
  return await ensureHubSessionRunning({
    containerName: opts.containerName,
    sessionName,
    command: agentCmd,
    cwd: String(opts.cwd ?? '').trim() || '/dvm-data',
    envVars: opts.envVars ?? null,
  });
}

async function copyChatAttachmentsToHost(opts: {
  hostDir: string;
  attachments: ChatImageAttachment[];
}): Promise<void> {
  const list = Array.isArray(opts.attachments) ? opts.attachments : [];
  if (list.length === 0) return;
  const dir = path.resolve(String(opts.hostDir ?? '').trim() || os.homedir());
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  for (const a of list) {
    const filePath = path.join(
      dir,
      path.basename(String(a.fileName ?? '').trim() || 'attachment.bin'),
    );
    const buf = Buffer.from(String(a.dataBase64 ?? ''), 'base64');
    if (!buf || buf.length === 0) throw new Error('attachment decode failed');
    await fs.writeFile(filePath, buf, { mode: 0o600 });
  }
}

function parseTurnSelection(selRaw: string, turnsLen: number, tailRaw?: string | null): number[] {
  const tailText = String(tailRaw ?? '').trim();
  if (tailText) {
    const tail = Number(tailText);
    if (!Number.isFinite(tail) || tail < 1 || Math.floor(tail) !== tail) {
      throw new Error('invalid tail (expected positive integer)');
    }
    const start = Math.max(0, turnsLen - tail);
    return Array.from({ length: turnsLen - start }, (_, i) => start + i);
  }
  const sel = String(selRaw || 'last')
    .trim()
    .toLowerCase();
  if (sel === 'all') return Array.from({ length: turnsLen }, (_, i) => i);
  if (sel === 'last') return turnsLen > 0 ? [turnsLen - 1] : [];
  const n = Number(sel);
  if (!Number.isFinite(n) || n < 1 || Math.floor(n) !== n)
    throw new Error('invalid turn (expected 1-based integer, last, or all)');
  if (n > turnsLen) throw new Error(`turn out of range (max ${turnsLen})`);
  return [n - 1];
}

function parseUuid(text: string): string | null {
  const m = String(text).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : null;
}

function openCodeSessionTitle(droneName: string, chatName: string): string {
  const d = sanitizeTmuxSessionName(droneName || 'drone');
  const c = sanitizeTmuxSessionName(chatName || 'default');
  return `drone-hub-${d}-${c}`;
}

async function ensureCursorChatId(opts: {
  droneId: string;
  containerName: string;
  chatName: string;
  runtime: DroneRuntime;
  cwd?: string | null;
  promptId?: string | null;
}): Promise<string> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing =
    typeof (chat as any).chatId === 'string' ? String((chat as any).chatId).trim() : '';
  if (existing) return existing;
  let id = '';
  try {
    const r =
      opts.runtime === 'host'
        ? await runHostCommand('bash', ['-lc', 'agent create-chat'], {
            cwd: String(opts.cwd ?? '').trim() || undefined,
            timeoutMs: defaultSeedBootstrapTimeoutMs(),
          })
        : await dvmExec(
            opts.containerName,
            'bash',
            [
              '-lc',
              [
                ...buildContainerManagedEnvLines({ runtime: 'container', cwd: opts.cwd ?? null }),
                'agent create-chat',
              ].join('\n'),
            ],
            {
              timeoutMs: defaultSeedBootstrapTimeoutMs(),
            },
          );
    if (r.code !== 0) throw new Error((r.stderr || r.stdout || 'agent create-chat failed').trim());
    id = parseUuid(`${r.stdout}\n${r.stderr}`) ?? '';
    if (!id)
      throw new Error(
        `failed to parse chatId from agent create-chat output: ${r.stdout || r.stderr || '(empty)'}`,
      );
  } catch (error: any) {
    const promptId = String(opts.promptId ?? '').trim();
    if (!promptId.startsWith('agent-copilot-')) throw error;
    id = crypto.randomUUID();
    hubLog('warn', 'cursor chat id creation failed; using generated chat id', {
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId,
      runtime: opts.runtime,
      error: String(error?.message ?? error ?? 'unknown error'),
    });
  }
  const patched = await patchChatMetadataInStore({
    droneId: normalizeDroneIdentity(opts.droneId),
    chatName: opts.chatName,
    patch: { setIfMissing: { chatId: id } },
  });
  await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
  return String(patched.metadata?.chatId ?? id).trim() || id;
}

async function ensureClaudeSessionId(opts: { droneId: string; chatName: string }): Promise<string> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing =
    typeof (chat as any).claudeSessionId === 'string'
      ? String((chat as any).claudeSessionId).trim()
      : '';
  if (existing) return existing;
  const id = crypto.randomUUID();
  const patched = await patchChatMetadataInStore({
    droneId: normalizeDroneIdentity(opts.droneId),
    chatName: opts.chatName,
    patch: { setIfMissing: { claudeSessionId: id } },
  });
  await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
  return String(patched.metadata?.claudeSessionId ?? id).trim() || id;
}

function parseOpenCodeSessionList(stdout: string, preferredTitle?: string | null): string | null {
  let parsed: any = null;
  try {
    parsed = JSON.parse(String(stdout ?? ''));
  } catch {
    return null;
  }
  const pick = (v: any): { id: string | null; title: string | null } => {
    const id = String(v?.id ?? v?.sessionId ?? v?.sessionID ?? v?.session_id ?? '').trim();
    const title = String(v?.title ?? v?.name ?? '').trim();
    return { id: id || null, title: title || null };
  };
  const preferred = String(preferredTitle ?? '')
    .trim()
    .toLowerCase();
  const all: Array<{ id: string | null; title: string | null }> = [];
  if (Array.isArray(parsed)) {
    for (const item of parsed) {
      all.push(pick(item));
    }
  } else if (Array.isArray(parsed?.sessions)) {
    for (const item of parsed.sessions) {
      all.push(pick(item));
    }
  } else if (Array.isArray(parsed?.items)) {
    for (const item of parsed.items) {
      all.push(pick(item));
    }
  } else {
    all.push(pick(parsed));
  }

  if (preferred) {
    for (const item of all) {
      if (!item.id) continue;
      if (
        String(item.title ?? '')
          .trim()
          .toLowerCase() === preferred
      ) {
        return item.id;
      }
    }
  }

  for (const item of all) {
    if (item.id) return item.id;
  }
  return null;
}

function parseOpenCodeSessionIdFromListOutputs(opts: {
  stdout: string;
  stderr: string;
  preferredTitle?: string | null;
}): string | null {
  const { stdout, stderr, preferredTitle } = opts;
  const candidates = [
    parseOpenCodeSessionList(String(stdout ?? '').trim(), preferredTitle),
    parseOpenCodeSessionList(String(stderr ?? '').trim(), preferredTitle),
  ];
  for (const id of candidates) {
    if (id) return id;
  }
  if (preferredTitle) {
    for (const id of [
      parseOpenCodeSessionList(String(stdout ?? '').trim()),
      parseOpenCodeSessionList(String(stderr ?? '').trim()),
    ]) {
      if (id) return id;
    }
  }
  return null;
}

async function ensureOpenCodeSessionId(opts: {
  droneId: string;
  droneLabel?: string | null;
  containerName: string;
  chatName: string;
}): Promise<string | null> {
  const { chat } = await getChatEntry({ droneId: opts.droneId, chatName: opts.chatName });
  const existing =
    typeof (chat as any).openCodeSessionId === 'string'
      ? String((chat as any).openCodeSessionId).trim()
      : '';
  if (existing) return existing;

  const preferredTitle = openCodeSessionTitle(
    String(opts.droneLabel ?? opts.droneId),
    opts.chatName,
  );
  const listCmd = 'opencode session list --max-count 30 --format json';
  const r = await dvmExec(opts.containerName, 'bash', ['-lc', listCmd], {
    timeoutMs: defaultSeedBootstrapTimeoutMs(),
  });
  if (r.code !== 0) return null;
  const id = parseOpenCodeSessionIdFromListOutputs({
    stdout: String(r.stdout ?? ''),
    stderr: String(r.stderr ?? ''),
    preferredTitle,
  });
  if (!id) return null;

  const patched = await patchChatMetadataInStore({
    droneId: normalizeDroneIdentity(opts.droneId),
    chatName: opts.chatName,
    patch: { setIfMissing: { openCodeSessionId: id } },
  });
  await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
  return String(patched.metadata?.openCodeSessionId ?? id).trim() || id;
}

async function recordTranscriptTurn(opts: {
  droneName: string;
  chatName: string;
  turn: { at: string; id?: string; prompt: string; ok: boolean; output: string; error?: string };
  agentPatch?: Partial<{
    codexThreadId: string;
    claudeSessionId: string;
    openCodeSessionId: string;
    piSessionId: string;
    blipSessionId: string;
  }>;
}): Promise<void> {
  const reg = await loadRegistry();
  const d = (reg as any)?.drones?.[opts.droneName];
  if (!d) throw new Error(`unknown drone: ${opts.droneName}`);
  const droneId = String(d?.id ?? opts.droneName).trim() || opts.droneName;
  await applyChatReconciliationInStore({
    droneId,
    chatName: opts.chatName,
    metadataPatch: opts.agentPatch ? { set: opts.agentPatch } : undefined,
    turns: [opts.turn],
  });
  await projectCanonicalChatToRegistry(droneId, opts.chatName);
}

async function updateTranscriptTurnById(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  update: (turn: TranscriptTurn) => TranscriptTurn;
}): Promise<boolean> {
  const result = await updateTranscriptTurnInStore({
    droneId: normalizeDroneIdentity(opts.droneId),
    chatName: normalizeChatName(opts.chatName),
    turnId: opts.promptId,
    update: (turn) => opts.update(turn as TranscriptTurn),
  });
  if (result.changed) await projectCanonicalChatToRegistry(opts.droneId, opts.chatName);
  return result.changed;
}

async function beginDockerSnapshotForTranscriptTurn(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): Promise<{ snapshotId: string; imageRef: string; containerName: string } | null> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const promptId = String(opts.promptId ?? '').trim();
  if (!droneId || !chatName || !promptId) return null;
  const reg = await loadRegistry();
  const d = (reg as any)?.drones?.[droneId];
  const stored = readChatFromStore({ droneId, chatName });
  const chat = stored.available ? stored.chat : null;
  if (
    !d ||
    !chat ||
    droneRuntime(d) === 'host' ||
    !dockerSnapshotAfterAgentMessageEnabledForChat(d, chat)
  )
    return null;
  const snapshotId = crypto.randomBytes(8).toString('hex');
  const imageRef = dockerSnapshotImageRef({ droneId, chatName, promptId });
  const containerName =
    String(d?.containerName ?? d?.name ?? `drone-${droneId}`).trim() || `drone-${droneId}`;
  const updated = await updateTranscriptTurnInStore({
    droneId,
    chatName,
    turnId: promptId,
    update: (turn) => {
      const existing = normalizeDockerSnapshot((turn as any)?.dockerSnapshot);
      if (!turn.ok || (existing && existing.status !== 'failed')) return turn;
      return {
        ...turn,
        dockerSnapshot: { id: snapshotId, status: 'creating', imageRef, createdAt: nowIso() },
      };
    },
  });
  if (updated.changed) await projectCanonicalChatToRegistry(droneId, chatName);
  return updated.changed ? { snapshotId, imageRef, containerName } : null;
}

async function finishDockerSnapshotForTranscriptTurn(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  snapshotId: string;
  imageRef: string;
  containerName: string;
}): Promise<void> {
  try {
    await cleanupContainerBeforeDockerSnapshot(opts.containerName);
    const stdout = await runDockerOrThrow(['commit', opts.containerName, opts.imageRef], {
      timeoutMs: 10 * 60_000,
    });
    const imageId = String(stdout ?? '').trim();
    const sizeBytes = await dockerImageSizeBytes(opts.imageRef);
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn) => {
        const current = normalizeDockerSnapshot((turn as any).dockerSnapshot);
        if (!current || current.id !== opts.snapshotId) return turn;
        return {
          ...turn,
          dockerSnapshot: {
            ...current,
            status: 'ready',
            imageRef: opts.imageRef,
            ...(imageId ? { imageId } : {}),
            ...(typeof sizeBytes === 'number' ? { sizeBytes } : {}),
            readyAt: nowIso(),
          },
        };
      },
    });
  } catch (e: any) {
    const error = String(e?.message ?? e ?? 'snapshot failed');
    await updateTranscriptTurnById({
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      update: (turn) => {
        const current = normalizeDockerSnapshot((turn as any).dockerSnapshot);
        if (!current || current.id !== opts.snapshotId) return turn;
        return {
          ...turn,
          dockerSnapshot: {
            ...current,
            status: 'failed',
            error,
          },
        };
      },
    });
    hubLog('warn', 'docker snapshot failed', {
      droneId: opts.droneId,
      chatName: opts.chatName,
      promptId: opts.promptId,
      imageRef: opts.imageRef,
      error,
    });
  }
}

async function cleanupContainerBeforeDockerSnapshot(containerName: string): Promise<void> {
  const name = String(containerName ?? '').trim();
  if (!name) return;
  const script = [
    'rm -f /tmp/dvm-repo.bundle',
    'rm -rf /tmp/yarn--* /tmp/node-compile-cache /tmp/v8-compile-cache-*',
    'rm -rf /root/.npm/_cacache /root/.cache/node /root/.cache/cursor-compile-cache',
    'rm -rf /usr/local/share/.cache/yarn',
  ].join('\n');
  const result = await runDocker(['exec', name, 'sh', '-lc', script], { timeoutMs: 60_000 });
  if (result.code !== 0) {
    hubLog('warn', 'docker snapshot pre-cleanup failed', {
      containerName: name,
      error: (
        result.stderr ||
        result.stdout ||
        `docker exec cleanup failed with code ${result.code}`
      ).trim(),
    });
  }
}

async function maybeStartDockerSnapshotForTranscriptTurn(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
}): Promise<void> {
  const started = await beginDockerSnapshotForTranscriptTurn(opts);
  if (!started) return;
  void finishDockerSnapshotForTranscriptTurn({
    ...opts,
    snapshotId: started.snapshotId,
    imageRef: started.imageRef,
    containerName: started.containerName,
  });
}

function dockerPortBindingArgs(inspect: any): string[] {
  const bindings = inspect?.HostConfig?.PortBindings ?? {};
  const args: string[] = [];
  for (const [containerPort, rawList] of Object.entries(bindings)) {
    const list = Array.isArray(rawList) ? rawList : [];
    for (const binding of list) {
      const hostPort = String((binding as any)?.HostPort ?? '').trim();
      if (!hostPort) continue;
      const hostIp = String((binding as any)?.HostIp ?? '').trim();
      args.push(
        '-p',
        hostIp && hostIp !== '0.0.0.0'
          ? `${hostIp}:${hostPort}:${containerPort}`
          : `${hostPort}:${containerPort}`,
      );
    }
  }
  return args;
}

function dockerBindMountArgs(inspect: any): string[] {
  const mounts = Array.isArray(inspect?.Mounts) ? inspect.Mounts : [];
  const args: string[] = [];
  for (const mount of mounts) {
    if (String(mount?.Type ?? '').trim() !== 'bind') continue;
    const source = String(mount?.Source ?? '').trim();
    const target = String(mount?.Destination ?? '').trim();
    if (!source || !target || target === '/dvm-data') continue;
    const readonly = mount?.RW === false;
    args.push('--mount', `type=bind,src=${source},dst=${target}${readonly ? ',readonly' : ''}`);
  }
  return args;
}

function dockerNetworkArgs(inspect: any): string[] {
  const networks =
    inspect?.NetworkSettings?.Networks && typeof inspect.NetworkSettings.Networks === 'object'
      ? Object.keys(inspect.NetworkSettings.Networks)
      : [];
  const preferred = networks.find(
    (name) => name && name !== 'bridge' && name !== 'host' && name !== 'none',
  );
  return preferred ? ['--network', preferred] : [];
}

async function recreateDroneContainerFromSnapshot(opts: {
  droneId: string;
  droneEntry: any;
  imageRef: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  if (!droneId) throw new Error('missing drone id');
  if (droneRuntime(opts.droneEntry) === 'host')
    throw new Error('Docker snapshots are only supported for container drones');
  if (opts.droneEntry?.persistVolume !== false) {
    throw new Error('Docker snapshots require this drone to be created with Persist volume off');
  }
  const containerName =
    String(opts.droneEntry?.containerName ?? opts.droneEntry?.name ?? `drone-${droneId}`).trim() ||
    `drone-${droneId}`;
  const backupName = `${containerName}-rollback-backup-${crypto.randomBytes(5).toString('hex')}`;
  const inspect = await dockerInspectOne(containerName);
  if (!inspect) throw new Error(`container "${containerName}" does not exist`);

  await stopAllDroneChatActivity({
    droneId,
    droneEntry: opts.droneEntry,
    reason: 'restart',
    updateLiveRegistry: true,
  });

  let renamed = false;
  let createdReplacement = false;
  try {
    await runDocker(['stop', containerName], { timeoutMs: 60_000 });
    await runDockerOrThrow(['rename', containerName, backupName], { timeoutMs: 30_000 });
    renamed = true;

    const createArgs = [
      'create',
      '--name',
      containerName,
      ...dockerNetworkArgs(inspect),
      ...dockerPortBindingArgs(inspect),
      ...dockerBindMountArgs(inspect),
      opts.imageRef,
    ];
    await runDockerOrThrow(createArgs, { timeoutMs: 60_000 });
    createdReplacement = true;
    await runDockerOrThrow(['start', containerName], { timeoutMs: 60_000 });
    await ensureContainerDroneDaemonSession({
      containerName,
      containerPort: Number(opts.droneEntry?.containerPort ?? 7777),
    });
    const hostPort =
      typeof opts.droneEntry?.hostPort === 'number' && Number.isFinite(opts.droneEntry.hostPort)
        ? opts.droneEntry.hostPort
        : await resolveHostPort(containerName, opts.droneEntry?.containerPort);
    const token = typeof opts.droneEntry?.token === 'string' ? opts.droneEntry.token : '';
    if (hostPort && token) await droneStatus(makeClient(hostPort, token));
    await runDocker(['rm', '-f', backupName], { timeoutMs: 60_000 });
  } catch (e) {
    if (createdReplacement) {
      await runDocker(['rm', '-f', containerName], { timeoutMs: 60_000 });
    }
    if (renamed) {
      await runDocker(['rename', backupName, containerName], { timeoutMs: 30_000 });
      await runDocker(['start', containerName], { timeoutMs: 60_000 });
    } else {
      await runDocker(['start', containerName], { timeoutMs: 60_000 });
    }
    throw e;
  }
}

async function restoreDockerSnapshotForTranscriptTurn(opts: {
  droneId: string;
  chatName: string;
  promptId: string;
  snapshotId: string;
}): Promise<void> {
  const droneId = normalizeDroneIdentity(opts.droneId);
  const chatName = normalizeChatName(opts.chatName);
  const promptId = String(opts.promptId ?? '').trim();
  const snapshotId = String(opts.snapshotId ?? '').trim();
  if (!droneId || !chatName || !promptId || !snapshotId) throw new Error('missing snapshot target');

  let imageRef = '';
  let droneEntry: any = null;
  const reg = await loadRegistry();
  const d = (reg as any)?.drones?.[droneId];
  const stored = readChatFromStore({ droneId, chatName });
  const chat = stored.available ? stored.chat : null;
  const turns: TranscriptTurn[] = Array.isArray(chat?.turns) ? chat.turns : [];
  const turn = turns.find(
    (candidate: any) => String(candidate?.id ?? '').trim() === promptId,
  ) as any;
  const snap = normalizeDockerSnapshot(turn?.dockerSnapshot);
  if (
    chatHasActivePendingPromptsForSummary(chat) ||
    promptAutomationLaneBusy(getPromptAutomationLane(droneId, chatName), { includeQueued: true })
  ) {
    const error: Error & { statusCode?: number } = new Error(
      'chat is busy; wait for the current work to finish before rolling back',
    );
    error.statusCode = 409;
    throw error;
  }
  const hasOtherActiveSnapshot = turns.some((candidate: any) => {
    if (String(candidate?.id ?? '').trim() === promptId) return false;
    const status = String(candidate?.dockerSnapshot?.status ?? '').trim();
    return status === 'creating' || status === 'restoring';
  });
  if (hasOtherActiveSnapshot) {
    const error: Error & { statusCode?: number } = new Error(
      'another Docker snapshot is still in progress for this chat',
    );
    error.statusCode = 409;
    throw error;
  }
  if (
    !d ||
    !chat ||
    !turn ||
    !snap ||
    snap.id !== snapshotId ||
    snap.status !== 'ready' ||
    !snap.imageRef
  ) {
    const error: Error & { statusCode?: number } = new Error(
      'snapshot is not available for rollback',
    );
    error.statusCode = 404;
    throw error;
  }
  imageRef = snap.imageRef;
  droneEntry = { ...d };
  const marked = await updateTranscriptTurnInStore({
    droneId,
    chatName,
    turnId: promptId,
    update: (current) => {
      const currentSnapshot = normalizeDockerSnapshot((current as any).dockerSnapshot);
      if (
        !currentSnapshot ||
        currentSnapshot.id !== snapshotId ||
        currentSnapshot.status !== 'ready'
      )
        return current;
      return { ...current, dockerSnapshot: { ...currentSnapshot, status: 'restoring' } };
    },
  });
  if (!marked.changed) {
    const error: Error & { statusCode?: number } = new Error(
      'snapshot is not available for rollback',
    );
    error.statusCode = 409;
    throw error;
  }

  try {
    await recreateDroneContainerFromSnapshot({ droneId, droneEntry, imageRef });
  } catch (e: any) {
    const error = String(e?.message ?? e ?? 'rollback failed');
    await updateTranscriptTurnById({
      droneId,
      chatName,
      promptId,
      update: (turn) => {
        const snap = normalizeDockerSnapshot((turn as any).dockerSnapshot);
        if (!snap || snap.id !== snapshotId) return turn;
        return {
          ...turn,
          dockerSnapshot: {
            ...snap,
            status: 'ready',
            error,
          },
        };
      },
    });
    throw e;
  }

  const rollback = await rollbackTranscriptToTurnInStore({
    droneId,
    chatName,
    turnId: promptId,
    update: (current) => {
      const currentSnapshot = normalizeDockerSnapshot((current as any).dockerSnapshot);
      if (!currentSnapshot || currentSnapshot.id !== snapshotId) return current;
      return {
        ...current,
        dockerSnapshot: { ...currentSnapshot, status: 'ready', restoredAt: nowIso() },
      };
    },
  });
  if (rollback.changed) await projectCanonicalChatToRegistry(droneId, chatName);
  const prunedImageRefs = rollback.removedTurns
    .map((turn: any) => String(turn?.dockerSnapshot?.imageRef ?? '').trim())
    .filter(Boolean);
  await removeDockerSnapshotImagesBestEffort(prunedImageRefs, {
    droneId,
    chatName,
    reason: 'rollback-pruned-turns',
  });
  enqueuePendingPromptPump(droneId, chatName);
}

async function runNodeCli(args: string[], opts?: { cwd?: string; timeoutMs?: number }) {
  const envTimeoutRaw = String(process.env.DRONE_HUB_NODE_CLI_TIMEOUT_MS ?? '').trim();
  const envTimeout = envTimeoutRaw ? Number(envTimeoutRaw) : NaN;
  const timeoutMs =
    typeof opts?.timeoutMs === 'number' && Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0
      ? opts.timeoutMs
      : Number.isFinite(envTimeout) && envTimeout > 0
        ? envTimeout
        : 10 * 60_000;

  let nodeArgs = [...args];
  const cliEntry = String(nodeArgs[0] ?? '').trim();
  if (cliEntry.endsWith('.ts')) {
    try {
      const tsNodeRegister = requireForHub.resolve('ts-node/register');
      nodeArgs = ['-r', tsNodeRegister, ...nodeArgs];
    } catch {
      const builtCliPath = path.resolve(
        path.dirname(cliEntry),
        '..',
        'dist',
        `${path.basename(cliEntry, '.ts')}.js`,
      );
      if (existsSync(builtCliPath)) nodeArgs = [builtCliPath, ...nodeArgs.slice(1)];
    }
  }

  const r = await new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(process.execPath, nodeArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      cwd: opts?.cwd,
    });
    let stdout = '';
    let stderr = '';
    let done = false;
    let timeout: any = null;

    const finish = (res: { code: number; stdout: string; stderr: string }) => {
      if (done) return;
      done = true;
      if (timeout) clearTimeout(timeout);
      resolve(res);
    };

    child.stdout.on('data', (d) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d) => (stderr += d.toString('utf8')));

    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        try {
          child.kill('SIGTERM');
        } catch {
          // ignore
        }
        setTimeout(() => {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }, 1500);
        finish({
          code: 124,
          stdout,
          stderr: `${stderr}${stderr.trim() ? '\n\n' : ''}Timed out after ${Math.round(timeoutMs / 1000)}s`,
        });
      }, timeoutMs);
    }

    child.once('error', (err: any) =>
      finish({ code: 127, stdout, stderr: `${stderr}${err?.message ?? String(err)}` }),
    );
    child.once('close', (code) =>
      finish({ code: typeof code === 'number' ? code : 1, stdout, stderr }),
    );
  });
  return r;
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

export async function startDroneHubApiServer(opts: {
  port: number;
  host?: string;
  containerMcpHost?: string;
  containerMcpPort?: number;
  containerMcpUrl?: string;
  apiToken: string;
  deviceMeshIngressPort?: number;
  mcpToken?: string;
  allowedOrigins?: string[];
}) {
  chatReconciliationQueue.clearRetries();
  agentFollowupCoordinator.clear();
  loadHubEnv();
  await logHubLlmStartupSnapshot();
  const host = opts.host ?? '127.0.0.1';
  const containerMcpHost = String(opts.containerMcpHost ?? '').trim();
  const containerMcpPort = Number(opts.containerMcpPort ?? NaN);
  const containerMcpRequestedUrl = normalizeContainerMcpUrl(opts.containerMcpUrl);
  const apiToken = String(opts.apiToken ?? '').trim();
  if (!apiToken) throw new Error('missing hub API token');
  const mcpToken = String(opts.mcpToken ?? '').trim();
  let actualPort = opts.port;
  const deviceMesh = await createDeviceMeshService({
    rootDir: droneRootPath('device-mesh'),
    apiToken,
    localHubBaseUrl: () => `http://127.0.0.1:${actualPort}`,
    ingressPort: opts.deviceMeshIngressPort,
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
    const address = server.address();
    const apiPort = typeof address === 'object' && address ? address.port : opts.port;
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
    const regAny: any = await loadRegistry();
    enqueueProvisioningForAllPending(regAny);
    // Best-effort: resume any hub-queued prompts after hub restarts.
    // These are prompts persisted in the registry but not yet enqueued into the daemon
    // (e.g. Codex/OpenCode follow-ups waiting for session ids to be discovered).
    try {
      const drones =
        regAny?.drones && typeof regAny.drones === 'object' ? Object.entries(regAny.drones) : [];
      const activeDroneIds = new Set(drones.map(([droneId]) => String(droneId)));
      for (const pendingChat of await resumePendingPromptChats()) {
        if (activeDroneIds.has(pendingChat.droneId)) {
          enqueuePendingPromptPump(pendingChat.droneId, pendingChat.chatName);
        }
      }
      for (const [droneName, d] of drones as any[]) {
        const chats = d?.chats && typeof d.chats === 'object' ? Object.entries(d.chats) : [];
        for (const [chatName, entry] of chats as any[]) {
          if (isDraftChatEntry(entry)) continue;
          const pending = await readPendingPrompts({
            droneId: String(droneName),
            chatName: String(chatName),
          });
          if (pending.some((p: any) => String(p?.state ?? '') === 'queued')) {
            enqueuePendingPromptPump(String(droneName), String(chatName));
          }
        }
      }
    } catch {
      // ignore (best-effort)
    }
  } catch {
    // ignore (best-effort)
  }

  if (!ARCHIVE_CLEANUP_INTERVAL) {
    ARCHIVE_CLEANUP_INTERVAL = setInterval(() => {
      triggerArchiveCleanup('interval');
    }, ARCHIVE_CLEANUP_INTERVAL_MS);
    try {
      (ARCHIVE_CLEANUP_INTERVAL as any).unref?.();
    } catch {
      // ignore
    }
  }
  triggerArchiveCleanup('startup');
  if (!PLAYBOOK_RUN_QUEUE_INTERVAL) {
    PLAYBOOK_RUN_QUEUE_INTERVAL = setInterval(() => {
      void runPlaybookRunQueueCycle();
    }, PLAYBOOK_RUN_QUEUE_INTERVAL_MS);
    try {
      (PLAYBOOK_RUN_QUEUE_INTERVAL as any).unref?.();
    } catch {
      // ignore
    }
  }
  void runPlaybookRunQueueCycle();
  startRegistryBackupScheduler();

  const wss = createTerminalWebSocketServer({
    isStaleSessionError: isStaleDockerExecErrorMessage,
  });

  const callLocalHubApi = async (pathname: string, body: any): Promise<any> => {
    const response = await fetch(`http://127.0.0.1:${opts.port}${pathname}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body ?? {}),
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
    if (!response.ok) throw new Error(data?.error ?? `${response.status} ${response.statusText}`);
    return data;
  };

  function buildAssistantDroneSummariesFromRegistry(regAny: any): AssistantDroneSummary[] {
    const out: AssistantDroneSummary[] = [];
    const drones = regAny?.drones && typeof regAny.drones === 'object' ? regAny.drones : {};
    for (const [idRaw, d] of Object.entries(drones) as any[]) {
      const id = normalizeDroneIdentity((d as any)?.id) || normalizeDroneIdentity(idRaw);
      if (!id) continue;
      const chatObj =
        (d as any)?.chats && typeof (d as any).chats === 'object' ? (d as any).chats : {};
      const chats = Object.keys(chatObj);
      if (chats.length === 0) chats.push('default');
      const activity = summarizeDroneActivity(d);
      const busyChats = busyChatNamesForDrone(d, id);
      const hubPhase = String((d as any)?.hub?.phase ?? '').trim();
      out.push({
        id,
        name: String((d as any)?.name ?? id).trim() || id,
        group: String((d as any)?.group ?? '').trim() || null,
        runtime: normalizeDroneRuntime((d as any)?.runtime),
        repoPath: String((d as any)?.repoPath ?? '').trim(),
        status: hubPhase || (busyChats.length > 0 ? 'busy' : 'ready'),
        chats,
        ...(busyChats.length > 0 ? { busyChats, busy: true } : {}),
        ...(activity.lastActivityAt ? { lastActivityAt: activity.lastActivityAt } : {}),
        ...(activity.lastMessageAt ? { lastMessageAt: activity.lastMessageAt } : {}),
        ...(activity.lastActivityChat ? { lastActivityChat: activity.lastActivityChat } : {}),
      } as AssistantDroneSummary);
    }
    const pending = regAny?.pending && typeof regAny.pending === 'object' ? regAny.pending : {};
    for (const [idRaw, d] of Object.entries(pending) as any[]) {
      const id = normalizeDroneIdentity((d as any)?.id) || normalizeDroneIdentity(idRaw);
      if (!id || out.some((item) => item.id === id)) continue;
      const activity = summarizeDroneActivity(d);
      out.push({
        id,
        name: String((d as any)?.name ?? id).trim() || id,
        group: String((d as any)?.group ?? '').trim() || null,
        runtime: normalizeDroneRuntime((d as any)?.runtime),
        repoPath: String((d as any)?.repoPath ?? '').trim(),
        status: String((d as any)?.phase ?? 'starting').trim() || 'starting',
        chats: ['default'],
        ...(activity.lastActivityAt ? { lastActivityAt: activity.lastActivityAt } : {}),
        ...(activity.lastMessageAt ? { lastMessageAt: activity.lastMessageAt } : {}),
        ...(activity.lastActivityChat ? { lastActivityChat: activity.lastActivityChat } : {}),
      } as AssistantDroneSummary);
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  }

  type WhiteboardChangeReason = 'created' | 'updated' | 'deleted';
  type WhiteboardChangeEvent = {
    type: 'whiteboard_changed';
    sequence: number;
    whiteboardId: string;
    version: number | null;
    reason: WhiteboardChangeReason;
    source: string;
    at: string;
  };

  const whiteboardChangeListeners = new Set<(event: WhiteboardChangeEvent) => void>();
  let whiteboardChangeSequence = 0;

  function emitWhiteboardChange(input: {
    whiteboardId: string;
    version?: number | null;
    reason: WhiteboardChangeReason;
    source?: unknown;
  }): WhiteboardChangeEvent {
    const event: WhiteboardChangeEvent = {
      type: 'whiteboard_changed',
      sequence: ++whiteboardChangeSequence,
      whiteboardId: input.whiteboardId,
      version: input.version ?? null,
      reason: input.reason,
      source: String(input.source ?? '').trim() || 'unknown',
      at: nowIso(),
    };
    for (const listener of whiteboardChangeListeners) {
      try {
        listener(event);
      } catch (error: any) {
        hubLog('warn', 'whiteboard change listener failed', {
          error: String(error?.message ?? error ?? ''),
        });
      }
    }
    return event;
  }

  function subscribeWhiteboardChanges(
    listener: (event: WhiteboardChangeEvent) => void,
  ): () => void {
    whiteboardChangeListeners.add(listener);
    return () => {
      whiteboardChangeListeners.delete(listener);
    };
  }

  const assistantService = new HubAssistantService({
    listDrones: async (): Promise<AssistantDroneSummary[]> => {
      const regAny: any = await loadRegistry();
      return buildAssistantDroneSummariesFromRegistry(regAny);
    },
    listDroneFiles: async ({ droneId, path }) => await assistantListDroneFiles({ droneId, path }),
    readDroneFile: async ({ droneId, path, startLine, endLine }) =>
      await assistantReadDroneFile({ droneId, path, startLine, endLine }),
    writeDroneFile: async ({ droneId, path, content }) =>
      await assistantWriteDroneFile({ droneId, path, content }),
    deleteDroneFile: async ({ droneId, path }) => await assistantDeleteDroneFile({ droneId, path }),
    moveDroneFile: async ({ droneId, fromPath, toPath }) =>
      await assistantMoveDroneFile({ droneId, fromPath, toPath }),
    moveDronePath: async ({ droneId, fromPath, toPath, overwrite }) =>
      await assistantMoveDronePath({ droneId, fromPath, toPath, overwrite }),
    createDroneDirectory: async ({ droneId, path, recursive }) =>
      await assistantCreateDroneDirectory({ droneId, path, recursive }),
    deleteDroneDirectory: async ({ droneId, path, recursive }) =>
      await assistantDeleteDroneDirectory({ droneId, path, recursive }),
    searchDroneFiles: async ({ droneId, path, query, limit, contextBefore, contextAfter }) =>
      await assistantSearchDroneFiles({ droneId, path, query, limit, contextBefore, contextAfter }),
    statDronePath: async ({ droneId, path }) => await assistantStatDronePath({ droneId, path }),
    readDroneFileChunk: async (input) => await assistantReadDroneFileChunk(input),
    createDroneTransferDirectory: async (input) =>
      await assistantCreateDroneTransferDirectory(input),
    prepareDroneTransferFile: async (input) => await assistantPrepareDroneTransferFile(input),
    writeDroneTransferChunk: async (input) => await assistantWriteDroneTransferChunk(input),
    commitDroneTransferFile: async (input) => await assistantCommitDroneTransferFile(input),
    abortDroneTransferFile: async (input) => await assistantAbortDroneTransferFile(input),
    runDroneBash: async ({ droneId, command, cwd, timeoutMs }) =>
      await assistantRunDroneBash({ droneId, command, cwd, timeoutMs }),
    listDroneChangedFiles: async ({ droneId }) => await assistantListDroneChangedFiles({ droneId }),
  });
  const blipAssistantHost = new BlipAssistantHost(
    async (threadId) => {
      const snapshot = await assistantService.threadSnapshot(threadId);
      const thread = snapshot.threads.find((candidate) => candidate.id === threadId);
      if (!thread) throw new Error(`unknown assistant thread: ${threadId}`);
      const [{ createMcpToolProvider }, blipTools] = await Promise.all([
        loadBlipMcp(),
        loadBlipTools(),
      ]);
      const workspaceDrones = await assistantService.workspaceDrones(threadId);
      const readableWorkspaceCapabilities = [
        'files.list',
        'files.read',
        'files.search',
        'git.status',
      ] as const;
      const readableDrones = workspaceDrones.filter((drone) => drone.canRead);
      const writableDrones = workspaceDrones.filter((drone) => drone.canWrite);
      const refsFor = (drones: any[]) =>
        Array.from(
          new Set(
            drones
              .flatMap((drone: any) => [String(drone.id ?? ''), String(drone.name ?? '')])
              .filter(Boolean),
          ),
        );
      const mcpClient = await createInProcessDroneHubMcpClient({
        correlationId: threadId,
        allowedDroneRefs: refsFor(readableDrones),
        allowedWriteDroneRefs: refsFor(writableDrones),
        allowedDroneIds: readableDrones.map((drone: any) => String(drone.id ?? '')).filter(Boolean),
      });
      const droneTargets = workspaceDrones.map((drone) => {
        return new DroneWorkspaceTarget({
          id: `drone:${drone.id}`,
          droneId: drone.id,
          label: drone.name || drone.id,
          rootLabel: `${drone.name || drone.id} workspace`,
          capabilities: [
            ...(drone.canRead ? readableWorkspaceCapabilities : []),
            ...(drone.canWrite
              ? ([
                  'files.write',
                  'files.delete',
                  'files.move',
                  'directories.create',
                  'directories.delete',
                  'patch.apply',
                ] as const)
              : []),
            ...(drone.canExecute ? (['shell.execute'] as const) : []),
          ],
          execute: async (call) =>
            assistantService.executeDroneWorkspaceTool(threadId, drone.id, call, {
              parse: blipTools.parsePatch,
              applyHunks: blipTools.applyPatchHunks,
            }),
        });
      });
      const artifactTarget = new AssistantArtifactsTarget(threadId);
      const remoteWorkspaceTargets = await deviceMesh.remoteWorkspaceTargets(threadId);
      const targets = [...droneTargets, artifactTarget, ...remoteWorkspaceTargets];
      const preferredDroneId = Array.isArray(thread.accessScope?.droneIds)
        ? thread.accessScope.droneIds[0]
        : '';
      const activeTargetId =
        droneTargets.find((target: DroneWorkspaceTarget) => target.droneId === preferredDroneId)
          ?.descriptor.id ?? targets[0]?.descriptor.id;
      const targetCatalog = new blipTools.WorkspaceTargetCatalog(targets, activeTargetId);
      const enabledTools = new Set(Array.isArray(thread.enabledTools) ? thread.enabledTools : []);
      const workspaceTools = blipTools
        .createWorkspaceTargetTools({
          profile: 'no-shell-workspace-write',
          includeShell: true,
          catalog: targetCatalog,
        })
        .filter((tool) => enabledTools.has(tool.name));
      const targetTools = blipTools
        .createWorkspaceTargetSelectionTools(targetCatalog)
        .filter((tool) => enabledTools.has(tool.name));
      const transferTools = blipTools
        .createWorkspaceTransferTools(targetCatalog)
        .filter((tool) => enabledTools.has(tool.name));
      const tools = [
        {
          name: 'get_current_context',
          label: 'Get current context',
          description: 'Read the current Drone Hub UI context and this thread access scope.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => {
            const context = assistantService.currentContext(threadId);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(context, null, 2) }],
              details: context,
            };
          },
        },
        {
          name: 'get_system_prompt',
          label: 'Get system prompt',
          description:
            'Read the current thread system prompt, global prompt, and runtime appendix.',
          parameters: { type: 'object', properties: {}, additionalProperties: false },
          execute: async () => {
            const result = await assistantService.threadSystemPromptSettings(threadId);
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
              details: result,
            };
          },
        },
        {
          name: 'update_system_prompt',
          label: 'Update system prompt',
          description: 'Replace or patch only this assistant thread system prompt.',
          parameters: {
            type: 'object',
            properties: {
              prompt: { type: 'string' },
              patches: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { oldText: { type: 'string' }, newText: { type: 'string' } },
                  required: ['oldText', 'newText'],
                  additionalProperties: false,
                },
              },
            },
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const result = await assistantService.updateThreadSystemPrompt(threadId, args ?? {});
            return {
              content: [
                { type: 'text' as const, text: 'Updated this assistant thread system prompt.' },
              ],
              details: result,
            };
          },
        },
        {
          name: 'set_thinking_level',
          label: 'Set thinking level',
          description:
            'Change the thinking level for this assistant thread while keeping its current model.',
          parameters: {
            type: 'object',
            properties: {
              level: { type: 'string', enum: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] },
            },
            required: ['level'],
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const before = thread.thinkingLevel;
            const updated = await assistantService.updateThread(threadId, {
              thinkingLevel: args?.level,
            });
            const next =
              updated.threads.find((candidate) => candidate.id === threadId)?.thinkingLevel ??
              before;
            setTimeout(() => blipAssistantHost.invalidateThread(threadId), 0);
            const result = {
              previousThinkingLevel: before,
              thinkingLevel: next,
              provider: thread.provider,
              model: thread.model,
            };
            return {
              content: [{ type: 'text' as const, text: `Thinking level is now ${next}.` }],
              details: result,
            };
          },
        },
        {
          name: 'create_new_thread',
          label: 'Create new thread',
          description:
            'Create a fresh assistant thread only when the user explicitly asks for one.',
          parameters: {
            type: 'object',
            properties: { title: { type: 'string' } },
            additionalProperties: false,
          },
          execute: async (_callId: string, args: any) => {
            const result = await assistantService.createNewThreadFromThread(threadId, {
              title: args?.title,
            });
            return {
              content: [
                { type: 'text' as const, text: `Created assistant thread ${result.thread.title}.` },
              ],
              details: result,
            };
          },
        },
        {
          name: 'web_search',
          label: 'Web search',
          description: 'Search the web for current information and source URLs.',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string' },
              numResults: { type: 'number' },
              recencyFilter: { type: 'string', enum: ['day', 'week', 'month', 'year'] },
              domainFilter: { type: 'array', items: { type: 'string' } },
            },
            required: ['query'],
          },
          execute: async (_callId: string, args: any) => {
            const settings = await resolveExaApiKeySettings();
            const result = await searchWeb(args, settings.apiKey ?? '');
            return { content: [{ type: 'text' as const, text: result.answer }], details: result };
          },
        },
        {
          name: 'fetch_content',
          label: 'Fetch content',
          description: 'Fetch readable content from an HTTP or HTTPS URL.',
          parameters: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              maxCharacters: { type: 'number' },
              livecrawl: { type: 'string', enum: ['never', 'fallback', 'preferred', 'always'] },
            },
            required: ['url'],
          },
          execute: async (_callId: string, args: any) => {
            const settings = await resolveExaApiKeySettings();
            const result = await fetchContent(args, settings.apiKey ?? '');
            return { content: [{ type: 'text' as const, text: result.answer }], details: result };
          },
        },
        ...targetTools,
        ...transferTools,
        ...workspaceTools,
      ].filter((tool) => enabledTools.has(tool.name));
      const mcpProvider = createMcpToolProvider({
        id: 'drone-hub',
        namePrefix: 'drone_hub',
        client: mcpClient,
        promptGuidance:
          'Use drone_hub__ tools for Drone Hub drones, chats, groups, repositories, and whiteboards.',
        correlation: () => ({ threadId }),
      });
      const enabledMcpProvider = {
        id: mcpProvider.id,
        promptSections: mcpProvider.promptSections?.bind(mcpProvider),
        async load(context: any) {
          return (await mcpProvider.load(context)).filter((tool) => {
            const unqualified = tool.name.replace(/^drone_hub__/, '');
            return enabledTools.has(unqualified);
          });
        },
      };
      const transportProvider =
        thread.provider === 'codex'
          ? 'openai-codex'
          : thread.provider === 'gemini'
            ? 'google'
            : thread.provider;
      hubLog('info', 'assistant model session configuring', {
        threadId,
        provider: thread.provider,
        transportProvider,
        model: thread.model,
        thinkingLevel: thread.thinkingLevel,
      });
      return {
        provider: thread.provider,
        model: thread.model,
        thinkingLevel: thread.thinkingLevel,
        promptDeliveryMode: thread.promptDeliveryMode,
        systemPrompt: assistantService.resolvedSystemPrompt(threadId, {
          multipleWorkspaceTargets: targetCatalog.size() > 1,
        }),
        tools,
        toolProviders: [enabledMcpProvider],
        onResponse: async (response: any, model: any) => {
          const headers =
            response?.headers && typeof response.headers === 'object' ? response.headers : {};
          const header = (name: string) => {
            const value = String(headers[name] ?? headers[name.toLowerCase()] ?? '').trim();
            return value || undefined;
          };
          const status = Number(response?.status ?? 0) || undefined;
          hubLog(
            status != null && status >= 400 ? 'warn' : 'info',
            'assistant model provider response',
            {
              threadId,
              provider: thread.provider,
              transportProvider: String(model?.provider ?? transportProvider),
              model: String(model?.id ?? thread.model),
              api: String(model?.api ?? ''),
              status,
              requestId:
                header('x-request-id') ?? header('request-id') ?? header('openai-request-id'),
              clientRequestId: header('x-client-request-id'),
              processingMs: header('openai-processing-ms'),
              cfRay: header('cf-ray'),
              remainingRequests: header('x-ratelimit-remaining-requests'),
            },
          );
        },
        permissionPreflight: async (request) => {
          let toolName = request.tool;
          let args: any = request.args && typeof request.args === 'object' ? request.args : {};
          if (toolName === 'drone_hub__send_message') {
            toolName = 'message_drone';
            args = { ...args, droneId: args.drone, chatName: args.chat };
          } else if (toolName === 'drone_hub__set_drone_group') {
            toolName = 'set_drone_group';
          } else if (toolName === 'drone_hub__rename_drones') {
            toolName = 'rename_drones';
          } else if (blipTools.capabilityForWorkspaceTool(toolName)) {
            const target = targetCatalog.resolve(args.target);
            if (targetCatalog.size() > 1) args.target = target.descriptor.id;
            if (target instanceof DroneWorkspaceTarget) args = { ...args, droneId: target.droneId };
            else if (toolName === 'bash') args = { ...args, workspaceTarget: target.descriptor };
          }
          const decision = await assistantService.preflightBlipTool(
            threadId,
            toolName,
            request.callId,
            args,
            request.signal,
          );
          return decision?.block
            ? { status: 'deny' as const, reason: decision.reason ?? `Denied ${toolName}` }
            : { status: 'allow' as const };
        },
        getApiKey: async (provider: string) => {
          const normalized =
            provider === 'openai-codex' ? 'codex' : provider === 'google' ? 'gemini' : provider;
          if (normalized !== 'openai' && normalized !== 'codex' && normalized !== 'gemini')
            return undefined;
          return (await resolveEffectiveProviderApiKeySettings(normalized)).apiKey ?? undefined;
        },
        dispose: () => mcpClient.close(),
      };
    },
    async (threadId, event) => {
      await assistantService.notifyRuntimeEvent(threadId, event);
      if (event.type === 'session_error') {
        let thread: any;
        try {
          thread = (await assistantService.threadSnapshot(threadId)).threads.find(
            (candidate) => candidate.id === threadId,
          );
        } catch {}
        hubLog('warn', 'assistant model session failed', {
          threadId,
          sessionId: event.sessionId,
          turnId: event.turnId,
          eventId: event.eventId,
          provider: thread?.provider,
          model: thread?.model,
          thinkingLevel: thread?.thinkingLevel,
          error: String(event.error ?? '').slice(0, 2_000),
          recoverable: event.recoverable,
        });
      }
    },
  );
  deviceMesh.onAssistantPolicyChange((threadIds) => {
    for (const threadId of threadIds) {
      blipAssistantHost.invalidateThread(threadId);
      void deviceMesh.broadcastAssistantThreadChange({
        reason: 'workspace_policy_changed',
        threadId,
      });
    }
  });
  const unsubscribeDeviceMeshAssistantChanges = assistantService.subscribeChanges((event) => {
    void deviceMesh.broadcastAssistantThreadChange({
      sequence: event.sequence,
      reason: event.reason,
      ...(event.threadId ? { threadId: event.threadId } : {}),
      at: event.at,
    });
  });
  assistantService.setTextPromptDelegate(async (threadId, prompt) => {
    await blipAssistantHost.promptThread(threadId, prompt);
  });
  type AssistantPromptInput =
    | string
    | { text: string; images: Array<{ type: 'image'; data: string; mimeType: string }> };
  const assistantPromptDrains = new Map<string, Promise<void>>();
  const queuedPromptInput = (queued: any): AssistantPromptInput => {
    const images = Array.isArray(queued?.promptImages) ? queued.promptImages : [];
    return images.length > 0
      ? { text: String(queued?.prompt ?? ''), images }
      : String(queued?.prompt ?? '');
  };
  const startAssistantPromptDrain = (
    threadId: string,
    initial?: { input: AssistantPromptInput; onEvent?: (event: any) => Promise<void> | void },
  ): { started: boolean; promise: Promise<void>; initialPromise: Promise<void> } => {
    const existing = assistantPromptDrains.get(threadId);
    if (existing) return { started: false, promise: existing, initialPromise: existing };
    let resolveInitial!: () => void;
    let rejectInitial!: (error: unknown) => void;
    const initialPromise = new Promise<void>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    if (!initial) void initialPromise.catch(() => {});
    const promise = Promise.resolve()
      .then(async () => {
        try {
          if (initial) {
            await blipAssistantHost.waitForThreadIdle(threadId);
            await blipAssistantHost.promptThread(threadId, initial.input, initial.onEvent);
          } else {
            await blipAssistantHost.waitForThreadIdle(threadId);
          }
          resolveInitial();
        } catch (error) {
          rejectInitial(error);
          throw error;
        }
        while (true) {
          const queued = await assistantService.claimNextQueuedPrompt(threadId);
          if (!queued) break;
          try {
            await blipAssistantHost.waitForThreadIdle(threadId);
            await blipAssistantHost.promptThread(threadId, queuedPromptInput(queued));
            await assistantService.completeQueuedPrompt(threadId, queued.id);
          } catch (error) {
            await assistantService.failQueuedPrompt(threadId, queued.id, error);
          }
        }
      })
      .finally(() => {
        assistantPromptDrains.delete(threadId);
        void assistantService
          .hasQueuedPrompts(threadId)
          .then((hasQueued) => {
            if (hasQueued) {
              const restarted = startAssistantPromptDrain(threadId);
              void restarted.promise.catch((error: any) => {
                hubLog('warn', 'assistant queued prompt drain failed', {
                  threadId,
                  error: error?.message ?? String(error),
                });
              });
            }
          })
          .catch(() => {});
      });
    assistantPromptDrains.set(threadId, promise);
    return { started: true, promise, initialPromise };
  };
  void assistantService
    .snapshot('compact')
    .then((snapshot) => {
      for (const thread of snapshot.threads) {
        if (!thread.queuedPrompts?.some((prompt: any) => prompt.status === 'queued')) continue;
        const drain = startAssistantPromptDrain(thread.id);
        void drain.promise.catch((error: any) => {
          hubLog('warn', 'assistant queued prompt recovery drain failed', {
            threadId: thread.id,
            error: error?.message ?? String(error),
          });
        });
      }
    })
    .catch((error: any) => {
      hubLog('warn', 'assistant queued prompt recovery failed', {
        error: error?.message ?? String(error),
      });
    });
  function writeAssistantSseEvent(res: http.ServerResponse, event: string, data: any): void {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function writeHubSseEvent(res: http.ServerResponse, event: string, data: any): void {
    if (res.destroyed || res.writableEnded) return;
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  type DroneRegistrySnapshot = { ok: true; drones: any[] };
  type CachedDroneStatusSummary = {
    hostPort: number | null;
    statusOk: boolean;
    status: any;
    statusError: string | null;
    statusChecking?: boolean;
  };

  const DRONE_STATUS_SUMMARY_CONCURRENCY = 16;
  const DRONE_STATUS_REFRESH_CONCURRENCY = 4;
  const DRONE_STATUS_REFRESH_INTERVAL_MS = 15_000;
  const DRONE_SUMMARY_REGISTRY_CACHE_TTL_MS = 1_000;
  const CANONICAL_ACTIVE_MODEL_CACHE_TTL_MS = 250;
  const DRONE_SUMMARY_MAINTENANCE_MIN_INTERVAL_MS = 5_000;
  const droneStatusSummaryCache = new Map<string, CachedDroneStatusSummary>();
  let droneSummaryRegistryCache: { loadedAtMs: number; registry: any } | null = null;
  let droneSummaryRegistryCacheLoad: Promise<any> | null = null;
  let droneSummaryRegistryCacheEpoch = 0;
  let droneSummaryMaintenanceTimeout: ReturnType<typeof setTimeout> | null = null;
  let droneSummaryMaintenanceBusy = false;
  let droneSummaryMaintenanceLastStartedAt = 0;
  let droneStatusRefreshTimer: ReturnType<typeof setInterval> | null = null;
  let droneStatusRefreshTimeout: ReturnType<typeof setTimeout> | null = null;
  let droneStatusRefreshBusy = false;
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

  function pruneDroneStatusSummaryCache(): void {
    if (droneStatusSummaryCache.size <= 500) return;
    while (droneStatusSummaryCache.size > 500) {
      const oldestKey = droneStatusSummaryCache.keys().next().value;
      if (!oldestKey) break;
      droneStatusSummaryCache.delete(oldestKey);
    }
  }

  function buildDroneStatusSummaryCacheKey(d: any): string {
    const runtime = normalizeDroneRuntime(d?.runtime);
    const droneId = normalizeDroneIdentity(d?.id) || '';
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const hostPort =
      typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort) ? String(d.hostPort) : '';
    const containerPort = String(Number(d?.containerPort ?? 7777) || 7777);
    const token = typeof d?.token === 'string' ? d.token : '';
    return [droneId, runtime, containerName, hostPort, containerPort, token].join('\0');
  }

  function checkingDroneStatusSummaryFromEntry(d: any): CachedDroneStatusSummary {
    const hostPort =
      typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort) ? d.hostPort : null;
    return {
      hostPort,
      statusOk: false,
      status: null,
      statusError: 'checking status',
      statusChecking: true,
    };
  }

  function cachedDroneStatusSummaryForEntry(d: any): CachedDroneStatusSummary {
    pruneDroneStatusSummaryCache();
    const cacheKey = buildDroneStatusSummaryCacheKey(d);
    return droneStatusSummaryCache.get(cacheKey) ?? checkingDroneStatusSummaryFromEntry(d);
  }

  function sameDroneStatusSummaryForCache(
    a: CachedDroneStatusSummary | undefined,
    b: CachedDroneStatusSummary,
  ): boolean {
    if (!a) return false;
    return (
      a.hostPort === b.hostPort &&
      a.statusOk === b.statusOk &&
      (a.statusError ?? '') === (b.statusError ?? '') &&
      Boolean(a.statusChecking) === Boolean(b.statusChecking)
    );
  }

  async function probeDroneStatusSummary(d: any): Promise<CachedDroneStatusSummary> {
    const runtime = normalizeDroneRuntime(d?.runtime);
    const containerName = String(d?.containerName ?? d?.name ?? '').trim();
    const hostPort =
      typeof d.hostPort === 'number' && Number.isFinite(d.hostPort)
        ? d.hostPort
        : runtime === 'host'
          ? null
          : await resolveHostPort(containerName || String(d.name ?? ''), d.containerPort);

    let statusOk = false;
    let status: any = null;
    let statusError: string | null = null;
    const token = typeof d.token === 'string' ? d.token : '';
    if (hostPort && token) {
      try {
        status = await droneStatus(makeClient(hostPort, token));
        statusOk = true;
      } catch (e: any) {
        statusError = e?.message ?? String(e);
      }
    } else if (!hostPort) {
      statusError =
        runtime === 'host'
          ? 'no host port mapped'
          : 'no host port mapped (container likely stopped)';
    } else {
      statusError = 'missing token (still starting?)';
    }

    return { hostPort: hostPort ?? null, statusOk, status, statusError };
  }

  async function refreshDroneStatusCacheForEntry(d: any): Promise<boolean> {
    const cacheKey = buildDroneStatusSummaryCacheKey(d);
    const previous = droneStatusSummaryCache.get(cacheKey);
    let next: CachedDroneStatusSummary;
    try {
      next = await probeDroneStatusSummary(d);
    } catch (e: any) {
      next = {
        hostPort:
          typeof d?.hostPort === 'number' && Number.isFinite(d.hostPort) ? d.hostPort : null,
        statusOk: false,
        status: null,
        statusError: e?.message ?? String(e),
      };
    }
    droneStatusSummaryCache.set(cacheKey, next);
    pruneDroneStatusSummaryCache();
    return !sameDroneStatusSummaryForCache(previous, next);
  }

  async function refreshDroneStatusCache(source: string): Promise<void> {
    if (droneStatusRefreshBusy) return;
    droneStatusRefreshBusy = true;
    try {
      const regAny: any = await loadCanonicalActiveModel();
      const realDrones = Object.values(regAny?.drones ?? {}) as any[];
      const changed = await mapDroneRegistrySummaryConcurrent(
        realDrones,
        DRONE_STATUS_REFRESH_CONCURRENCY,
        async (d) => refreshDroneStatusCacheForEntry(d),
      );
      if (changed.some(Boolean)) {
        scheduleDroneRegistryBroadcasterRefresh(source === 'startup' ? 0 : 50);
      }
    } catch (e: any) {
      hubLog('warn', 'drone status refresh failed', { source, error: e?.message ?? String(e) });
    } finally {
      droneStatusRefreshBusy = false;
    }
  }

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

  function scheduleDroneStatusRefresh(source: string, delayMs = 0): void {
    if (droneStatusRefreshTimeout) return;
    droneStatusRefreshTimeout = setTimeout(
      () => {
        droneStatusRefreshTimeout = null;
        void refreshDroneStatusCache(source);
      },
      Math.max(0, delayMs),
    );
    (droneStatusRefreshTimeout as any).unref?.();
  }

  function startDroneStatusRefresher(): void {
    scheduleDroneStatusRefresh('startup', 0);
    if (droneStatusRefreshTimer) return;
    droneStatusRefreshTimer = setInterval(() => {
      scheduleDroneStatusRefresh('interval', 0);
    }, DRONE_STATUS_REFRESH_INTERVAL_MS);
    (droneStatusRefreshTimer as any).unref?.();
  }

  async function auditStartupRegistryPresence(): Promise<void> {
    try {
      const regAny: any = await loadRegistry();
      const drones = Object.keys(regAny?.drones ?? {}).length;
      const pending = Object.keys(regAny?.pending ?? {}).length;
      const archived = Object.keys(regAny?.archived ?? {}).length;
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

  async function runDroneSummaryMaintenance(source: string): Promise<void> {
    if (droneSummaryMaintenanceBusy) return;
    droneSummaryMaintenanceBusy = true;
    droneSummaryMaintenanceLastStartedAt = Date.now();
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
    } finally {
      droneSummaryMaintenanceBusy = false;
    }
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
    return {
      id: normalizeDroneIdentity(p?.id) || null,
      name: String(p?.name ?? ''),
      group: typeof p?.group === 'string' && p.group.trim() ? p.group.trim() : null,
      kind: normalizeDroneEntryKind(p?.kind),
      visibility: normalizeDroneEntryVisibility(p?.visibility),
      draft: isDraftDroneEntry(p),
      playbook: playbookMetaFromEntry(p?.playbook),
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
  ): Promise<any> {
    const runtime = normalizeDroneRuntime(d?.runtime);
    const activity = summarizeDroneActivity(d);
    const hubPhase = typeof d?.hub?.phase === 'string' ? String(d.hub.phase) : null;
    const hubMessage = typeof d?.hub?.message === 'string' ? String(d.hub.message) : null;
    const repoPath = String(d?.repoPath ?? '').trim();
    const repoBranch = String(d?.repo?.branch ?? '').trim() || null;
    const repoAttached =
      Boolean(repoPath) ||
      Boolean(String(d?.repo?.dest ?? '').trim()) ||
      Boolean(String(d?.repo?.seededAt ?? '').trim());
    const droneId = normalizeDroneIdentity(d?.id);
    const busyChats = droneId ? busyChatNamesForDrone(d, droneId) : [];
    const chats = Object.keys(d.chats ?? {});
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

    return {
      id: normalizeDroneIdentity(d?.id) || null,
      name: d.name,
      group: d.group ?? null,
      kind: normalizeDroneEntryKind(d?.kind),
      visibility: normalizeDroneEntryVisibility(d?.visibility),
      playbook: playbookMetaFromEntry(d?.playbook),
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
      unreadChats,
      chatReadStates,
      draftChats,
      busyChats,
      hubPhase,
      hubMessage,
      busy: busyChats.length > 0,
    };
  }

  async function buildDroneRegistrySnapshot(source: string): Promise<DroneRegistrySnapshot> {
    const regAny = await loadPreparedDroneRegistryForSummary(source);
    const pendingSummaries = Object.values(regAny?.pending ?? {}).map((p) =>
      buildPendingDroneSummary(regAny, p),
    );
    const realDrones = Object.values(regAny.drones ?? {});
    const readStatesByDroneId = listChatReadStatesForDronesFromStore({
      droneIds: realDrones.map((drone: any) => normalizeDroneIdentity(drone?.id)).filter(Boolean),
    });
    const realSummaries = await mapDroneRegistrySummaryConcurrent(
      realDrones,
      DRONE_STATUS_SUMMARY_CONCURRENCY,
      async (d) => {
        const droneId = normalizeDroneIdentity((d as any)?.id);
        return buildRealDroneSummary(regAny, d, readStatesByDroneId.get(droneId) ?? {});
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
    const drones = Array.from(byId.values()).filter((x) => x?.id && x?.name);
    return { ok: true, drones };
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
  const droneChatSseClients = droneChatBroadcaster.clients;
  const droneChatSseLastByKey = droneChatBroadcaster.lastByKey;
  const droneRegistrySseClients = droneRegistryBroadcaster.clients;
  const refreshDroneChatEventSnapshot = (opts?: { broadcastSnapshot?: boolean }) =>
    droneChatBroadcaster.refresh(opts);
  const refreshDroneRegistryBroadcasterSnapshot = (opts?: { broadcastSnapshot?: boolean }) =>
    droneRegistryBroadcaster.refresh(opts);
  const scheduleDroneChatEventRefresh = (delayMs = 100) =>
    droneChatBroadcaster.schedule(delayMs);
  const scheduleDroneRegistryBroadcasterRefresh = (delayMs = 150) =>
    droneRegistryBroadcaster.schedule(delayMs);
  const startDroneChatBroadcaster = () => droneChatBroadcaster.start();
  const startDroneRegistryBroadcaster = () => droneRegistryBroadcaster.start();
  const stopDroneChatBroadcasterIfIdle = () => droneChatBroadcaster.stopIfIdle();
  const stopDroneRegistryBroadcasterIfIdle = () => droneRegistryBroadcaster.stopIfIdle();

  const promptAutomationBroadcaster = new PromptAutomationBroadcaster({
    key: promptAutomationJobKey,
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    nowIso,
    writeSseEvent: writeHubSseEvent,
    async buildStatusPayload(meta) {
      let lane = getPromptAutomationLane(meta.droneId, meta.chatName);
      await recoverStalledPromptAutomationLane(lane);
      lane = getPromptAutomationLane(meta.droneId, meta.chatName);
      return {
        ok: true,
        automation: 'prompt-loop',
        id: meta.droneId,
        name: meta.name || meta.droneId,
        chat: meta.chatName,
        job: promptAutomationJobResponse(lane),
      };
    },
  });
  const promptAutomationService = new PromptAutomationService({
    manager: promptAutomationManager,
    events: promptAutomationBroadcaster,
    normalizeDroneId: normalizeDroneIdentity,
    normalizeChatName,
    normalizeOnFailurePrompt: normalizePromptAutomationOnFailurePrompt,
    normalizeRuns: normalizePromptAutomationRuns,
    normalizeSleepBetweenRunsSecondsFromBody:
      normalizePromptAutomationSleepBetweenRunsSecondsFromBody,
    normalizeStopPhrase: normalizePromptAutomationStopPhrase,
    normalizeStopPhraseCaseSensitive: normalizePromptAutomationStopPhraseCaseSensitive,
    ensureChatEntry,
    getChatEntry,
    inferChatAgent,
    recoverStalledLane: recoverStalledPromptAutomationLane,
    activePendingPromptIds: activePromptAutomationPendingPromptIds,
  });


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
  notifyDroneRegistryWrite = notifyCanonicalDroneRegistryWrite;
  const notifyCanonicalPromptQueueChatWrite = (droneId: string, chatName: string) => {
    // Prompt delivery state is canonical SQLite state and does not rewrite the
    // registry. Invalidate the projection and wake chat SSE clients explicitly
    // so live plan/status changes are not delayed until the fallback poll.
    canonicalActiveModelCache = null;
    scheduleDroneChatEventRefresh();
    void deviceMesh.broadcastDroneChatChange({
      reason: 'chat_write',
      droneId,
      chatName,
      at: nowIso(),
    });
  };
  notifyDroneChatWrite = notifyCanonicalPromptQueueChatWrite;
  const notifyCanonicalPromptAutomationLaneChange = (droneId: string, chatName: string) => {
    promptAutomationBroadcaster.notify(droneId, chatName);
  };
  notifyPromptAutomationLaneChange = notifyCanonicalPromptAutomationLaneChange;

  let containerMcpServer: http.Server | null = null;
  let containerMcpActualPort =
    Number.isFinite(containerMcpPort) && containerMcpPort > 0 ? Math.floor(containerMcpPort) : 0;
  let containerMcpActualUrl = '';
  const containerMcpSockets = new Set<any>();
  const mcpHttpTransport = new DroneHubMcpHttpTransport({
    signingSecret: mcpToken,
    log: hubLog,
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
    resolveLlmSettingsResponse,
    parseLlmProvider,
    upsertStoredLlmProvider,
    resolveGithubSettingsResponse,
    resolveDeleteActionSettingsResponse,
    readManagedHubStateAtRootOrFallback,
    parseDroneDeleteMode,
    parseArchiveRetentionId,
    parseArchiveRuntimePolicy,
    upsertStoredDeleteActionSettings,
    resolveFilesystemSettingsResponse,
    parseFilesystemUploadMaxBytes,
    upsertStoredFilesystemSettings,
    FILESYSTEM_UPLOAD_MAX_BYTES_MIN,
    FILESYSTEM_UPLOAD_MAX_BYTES_MAX,
    resolveRegistryBackupStatusResponse,
    upsertStoredRegistryBackupSettings,
    createRegistryBackup,
    resolveAgentMessageAutoContinueSettingsResponse,
    normalizeAgentMessageAutoContinuePrompt,
    upsertStoredAgentMessageAutoContinueSettings,
    resolveAgentSuggestionSettingsResponse,
    normalizeAgentSuggestionPolicyMarkdown,
    upsertStoredAgentSuggestionSettings,
    defaultAgentsPayload,
    normalizeAgentsMarkdown,
    upsertCanonicalDefaultAgentsConfig,
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
    resolveUiPreferencesSettingsResponse,
    upsertStoredUiPreferencesSettings,
    clampIntParam,
    readHubLogTail,
    HUB_SETTINGS_LOG_DEFAULT_MAX_BYTES,
    HUB_SETTINGS_LOG_MAX_BYTES,
    HUB_SETTINGS_LOG_DEFAULT_TAIL_LINES,
    HUB_SETTINGS_LOG_MAX_TAIL_LINES,
  });

  registerCatalogRoutes(apiRouter, {
    mcpToken,
    upsertDroneHubMcpServerPreset,
  });

  registerMessageRoutes(apiRouter, {
    resolveEffectiveLlmProvider,
    resolveEffectiveProviderApiKeySettings,
    resolveEffectiveAgentSuggestionSettings,
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
    assistantPromptDrains,
    startAssistantPromptDrain,
    validateAssistantPromptImages,
    saveAssistantArtifactUploads,
    hubLog,
  });

  registerWhiteboardRoutes(apiRouter, {
    nowIso,
    writeHubSseEvent,
    subscribeWhiteboardChanges,
    emitWhiteboardChange,
  });

  registerRepositoryRoutes(apiRouter, {
    normalizeBuiltinAgentId,
    modelCatalogCacheKey,
    latestChatModelDiscoveryByAgent,
    loadRegistry,
    droneRuntime,
    discoverAndRememberModelsForBuiltinAgent,
    listCanonicalRepositories,
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

  registerPlaybookRoutes(apiRouter, {
    listCanonicalPlaybookDefinitions,
    normalizePlaybookLabel,
    normalizePlaybookAgent,
    parseChatModelForUpdate,
    normalizePlaybookMessages,
    normalizePlaybookArtifacts,
    normalizePlaybookActions,
    nowIso,
    getCatalogStore,
    catalogPlaybookRecord,
    updateRegistry,
    normalizePlaybookDefinitions,
    parsePullHostBranchBeforeCreate,
    PLAYBOOK_RUN_QUEUE_BATCH_MIN,
    PLAYBOOK_RUN_QUEUE_BATCH_MAX,
    startPlaybookRunLaunch,
    formatPullHostBranchBeforeCreateError,
    enqueueCanonicalPlaybookQueueItem,
    runPlaybookRunQueueCycle,
    loadRegistry,
    normalizeDroneIdentity,
    playbookMetaFromEntry,
    normalizeDroneEntryKind,
    summarizePlaybookRunEntry,
    normalizeDroneRuntime,
    summarizePlaybookRunQueueItems,
    workflowStoreOrCompatibility,
    readPlaybookRunQueueItems,
    writePlaybookRunQueueItems,
  });

  registerGroupRoutes(apiRouter, {
    loadRegistry,
    listCanonicalGroups,
    listAllKnownGroups,
    normalizeGroupName,
    isUngroupedGroupName,
    validateGroupNameOrThrow,
    nowIso,
    ensureCanonicalGroup,
    renameCanonicalGroupOrchestration,
    isSameOrDescendantGroupPath,
    normalizeDroneIdentity,
    deleteCanonicalGroupArtifacts,
    dequeueProvisioning,
    removeDroneById,
    deleteCanonicalDroneLifecycleBatch,
  });

  registerOperationalRoutes(apiRouter, {
    resolveDroneOrPendingForReadRef,
    loadCanonicalActiveModel,
    summarizeAssistantChatIdle,
    resolveGroqApiKeySettings,
  });

  registerFleetRoutes(apiRouter, {
    resolveDroneOrRespond,
    loadRegistry,
    fleetActorPayload,
    findDroneIdByRef,
    resolveStableDroneOrPendingIdFromRef,
    fleetDescendantIdsForActor,
    updateDroneFleetMetadata,
    fleetActorConfig,
    fleetError,
  });

  const handleDroneLifecycleRoute = createDroneLifecycleRouteHandler({
    DRONE_DISPLAY_NAME_MAX_LEN,
    archiveDroneById,
    archiveRetentionMs,
    cleanupExpiredArchivedChats,
    commitDroneMetadataPatch,
    deleteArchivedChatById,
    deleteCanonicalDroneLifecycle,
    dequeueProvisioning,
    droneEnvironmentPayload,
    droneRuntime,
    dvmBaseSet,
    dvmStop,
    enqueueProvisioning,
    ensureCanonicalGroup,
    fileExists,
    findDroneIdByRef,
    hubLog,
    isDraftDroneEntry,
    isUngroupedGroupName,
    loadRegistry,
    looksLikeContainerNotRunningError,
    looksLikeMissingContainerError,
    normalizeArchiveRetention,
    normalizeArchiveRuntimePolicy,
    normalizeChatName,
    normalizeDisabledRepoKeys,
    normalizeDroneDisplayName,
    normalizeDroneIdentity,
    normalizeDroneRuntime,
    normalizeEnvVarMap,
    nowIso,
    parseIsoToMs,
    removeArchivedDroneById,
    removeDroneTreeById,
    renameDroneDisplayName,
    resolveArchiveDeleteAtIso,
    resolveDroneCliPath,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveDeleteActionSettings,
    restoreArchivedChatById,
    restoreArchivedDroneById,
    revokeMcpAccessTokensForDrone,
    runDroneLifecycleAction,
    setDroneEnvironmentMetadata,
    setDroneGroupMetadata,
    stopAllDroneChatActivity,
    triggerArchiveCleanup,
    validateGroupNameOrThrow,
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
    runGitInDrone,
    runGitInDroneOrThrow,
    runHostCommand,
    safeDroneRefSegment,
    setDroneHubMetaByIdentity,
    syncRepoAgentsInstructionsForDrone,
    updateHostRef,
    withLockedDroneContainer,
    withLockedDroneContainers,
    withReadonlyDroneContainer,
  });

  const handleChatAutomationRoute = createChatAutomationRouteHandler({
    promptAutomation: promptAutomationService,
    archiveChatById,
    attachmentOnlyPromptLabel,
    autoRenameGeneratedChatFromFirstPrompt,
    buildNewChatEntry,
    cancelQueuedPendingPrompt,
    chatSnapshotResponseBody,
    claimChatAutoRenameFromFirstPrompt,
    collectDockerSnapshotImageRefsFromChatEntry,
    createChatInStore,
    createOrEnqueuePromptUnified,
    createRequestTimer,
    defaultDaemonReadyTimeoutMs,
    deleteActiveChatFromStore,
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
    isDraftChatEntry,
    isSafePromptId,
    isStaleDockerExecErrorMessage,
    jsonWithEtag,
    jsonWithKnownEtag,
    listChatReadStatesFromStore,
    listChatsFromStore,
    logSlowHubRequest,
    markChatReadInStore,
    markChatUnreadInStore,
    markTranscriptTurnAgentSuggestionUsedDirect,
    migrateInMemoryChatStateForRename,
    normalizeAgentPermissionMode,
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
    parseChatModelForUpdate,
    parseChatNameForMutation,
    parseDraftFlag,
    projectCanonicalChatToRegistry,
    projectCanonicalChatsToRegistry,
    pushPendingPrompt,
    pushPendingStartupPrompt,
    readChatReadStateFromStore,
    readChatSnapshot,
    removeDockerSnapshotImagesBestEffort,
    renameChatInStore,
    resolveChatTmuxCommand,
    resolveDroneDaemonClientForEntry,
    resolveDroneFromRegistryRef,
    resolveDroneOrPendingForReadRef,
    resolveDroneOrRespond,
    resolveEffectiveAgentMessageAutoContinueSettings,
    resolveEffectiveAgentSuggestionSettings,
    resolveEffectiveDeleteActionSettings,
    restoreDockerSnapshotForTranscriptTurn,
    setChatAgentConfig,
    shouldAutoRenameChatOnPrompt,
    stopChatResponse,
    stopSingleDroneChatActivity,
    stopTranscriptPendingPrompts,
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
    fileExists,
    findDroneEntryByIdentity,
    findDroneIdByRef,
    formatPullHostBranchBeforeCreateError,
    getDroneRegistrySseLastSnapshot: () => droneRegistryBroadcaster.snapshot,
    gitPullHostBranchBeforeCreate,
    gitResolveRemoteBranchForCreate,
    isSafePromptId,
    loadCanonicalActiveModel,
    loadRegistry,
    logSlowHubRequest,
    makeDroneIdentity,
    normalizeChatName,
    normalizeChatReasoning,
    normalizeDroneDisplayName,
    normalizeDroneRuntime,
    normalizeSubmittedAtIso,
    nowIso,
    parseAgentPermissionModeForUpdate,
    parseChatModelForUpdate,
    parseCreateRuntime,
    parseDraftFlag,
    parsePersistVolume,
    parsePullHostBranchBeforeCreate,
    parseRemoteBranchName,
    parseRepoBranchSourceMode,
    parseSeedAgent,
    refreshDroneChatEventSnapshot,
    refreshDroneRegistryBroadcasterSnapshot,
    resolveDroneCliPath,
    resolveDroneOrRespond,
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

  const server = http.createServer(async (req, res) => {
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

      if (await handleRepositoryRoute({ req, res, url: u, method, parts })) return;

      if (await handleDroneLifecycleRoute({ req, res, url: u, method, parts })) return;

      // POST /api/drones/:id/terminal/open?mode=shell|agent&chat=<chatName>&cwd=/path&session=<name>&create=1
      // Opens (or reuses) a tmux-backed terminal session for in-app web terminal use.
      if (
        method === 'POST' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[4] === 'open'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const d = resolved.drone;
        const runtime = droneRuntime(d);
        const droneName = String(d?.name ?? droneRef).trim() || droneRef;

        const modeRaw = String(u.searchParams.get('mode') ?? 'shell')
          .trim()
          .toLowerCase();
        const mode: HubWebTerminalMode = modeRaw === 'agent' ? 'agent' : 'shell';
        const chatName = normalizeChatName(u.searchParams.get('chat') ?? 'default');
        const requestedSessionName = String(u.searchParams.get('session') ?? '').trim();
        const createNewShell = u.searchParams.get('create') === '1';
        const cwd = normalizeDroneUiCwdForRuntime(d, u.searchParams.get('cwd') ?? null);
        const regAny: any = await loadRegistry();
        const managedEnv = resolveDroneEnvironmentConfig(regAny, d).resolvedVars;
        const runtimeEnv = resolveContainerManagedEnvVars(d, managedEnv);
        const managedEnvLines = buildEnvExportLines(managedEnv);

        let shellSessionName = '';
        if (mode === 'agent') {
          if (createNewShell) {
            json(res, 400, {
              ok: false,
              error: 'agent terminal sessions cannot be created with create=1',
              id: droneId,
              name: droneName,
            });
            return;
          }
          if (requestedSessionName && requestedSessionName !== hubChatSessionName(chatName)) {
            json(res, 400, {
              ok: false,
              error: 'agent terminal session does not match the requested chat',
              id: droneId,
              name: droneName,
            });
            return;
          }
        } else {
          if (createNewShell && requestedSessionName) {
            json(res, 400, {
              ok: false,
              error: 'shell terminal open accepts either create=1 or session=<name>, not both',
              id: droneId,
              name: droneName,
            });
            return;
          }
          if (requestedSessionName) {
            if (
              !isSafeTmuxSessionName(requestedSessionName) ||
              !isHubShellSessionName(requestedSessionName)
            ) {
              json(res, 400, {
                ok: false,
                error: 'invalid shell terminal session name',
                id: droneId,
                name: droneName,
              });
              return;
            }
            shellSessionName = requestedSessionName;
          } else {
            shellSessionName = createNewShell ? createHubShellSessionName() : hubShellSessionName();
          }
        }

        try {
          if (shouldAwaitTerminalSkillSync(mode)) {
            await syncSkillLibraryForDrone({ droneId, droneEntry: d });
            await syncMcpServersForDrone({ droneId, droneEntry: d });
          }
          if (mode === 'agent') {
            await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: d });
          }
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(d);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            const sessionName = mode === 'agent' ? hubChatSessionName(chatName) : shellSessionName;
            if (mode === 'agent') await ensureChatEntry({ droneId, chatName });
            const agentCmd =
              mode === 'agent'
                ? await resolveChatTmuxCommand({ droneId, chatName })
                : resolveHostTerminalShellCommand(process.env);
            const launchScript = [
              'set -euo pipefail',
              ...managedEnvLines,
              `mkdir -p ${bashQuote(cwd)} 2>/dev/null || true`,
              `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
              `exec ${agentCmd}`,
            ].join('\n');
            try {
              await procStart(daemon.client, {
                session: sessionName,
                cmd: 'bash',
                args: ['-lc', launchScript],
                cwd,
                env: managedEnv,
                force: false,
                terminal: true,
              });
            } catch (e: any) {
              const msg = String(e?.message ?? e ?? '')
                .trim()
                .toLowerCase();
              if (msg.includes('already exists') || msg.includes('process already exists')) {
                // Reuse the existing session instead of restarting it and dropping user state.
              } else {
                throw e;
              }
            }
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              mode,
              chat: mode === 'agent' ? chatName : null,
              cwd,
              sessionName,
            });
            return;
          }

          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: d },
            async ({ containerName, droneEntry, droneId: lockedId }) => {
              const idForOps =
                normalizeDroneIdentity(lockedId) ||
                normalizeDroneIdentity((droneEntry as any)?.id) ||
                droneId;
              if (mode === 'agent') {
                try {
                  await upgradeDroneDaemonInContainer({
                    containerName,
                    containerPort: Number((droneEntry as any)?.containerPort ?? 7777),
                  });
                } catch {
                  // Best-effort daemon refresh; continue if upgrade fails.
                }
                await ensureChatEntry({ droneId: idForOps, chatName });
                const tmuxCmd = await resolveChatTmuxCommand({ droneId: idForOps, chatName });
                const { sessionName } = await ensureHubChatSessionRunning({
                  containerName,
                  chatName,
                  command: tmuxCmd,
                  cwd,
                  envVars: runtimeEnv,
                });
                json(res, 200, {
                  ok: true,
                  id: idForOps,
                  name: droneName,
                  mode,
                  chat: chatName,
                  cwd,
                  sessionName,
                });
                return;
              }

              const sessionName = shellSessionName;
              await ensureHubSessionRunning({
                containerName,
                sessionName,
                command: resolveHubTerminalShellCommand(),
                cwd,
                envVars: runtimeEnv,
              });
              json(res, 200, {
                ok: true,
                id: idForOps,
                name: droneName,
                mode,
                chat: null,
                cwd,
                sessionName,
              });
            },
          );
          return;
        } catch (e: any) {
          json(res, 500, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
            mode,
            chat: mode === 'agent' ? chatName : null,
          });
          return;
        }
      }

      // GET /api/drones/:id/terminal/:session/output?since=<bytes>&maxBytes=<bytes>&tail=<lines>
      // Read output from a tmux-backed terminal session.
      if (
        method === 'DELETE' &&
        parts.length === 5 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            await procStop(daemon.client, { session: sessionName });
            json(res, 200, { ok: true, id: droneId, name: droneName, sessionName });
            return;
          }

          await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: drone },
            async ({ containerName }) => {
              const cleanupScript = [
                'set -euo pipefail',
                `s=${bashQuote(sessionName)}`,
                'if tmux has-session -t "$s" 2>/dev/null; then',
                '  tmux kill-session -t "$s" 2>/dev/null || true',
                'fi',
                `rm -rf /dvm-data/dvm-sessions/${sessionName} /tmp/dvm-sessions/${sessionName} 2>/dev/null || true`,
              ].join('\n');
              const result = await dvmExec(containerName, 'bash', ['-lc', cleanupScript]);
              if (result.code !== 0) {
                throw new Error(
                  result.stderr ||
                    result.stdout ||
                    `failed to close terminal session ${sessionName}`,
                );
              }
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, sessionName });
          return;
        } catch (e: any) {
          json(res, 500, {
            ok: false,
            error: e?.message ?? String(e),
            id: droneId,
            name: droneName,
            sessionName,
          });
          return;
        }
      }

      if (
        method === 'GET' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'output'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const sinceRaw = u.searchParams.get('since');
        const maxBytesRaw = u.searchParams.get('maxBytes');
        const tailRaw = u.searchParams.get('tail');
        const viewRaw = String(u.searchParams.get('view') ?? 'log')
          .trim()
          .toLowerCase();
        const view = viewRaw === 'screen' ? 'screen' : 'log';
        const since = parseOptionalNonNegativeInt(sinceRaw);
        const maxBytes = clampIntParam(
          maxBytesRaw,
          HUB_WEB_TERMINAL_MAX_BYTES,
          1,
          HUB_WEB_TERMINAL_MAX_BYTES,
        );
        const tailLines = clampIntParam(
          tailRaw,
          HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES,
          0,
          HUB_WEB_TERMINAL_MAX_TAIL_LINES,
        );

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            const out = await droneTerminalOutput(daemon.client, {
              session: sessionName,
              view,
              since: since ?? 0,
              max: since != null ? maxBytes : Math.max(maxBytes, tailLines * 256),
              tail: tailLines,
            });
            json(res, 200, {
              ok: true,
              id: droneId,
              name: droneName,
              sessionName,
              view,
              offsetBytes: Number((out as any)?.nextOffset ?? 0),
              text: String((out as any)?.chunk ?? ''),
            });
            return;
          }

          const out = await withLockedDroneContainer(
            { requestedDroneName: droneName, droneEntry: drone },
            async ({ containerName }) => {
              if (view === 'screen') {
                const n = Math.max(
                  20,
                  Math.min(5000, tailLines || HUB_WEB_TERMINAL_DEFAULT_TAIL_LINES),
                );
                const screenScript = [
                  'set -euo pipefail',
                  `session=${JSON.stringify(sessionName)}`,
                  `n=${JSON.stringify(String(n))}`,
                  'tmux capture-pane -p -t "$session" -S "-$n" 2>/dev/null || tmux capture-pane -p -t "$session" 2>/dev/null || true',
                ].join('\n');
                const screenResult = await dvmExec(containerName, 'bash', ['-lc', screenScript]);
                if (screenResult.code !== 0) {
                  throw new Error(
                    (
                      screenResult.stderr ||
                      screenResult.stdout ||
                      'tmux capture-pane failed'
                    ).trim(),
                  );
                }
                const offset = await dvmSessionRead({
                  container: containerName,
                  session: sessionName,
                  since: Number.MAX_SAFE_INTEGER,
                  maxBytes: 1,
                });
                return { offsetBytes: offset.offsetBytes, text: screenResult.stdout || '' };
              }
              return await dvmSessionRead({
                container: containerName,
                session: sessionName,
                since,
                maxBytes: since != null ? maxBytes : undefined,
                tailLines: since != null ? undefined : tailLines,
              });
            },
          );
          json(res, 200, { ok: true, id: droneId, name: droneName, sessionName, view, ...out });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (isStaleDockerExecErrorMessage(msg)) {
            json(res, 409, {
              ok: false,
              code: 'STALE_TERMINAL_SESSION',
              error:
                'Terminal session was interrupted by a container restart. Reopen the terminal session.',
              detail: msg,
              id: droneId,
              name: droneName,
              sessionName,
            });
            return;
          }
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/terminal/:session/input
      // Sends raw text into a tmux-backed terminal session.
      if (
        method === 'POST' &&
        parts.length === 6 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'terminal' &&
        parts[5] === 'input'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const sessionName = decodeURIComponent(parts[4]);
        if (!isSafeTmuxSessionName(sessionName)) {
          json(res, 400, { ok: false, error: 'invalid session name' });
          return;
        }
        if (!isHubWebTerminalSessionName(sessionName)) {
          json(res, 404, { ok: false, error: 'unknown session', name: droneRef, sessionName });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        let body: any = null;
        try {
          body = await readJsonBody(req);
        } catch (e: any) {
          json(res, 400, { ok: false, error: e?.message ?? String(e) });
          return;
        }

        const data = typeof body?.data === 'string' ? body.data : '';
        if (!data) {
          json(res, 400, { ok: false, error: 'missing input data' });
          return;
        }
        if (Buffer.byteLength(data, 'utf8') > 128 * 1024) {
          json(res, 413, { ok: false, error: 'input too large' });
          return;
        }

        try {
          if (runtime === 'host') {
            const daemon = await resolveDroneDaemonClientForEntry(drone);
            if (!daemon) {
              json(res, 409, {
                ok: false,
                error: 'drone daemon not reachable (missing hostPort/token)',
                id: droneId,
                name: droneName,
                sessionName,
              });
              return;
            }
            await waitForDroneDaemonReady(daemon.client, defaultDaemonReadyTimeoutMs());
            await droneTerminalInput(daemon.client, { session: sessionName, data });
          } else {
            await withLockedDroneContainer(
              { requestedDroneName: droneName, droneEntry: drone },
              async ({ containerName }) => {
                await dvmSessionType(containerName, sessionName, { text: data });
              },
            );
          }
          json(res, 202, {
            ok: true,
            id: droneId,
            name: droneName,
            sessionName,
            bytes: Buffer.byteLength(data, 'utf8'),
          });
          return;
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          if (isStaleDockerExecErrorMessage(msg)) {
            json(res, 409, {
              ok: false,
              code: 'STALE_TERMINAL_SESSION',
              error:
                'Terminal session was interrupted by a container restart. Reopen the terminal session.',
              detail: msg,
              id: droneId,
              name: droneName,
              sessionName,
            });
            return;
          }
          const code = /Session not found:/i.test(msg) ? 404 : 500;
          json(res, code, { ok: false, error: msg, id: droneId, name: droneName, sessionName });
          return;
        }
      }

      // POST /api/drones/:id/open-terminal?mode=ssh|agent&chat=<chatName>
      // Opens a *real* terminal on the host machine (not a simulated web terminal).
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'open-terminal'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const modeRaw = String(u.searchParams.get('mode') ?? 'ssh')
          .trim()
          .toLowerCase();
        const mode = modeRaw === 'ssh' || modeRaw === 'agent' ? (modeRaw as 'ssh' | 'agent') : null;
        if (!mode) {
          json(res, 400, { ok: false, error: `invalid mode: ${modeRaw} (expected ssh|agent)` });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;
        const containerName =
          String((drone as any)?.containerName ?? (drone as any)?.name ?? droneId).trim() ||
          droneId;

        const chatName = String(u.searchParams.get('chat') ?? 'default').trim() || 'default';
        if (mode === 'agent') {
          await ensureChatEntry({ droneId, chatName });
        }
        await syncSkillLibraryForDrone({ droneId, droneEntry: drone });
        await syncMcpServersForDrone({ droneId, droneEntry: drone });
        await syncRepoAgentsInstructionsForDrone({ droneId, droneEntry: drone });

        // CLI-agnostic "continuation": keep one tmux session per chat.
        // This avoids relying on any CLI-specific resume flag.
        const sessionName = hubChatSessionName(chatName);
        const terminal = String(u.searchParams.get('terminal') ?? '').trim() || null;
        const markerBase =
          process.env.XDG_RUNTIME_DIR && process.env.XDG_RUNTIME_DIR.trim()
            ? process.env.XDG_RUNTIME_DIR.trim()
            : os.tmpdir();
        const markerPath = `${markerBase}/drone-hub-terminal-${process.pid}-${crypto.randomBytes(4).toString('hex')}.ok`;
        const markerSnippet = `printf %s ok > ${bashQuote(markerPath)}`;
        const agentCmd =
          mode === 'agent'
            ? await resolveChatTmuxCommand({ droneId, chatName })
            : resolveHubAgentCommand();
        const agentSessionEnv = [
          // Match non-tmux-ish colors as closely as possible.
          'export TERM=xterm-256color',
          'export COLORTERM=truecolor',
        ].join('; ');
        const containerSessionEnv = buildContainerManagedEnvLines(drone).join('; ');
        const cwd = normalizeDroneUiCwdForRuntime(drone, u.searchParams.get('cwd') ?? null);

        if (runtime === 'host') {
          const manualSshCmd = `cd ${shellQuoteIfNeeded(cwd)} && exec bash -i`;
          const manualAgentCmd = `cd ${shellQuoteIfNeeded(cwd)} && exec ${agentCmd}`;
          const manualCommand = mode === 'ssh' ? manualSshCmd : manualAgentCmd;
          const command =
            mode === 'ssh'
              ? [
                  'set +e',
                  markerSnippet,
                  `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
                  'exec bash -i',
                ].join('; ')
              : [
                  'set +e',
                  markerSnippet,
                  `cd ${bashQuote(cwd)} 2>/dev/null || cd /`,
                  `exec ${agentCmd}`,
                ].join('; ');
          const launched = await spawnTerminalWithBash(command, { terminal, markerPath });
          if (!launched.ok) {
            json(res, 500, {
              ok: false,
              error: launched.error,
              command,
              manualCommand,
              chat: chatName,
              sessionName,
              note: 'You can run this command manually in a terminal.',
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            mode,
            chat: chatName,
            sessionName,
            command,
            manualCommand,
            launcher: launched.launcher,
          });
          return;
        }

        const manualSshCmd = buildDockerExecShellCommand(containerName, cwd);
        const sshCmd = manualSshCmd;
        const agentAttachCmd = buildDockerExecTmuxAttachCommand(containerName, sessionName);
        let agentPrepError: string | null = null;
        if (mode === 'agent') {
          const agentShell = `set -e; ${containerSessionEnv}; ${agentSessionEnv}; mkdir -p ${bashQuote(cwd)} 2>/dev/null || true; cd ${bashQuote(cwd)} 2>/dev/null || cd /dvm-data; exec ${agentCmd}`;
          try {
            await dvmSessionStart(containerName, sessionName, 'bash', ['-lc', agentShell], true);
            const tmuxTuneCommands = [
              ['set-option', '-g', 'status', 'off'],
              ['set-window-option', '-g', 'remain-on-exit', 'off'],
              ['set-option', '-g', 'default-terminal', 'xterm-256color'],
              [
                'set-option',
                '-ga',
                'terminal-overrides',
                ',xterm-256color:Tc,screen-256color:Tc,screen:Tc,xterm-kitty:Tc',
              ],
              [
                'set-option',
                '-ga',
                'terminal-features',
                ',xterm-256color:RGB,screen-256color:RGB,xterm-kitty:RGB',
              ],
            ];
            for (const tmuxArgs of tmuxTuneCommands) {
              // Best-effort: ignore tuning failures and continue.
              // eslint-disable-next-line no-await-in-loop
              await dvmExec(containerName, 'tmux', tmuxArgs);
            }
          } catch (e: any) {
            agentPrepError = e?.message ?? String(e);
          }
        }
        const manualAgentCmd = `${agentAttachCmd} || ${manualSshCmd}`;

        const manualCommand = mode === 'ssh' ? manualSshCmd : manualAgentCmd;
        const command =
          mode === 'ssh'
            ? [
                'set +e',
                // Marker: prove that bash actually started (used by the launcher).
                markerSnippet,
                sshCmd,
                'code=$?',
                'echo',
                'echo "SSH exited with code $code"',
                'exec bash',
              ].join('; ')
            : [
                'set +e',
                markerSnippet,
                `echo "Attaching Agent session (${sessionName})..."`,
                agentPrepError
                  ? `echo ${bashQuote(`Warning: failed to prepare Agent session: ${agentPrepError}`)}`
                  : '',
                `${agentAttachCmd} || true`,
                'echo',
                'echo "If attach failed, you can run manually:"',
                `echo ${bashQuote(agentAttachCmd)}`,
                'echo',
                'echo "Falling back to a shell..."',
                sshCmd,
                'code=$?',
                'echo',
                'echo "Exited with code $code"',
                // Keep the terminal open after detach/exit.
                'exec bash',
              ]
                .filter(Boolean)
                .join('; ');

        const launched = await spawnTerminalWithBash(command, { terminal, markerPath });
        if (!launched.ok) {
          json(res, 500, {
            ok: false,
            error: launched.error,
            command,
            manualCommand,
            chat: chatName,
            sessionName,
            note: 'You can run this command manually in a terminal.',
          });
          return;
        }

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          mode,
          chat: chatName,
          sessionName,
          command,
          manualCommand,
          launcher: launched.launcher,
        });
        return;
      }

      // POST /api/drones/:id/open-editor?editor=code|cursor&cwd=/path
      // Opens a local editor attached to the docker container (VS Code Dev Containers style).
      if (
        method === 'POST' &&
        parts.length === 4 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'open-editor'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const editorRaw = String(u.searchParams.get('editor') ?? 'code')
          .trim()
          .toLowerCase();
        const editor =
          editorRaw === 'code' || editorRaw === 'cursor' ? (editorRaw as 'code' | 'cursor') : null;
        if (!editor) {
          json(res, 400, {
            ok: false,
            error: `invalid editor: ${editorRaw} (expected code|cursor)`,
          });
          return;
        }

        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        const droneId = resolved.id;
        const drone = resolved.drone;
        const runtime = droneRuntime(drone);
        const droneName = String(drone?.name ?? droneRef).trim() || droneRef;

        const cwd = normalizeDroneUiCwdForRuntime(drone, u.searchParams.get('cwd') ?? null);
        if (runtime === 'host') {
          const uri = `file://${encodeRemotePath(cwd)}`;
          const manualCommand = `${editor} ${shellQuoteIfNeeded(cwd)}`;
          const launched = await new Promise<
            { ok: true; launcher: string } | { ok: false; error: string }
          >((resolve) => {
            const child = spawn(editor, [cwd], {
              detached: true,
              stdio: 'ignore',
              env: process.env,
            });
            child.once('error', (err: any) =>
              resolve({ ok: false, error: err?.message ?? String(err) }),
            );
            child.once('spawn', () => {
              try {
                child.unref();
              } catch {
                // ignore
              }
              resolve({ ok: true, launcher: `${editor} ${cwd}` });
            });
          });
          if (!launched.ok) {
            json(res, 500, {
              ok: false,
              error: launched.error,
              uri,
              manualCommand,
              note: 'Install the editor and run the command manually.',
            });
            return;
          }
          json(res, 200, {
            ok: true,
            id: droneId,
            name: droneName,
            editor,
            cwd,
            uri,
            manualCommand,
            launcher: launched.launcher,
          });
          return;
        }

        const containerNameRaw = String(
          (drone as any)?.containerName ?? (drone as any)?.name ?? `drone-${droneId}`,
        ).trim();
        const id = await dockerContainerId(containerNameRaw);
        // Dev Containers "attached-container" URIs expect a hex-encoded JSON payload as the authority suffix.
        // If we pass a raw docker ID, the extension will try to decode it and we end up with a corrupted
        // container identifier (seen as "��..." in logs).
        const containerName = `/${containerNameRaw}`;
        const authorityJson = JSON.stringify({
          settingType: 'container',
          containerId: id,
          containerName,
        });
        const authority = hexEncodeUtf8(authorityJson);
        const uri = `vscode-remote://attached-container+${authority}${encodeRemotePath(cwd)}`;
        const manualCommand = `${editor} --folder-uri ${shellQuoteIfNeeded(uri)}`;

        const launched = await new Promise<
          { ok: true; launcher: string } | { ok: false; error: string }
        >((resolve) => {
          const child = spawn(editor, ['--folder-uri', uri], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
          child.once('error', (err: any) =>
            resolve({ ok: false, error: err?.message ?? String(err) }),
          );
          child.once('spawn', () => {
            try {
              child.unref();
            } catch {
              // ignore
            }
            resolve({ ok: true, launcher: `${editor} --folder-uri ${uri}` });
          });
        });

        if (!launched.ok) {
          json(res, 500, {
            ok: false,
            error: launched.error,
            uri,
            manualCommand,
            note: 'Install the editor and run the command manually.',
          });
          return;
        }

        json(res, 200, {
          ok: true,
          id: droneId,
          name: droneName,
          editor,
          cwd,
          uri,
          manualCommand,
          launcher: launched.launcher,
        });
        return;
      }

      if (await handleChatAutomationRoute({ req, res, url: u, method, parts })) return;

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
  });
  const httpSockets = new Set<any>();
  server.on('connection', (socket) => {
    httpSockets.add(socket);
    socket.on('close', () => {
      httpSockets.delete(socket);
    });
  });

  server.on(
    'upgrade',
    createTerminalWebSocketUpgradeHandler({
      apiToken,
      allowedOrigins,
      webSocketServer: wss,
      handleDeviceMeshUpgrade: (req, socket, head) =>
        deviceMesh.handleUpgrade(req, socket, head),
      isSafeSessionName: isSafeTmuxSessionName,
      parseSince: parseOptionalNonNegativeInt,
      parseMaxBytes: (raw) =>
        clampIntParam(raw, HUB_WEB_TERMINAL_MAX_BYTES, 1, HUB_WEB_TERMINAL_MAX_BYTES),
      resolveDrone: resolveDroneOrRejectUpgrade,
      resolveHostPort,
    }),
  );

  await new Promise<void>((resolve) => server.listen(opts.port, host, () => resolve()));
  const outboxDatabase = getHubDatabase();
  const hubOutboxDispatchLoop = outboxDatabase
    ? new HubOutboxDispatchLoop(
        new HubOutboxDispatcher(new HubOutboxRepository(outboxDatabase), async () => {
          // Canonical transactions only enqueue. Projection/SSE effects happen here,
          // after claim commit, and are coalesced by the existing refresh scheduler.
          notifyDroneRegistryWrite?.();
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
  void auditStartupRegistryPresence();
  startDroneStatusRefresher();
  scheduleDroneSummaryMaintenance('startup', 0);
  const address = server.address();
  actualPort = typeof address === 'object' && address ? address.port : opts.port;
  await deviceMesh.start();
  if (mcpToken && containerMcpHost && containerMcpActualPort > 0) {
    const mcpOnlyServer = http.createServer(async (req, res) => {
      try {
        const method = (req.method ?? 'GET').toUpperCase();
        const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (u.pathname !== '/mcp') {
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
    });
    mcpOnlyServer.on('connection', (socket) => {
      containerMcpSockets.add(socket);
      socket.on('close', () => {
        containerMcpSockets.delete(socket);
      });
    });
    try {
      await new Promise<void>((resolve, reject) => {
        mcpOnlyServer.once('error', reject);
        mcpOnlyServer.listen(containerMcpActualPort, containerMcpHost, () => resolve());
      });
    } catch (error) {
      await deviceMesh.close();
      await new Promise<void>((resolve) => server.close(() => resolve())).catch(() => {});
      throw error;
    }
    containerMcpServer = mcpOnlyServer;
    const mcpAddress = mcpOnlyServer.address();
    containerMcpActualPort =
      typeof mcpAddress === 'object' && mcpAddress ? mcpAddress.port : containerMcpActualPort;
    containerMcpActualUrl =
      containerMcpRequestedUrl || `http://host.docker.internal:${containerMcpActualPort}/mcp`;
    hubLog('info', 'container mcp listener started', {
      host: containerMcpHost,
      port: containerMcpActualPort,
      url: containerMcpActualUrl,
    });
  }
  setActiveDroneHubMcpProjectionConfig({
    signingSecret: mcpToken,
    hostUrl: `http://127.0.0.1:${actualPort}/mcp`,
    containerUrl: containerMcpActualUrl || `http://host.docker.internal:${actualPort}/mcp`,
  });

  return {
    host,
    port: actualPort,
    containerMcp:
      containerMcpServer && containerMcpActualUrl
        ? {
            host: containerMcpHost,
            port: containerMcpActualPort,
            url: containerMcpActualUrl,
          }
        : null,
    close: async () => {
      unsubscribeDeviceMeshAssistantChanges();
      await deviceMesh.close();
      await hubOutboxDispatchLoop?.stop();
      if (notifyDroneChatWrite === notifyCanonicalPromptQueueChatWrite) {
        notifyDroneChatWrite = null;
      }
      if (notifyDroneRegistryWrite === notifyCanonicalDroneRegistryWrite) {
        notifyDroneRegistryWrite = null;
      }
      if (notifyPromptAutomationLaneChange === notifyCanonicalPromptAutomationLaneChange) {
        notifyPromptAutomationLaneChange = null;
      }
      promptAutomationBroadcaster.close();
      if (activeDroneHubMcpProjectionConfig?.signingSecret === mcpToken) {
        activeDroneHubMcpProjectionConfig = null;
      }
      const waitWithTimeout = async (p: Promise<void>, timeoutMs: number): Promise<void> => {
        await Promise.race([
          p,
          new Promise<void>((resolve) => {
            setTimeout(() => resolve(), Math.max(1, Math.floor(timeoutMs)));
          }),
        ]);
      };
      try {
        wss.clients.forEach((c: WebSocket) => {
          try {
            c.close();
          } catch {
            // ignore
          }
          try {
            c.terminate();
          } catch {
            // ignore
          }
        });
      } catch {
        // ignore
      }
      await waitWithTimeout(
        new Promise<void>((resolve) => {
          try {
            wss.close(() => resolve());
          } catch {
            resolve();
          }
        }),
        1_000,
      );
      await mcpHttpTransport.close();
      const serverClose = new Promise<void>((resolve) => server.close(() => resolve()));
      const containerMcpServerClose = containerMcpServer
        ? new Promise<void>((resolve) => containerMcpServer?.close(() => resolve()))
        : Promise.resolve();
      try {
        (server as any).closeIdleConnections?.();
      } catch {
        // ignore
      }
      try {
        (containerMcpServer as any)?.closeIdleConnections?.();
      } catch {
        // ignore
      }
      for (const socket of httpSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      for (const socket of containerMcpSockets) {
        try {
          socket.destroy();
        } catch {
          // ignore
        }
      }
      await waitWithTimeout(serverClose, 3_000);
      await waitWithTimeout(containerMcpServerClose, 3_000);
      if (ARCHIVE_CLEANUP_INTERVAL) {
        try {
          clearInterval(ARCHIVE_CLEANUP_INTERVAL);
        } catch {
          // ignore
        }
        ARCHIVE_CLEANUP_INTERVAL = null;
      }
      if (PLAYBOOK_RUN_QUEUE_INTERVAL) {
        try {
          clearInterval(PLAYBOOK_RUN_QUEUE_INTERVAL);
        } catch {
          // ignore
        }
        PLAYBOOK_RUN_QUEUE_INTERVAL = null;
      }
      if (droneStatusRefreshTimer) {
        try {
          clearInterval(droneStatusRefreshTimer);
        } catch {
          // ignore
        }
        droneStatusRefreshTimer = null;
      }
      if (droneStatusRefreshTimeout) {
        try {
          clearTimeout(droneStatusRefreshTimeout);
        } catch {
          // ignore
        }
        droneStatusRefreshTimeout = null;
      }
      if (droneSummaryMaintenanceTimeout) {
        try {
          clearTimeout(droneSummaryMaintenanceTimeout);
        } catch {
          // ignore
        }
        droneSummaryMaintenanceTimeout = null;
      }
      droneStatusRefreshBusy = false;
      chatReconciliationQueue.clearRetries();
      daemonPromptEventMonitor.close();
      chatStateMaintenanceScheduler.close();
      agentFollowupCoordinator.clear();
    },
  };
}
