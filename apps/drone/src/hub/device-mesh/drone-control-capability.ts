import { DRONE_CONTROL_CAPABILITY, MESH_BINARY_CHUNK_BYTES } from '@drone/device-protocol';
import {
  filterCompletedPendingPrompts,
  isSendInNewChatQueueAction,
  normalizePendingPromptState,
} from '@drone/assistant-chat';
import type { CapabilityHandler } from './device-mesh-types';
import {
  scheduleCreatedDroneAutoRename,
  type CreatedDroneAutoRenameOperations,
} from './auto-rename-created-drone';
import {
  boundedDroneChatPage,
  compactAgentPlanForMesh,
  compactAgentRunActivityForMesh,
  compactAgentRunFileChangesForMesh,
} from './drone-chat-page';
import { isLikelyImagePath, isLikelyVideoPath } from '../filesystem-media';
import { localHubRequest, type LocalHubAccess } from './local-hub-request';
import { meshJsonContentChunk } from './mesh-content-chunk';
import type { MeshChatAttachmentStore } from './mesh-chat-attachment-store';
import { compactNativeChatReadResponse } from './native-chat-response';
import { submitNativeChatPrompt } from './native-chat-prompt';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw Object.assign(new Error(`${label} is required`), { code: 'INVALID_REQUEST' });
  return result;
}

function normalizedGroupPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function groupPathContains(pathRaw: unknown, parentRaw: unknown): boolean {
  const path = normalizedGroupPath(pathRaw);
  const parent = normalizedGroupPath(parentRaw);
  return Boolean(path && parent && (path === parent || path.startsWith(`${parent}/`)));
}

function groupBaseName(value: unknown): string {
  return normalizedGroupPath(value).split('/').filter(Boolean).at(-1) ?? '';
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const result = String(value ?? '').trim();
    if (result) return result;
  }
  return '';
}

function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item ?? '').trim()).filter(Boolean))];
}

function textListMap(value: unknown): Record<string, string[]> {
  const source = object(value);
  return Object.fromEntries(
    Object.entries(source)
      .map(([key, items]) => [key.trim(), textList(items)] as const)
      .filter(([key, items]) => Boolean(key && items.length)),
  );
}

function optionalText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.trim() || undefined;
}

function truncateUtf8(value: unknown, maxBytes: number): string {
  const source = String(value ?? '');
  const bytes = Buffer.from(source);
  if (bytes.length <= maxBytes) return source;
  return `${bytes
    .subarray(0, Math.max(0, maxBytes - 3))
    .toString('utf8')
    .replace(/\uFFFD+$/u, '')}…`;
}

function compactPendingPrompts(value: unknown): any[] {
  const prompts = Array.isArray(value) ? value.slice(-50) : [];
  const promptLimit = Math.max(160, Math.floor(8_000 / Math.max(1, prompts.length)));
  const errorLimit = Math.max(80, Math.floor(4_000 / Math.max(1, prompts.length)));
  return prompts.map((prompt: any) => {
    const attachments = Array.isArray(prompt?.attachments) ? prompt.attachments : [];
    const startedAt = optionalText(prompt?.startedAt);
    const compactedActivity = compactAgentRunActivityForMesh(prompt?.activity);
    const agentPlan = compactAgentPlanForMesh(prompt?.agentPlan);
    const fileChanges = compactAgentRunFileChangesForMesh(prompt?.fileChanges);
    return {
      id: String(prompt?.id ?? '').slice(0, 160),
      at: String(prompt?.at ?? ''),
      ...(startedAt ? { startedAt } : {}),
      prompt: truncateUtf8(prompt?.prompt, promptLimit),
      state: normalizePendingPromptState(prompt?.state, 'queued'),
      ...(isSendInNewChatQueueAction(prompt?.action) ? { action: prompt.action } : {}),
      ...(prompt?.error ? { error: truncateUtf8(prompt.error, errorLimit) } : {}),
      attachmentCount: attachments.length,
      imageCount: attachments.filter((attachment: any) =>
        String(attachment?.mime ?? '').startsWith('image/'),
      ).length,
      ...(agentPlan ? { agentPlan } : {}),
      ...(fileChanges ? { fileChanges } : {}),
      ...(compactedActivity.activity ? { activity: compactedActivity.activity } : {}),
      ...(compactedActivity.truncated ? { activityMeshTruncated: true } : {}),
      updatedAt: String(prompt?.updatedAt ?? ''),
    };
  });
}

const CREATE_REPO_BRANCH_PAGE_SIZE = 500;
const CREATE_REPO_BRANCH_PAGE_BYTES = 160 * 1024;
const MOBILE_FILE_MEDIA_MAX_BYTES = 32 * 1024 * 1024;
const MOBILE_FILE_WRITE_MAX_BYTES = 180 * 1024;
const MOBILE_RUN_DIFF_MAX_BYTES = 80 * 1024;

function compactCreateRepoBranch(branch: unknown) {
  const entry = object(branch);
  const name = truncateUtf8(entry.name, 600);
  if (!name) return null;
  return {
    name,
    remote: truncateUtf8(entry.remote, 200),
    branch: truncateUtf8(entry.branch, 600) || name,
  };
}

function compactChatSubscriptions(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const subscriptions = value.flatMap((subscription) => {
    const entry = object(subscription);
    const id = truncateUtf8(entry.id, 160).trim();
    const resourceId = truncateUtf8(entry.resourceId, 800).trim();
    if (!id || !resourceId || entry.status !== 'active') return [];
    const provider = entry.provider === 'github' ? 'github' : 'drone-hub';
    const resourceType = ['chat', 'repository', 'pull_request', 'cron'].includes(
      String(entry.resourceType),
    )
      ? String(entry.resourceType)
      : 'chat';
    const resourceConfig = object(entry.resourceConfig);
    return [
      {
        id,
        provider,
        resourceType,
        resourceId,
        ...(resourceType === 'cron'
          ? {
              resourceConfig: {
                expression: truncateUtf8(resourceConfig.expression, 200).trim(),
                description: truncateUtf8(resourceConfig.description, 500).trim(),
                timeZone: truncateUtf8(resourceConfig.timeZone, 100).trim() || 'UTC',
              },
              nextEventAt: truncateUtf8(entry.nextEventAt, 100).trim() || null,
            }
          : {}),
        events: textList(entry.events)
          .slice(0, 20)
          .map((event) => truncateUtf8(event, 160)),
        intent: truncateUtf8(entry.intent, 2_000).trim(),
        status: 'active',
      },
    ];
  });
  return subscriptions.slice(0, 50);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : Number.NaN;
  if (!Number.isSafeInteger(normalized) || normalized <= 0)
    throw Object.assign(new Error(`${label} must be a positive integer`), {
      code: 'INVALID_REQUEST',
    });
  return normalized;
}

function seedAgent(value: unknown): Record<string, string> | undefined {
  const agent = object(value);
  const kind =
    agent.kind === 'native' || agent.kind === 'builtin' || agent.kind === 'custom'
      ? agent.kind
      : '';
  if (kind === 'native') return { kind };
  const id = optionalText(agent.id);
  if (!kind || !id) return undefined;
  if (kind === 'builtin') return { kind, id };
  const label = optionalText(agent.label);
  const command = optionalText(agent.command);
  return label && command ? { kind, id, label, command } : undefined;
}

export function deviceMeshDroneSummary(drone: any) {
  const chats = Array.isArray(drone?.chats)
    ? drone.chats
    : drone?.chats && typeof drone.chats === 'object'
      ? Object.keys(drone.chats)
      : [];
  return {
    id: String(drone?.id ?? drone?.name ?? ''),
    name: String(drone?.name ?? drone?.id ?? ''),
    runtime: String(drone?.runtime ?? 'container'),
    phase: String(drone?.phase ?? drone?.hubPhase ?? drone?.hub?.phase ?? ''),
    status: String(drone?.status ?? drone?.hubMessage ?? ''),
    group: drone?.group ?? null,
    repoPath: firstText(
      drone?.repoPath,
      drone?.repositoryPath,
      drone?.repo?.path,
      drone?.repo?.hostPath,
      drone?.repo?.dest,
    ),
    repoBranch: firstText(drone?.repoBranch, drone?.repo?.branch) || null,
    cwd: firstText(drone?.cwd, drone?.workingDirectory),
    repoAttached: Boolean(
      drone?.repoAttached ??
      firstText(
        drone?.repoPath,
        drone?.repositoryPath,
        drone?.repo?.path,
        drone?.repo?.hostPath,
        drone?.repo?.dest,
      ),
    ),
    fleetParentId: String(drone?.fleetParentId ?? '').trim() || null,
    chats: chats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean),
    draftChats:
      drone?.draftChats && typeof drone.draftChats === 'object' && !Array.isArray(drone.draftChats)
        ? Object.fromEntries(
            Object.entries(drone.draftChats).filter(
              ([chatName, draft]) => Boolean(String(chatName).trim()) && draft === true,
            ),
          )
        : {},
    busyChats: Array.isArray(drone?.busyChats)
      ? drone.busyChats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
      : [],
    approvalChats: Array.isArray(drone?.approvalChats)
      ? drone.approvalChats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
      : [],
    approvalRequired:
      drone?.approvalRequired === true ||
      (Array.isArray(drone?.approvalChats) && drone.approvalChats.length > 0),
    unreadChats: Array.isArray(drone?.unreadChats)
      ? drone.unreadChats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
      : [],
    chatReadStates:
      drone?.chatReadStates && typeof drone.chatReadStates === 'object' ? drone.chatReadStates : {},
    createdAt: String(drone?.createdAt ?? ''),
    lastActivityAt: String(drone?.lastActivityAt ?? ''),
    lastMessageAt: String(drone?.lastMessageAt ?? ''),
    statusOk: drone?.statusOk !== false,
    statusError: String(drone?.statusError ?? '').trim() || null,
    draft:
      drone?.draft === true ||
      String(drone?.phase ?? drone?.hubPhase ?? drone?.hub?.phase ?? '')
        .trim()
        .toLowerCase() === 'draft',
  };
}

export function createDroneControlCapability(
  access: LocalHubAccess,
  chatAttachments?: MeshChatAttachmentStore,
  options?: {
    createdDroneAutoRename?: CreatedDroneAutoRenameOperations;
    broadcastFileChange?: (
      payload: Record<string, any>,
      targetDeviceIds: string[],
    ) => void | Promise<void>;
  },
): CapabilityHandler {
  type FileWatch = {
    droneId: string;
    path: string;
    subscribers: Map<string, Set<string>>;
    revision: string | null;
    size: number;
    mtimeMs: number | null;
    lastHashAt: number;
    busy: boolean;
    timer: ReturnType<typeof setInterval>;
  };
  const fileWatches = new Map<string, FileWatch>();
  const fileWatchStarts = new Map<string, Promise<FileWatch>>();
  let closed = false;
  const stopWatch = (key: string) => {
    const watch = fileWatches.get(key);
    if (!watch) return;
    clearInterval(watch.timer);
    fileWatches.delete(key);
  };
  const readFileMetadata = async (droneId: string, filePath: string, includeRevision: boolean) =>
    await localHubRequest(
      access,
      `/api/drones/${encodeURIComponent(droneId)}/fs/file?path=${encodeURIComponent(filePath)}&metadata=1&revision=${includeRevision ? '1' : '0'}`,
    );
  const getOrCreateFileWatch = async (
    watchKey: string,
    droneId: string,
    filePath: string,
  ): Promise<FileWatch> => {
    const existing = fileWatches.get(watchKey);
    if (existing) return existing;
    const pending = fileWatchStarts.get(watchKey);
    if (pending) return await pending;
    if (fileWatches.size + fileWatchStarts.size >= 128) {
      throw Object.assign(new Error('too many active file watches'), {
        code: 'RESOURCE_LIMIT',
      });
    }
    const start = (async () => {
      const metadata = await readFileMetadata(droneId, filePath, true);
      if (closed) {
        throw Object.assign(new Error('drone control capability is closed'), {
          code: 'CAPABILITY_CLOSED',
        });
      }
      const timer = setInterval(() => void pollWatch(watchKey), 2_000);
      timer.unref?.();
      const watch: FileWatch = {
        droneId,
        path: filePath,
        subscribers: new Map(),
        revision: optionalText(metadata?.revision) ?? null,
        size: Number.isFinite(Number(metadata?.size))
          ? Math.max(0, Math.floor(Number(metadata.size)))
          : 0,
        mtimeMs: Number.isFinite(Number(metadata?.mtimeMs)) ? Number(metadata.mtimeMs) : null,
        lastHashAt: Date.now(),
        busy: false,
        timer,
      };
      fileWatches.set(watchKey, watch);
      return watch;
    })();
    fileWatchStarts.set(watchKey, start);
    try {
      return await start;
    } finally {
      if (fileWatchStarts.get(watchKey) === start) fileWatchStarts.delete(watchKey);
    }
  };
  const pollWatch = async (key: string) => {
    const watch = fileWatches.get(key);
    if (!watch || watch.busy) return;
    watch.busy = true;
    try {
      const fingerprint = await readFileMetadata(watch.droneId, watch.path, false);
      if (fileWatches.get(key) !== watch) return;
      const nextSize = Number.isFinite(Number(fingerprint?.size))
        ? Math.max(0, Math.floor(Number(fingerprint.size)))
        : 0;
      const nextMtimeMs = Number.isFinite(Number(fingerprint?.mtimeMs))
        ? Number(fingerprint.mtimeMs)
        : null;
      const fingerprintChanged = nextSize !== watch.size || nextMtimeMs !== watch.mtimeMs;
      watch.size = nextSize;
      watch.mtimeMs = nextMtimeMs;
      if (!fingerprintChanged && Date.now() - watch.lastHashAt < 30_000) return;
      const metadata = await readFileMetadata(watch.droneId, watch.path, true);
      if (fileWatches.get(key) !== watch) return;
      watch.lastHashAt = Date.now();
      const revision = optionalText(metadata?.revision) ?? null;
      if (revision && watch.revision && revision !== watch.revision) {
        watch.revision = revision;
        await options?.broadcastFileChange?.(
          {
            droneId: watch.droneId,
            path: optionalText(metadata?.path) ?? watch.path,
            revision,
            size: Number(metadata?.size) || 0,
            mtimeMs: Number.isFinite(Number(metadata?.mtimeMs)) ? Number(metadata.mtimeMs) : null,
            kind: 'changed',
          },
          [...watch.subscribers.keys()],
        );
      } else if (revision) {
        watch.revision = revision;
      }
    } catch (error: any) {
      const message = String(error?.message ?? error);
      if (/not found|not-file|ENOENT/i.test(message) && watch.revision !== 'deleted') {
        watch.revision = 'deleted';
        watch.size = -1;
        watch.mtimeMs = null;
        watch.lastHashAt = 0;
        await options?.broadcastFileChange?.(
          {
            droneId: watch.droneId,
            path: watch.path,
            revision: null,
            kind: 'deleted',
          },
          [...watch.subscribers.keys()],
        );
      }
    } finally {
      watch.busy = false;
    }
  };
  return {
    descriptor: DRONE_CONTROL_CAPABILITY,
    async invoke(operation, rawPayload, context) {
      const payload = object(rawPayload);
      if (operation === 'drones.list') {
        const createModelAgent = optionalText(payload.createModelAgent);
        if (createModelAgent) {
          if (createModelAgent === 'native') {
            const createModelCatalog = await localHubRequest(
              access,
              '/api/model-catalog?agent=native',
            );
            return {
              schemaVersion: 6,
              createModelCatalog,
            };
          }
          const runtime = payload.createModelRuntime === 'host' ? 'host' : 'container';
          const refresh = payload.refreshCreateModels === true ? '&refresh=1' : '';
          const createModelCatalog = await localHubRequest(
            access,
            `/api/model-catalog?agent=${encodeURIComponent(createModelAgent)}&runtime=${runtime}${refresh}`,
          );
          return { schemaVersion: 5, createModelCatalog };
        }
        const createRepoPath = optionalText(payload.createRepoPath);
        if (createRepoPath) {
          const reposResult = await localHubRequest(access, '/api/repos');
          const registeredRepoPaths = textList(
            Array.isArray(reposResult.repos)
              ? reposResult.repos.map((repo: unknown) => object(repo).path)
              : [],
          );
          if (!registeredRepoPaths.includes(createRepoPath)) {
            throw Object.assign(new Error('repository is not registered on this Hub'), {
              code: 'INVALID_REQUEST',
            });
          }
          const requestedCursor = Number(payload.createRepoCursor);
          const cursor =
            Number.isSafeInteger(requestedCursor) && requestedCursor >= 0 ? requestedCursor : 0;
          try {
            const result = await localHubRequest(
              access,
              `/api/repos/branches?repoPath=${encodeURIComponent(createRepoPath)}`,
            );
            const branches = Array.isArray(result.remoteBranches) ? result.remoteBranches : [];
            const remoteBranches: NonNullable<ReturnType<typeof compactCreateRepoBranch>>[] = [];
            let pageBytes = 0;
            let nextIndex = cursor;
            while (
              nextIndex < branches.length &&
              remoteBranches.length < CREATE_REPO_BRANCH_PAGE_SIZE
            ) {
              const branch = compactCreateRepoBranch(branches[nextIndex]);
              nextIndex += 1;
              if (!branch) continue;
              const branchBytes = Buffer.byteLength(JSON.stringify(branch));
              if (
                remoteBranches.length > 0 &&
                pageBytes + branchBytes > CREATE_REPO_BRANCH_PAGE_BYTES
              ) {
                nextIndex -= 1;
                break;
              }
              remoteBranches.push(branch);
              pageBytes += branchBytes;
            }
            const nextCursor = nextIndex < branches.length ? nextIndex : null;
            return {
              schemaVersion: 6,
              createRepo: {
                path: createRepoPath,
                hostBranch: optionalText(result.hostBranch) ?? null,
                remoteBranches,
                branchesError: null,
                branchesLoaded: nextCursor === null,
                nextCursor,
              },
            };
          } catch (error: any) {
            return {
              schemaVersion: 6,
              createRepo: {
                path: createRepoPath,
                hostBranch: null,
                remoteBranches: [],
                branchesError: truncateUtf8(
                  error?.message ?? error ?? 'Failed to load branches.',
                  4_000,
                ),
                branchesLoaded: true,
                nextCursor: null,
              },
            };
          }
        }
        const [
          dronesRequest,
          reposRequest,
          groupsRequest,
          preferencesRequest,
          deleteSettingsRequest,
        ] = await Promise.allSettled([
          localHubRequest(access, '/api/drones'),
          localHubRequest(access, '/api/repos'),
          localHubRequest(access, '/api/groups'),
          localHubRequest(access, '/api/settings/ui-preferences'),
          localHubRequest(access, '/api/settings/delete-action'),
        ]);
        if (dronesRequest.status === 'rejected') throw dronesRequest.reason;
        const result = dronesRequest.value;
        const reposResult = reposRequest.status === 'fulfilled' ? reposRequest.value : {};
        const groupsResult = groupsRequest.status === 'fulfilled' ? groupsRequest.value : {};
        const preferencesResult =
          preferencesRequest.status === 'fulfilled' ? preferencesRequest.value : {};
        const deleteSettingsResult =
          deleteSettingsRequest.status === 'fulfilled' ? deleteSettingsRequest.value : {};
        const sidebarSnapshotComplete =
          reposRequest.status === 'fulfilled' &&
          groupsRequest.status === 'fulfilled' &&
          preferencesRequest.status === 'fulfilled';
        const drones: ReturnType<typeof deviceMeshDroneSummary>[] = Array.isArray(result.drones)
          ? result.drones.map(deviceMeshDroneSummary)
          : [];
        const preferences = object(preferencesResult.uiPreferences);
        const deleteMode =
          object(deleteSettingsResult.deleteAction).mode === 'archive' ? 'archive' : 'permanent';
        const groups: unknown[] = Array.isArray(groupsResult.groups) ? groupsResult.groups : [];
        const repoPaths = textList(
          Array.isArray(reposResult.repos)
            ? reposResult.repos.map((repo: unknown) => object(repo).path)
            : [],
        );
        const createRepos =
          payload.includeCreateOptions === true
            ? repoPaths.map((path) => ({
                path,
                hostBranch: null,
                remoteBranches: [],
                branchesError: null,
                branchesLoaded: false,
              }))
            : [];
        return {
          schemaVersion: 7,
          deleteMode,
          drones,
          repoPathByDroneId: Object.fromEntries(
            drones
              .map((drone) => [drone.id, drone.repoPath] as const)
              .filter(([droneId, repoPath]) => Boolean(droneId && repoPath)),
          ),
          sidebar: {
            snapshotComplete: sidebarSnapshotComplete,
            preferenceVersion:
              Number.isSafeInteger(preferencesResult.version) &&
              Number(preferencesResult.version) >= 0
                ? Number(preferencesResult.version)
                : null,
            preferenceUpdatedAt:
              typeof preferencesResult.updatedAt === 'string'
                ? preferencesResult.updatedAt.trim() || null
                : null,
            registeredRepoPaths: repoPaths,
            groupCreatedAtByName: Object.fromEntries(
              groups
                .map((group: unknown) => {
                  const entry = object(group);
                  const name = String(entry.name ?? '').trim();
                  const createdAt = String(entry.createdAt ?? '').trim();
                  return [name, createdAt || null] as const;
                })
                .filter(([name]) => Boolean(name)),
            ),
            sidebarGroupOrder: textList(preferences.sidebarGroupOrder),
            sidebarDroneOrderByGroup: textListMap(preferences.sidebarDroneOrderByGroup),
            sidebarNodeOrderByParent: textListMap(preferences.sidebarNodeOrderByParent),
            sidebarChatOrderByDrone: textListMap(preferences.sidebarChatOrderByDrone),
            pinnedDroneIds: textList(preferences.pinnedDroneIds),
          },
          ...(payload.includeCreateOptions === true
            ? { createOptions: { repos: createRepos } }
            : {}),
        };
      }

      if (operation === 'drone.create.container' || operation === 'drone.create.host') {
        const agent = seedAgent(payload.seedAgent);
        const requestedName = optionalText(payload.name);
        const autoRenamePrompt =
          payload.autoRename === true
            ? (optionalText(payload.autoRenamePrompt) ?? optionalText(payload.seedPrompt))
            : undefined;
        const repoBranchSource = payload.repoBranchSource === 'remote' ? 'remote' : 'host';
        const createPayload = {
          name: requestedName,
          group: optionalText(payload.group),
          repoPath: optionalText(payload.repoPath),
          runtime: operation.endsWith('.host') ? 'host' : 'container',
          ...(payload.draft === true ? { draft: true } : {}),
          ...(typeof payload.persistVolume === 'boolean'
            ? { persistVolume: payload.persistVolume }
            : {}),
          repoBranchSource,
          ...(repoBranchSource === 'remote'
            ? { remoteBranch: optionalText(payload.remoteBranch) }
            : {}),
          ...(agent ? { seedAgent: agent, seedChat: 'default' } : {}),
          ...(agent?.kind === 'native' && optionalText(payload.seedProvider)
            ? { seedProvider: optionalText(payload.seedProvider) }
            : {}),
          ...(optionalText(payload.seedModel)
            ? { seedModel: optionalText(payload.seedModel) }
            : {}),
          ...(optionalText(payload.seedReasoning)
            ? { seedReasoning: optionalText(payload.seedReasoning) }
            : {}),
          ...(payload.seedAgentPermissionMode === 'read-only' ||
          payload.seedAgentPermissionMode === 'workspace-write'
            ? { seedAgentPermissionMode: payload.seedAgentPermissionMode }
            : {}),
          ...(payload.seedApprovalPolicy === 'agent-decides' ||
          payload.seedApprovalPolicy === 'never'
            ? { seedApprovalPolicy: payload.seedApprovalPolicy }
            : {}),
          ...(optionalText(payload.seedPrompt)
            ? {
                seedPrompt: optionalText(payload.seedPrompt),
                seedSubmittedAt: optionalText(payload.seedSubmittedAt) ?? new Date().toISOString(),
              }
            : {}),
        };
        const created = await localHubRequest(access, '/api/drones', {
          method: 'POST',
          body: JSON.stringify(createPayload),
        });
        const createdDroneId = firstText(created?.id, created?.droneId, created?.drone?.id);
        if (
          !requestedName &&
          autoRenamePrompt &&
          createdDroneId &&
          options?.createdDroneAutoRename
        ) {
          const createdDroneName = firstText(created?.name, created?.drone?.name);
          scheduleCreatedDroneAutoRename(
            options.createdDroneAutoRename,
            createdDroneId,
            autoRenamePrompt,
            createdDroneName,
          );
          return { ...created, autoRenameScheduled: true };
        }
        return created;
      }

      if (operation === 'sidebar.order.update') {
        const current = await localHubRequest(access, '/api/settings/ui-preferences');
        const currentPreferences = object(current.uiPreferences);
        const sidebar = object(payload.sidebar);
        const nextPreferences = {
          ...currentPreferences,
          ...(Object.prototype.hasOwnProperty.call(sidebar, 'sidebarNodeOrderByParent')
            ? { sidebarNodeOrderByParent: textListMap(sidebar.sidebarNodeOrderByParent) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(sidebar, 'sidebarChatOrderByDrone')
            ? { sidebarChatOrderByDrone: textListMap(sidebar.sidebarChatOrderByDrone) }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(sidebar, 'pinnedDroneIds')
            ? { pinnedDroneIds: textList(sidebar.pinnedDroneIds) }
            : {}),
        };
        const expectedVersion = Number(payload.expectedVersion);
        return await localHubRequest(access, '/api/settings/ui-preferences', {
          method: 'POST',
          body: JSON.stringify({
            uiPreferences: nextPreferences,
            ...(Number.isSafeInteger(expectedVersion) && expectedVersion > 0
              ? { expectedVersion }
              : {}),
          }),
        });
      }

      if (operation === 'sidebar.item.move') {
        const itemKind = requiredText(payload.itemKind, 'itemKind');
        const repoPath = optionalText(payload.repoPath) ?? '';
        const targetGroup = optionalText(payload.targetGroup);
        if (itemKind === 'drone') {
          const droneId = requiredText(payload.droneId, 'droneId');
          const result = await localHubRequest(access, '/api/drones/group-set', {
            method: 'POST',
            body: JSON.stringify({ droneIds: [droneId], group: targetGroup ?? null }),
          });
          const rejected = Array.isArray(result.rejected) ? result.rejected : [];
          if (rejected.length > 0) {
            throw Object.assign(
              new Error(String(object(rejected[0]).error ?? 'drone could not be moved')),
              { code: 'OPERATION_FAILED' },
            );
          }
          return result;
        }
        if (itemKind !== 'folder') {
          throw Object.assign(new Error('itemKind must be drone or folder'), {
            code: 'INVALID_REQUEST',
          });
        }
        const sourceGroup = requiredText(payload.sourceGroup, 'sourceGroup');
        if (
          targetGroup != null &&
          (sourceGroup === targetGroup || groupPathContains(targetGroup, sourceGroup))
        ) {
          throw Object.assign(new Error('cannot move a group into itself or its subtree'), {
            code: 'INVALID_REQUEST',
          });
        }
        const nextGroup = normalizedGroupPath(
          targetGroup ? `${targetGroup}/${groupBaseName(sourceGroup)}` : groupBaseName(sourceGroup),
        );
        return await localHubRequest(
          access,
          `/api/groups/${encodeURIComponent(sourceGroup)}/rename`,
          {
            method: 'POST',
            body: JSON.stringify({ repoPath, newName: nextGroup }),
          },
        );
      }

      const droneId = requiredText(payload.droneId, 'droneId');
      const encodedDrone = encodeURIComponent(droneId);
      if (operation === 'drone.rename') {
        const newName = requiredText(payload.newName, 'newName');
        return await localHubRequest(access, `/api/drones/${encodedDrone}/rename`, {
          method: 'POST',
          body: JSON.stringify({ newName, source: 'drone-hub-mobile' }),
        });
      }
      if (operation === 'drone.pin.update') {
        return await localHubRequest(access, '/api/settings/ui-preferences/pinned-drones', {
          method: 'POST',
          body: JSON.stringify({ droneId, pinned: payload.pinned === true }),
        });
      }
      if (operation === 'drone.delete') {
        // Do not guess for a destructive operation. Falling back to permanent deletion when the
        // settings request fails can bypass an explicitly configured archive policy.
        const settings = await localHubRequest(access, '/api/settings/delete-action');
        const deleteMode =
          object(settings.deleteAction).mode === 'archive' ? 'archive' : 'permanent';
        await localHubRequest(
          access,
          deleteMode === 'archive'
            ? `/api/drones/${encodedDrone}/archive`
            : `/api/drones/${encodedDrone}`,
          { method: deleteMode === 'archive' ? 'POST' : 'DELETE' },
        );
        return { deleted: true, droneId };
      }
      if (operation === 'chats.list') {
        const result = await localHubRequest(access, `/api/drones/${encodedDrone}/chats`);
        return {
          droneId,
          chats: result.chats ?? [],
          unreadChats: result.unreadChats ?? [],
          chatReadStates: result.chatReadStates ?? {},
        };
      }
      if (operation === 'chat.create') {
        const queuedActionId = optionalText(payload.queuedActionId);
        if (queuedActionId) {
          const sourceChatName =
            optionalText(payload.sourceChatName ?? payload.chatName) ?? 'default';
          return await localHubRequest(
            access,
            `/api/drones/${encodedDrone}/chats/${encodeURIComponent(sourceChatName)}/pending/${encodeURIComponent(queuedActionId)}/create-now`,
            { method: 'POST', body: '{}' },
          );
        }
        const chatName = requiredText(payload.name ?? payload.chatName, 'chatName');
        const copyFrom = optionalText(payload.copyFrom ?? payload.copyFromChat);
        const result = await localHubRequest(access, `/api/drones/${encodedDrone}/chats`, {
          method: 'POST',
          body: JSON.stringify({ name: chatName, ...(copyFrom ? { copyFrom } : {}) }),
        });
        return {
          droneId,
          chatName: optionalText(result.chat) ?? chatName,
          chats: Array.isArray(result.chats) ? result.chats : [],
        };
      }
      if (operation === 'chat.rename') {
        const chatName = requiredText(payload.chatName, 'chatName');
        const newName = requiredText(payload.newName, 'newName');
        return await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}/rename`,
          { method: 'POST', body: JSON.stringify({ newName }) },
        );
      }
      if (operation === 'chat.delete') {
        const chatName = requiredText(payload.chatName, 'chatName');
        return await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}`,
          { method: 'DELETE' },
        );
      }
      if (operation === 'repo.pull-requests.read') {
        const state =
          payload.state === 'open' || payload.state === 'closed' ? payload.state : 'all';
        return await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/repo/pull-requests?state=${state}`,
        );
      }
      if (operation === 'repo.pull-requests.merge') {
        const pullNumber = requiredPositiveInteger(payload.pullNumber, 'pullNumber');
        const method =
          payload.method === 'squash' || payload.method === 'rebase' ? payload.method : 'merge';
        return await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/repo/pull-requests/${pullNumber}/merge`,
          { method: 'POST', body: JSON.stringify({ method }) },
        );
      }
      if (operation === 'repo.pull-requests.close') {
        const pullNumber = requiredPositiveInteger(payload.pullNumber, 'pullNumber');
        return await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/repo/pull-requests/${pullNumber}/close`,
          { method: 'POST', body: '{}' },
        );
      }
      if (operation === 'files.list') {
        const directoryPath = optionalText(payload.path) ?? '';
        const listing = await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/fs/list?path=${encodeURIComponent(directoryPath)}`,
        );
        return { contentChunk: meshJsonContentChunk(listing, payload.contentOffset) };
      }
      if (operation === 'file.write') {
        const filePath = requiredText(payload.path, 'path');
        if (typeof payload.content !== 'string') {
          throw Object.assign(new Error('content must be a string'), { code: 'INVALID_REQUEST' });
        }
        const content = payload.content;
        const contentBytes = Buffer.byteLength(content, 'utf8');
        if (contentBytes > MOBILE_FILE_WRITE_MAX_BYTES) {
          throw Object.assign(
            new Error(
              `file is too large to edit on mobile (${contentBytes} bytes, max ${MOBILE_FILE_WRITE_MAX_BYTES})`,
            ),
            { code: 'FILE_TOO_LARGE' },
          );
        }
        return await localHubRequest(access, `/api/drones/${encodedDrone}/fs/file`, {
          method: 'POST',
          body: JSON.stringify({
            path: filePath,
            content,
            ...(optionalText(payload.expectedRevision)
              ? { expectedRevision: optionalText(payload.expectedRevision) }
              : {}),
          }),
        });
      }
      if (operation === 'file.preview') {
        const filePath = requiredText(payload.path, 'path');
        const watchAction = optionalText(payload.watch);
        const watchId = optionalText(payload.watchId) ?? 'default';
        const watchKey = `${droneId}\u0000${filePath}`;
        if (watchAction === 'unsubscribe') {
          const watch = fileWatches.get(watchKey);
          const deviceSubscriptions = watch?.subscribers.get(context.sourceDevice.id);
          deviceSubscriptions?.delete(watchId);
          if (watch && deviceSubscriptions?.size === 0) {
            watch.subscribers.delete(context.sourceDevice.id);
          }
          if (watch && watch.subscribers.size === 0) stopWatch(watchKey);
          return { watching: false, droneId, path: filePath };
        }
        if (watchAction === 'subscribe') {
          const watch = await getOrCreateFileWatch(watchKey, droneId, filePath);
          let deviceSubscriptions = watch.subscribers.get(context.sourceDevice.id);
          if (!deviceSubscriptions) {
            deviceSubscriptions = new Set();
            watch.subscribers.set(context.sourceDevice.id, deviceSubscriptions);
          }
          if (!deviceSubscriptions.has(watchId) && deviceSubscriptions.size >= 32) {
            throw Object.assign(new Error('too many subscriptions for this file watch'), {
              code: 'RESOURCE_LIMIT',
            });
          }
          deviceSubscriptions.add(watchId);
          return {
            watching: true,
            droneId,
            path: filePath,
            revision: watch.revision,
          };
        }
        const fsFilePath = `/api/drones/${encodedDrone}/fs/file?path=${encodeURIComponent(filePath)}`;
        if (payload.metadataOnly === true) {
          return {
            preview: await localHubRequest(
              access,
              `${fsFilePath}&metadata=1&revision=${payload.includeRevision === false ? '0' : '1'}`,
            ),
          };
        }
        const likelyMedia = isLikelyImagePath(filePath) || isLikelyVideoPath(filePath);
        const expectedRevision = optionalText(payload.expectedRevision);
        let metadata: any;
        try {
          metadata = await localHubRequest(
            access,
            likelyMedia ? `${fsFilePath}&metadata=1&revision=0` : fsFilePath,
          );
        } catch (error: any) {
          if (error?.code !== 'HUB_413' || likelyMedia) throw error;
          metadata = await localHubRequest(access, `${fsFilePath}&metadata=1`);
          if (metadata?.kind !== 'image' && metadata?.kind !== 'video') throw error;
        }
        if (metadata?.kind !== 'image' && metadata?.kind !== 'video') {
          return {
            contentChunk: meshJsonContentChunk(metadata, payload.contentOffset),
          };
        }

        const size = Number(metadata?.size);
        if (!Number.isSafeInteger(size) || size < 0)
          throw Object.assign(new Error('the Hub returned invalid file metadata'), {
            code: 'INVALID_RESPONSE',
          });
        if (size === 0)
          throw Object.assign(new Error('empty media files cannot be previewed'), {
            code: 'EMPTY_MEDIA',
          });
        if (size > MOBILE_FILE_MEDIA_MAX_BYTES)
          throw Object.assign(
            new Error(
              `media is too large to preview on mobile (${size} bytes, max ${MOBILE_FILE_MEDIA_MAX_BYTES})`,
            ),
            { code: 'FILE_TOO_LARGE' },
          );
        if (!optionalText(metadata?.revision) && !expectedRevision) {
          metadata = await localHubRequest(access, `${fsFilePath}&metadata=1&revision=1`);
        }
        const revision = optionalText(metadata?.revision) ?? expectedRevision ?? null;
        const previewPath = requiredText(metadata?.path ?? filePath, 'preview path');

        const requestedOffset = Number(payload.contentOffset);
        const offset =
          Number.isSafeInteger(requestedOffset) && requestedOffset > 0 ? requestedOffset : 0;
        if (offset >= size)
          throw Object.assign(new Error('media preview offset is outside the file'), {
            code: 'INVALID_REQUEST',
          });
        const chunk = await localHubRequest(
          access,
          `/api/drones/${encodedDrone}/fs/chunk?path=${encodeURIComponent(previewPath)}&offset=${offset}&limit=${MESH_BINARY_CHUNK_BYTES}`,
        );
        const dataBase64 = String(chunk?.dataBase64 ?? '');
        const bytes = Buffer.from(dataBase64, 'base64');
        if (
          chunk?.kind !== 'binary-chunk' ||
          Number(chunk?.offset) !== offset ||
          Number(chunk?.nextOffset) !== offset + bytes.length ||
          Number(chunk?.size) !== size ||
          bytes.toString('base64') !== dataBase64
        ) {
          throw Object.assign(new Error('the Hub returned an invalid media chunk'), {
            code: 'INVALID_RESPONSE',
          });
        }
        return {
          preview: {
            path: previewPath,
            kind: metadata.kind,
            mime: String(metadata.mime ?? chunk?.mime ?? ''),
            size,
            mtimeMs: Number.isFinite(Number(metadata.mtimeMs)) ? Number(metadata.mtimeMs) : null,
            revision,
          },
          mediaChunk: {
            encoding: 'base64-binary',
            offset,
            bytes: bytes.length,
            totalBytes: size,
            done: offset + bytes.length >= size,
            dataBase64,
          },
        };
      }

      const chatName = requiredText(payload.chatName ?? 'default', 'chatName');
      const chatPath = `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}`;
      const resolveNativeChat = async (requestedId?: string) => {
        const snapshot = await localHubRequest(access, `${chatPath}/native`, {
          method: 'POST',
          body: '{}',
        });
        const nativeChatId = requiredText(snapshot?.nativeChatId, 'nativeChatId');
        if (requestedId && requestedId !== nativeChatId) {
          throw Object.assign(new Error('nativeChatId does not belong to this drone chat'), {
            code: 'INVALID_REQUEST',
          });
        }
        return { nativeChatId, snapshot };
      };
      if (operation === 'chat.read') {
        const diffArtifactId = optionalText(payload.diffArtifactId);
        const diffPath = optionalText(payload.diffPath);
        const diffList = payload.diffList === true;
        if (diffArtifactId || diffPath || diffList) {
          if (!diffArtifactId || (!diffList && !diffPath) || (diffList && diffPath)) {
            throw Object.assign(
              new Error('A changed-files artifact and one read mode are required'),
              {
                code: 'INVALID_REQUEST',
              },
            );
          }
          const response = await localHubRequest(
            access,
            diffList
              ? `/api/agent-run-diffs/${encodeURIComponent(diffArtifactId)}/files?offset=${Math.max(0, Math.floor(Number(payload.diffListOffset) || 0))}&limit=${Math.max(1, Math.min(500, Math.floor(Number(payload.diffListLimit) || 20)))}`
              : `/api/agent-run-diffs/${encodeURIComponent(diffArtifactId)}/file?path=${encodeURIComponent(diffPath!)}`,
          );
          const owner = object(diffList ? response?.files?.owner : response?.diff?.owner);
          const ownerThreadId = optionalText(owner.threadId);
          if (ownerThreadId) {
            const identity = await localHubRequest(access, `${chatPath}/native`);
            if (requiredText(identity?.nativeChatId, 'nativeChatId') !== ownerThreadId) {
              throw Object.assign(
                new Error('changed-files artifact does not belong to this chat'),
                {
                  code: 'INVALID_REQUEST',
                },
              );
            }
          } else if (
            requiredText(owner.droneId, 'artifact owner droneId') !== droneId ||
            optionalText(owner.chatName) !== chatName
          ) {
            throw Object.assign(new Error('changed-files artifact does not belong to this chat'), {
              code: 'INVALID_REQUEST',
            });
          }
          if (diffList) return response;
          const diff = object(response?.diff);
          const rawPatch = String(diff.patch ?? '');
          const patch = truncateUtf8(rawPatch, MOBILE_RUN_DIFF_MAX_BYTES);
          return {
            ...response,
            diff: {
              ...diff,
              patch,
              truncated: diff.truncated === true || patch !== rawPatch,
            },
          };
        }
        const [result, pendingResult] = await Promise.all([
          localHubRequest(access, chatPath),
          localHubRequest(access, `${chatPath}/pending`),
        ]);
        const contentOnlyRead = Boolean(
          optionalText(payload.messageId) || optionalText(payload.turnId),
        );
        const latestAgentTurnId = optionalText(result?.readState?.latestAgentTurnId) ?? null;
        const latestAgentRevision = Number.isSafeInteger(result?.readState?.latestAgentRevision)
          ? Number(result.readState.latestAgentRevision)
          : 0;
        const subscriptions = contentOnlyRead
          ? []
          : compactChatSubscriptions(result?.subscriptions);
        const marked = await localHubRequest(access, `${chatPath}/read`, {
          method: 'POST',
          body: JSON.stringify({
            latestAgentTurnId,
            latestAgentRevision,
            updatedByDeviceId: context?.sourceDevice?.id ?? null,
          }),
        });
        if (result?.agent?.kind === 'native') {
          const { nativeChatId, snapshot: ensured } = await resolveNativeChat();
          const messageId = optionalText(payload.messageId);
          if (messageId) {
            const entry = await localHubRequest(
              access,
              `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/messages/${encodeURIComponent(messageId)}`,
            );
            return {
              droneId,
              chatName,
              historyKind: 'message-content',
              nativeChatId,
              messageId,
              contentChunk: meshJsonContentChunk(entry, payload.contentOffset),
            };
          }
          const history = await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/history?limit=200${Number.isSafeInteger(Number(payload.before)) && Number(payload.before) > 0 ? `&before=${Number(payload.before)}` : ''}`,
          );
          const nativeResponse = compactNativeChatReadResponse({
            nativeChatId,
            snapshot: ensured,
            history,
          });
          return {
            droneId,
            chatName,
            ...nativeResponse,
            agent: result.agent,
            model: nativeResponse.thread?.model ?? result.model ?? null,
            reasoning: nativeResponse.thread?.thinkingLevel ?? null,
            readState: marked?.readState ?? result?.readState ?? null,
            agentPermissionMode:
              nativeResponse.thread?.agentPermissionMode ??
              result.agentPermissionMode ??
              'full-access',
            approvalPolicy: nativeResponse.thread?.approvalPolicy ?? result.approvalPolicy ?? 'ask',
            ...(subscriptions ? { subscriptions } : {}),
          };
        }
        const turnId = optionalText(payload.turnId);
        if (turnId) {
          const turn = (Array.isArray(result?.turns) ? result.turns : []).find(
            (item: any, index: number) => {
              const itemId = String(item?.id ?? '').trim();
              const turnNumber = Number(item?.turn);
              return (
                (itemId ||
                  (Number.isFinite(turnNumber) ? `turn-${turnNumber}` : `turn-${index}`)) === turnId
              );
            },
          );
          if (!turn)
            throw Object.assign(new Error(`unknown chat turn: ${turnId}`), {
              code: 'NOT_FOUND',
            });
          return {
            droneId,
            chatName,
            historyKind: 'turn-content',
            turnId,
            contentChunk: meshJsonContentChunk(turn, payload.contentOffset),
          };
        }
        const turnPage = boundedDroneChatPage(result.turns, payload.before);
        return {
          droneId,
          chatName,
          historyKind: 'turns',
          ...turnPage,
          agent: result.agent ?? null,
          model: result.model ?? null,
          reasoning: result.reasoning ?? null,
          pending: filterCompletedPendingPrompts(
            compactPendingPrompts(pendingResult?.pending),
            result.turns,
          ),
          readState: marked?.readState ?? result?.readState ?? null,
          agentPermissionMode:
            result.agentPermissionMode === 'read-only' ||
            result.agentPermissionMode === 'workspace-write'
              ? result.agentPermissionMode
              : 'full-access',
          approvalPolicy:
            result.approvalPolicy === 'agent-decides' || result.approvalPolicy === 'never'
              ? result.approvalPolicy
              : 'ask',
          ...(subscriptions ? { subscriptions } : {}),
        };
      }
      if (operation === 'chat.models') {
        const requestedNativeChatId = optionalText(payload.nativeChatId);
        if (requestedNativeChatId) {
          const { nativeChatId, snapshot: ensured } =
            await resolveNativeChat(requestedNativeChatId);
          const thread = Array.isArray(ensured?.threads)
            ? ensured.threads.find((item: any) => String(item?.id ?? '') === nativeChatId)
            : null;
          const catalog = await localHubRequest(access, '/api/model-catalog?agent=native');
          const provider =
            optionalText(catalog?.provider) ?? optionalText(thread?.provider) ?? 'openai';
          const models = Array.isArray(catalog?.models) ? catalog.models : [];
          const defaultModel = object(catalog?.defaultModel);
          const threadModelAvailable =
            optionalText(thread?.provider) === provider &&
            models.some((model: any) => optionalText(model?.id) === optionalText(thread?.model));
          return {
            droneId,
            chatName,
            agent: { kind: 'native' },
            provider,
            model: threadModelAvailable ? (thread?.model ?? null) : (defaultModel.model ?? null),
            reasoning: threadModelAvailable
              ? (thread?.thinkingLevel ?? null)
              : (defaultModel.thinkingLevel ?? null),
            models,
            source: 'native',
            discoveredAt: null,
            error: null,
          };
        }
        const refresh = payload.refresh === true ? '?refresh=1' : '';
        const result = await localHubRequest(access, `${chatPath}/models${refresh}`);
        return {
          droneId,
          chatName,
          agent: result.agent ?? null,
          model: result.model ?? null,
          models: Array.isArray(result.models) ? result.models : [],
          source: result.source ?? 'none',
          discoveredAt: result.discoveredAt ?? null,
          error: result.error ?? null,
        };
      }
      if (operation === 'chat.update') {
        const model = payload.model == null ? null : String(payload.model).trim();
        const requestedNativeChatId = optionalText(payload.nativeChatId);
        if (requestedNativeChatId) {
          const { nativeChatId } = await resolveNativeChat(requestedNativeChatId);
          if (payload.agentPermissionMode !== undefined || payload.approvalPolicy !== undefined) {
            await localHubRequest(access, `${chatPath}/config`, {
              method: 'POST',
              body: JSON.stringify({
                ...(payload.agentPermissionMode !== undefined
                  ? { agentPermissionMode: payload.agentPermissionMode }
                  : {}),
                ...(payload.approvalPolicy !== undefined
                  ? { approvalPolicy: payload.approvalPolicy }
                  : {}),
              }),
            });
          }
          return await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(nativeChatId)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                ...(model ? { model } : {}),
                ...(optionalText(payload.provider)
                  ? { provider: optionalText(payload.provider) }
                  : {}),
                ...(optionalText(payload.thinkingLevel)
                  ? { thinkingLevel: optionalText(payload.thinkingLevel) }
                  : {}),
                ...(typeof payload.autoApprove === 'boolean'
                  ? { autoApprove: payload.autoApprove }
                  : {}),
                ...(payload.agentPermissionMode !== undefined
                  ? { agentPermissionMode: payload.agentPermissionMode }
                  : {}),
                ...(payload.approvalPolicy !== undefined
                  ? { approvalPolicy: payload.approvalPolicy }
                  : {}),
              }),
            },
          );
        }
        return await localHubRequest(access, `${chatPath}/config`, {
          method: 'POST',
          body: JSON.stringify({
            ...(payload.model !== undefined ? { model: model || null } : {}),
            ...(payload.agentPermissionMode !== undefined
              ? { agentPermissionMode: payload.agentPermissionMode }
              : {}),
            ...(payload.approvalPolicy !== undefined
              ? { approvalPolicy: payload.approvalPolicy }
              : {}),
          }),
        });
      }
      if (operation === 'chat.approval.resolve') {
        const { nativeChatId } = await resolveNativeChat(
          requiredText(payload.nativeChatId, 'nativeChatId'),
        );
        const approvalId = requiredText(payload.approvalId, 'approvalId');
        const decision = payload.approved === true ? 'approve' : 'deny';
        return await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
          { method: 'POST', body: '{}' },
        );
      }
      if (operation === 'chat.message.delete') {
        const { nativeChatId } = await resolveNativeChat(
          requiredText(payload.nativeChatId, 'nativeChatId'),
        );
        const messageId = requiredText(payload.messageId, 'messageId');
        return await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/messages/${encodeURIComponent(messageId)}?following=${payload.deleteFollowing === true}`,
          { method: 'DELETE' },
        );
      }
      if (operation === 'chat.prompt') {
        const transfer = object(payload.attachmentTransfer);
        const transferAction = optionalText(transfer.action);
        if (transferAction) {
          if (!chatAttachments)
            throw Object.assign(new Error('mesh attachment uploads are unavailable'), {
              code: 'UNAVAILABLE',
            });
          const sourceDeviceId = requiredText(context?.sourceDevice?.id, 'sourceDeviceId');
          if (transferAction === 'prepare') {
            return await chatAttachments.prepare({
              sourceDeviceId,
              droneId,
              chatName,
              name: transfer.name,
              mime: transfer.mime,
              size: transfer.size,
              sha256: transfer.sha256,
            });
          }
          if (transferAction === 'write') {
            return await chatAttachments.writeMesh({
              sourceDeviceId,
              uploadId: transfer.uploadId,
              offset: transfer.offset,
              dataBase64: transfer.dataBase64,
            });
          }
          if (transferAction === 'commit')
            return await chatAttachments.commit(sourceDeviceId, transfer.uploadId);
          if (transferAction === 'abort')
            return await chatAttachments.abort(sourceDeviceId, transfer.uploadId);
          throw Object.assign(
            new Error(`unsupported attachment transfer action: ${transferAction}`),
            {
              code: 'INVALID_REQUEST',
            },
          );
        }
        const prompt = String(payload.prompt ?? '').trim();
        const userTimeZone = optionalText(payload.userTimeZone);
        const deliveryMode =
          payload.deliveryMode === 'asap'
            ? 'asap'
            : payload.deliveryMode === 'queue'
              ? 'queue'
              : undefined;
        const attachmentIds = Array.isArray(payload.attachmentIds)
          ? payload.attachmentIds.map((value) => String(value ?? '').trim()).filter(Boolean)
          : [];
        const attachments =
          chatAttachments && attachmentIds.length > 0
            ? await chatAttachments.attachments(
                requiredText(context?.sourceDevice?.id, 'sourceDeviceId'),
                droneId,
                chatName,
                attachmentIds,
              )
            : [];
        if (!prompt && attachments.length === 0)
          throw Object.assign(new Error('prompt text or an attachment is required'), {
            code: 'INVALID_REQUEST',
          });
        try {
          const chat = await localHubRequest(access, chatPath);
          if (chat?.agent?.kind === 'native') {
            const { nativeChatId } = await resolveNativeChat();
            const acknowledgement = await submitNativeChatPrompt(
              access,
              nativeChatId,
              prompt,
              attachments,
              deliveryMode,
              userTimeZone,
            );
            return {
              accepted: true,
              nativeChatId,
              queuedPrompt:
                acknowledgement?.type === 'queued' ? (acknowledgement.prompt ?? null) : null,
            };
          }
          return await localHubRequest(access, `${chatPath}/prompt`, {
            method: 'POST',
            body: JSON.stringify({
              prompt,
              attachments,
              ...(userTimeZone ? { userTimeZone } : {}),
              ...(deliveryMode ? { deliveryMode } : {}),
            }),
          });
        } finally {
          await chatAttachments?.remove(attachmentIds);
        }
      }
      if (operation === 'chat.stop') {
        const chat = await localHubRequest(access, chatPath);
        if (chat?.agent?.kind === 'native') {
          const { nativeChatId } = await resolveNativeChat();
          const promptId = optionalText(payload.promptId);
          return await localHubRequest(
            access,
            promptId
              ? `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/queued/${encodeURIComponent(promptId)}`
              : `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/stop`,
            { method: promptId ? 'DELETE' : 'POST', body: promptId ? undefined : '{}' },
          );
        }
        // Per-prompt cancellation is intentionally covered by the existing stop grant so an
        // already-paired mobile device does not need its access permissions expanded on upgrade.
        const promptId = optionalText(payload.promptId);
        if (promptId) {
          return await localHubRequest(
            access,
            `${chatPath}/pending/${encodeURIComponent(promptId)}`,
            { method: 'DELETE' },
          );
        }
        return await localHubRequest(access, `${chatPath}/stop`, { method: 'POST', body: '{}' });
      }
      throw Object.assign(new Error(`unsupported drone-control operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
    close() {
      closed = true;
      for (const key of [...fileWatches.keys()]) stopWatch(key);
    },
    revokeDevice(deviceId) {
      for (const [key, watch] of fileWatches) {
        watch.subscribers.delete(deviceId);
        if (watch.subscribers.size === 0) stopWatch(key);
      }
    },
  };
}
