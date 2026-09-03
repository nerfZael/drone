import { DRONE_CONTROL_CAPABILITY } from '@drone/device-protocol';
import {
  filterCompletedPendingPrompts,
  isSendInNewChatQueueAction,
  normalizePendingPromptState,
  normalizePromptQueueInterruption,
  normalizePromptQueueInterruptionResolution,
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
import { trimJsonArrayToBytes } from '../builtin-agent-activity';
import { isLikelyImagePath, isLikelyVideoPath } from '../filesystem-media';
import {
  localHubBinaryRequest,
  localHubBoundedJsonRequest,
  localHubRequest,
  type LocalHubAccess,
} from './local-hub-request';
import { MeshContentSnapshotStore } from './mesh-content-chunk';
import type { MeshChatAttachmentStore } from './mesh-chat-attachment-store';
import { fitMeshChatPayload } from './fit-mesh-chat-payload';
import { compactChatQuestionRequests, compactNativeChatReadResponse } from './native-chat-response';
import { submitNativeChatPrompt } from './native-chat-prompt';
import type { SidebarCommandService } from '../sidebar-command-service';
import { createHttpHubServices, type HubServices } from '../application/hub-services';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  const result = String(value ?? '').trim();
  if (!result) throw Object.assign(new Error(`${label} is required`), { code: 'INVALID_REQUEST' });
  return result;
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

function textMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([keyRaw, valueRaw]) => {
      const key = String(keyRaw ?? '').trim();
      const item = String(valueRaw ?? '').trim();
      return key && item ? [[key, item] as const] : [];
    }),
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

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

const MOBILE_PENDING_PROMPTS_MAX_BYTES = 48 * 1024;
const MOBILE_APPROVAL_DETAILS_MAX_BYTES = 2 * 1024;

const CODEX_APPROVAL_METHODS = new Set([
  'item/commandExecution/requestApproval',
  'item/fileChange/requestApproval',
  'item/permissions/requestApproval',
  'execCommandApproval',
  'applyPatchApproval',
]);
const CODEX_APPROVAL_KINDS = new Set(['command_execution', 'file_change', 'permissions']);
const CODEX_APPROVAL_DECISIONS = new Set(['accept', 'acceptForSession', 'decline', 'cancel']);

function compactApprovalDetails(value: unknown): { value?: unknown; truncated: boolean } {
  if (value == null) return { truncated: false };
  try {
    if (serializedBytes(value) <= MOBILE_APPROVAL_DETAILS_MAX_BYTES) {
      return { value, truncated: false };
    }
  } catch {
    // Invalid or circular values are omitted from the mobile projection.
  }
  return { truncated: true };
}

function compactCodexApprovals(value: unknown): any[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const approvals = value.slice(-4).flatMap((approval: any) => {
    const id = optionalText(approval?.id);
    const promptId = optionalText(approval?.promptId);
    const threadId = optionalText(approval?.threadId);
    const turnId = optionalText(approval?.turnId);
    const itemId = optionalText(approval?.itemId);
    const method = optionalText(approval?.method);
    const kind = optionalText(approval?.kind);
    if (
      !id ||
      id.length > 200 ||
      !promptId ||
      promptId.length > 200 ||
      !threadId ||
      threadId.length > 200 ||
      !turnId ||
      turnId.length > 200 ||
      !itemId ||
      itemId.length > 200 ||
      !method ||
      !CODEX_APPROVAL_METHODS.has(method) ||
      !kind ||
      !CODEX_APPROVAL_KINDS.has(kind) ||
      approval?.status !== 'pending'
    ) {
      return [];
    }

    const availableDecisions = Array.isArray(approval?.availableDecisions)
      ? [
          ...new Set(
            approval.availableDecisions.filter((decision: unknown) =>
              CODEX_APPROVAL_DECISIONS.has(String(decision)),
            ),
          ),
        ]
      : [];
    const item = compactApprovalDetails(approval?.item);
    const permissions = compactApprovalDetails(approval?.permissions);
    const reason = truncateUtf8(approval?.reason, 512);
    const command = truncateUtf8(approval?.command, 2_048);
    const cwd = truncateUtf8(approval?.cwd, 512);
    const grantRoot = truncateUtf8(approval?.grantRoot, 512);
    const detailsTruncated =
      Boolean(approval?.detailsTruncated) ||
      item.truncated ||
      permissions.truncated ||
      reason !== String(approval?.reason ?? '') ||
      command !== String(approval?.command ?? '') ||
      cwd !== String(approval?.cwd ?? '') ||
      grantRoot !== String(approval?.grantRoot ?? '');

    return [
      {
        id,
        promptId,
        threadId,
        turnId,
        itemId,
        method,
        kind,
        ...(reason ? { reason } : {}),
        ...(command ? { command } : {}),
        ...(cwd ? { cwd } : {}),
        ...(grantRoot ? { grantRoot } : {}),
        ...(item.value !== undefined ? { item: item.value } : {}),
        ...(permissions.value !== undefined ? { permissions: permissions.value } : {}),
        availableDecisions:
          availableDecisions.length > 0
            ? availableDecisions
            : ['accept', 'acceptForSession', 'decline', 'cancel'],
        createdAt: truncateUtf8(approval?.createdAt, 128),
        status: 'pending',
        ...(detailsTruncated ? { detailsTruncated: true } : {}),
      },
    ];
  });
  return approvals.length > 0 ? approvals : [];
}

function compactPendingPrompts(value: unknown): any[] {
  const prompts = Array.isArray(value) ? value.slice(-50) : [];
  const promptLimit = Math.max(160, Math.floor(8_000 / Math.max(1, prompts.length)));
  const errorLimit = Math.max(80, Math.floor(4_000 / Math.max(1, prompts.length)));
  const compacted = prompts.map((prompt: any) => {
    const attachments = Array.isArray(prompt?.attachments) ? prompt.attachments : [];
    const startedAt = optionalText(prompt?.startedAt);
    const compactedActivity = compactAgentRunActivityForMesh(prompt?.activity);
    const agentPlan = compactAgentPlanForMesh(prompt?.agentPlan);
    const fileChanges = compactAgentRunFileChangesForMesh(prompt?.fileChanges);
    const approvals = compactCodexApprovals(prompt?.approvals);
    const queueInterruption = normalizePromptQueueInterruption(prompt?.queueInterruption);
    return {
      id: String(prompt?.id ?? '').slice(0, 160),
      at: truncateUtf8(prompt?.at, 128),
      ...(startedAt ? { startedAt: truncateUtf8(startedAt, 128) } : {}),
      prompt: truncateUtf8(prompt?.prompt, promptLimit),
      state: normalizePendingPromptState(prompt?.state, 'queued'),
      ...(queueInterruption ? { queueInterruption } : {}),
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
      ...(approvals !== undefined ? { approvals } : {}),
      updatedAt: truncateUtf8(prompt?.updatedAt, 128),
    };
  });

  // Plans, file summaries, and activity are each bounded, but several active prompts can still
  // exceed one mesh response when those optional details are combined. Keep the core state for
  // every prompt and shed older rich details first so the newest work keeps the richest detail.
  for (const prompt of compacted) {
    for (const field of ['fileChanges', 'agentPlan', 'activity'] as const) {
      if (serializedBytes(compacted) <= MOBILE_PENDING_PROMPTS_MAX_BYTES) return compacted;
      if (!(field in prompt)) continue;
      delete prompt[field];
      prompt.activityMeshTruncated = true;
    }
  }

  return trimJsonArrayToBytes(compacted, MOBILE_PENDING_PROMPTS_MAX_BYTES).items;
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
    const resourceType = ['chat', 'repository', 'pull_request', 'change_request', 'cron'].includes(
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
        ...(truncateUtf8(entry.resourceLabel, 800).trim()
          ? { resourceLabel: truncateUtf8(entry.resourceLabel, 800).trim() }
          : {}),
        ...(truncateUtf8(entry.resourceDroneId, 200).trim()
          ? { resourceDroneId: truncateUtf8(entry.resourceDroneId, 200).trim() }
          : {}),
        ...(truncateUtf8(entry.resourceChatName, 200).trim()
          ? { resourceChatName: truncateUtf8(entry.resourceChatName, 200).trim() }
          : {}),
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
    groupId: String(drone?.groupId ?? '').trim() || null,
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
    ...(String(drone?.runtime ?? 'container')
      .trim()
      .toLowerCase() === 'container'
      ? { persistVolume: drone?.persistVolume !== false }
      : {}),
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
    sidebarCommands?: SidebarCommandService;
    hubServices?: HubServices;
    createdDroneAutoRename?: CreatedDroneAutoRenameOperations;
    broadcastFileChange?: (
      payload: Record<string, any>,
      targetDeviceIds: string[],
    ) => void | Promise<void>;
  },
): CapabilityHandler {
  const sidebarCommands = options?.sidebarCommands;
  // Production injects the in-process services. The HTTP adapter keeps direct capability
  // consumers and older standalone integrations compatible without branching per operation.
  const hubServices =
    options?.hubServices ??
    createHttpHubServices(async (pathname, init) => await localHubRequest(access, pathname, init));
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
  const contentSnapshots = new MeshContentSnapshotStore();
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
      const sourceDeviceId = optionalText(context?.sourceDevice?.id) ?? '__direct__';
      const snapshotOwner = contentSnapshots.captureOwner(sourceDeviceId);
      const operationSignal = context?.signal
        ? AbortSignal.any([snapshotOwner.signal, context.signal])
        : snapshotOwner.signal;
      const loadJsonSnapshot = async (
        scope: string,
        offset: unknown,
        load: (signal: AbortSignal, maxBytes: number) => Promise<unknown>,
      ) => {
        const reservation = await contentSnapshots.reserveJson(snapshotOwner, operationSignal);
        try {
          const value = await load(reservation.signal, reservation.maxBytes);
          return reservation.commitJson({ value, scope, offset });
        } finally {
          reservation.release();
        }
      };
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
          const reposResult = await hubServices.repositories.list();
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
          hubServices.repositories.list(),
          hubServices.groups.list(),
          hubServices.settings.uiPreferences.read(),
          hubServices.settings.readDeleteAction(),
        ]);
        if (dronesRequest.status === 'rejected') throw dronesRequest.reason;
        const result = dronesRequest.value;
        const reposResult = object(reposRequest.status === 'fulfilled' ? reposRequest.value : {});
        const groupsResult = object(
          groupsRequest.status === 'fulfilled' ? groupsRequest.value : {},
        );
        const preferencesResult = object(
          preferencesRequest.status === 'fulfilled' ? preferencesRequest.value : {},
        );
        const deleteSettingsResult = object(
          deleteSettingsRequest.status === 'fulfilled' ? deleteSettingsRequest.value : {},
        );
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
            groups: groups.flatMap((group: unknown) => {
              const entry = object(group);
              const id = String(entry.id ?? '').trim();
              const name = String(entry.name ?? '').trim();
              if (!id || !name) return [];
              return [
                {
                  id,
                  name,
                  repoPath: String(entry.repoPath ?? '').trim(),
                  parentId: String(entry.parentId ?? '').trim() || null,
                  createdAt: String(entry.createdAt ?? '').trim() || null,
                },
              ];
            }),
            sidebarGroupOrder: textList(preferences.sidebarGroupOrder),
            sidebarDroneOrderByGroup: textListMap(preferences.sidebarDroneOrderByGroup),
            sidebarNodeOrderByParent: textListMap(preferences.sidebarNodeOrderByParent),
            sidebarChatOrderByDrone: textListMap(preferences.sidebarChatOrderByDrone),
            sidebarChatGroupPathsByDrone: textListMap(preferences.sidebarChatGroupPathsByDrone),
            sidebarChatGroupByChat: textMap(preferences.sidebarChatGroupByChat),
            sidebarChatNodeOrderByParent: textListMap(preferences.sidebarChatNodeOrderByParent),
            pinnedDroneIds: textList(preferences.pinnedDroneIds),
            mutedSidebarGroupIds: textList(preferences.mutedSidebarGroupIds),
            mutedDroneIds: textList(preferences.mutedDroneIds),
            mutedChatIds: textList(preferences.mutedChatIds),
          },
          ...(payload.includeCreateOptions === true
            ? { createOptions: { repos: createRepos } }
            : {}),
        };
      }

      if (operation === 'drone.create.container' || operation === 'drone.create.host') {
        const agent = seedAgent(payload.seedAgent);
        const requestedName = optionalText(payload.name);
        const cloneFrom = optionalText(payload.cloneFrom);
        if (cloneFrom && operation !== 'drone.create.container') {
          throw new Error('Cloning is only supported for container runtime drones');
        }
        const autoRenamePrompt =
          payload.autoRename === true
            ? (optionalText(payload.autoRenamePrompt) ?? optionalText(payload.seedPrompt))
            : undefined;
        const seedAttachmentIds = Array.isArray(payload.seedAttachmentIds)
          ? payload.seedAttachmentIds.map((value) => String(value ?? '').trim()).filter(Boolean)
          : [];
        let uploadedSeedAttachments: Awaited<ReturnType<MeshChatAttachmentStore['attachments']>> =
          [];
        if (seedAttachmentIds.length > 0) {
          if (!chatAttachments)
            throw Object.assign(new Error('mesh attachment uploads are unavailable'), {
              code: 'UNAVAILABLE',
            });
          uploadedSeedAttachments = await chatAttachments.attachments(
            requiredText(context?.sourceDevice?.id, 'sourceDeviceId'),
            requiredText(payload.seedAttachmentUploadKey, 'seedAttachmentUploadKey'),
            'default',
            seedAttachmentIds,
          );
        }
        const seedAttachments =
          uploadedSeedAttachments.length > 0
            ? uploadedSeedAttachments
            : Array.isArray(payload.seedAttachments)
              ? payload.seedAttachments
              : [];
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
          ...(cloneFrom
            ? {
                cloneFrom,
                cloneChats: payload.cloneChats !== false,
              }
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
          ...(payload.seedAgentPermissionMode === 'read' ||
          payload.seedAgentPermissionMode === 'write'
            ? { seedAgentPermissionMode: payload.seedAgentPermissionMode }
            : {}),
          ...(payload.seedApprovalPolicy === 'auto' || payload.seedApprovalPolicy === 'none'
            ? { seedApprovalPolicy: payload.seedApprovalPolicy }
            : {}),
          ...(optionalText(payload.seedPrompt)
            ? {
                seedPrompt: optionalText(payload.seedPrompt),
                seedSubmittedAt: optionalText(payload.seedSubmittedAt) ?? new Date().toISOString(),
              }
            : {}),
          ...(seedAttachments.length > 0 ? { seedAttachments } : {}),
        };
        try {
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
        } finally {
          await chatAttachments?.remove(seedAttachmentIds);
        }
      }

      if (operation === 'sidebar.move') {
        if (!sidebarCommands) {
          throw Object.assign(new Error('sidebar commands are unavailable'), {
            code: 'CAPABILITY_UNAVAILABLE',
          });
        }
        return await sidebarCommands.move(payload);
      }

      if (operation === 'groups.list') {
        return await hubServices.groups.list(
          payload.repoPath === undefined ? undefined : String(payload.repoPath ?? '').trim(),
        );
      }
      if (operation === 'group.create') {
        return await hubServices.groups.create({
          name: requiredText(payload.name, 'name'),
          repoPath: optionalText(payload.repoPath) ?? '',
          at: new Date().toISOString(),
        });
      }
      if (operation === 'group.rename') {
        return await hubServices.groups.rename({
          groupRef: requiredText(payload.groupRef ?? payload.name, 'groupRef'),
          repoPath: optionalText(payload.repoPath) ?? '',
          newName: requiredText(payload.newName, 'newName'),
          at: new Date().toISOString(),
        });
      }
      if (operation === 'group.delete') {
        const result = await hubServices.groups.delete({
          groupRef: requiredText(payload.groupRef ?? payload.name, 'groupRef'),
          repoPath: optionalText(payload.repoPath) ?? '',
          keepVolume: false,
          forget: true,
        });
        if (!result.ok) {
          const messages = (result.errors ?? []).map((item) => item.error).filter(Boolean);
          throw Object.assign(new Error(messages.join('; ') || 'Group deletion failed'), {
            code: 'GROUP_DELETE_FAILED',
            details: result,
          });
        }
        return result;
      }

      const droneId = requiredText(payload.droneId, 'droneId');
      const encodedDrone = encodeURIComponent(droneId);
      if (operation === 'drone.rename') {
        const newName = requiredText(payload.newName, 'newName');
        return await hubServices.drones.rename({
          droneRef: droneId,
          newName,
          source: 'drone-hub-mobile',
        });
      }
      if (operation === 'drone.delete') {
        // Do not guess for a destructive operation. Falling back to permanent deletion when the
        // settings request fails can bypass an explicitly configured archive policy.
        const settings = await hubServices.settings.readDeleteAction();
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
        const mode =
          payload.mode === 'copy-config'
            ? 'copy-config'
            : payload.mode === 'fork'
              ? 'fork'
              : undefined;
        const result = await localHubRequest(access, `/api/drones/${encodedDrone}/chats`, {
          method: 'POST',
          body: JSON.stringify({
            name: chatName,
            ...(copyFrom ? { copyFrom, ...(mode ? { mode } : {}) } : {}),
            ...(payload.draft === true ? { draft: true } : {}),
          }),
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
        const scope = ['files.list', droneId, directoryPath].join('\u0000');
        if (payload.snapshotToken) {
          if (payload.cancelSnapshot === true) {
            contentSnapshots.cancel({
              snapshotToken: payload.snapshotToken,
              sourceDeviceId,
              scope,
            });
            return { cancelled: true };
          }
          return {
            contentChunk: contentSnapshots.resume({
              snapshotToken: payload.snapshotToken,
              sourceDeviceId,
              scope,
              encoding: 'base64-json-utf8',
              offset: payload.contentOffset,
            }).chunk,
          };
        }
        return {
          contentChunk: await loadJsonSnapshot(scope, payload.contentOffset, (signal, maxBytes) =>
            localHubBoundedJsonRequest(
              access,
              `/api/drones/${encodedDrone}/fs/list?path=${encodeURIComponent(directoryPath)}`,
              { signal, maxBytes },
            ),
          ),
        };
      }
      if (operation === 'file.action') {
        const action = requiredText(payload.action, 'action');
        if (action !== 'create-file' && action !== 'create-directory' && action !== 'rename') {
          throw Object.assign(new Error('unsupported mobile filesystem action'), {
            code: 'INVALID_REQUEST',
          });
        }
        const body =
          action === 'rename'
            ? {
                action,
                path: requiredText(payload.path, 'path'),
                name: requiredText(payload.name, 'name'),
              }
            : {
                action,
                targetDir: requiredText(payload.targetDir, 'targetDir'),
                name: requiredText(payload.name, 'name'),
              };
        return await localHubRequest(access, `/api/drones/${encodedDrone}/fs/action`, {
          method: 'POST',
          body: JSON.stringify(body),
        });
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
        const contentScope = ['file.preview', droneId, filePath].join('\u0000');
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
        if (payload.snapshotToken) {
          const resumedRevision = optionalText(payload.expectedRevision);
          const isMediaSnapshot = Boolean(resumedRevision || payload.mediaSnapshot === true);
          const resumeScope = isMediaSnapshot
            ? [contentScope, resumedRevision ?? ''].join('\u0000')
            : contentScope;
          if (isMediaSnapshot && !resumedRevision) {
            throw Object.assign(new Error('expectedRevision is required to resume media'), {
              code: 'INVALID_REQUEST',
            });
          }
          if (payload.cancelSnapshot === true) {
            contentSnapshots.cancel({
              snapshotToken: payload.snapshotToken,
              sourceDeviceId,
              scope: resumeScope,
            });
            return { cancelled: true };
          }
          const resumed = contentSnapshots.resume({
            snapshotToken: payload.snapshotToken,
            sourceDeviceId,
            scope: resumeScope,
            encoding: isMediaSnapshot ? 'base64-binary' : 'base64-json-utf8',
            offset: payload.contentOffset,
          });
          if (resumed.chunk.encoding === 'base64-binary') {
            return { preview: resumed.metadata, mediaChunk: resumed.chunk };
          }
          return { contentChunk: resumed.chunk };
        }
        const fsFilePath = `/api/drones/${encodedDrone}/fs/file?path=${encodeURIComponent(filePath)}`;
        if (payload.metadataOnly === true) {
          return {
            preview: await localHubRequest(
              access,
              `${fsFilePath}&metadata=1&revision=${payload.includeRevision === false ? '0' : '1'}`,
              { signal: operationSignal },
            ),
          };
        }
        const likelyMedia = isLikelyImagePath(filePath) || isLikelyVideoPath(filePath);
        const expectedRevision = optionalText(payload.expectedRevision);
        let metadata: any;
        if (likelyMedia) {
          metadata = await localHubRequest(access, `${fsFilePath}&metadata=1&revision=0`, {
            signal: operationSignal,
          });
        } else {
          const jsonReservation = await contentSnapshots.reserveJson(
            snapshotOwner,
            operationSignal,
          );
          try {
            try {
              metadata = await localHubBoundedJsonRequest(access, fsFilePath, {
                signal: jsonReservation.signal,
                maxBytes: jsonReservation.maxBytes,
              });
            } catch (error: any) {
              if (error?.code !== 'HUB_413') throw error;
              metadata = await localHubBoundedJsonRequest(access, `${fsFilePath}&metadata=1`, {
                signal: jsonReservation.signal,
                maxBytes: jsonReservation.maxBytes,
              });
              if (metadata?.kind !== 'image' && metadata?.kind !== 'video') throw error;
            }
            if (metadata?.kind !== 'image' && metadata?.kind !== 'video') {
              return {
                contentChunk: jsonReservation.commitJson({
                  value: metadata,
                  scope: contentScope,
                  offset: payload.contentOffset,
                }),
              };
            }
          } finally {
            jsonReservation.release();
          }
        }

        const initialMediaKind = metadata.kind;
        const initialMediaPath = requiredText(metadata?.path ?? filePath, 'preview path');
        metadata = await localHubRequest(access, `${fsFilePath}&metadata=1&revision=1`, {
          signal: operationSignal,
        });
        if (metadata?.kind !== 'image' && metadata?.kind !== 'video') {
          throw Object.assign(new Error('the file is no longer previewable media'), {
            code: 'FILE_CHANGED_DURING_READ',
          });
        }
        if (
          metadata.kind !== initialMediaKind ||
          requiredText(metadata?.path ?? filePath, 'preview path') !== initialMediaPath
        ) {
          throw Object.assign(new Error('the file changed while it was loading'), {
            code: 'FILE_CHANGED_DURING_READ',
          });
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
        const revision = optionalText(metadata?.revision);
        const previewPath = requiredText(metadata?.path ?? filePath, 'preview path');
        if (!revision) {
          throw Object.assign(new Error('the Hub did not return a media revision'), {
            code: 'INVALID_RESPONSE',
          });
        }
        if (expectedRevision && revision !== expectedRevision) {
          throw Object.assign(new Error('the file changed while it was loading'), {
            code: 'FILE_REVISION_MISMATCH',
          });
        }
        // The binary reader preallocates exactly the authoritative byte count. Reserve that
        // working buffer so concurrent reads and retained snapshots share one memory ceiling.
        const snapshotReservation = await contentSnapshots.reserve(
          sourceDeviceId,
          size,
          operationSignal,
          snapshotOwner,
        );
        try {
          const media = await localHubBinaryRequest(
            access,
            `/api/drones/${encodedDrone}/fs/media?path=${encodeURIComponent(previewPath)}&revision=${encodeURIComponent(revision)}&maxBytes=${MOBILE_FILE_MEDIA_MAX_BYTES}`,
            {
              maxBytes: MOBILE_FILE_MEDIA_MAX_BYTES,
              expectedBytes: size,
              signal: snapshotReservation.signal,
            },
          );
          if (media.bytes.length !== size) {
            throw Object.assign(new Error('the Hub returned an invalid media chunk'), {
              code: 'INVALID_RESPONSE',
            });
          }
          if (
            (metadata.kind === 'image' && !media.contentType.toLowerCase().startsWith('image/')) ||
            (metadata.kind === 'video' && !media.contentType.toLowerCase().startsWith('video/'))
          ) {
            throw Object.assign(new Error('the Hub returned a different media type'), {
              code: 'FILE_CHANGED_DURING_READ',
            });
          }
          const preview = {
            path: previewPath,
            kind: metadata.kind,
            mime: String(metadata.mime ?? media.contentType ?? ''),
            size,
            mtimeMs: Number.isFinite(Number(metadata.mtimeMs)) ? Number(metadata.mtimeMs) : null,
            revision,
          };
          const snapshot = snapshotReservation.commitBinary({
            content: media.bytes,
            scope: [contentScope, revision].join('\u0000'),
            metadata: preview,
            offset: payload.contentOffset,
          });
          return {
            preview,
            mediaChunk: snapshot.chunk,
          };
        } finally {
          snapshotReservation.release();
        }
      }

      const chatName = requiredText(payload.chatName ?? 'default', 'chatName');
      const chatPath = `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}`;
      const resolveNativeChat = async (requestedId?: string, signal?: AbortSignal) => {
        const snapshot = await localHubRequest(access, `${chatPath}/native`, {
          method: 'POST',
          body: '{}',
          signal,
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
        const messageId = optionalText(payload.messageId);
        const turnId = optionalText(payload.turnId);
        const contentScope = [
          'chat.read',
          droneId,
          chatName,
          messageId ? `message:${messageId}` : `turn:${turnId ?? ''}`,
        ].join('\u0000');
        if (payload.snapshotToken && (messageId || turnId)) {
          if (payload.cancelSnapshot === true) {
            contentSnapshots.cancel({
              snapshotToken: payload.snapshotToken,
              sourceDeviceId,
              scope: contentScope,
            });
            return { cancelled: true };
          }
          return {
            droneId,
            chatName,
            contentChunk: contentSnapshots.resume({
              snapshotToken: payload.snapshotToken,
              sourceDeviceId,
              scope: contentScope,
              encoding: 'base64-json-utf8',
              offset: payload.contentOffset,
            }).chunk,
          };
        }
        const contentOnlyRead = Boolean(messageId || turnId);
        const contentReservation = contentOnlyRead
          ? await contentSnapshots.reserveJson(snapshotOwner, operationSignal)
          : null;
        try {
          const turnNumber = Number(payload.turnNumber);
          const hasTurnNumber = Number.isSafeInteger(turnNumber) && turnNumber > 0;
          const selectedTurnQuery =
            turnId && hasTurnNumber
              ? `selected&turn=${turnNumber}`
              : turnId || messageId
                ? 'none'
                : 'page&limit=100';
          const before = Number(payload.before);
          const beforeQuery = Number.isSafeInteger(before) && before > 0 ? `&before=${before}` : '';
          let legacyTranscriptLoaded = false;
          let result: any;
          try {
            const statePath = `${chatPath}/state?transcript=${selectedTurnQuery}&pending=${contentOnlyRead ? 'none' : 'all'}&subscriptions=${contentOnlyRead ? '0' : '1'}&readState=${contentOnlyRead ? '0' : '1'}&transcriptMeta=0${beforeQuery}`;
            result = contentReservation
              ? await localHubBoundedJsonRequest(access, statePath, {
                  signal: contentReservation.signal,
                  maxBytes: contentReservation.maxBytes,
                })
              : await localHubRequest(access, statePath);
          } catch (error: any) {
            if (error?.code !== 'HUB_410') throw error;
            const [legacy, pendingResult] = await Promise.all([
              contentReservation
                ? localHubBoundedJsonRequest(access, chatPath, {
                    signal: contentReservation.signal,
                    maxBytes: contentReservation.maxBytes,
                  })
                : localHubRequest(access, chatPath),
              contentOnlyRead
                ? Promise.resolve(null)
                : localHubRequest(access, `${chatPath}/pending`),
            ]);
            result = {
              ...legacy,
              transcripts: Array.isArray(legacy?.turns) ? legacy.turns : [],
              pending: pendingResult?.pending,
            };
            legacyTranscriptLoaded = true;
          }
          const latestAgentTurnId = optionalText(result?.readState?.latestAgentTurnId) ?? null;
          const latestAgentRevision = Number.isSafeInteger(result?.readState?.latestAgentRevision)
            ? Number(result.readState.latestAgentRevision)
            : 0;
          const subscriptions = contentOnlyRead
            ? []
            : compactChatSubscriptions(result?.subscriptions);
          const questionRequests = contentOnlyRead
            ? []
            : await localHubRequest(
                access,
                `/api/chat-question-requests?${new URLSearchParams({
                  droneId,
                  chatName,
                  includeResolved: 'true',
                  limit: '12',
                }).toString()}`,
              ).then((response: any) => compactChatQuestionRequests(response?.requests));
          const pendingQuestionRequests = questionRequests.filter(
            (request: any) => request?.status === 'pending',
          );
          const marked = contentOnlyRead
            ? null
            : await localHubRequest(access, `${chatPath}/read`, {
                method: 'POST',
                body: JSON.stringify({
                  latestAgentTurnId,
                  latestAgentRevision,
                  updatedByDeviceId: context?.sourceDevice?.id ?? null,
                }),
              });
          if (result?.agent?.kind === 'native') {
            const { nativeChatId, snapshot: ensured } = await resolveNativeChat(
              undefined,
              contentReservation?.signal,
            );
            if (messageId) {
              const entry = await localHubBoundedJsonRequest(
                access,
                `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/messages/${encodeURIComponent(messageId)}`,
                {
                  signal: contentReservation!.signal,
                  maxBytes: contentReservation!.maxBytes,
                },
              );
              return {
                droneId,
                chatName,
                historyKind: 'message-content',
                nativeChatId,
                messageId,
                contentChunk: contentReservation!.commitJson({
                  value: entry,
                  scope: contentScope,
                  offset: payload.contentOffset,
                }),
              };
            }
            const history = await localHubRequest(
              access,
              `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/history?limit=60${Number.isSafeInteger(Number(payload.before)) && Number(payload.before) > 0 ? `&before=${Number(payload.before)}` : ''}`,
            );
            const nativeThread = Array.isArray(ensured?.threads)
              ? ensured.threads.find((item: any) => String(item?.id ?? '') === nativeChatId)
              : null;
            return compactNativeChatReadResponse({
              nativeChatId,
              snapshot: { ...ensured, pendingQuestionRequests, questionRequests },
              history,
              metadata: {
                droneId,
                chatName,
                agent: result.agent,
                model:
                  nativeThread != null ? String(nativeThread.model ?? '') : (result.model ?? null),
                reasoning: nativeThread != null ? String(nativeThread.thinkingLevel ?? '') : null,
                readState: marked?.readState ?? result?.readState ?? null,
                agentPermissionMode:
                  nativeThread != null
                    ? nativeThread.agentPermissionMode === 'read' ||
                      nativeThread.agentPermissionMode === 'write'
                      ? nativeThread.agentPermissionMode
                      : 'execute'
                    : (result.agentPermissionMode ?? 'execute'),
                approvalPolicy:
                  nativeThread != null
                    ? nativeThread.approvalPolicy === 'none'
                      ? 'none'
                      : 'ask'
                    : (result.approvalPolicy ?? 'ask'),
                ...(subscriptions ? { subscriptions } : {}),
              },
            });
          }
          if (turnId) {
            let turn = (Array.isArray(result?.transcripts) ? result.transcripts : []).find(
              (item: any, index: number) => {
                const itemId = String(item?.id ?? '').trim();
                const turnNumber = Number(item?.turn);
                return (
                  (itemId ||
                    (Number.isFinite(turnNumber) ? `turn-${turnNumber}` : `turn-${index}`)) ===
                  turnId
                );
              },
            );
            if (!turn && !hasTurnNumber && !legacyTranscriptLoaded) {
              const legacy = await localHubBoundedJsonRequest(access, chatPath, {
                signal: contentReservation!.signal,
                maxBytes: contentReservation!.maxBytes,
              });
              turn = (Array.isArray(legacy?.turns) ? legacy.turns : []).find(
                (item: any, index: number) => {
                  const itemId = String(item?.id ?? '').trim();
                  const turnNumber = Number(item?.turn);
                  return (
                    (itemId ||
                      (Number.isFinite(turnNumber) ? `turn-${turnNumber}` : `turn-${index}`)) ===
                    turnId
                  );
                },
              );
            }
            if (!turn)
              throw Object.assign(new Error(`unknown chat turn: ${turnId}`), {
                code: 'NOT_FOUND',
              });
            return {
              droneId,
              chatName,
              historyKind: 'turn-content',
              turnId,
              contentChunk: contentReservation!.commitJson({
                value: turn,
                scope: contentScope,
                offset: payload.contentOffset,
              }),
            };
          }
          const pending = filterCompletedPendingPrompts(
            compactPendingPrompts(result?.pending),
            result.transcripts,
          );
          const metadata = {
            droneId,
            chatName,
            historyKind: 'turns',
            agent: result.agent ?? null,
            model: result.model ?? null,
            reasoning: result.reasoning ?? null,
            pending,
            pendingQuestionRequests,
            questionRequests,
            readState: marked?.readState ?? result?.readState ?? null,
            agentPermissionMode:
              result.agentPermissionMode === 'read' || result.agentPermissionMode === 'write'
                ? result.agentPermissionMode
                : 'execute',
            approvalPolicy:
              result.approvalPolicy === 'auto' || result.approvalPolicy === 'none'
                ? result.approvalPolicy
                : 'ask',
            ...(subscriptions ? { subscriptions } : {}),
          };
          return fitMeshChatPayload(metadata, (turnBudget) =>
            boundedDroneChatPage(
              result.transcripts,
              legacyTranscriptLoaded ? payload.before : undefined,
              turnBudget,
            ),
          );
        } finally {
          contentReservation?.release();
        }
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
          if (
            payload.agent !== undefined ||
            payload.provider !== undefined ||
            payload.model !== undefined ||
            payload.reasoning !== undefined ||
            payload.agentPermissionMode !== undefined ||
            payload.approvalPolicy !== undefined
          ) {
            await localHubRequest(access, `${chatPath}/config`, {
              method: 'POST',
              body: JSON.stringify({
                ...(payload.agent !== undefined ? { agent: payload.agent } : {}),
                ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
                ...(payload.model !== undefined ? { model: model || null } : {}),
                ...(payload.reasoning !== undefined ? { reasoning: payload.reasoning } : {}),
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
                ...(optionalText(payload.thinkingLevel ?? payload.reasoning)
                  ? { thinkingLevel: optionalText(payload.thinkingLevel ?? payload.reasoning) }
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
        const updated = await localHubRequest(access, `${chatPath}/config`, {
          method: 'POST',
          body: JSON.stringify({
            ...(payload.model !== undefined ? { model: model || null } : {}),
            ...(payload.agent !== undefined ? { agent: payload.agent } : {}),
            ...(payload.provider !== undefined ? { provider: payload.provider } : {}),
            ...(payload.reasoning !== undefined ? { reasoning: payload.reasoning } : {}),
            ...(payload.agentPermissionMode !== undefined
              ? { agentPermissionMode: payload.agentPermissionMode }
              : {}),
            ...(payload.approvalPolicy !== undefined
              ? { approvalPolicy: payload.approvalPolicy }
              : {}),
          }),
        });
        if (payload.syncNativeThread === true) {
          const metadata = await localHubRequest(access, chatPath);
          if (metadata?.agent?.kind === 'native') {
            const { nativeChatId } = await resolveNativeChat();
            await localHubRequest(
              access,
              `/api/assistant/threads/${encodeURIComponent(nativeChatId)}`,
              {
                method: 'PATCH',
                body: JSON.stringify({
                  ...(model ? { model } : {}),
                  ...(optionalText(payload.provider)
                    ? { provider: optionalText(payload.provider) }
                    : {}),
                  ...(optionalText(payload.thinkingLevel ?? payload.reasoning)
                    ? { thinkingLevel: optionalText(payload.thinkingLevel ?? payload.reasoning) }
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
        }
        return updated;
      }
      if (operation === 'chat.approval.resolve') {
        if (payload.promptId) {
          const droneId = requiredText(payload.droneId, 'droneId');
          const chatName = requiredText(payload.chatName, 'chatName');
          const promptId = requiredText(payload.promptId, 'promptId');
          const approvalId = requiredText(payload.approvalId, 'approvalId');
          const decision = requiredText(payload.decision, 'decision');
          if (!['accept', 'acceptForSession', 'decline', 'cancel'].includes(decision)) {
            throw new Error(`unsupported Codex approval decision: ${decision}`);
          }
          return await localHubRequest(
            access,
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/approvals/${encodeURIComponent(promptId)}/${encodeURIComponent(approvalId)}/${encodeURIComponent(decision)}`,
            { method: 'POST', body: '{}' },
          );
        }
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
      if (operation === 'chat.questions.resolve') {
        const requestId = requiredText(payload.requestId, 'requestId');
        const requests = await localHubRequest(
          access,
          `/api/chat-question-requests?${new URLSearchParams({ droneId, chatName }).toString()}`,
        );
        if (
          !(Array.isArray(requests?.requests) ? requests.requests : []).some(
            (request: any) => String(request?.id ?? '') === requestId,
          )
        ) {
          throw Object.assign(new Error('question request does not belong to this chat'), {
            code: 'NOT_FOUND',
          });
        }
        const action = requiredText(payload.action, 'action');
        if (action !== 'submit' && action !== 'skip') {
          throw Object.assign(new Error('action must be submit or skip'), {
            code: 'INVALID_REQUEST',
          });
        }
        return await localHubRequest(
          access,
          `/api/chat-question-requests/${encodeURIComponent(requestId)}/${action}`,
          {
            method: 'POST',
            body: JSON.stringify(
              action === 'submit'
                ? { responses: payload.responses, notes: payload.notes }
                : { reason: 'user_skipped', notes: payload.notes },
            ),
          },
        );
      }
      if (operation === 'chat.interruption.resolve') {
        const droneId = requiredText(payload.droneId, 'droneId');
        const chatName = requiredText(payload.chatName, 'chatName');
        const promptId = requiredText(payload.promptId, 'promptId');
        const resolution = normalizePromptQueueInterruptionResolution(payload.resolution);
        if (!resolution) {
          throw Object.assign(
            new Error(`unsupported interruption resolution: ${String(payload.resolution ?? '')}`),
            { code: 'INVALID_REQUEST' },
          );
        }
        return await localHubRequest(
          access,
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/pending/${encodeURIComponent(promptId)}/interruption`,
          { method: 'POST', body: JSON.stringify({ resolution }) },
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
        const promptId = optionalText(payload.promptId);
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
              promptId,
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
              ...(promptId ? { promptId } : {}),
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
      contentSnapshots.close();
      for (const key of [...fileWatches.keys()]) stopWatch(key);
    },
    revokeDevice(deviceId) {
      contentSnapshots.revokeDevice(deviceId);
      for (const [key, watch] of fileWatches) {
        watch.subscribers.delete(deviceId);
        if (watch.subscribers.size === 0) stopWatch(key);
      }
    },
    disconnectDevice(deviceId) {
      // Transfers are connection-scoped: a reconnect starts from a fresh, authorized snapshot.
      contentSnapshots.revokeDevice(deviceId);
    },
    accessChanged(deviceId) {
      contentSnapshots.revokeDevice(deviceId);
    },
  };
}
