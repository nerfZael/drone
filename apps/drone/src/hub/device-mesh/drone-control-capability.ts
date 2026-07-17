import { DRONE_CONTROL_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from './device-mesh-types';
import { localHubRequest, type LocalHubAccess } from './local-hub-request';
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
  return prompts.map((prompt: any) => ({
    id: String(prompt?.id ?? '').slice(0, 160),
    at: String(prompt?.at ?? ''),
    prompt: truncateUtf8(prompt?.prompt, promptLimit),
    state: ['queued', 'sending', 'sent', 'failed'].includes(String(prompt?.state ?? ''))
      ? String(prompt.state)
      : 'queued',
    ...(prompt?.error ? { error: truncateUtf8(prompt.error, errorLimit) } : {}),
    ...(prompt?.automation ? { automation: true } : {}),
    ...(prompt?.blockedByAutomation ? { blockedByAutomation: true } : {}),
    imageCount: Array.isArray(prompt?.attachments) ? prompt.attachments.length : 0,
    updatedAt: String(prompt?.updatedAt ?? ''),
  }));
}

const CREATE_REPO_BRANCH_PAGE_SIZE = 500;
const CREATE_REPO_BRANCH_PAGE_BYTES = 160 * 1024;

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
    phase: String(drone?.phase ?? drone?.hub?.phase ?? ''),
    status: String(drone?.status ?? ''),
    group: drone?.group ?? null,
    repoPath: firstText(
      drone?.repoPath,
      drone?.repositoryPath,
      drone?.repo?.path,
      drone?.repo?.hostPath,
      drone?.repo?.dest,
    ),
    fleetParentId: String(drone?.fleetParentId ?? '').trim() || null,
    chats: chats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean),
    busyChats: Array.isArray(drone?.busyChats)
      ? drone.busyChats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
      : [],
    unreadChats: Array.isArray(drone?.unreadChats)
      ? drone.unreadChats.map((chat: unknown) => String(chat ?? '').trim()).filter(Boolean)
      : [],
    chatReadStates:
      drone?.chatReadStates && typeof drone.chatReadStates === 'object'
        ? drone.chatReadStates
        : {},
    createdAt: String(drone?.createdAt ?? ''),
    lastActivityAt: String(drone?.lastActivityAt ?? ''),
    lastMessageAt: String(drone?.lastMessageAt ?? ''),
    statusOk: drone?.statusOk !== false,
    statusError: String(drone?.statusError ?? '').trim() || null,
  };
}

export function createDroneControlCapability(access: LocalHubAccess): CapabilityHandler {
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
        const result = await localHubRequest(access, '/api/drones');
        const [reposResult, groupsResult, preferencesResult] = await Promise.all([
          localHubRequest(access, '/api/repos').catch(() => ({})),
          localHubRequest(access, '/api/groups').catch(() => ({})),
          localHubRequest(access, '/api/settings/ui-preferences').catch(() => ({})),
        ]);
        const drones: ReturnType<typeof deviceMeshDroneSummary>[] = Array.isArray(result.drones)
          ? result.drones.map(deviceMeshDroneSummary)
          : [];
        const preferences = object(preferencesResult.uiPreferences);
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
          schemaVersion: 6,
          drones,
          repoPathByDroneId: Object.fromEntries(
            drones
              .map((drone) => [drone.id, drone.repoPath] as const)
              .filter(([droneId, repoPath]) => Boolean(droneId && repoPath)),
          ),
          sidebar: {
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
          },
          ...(payload.includeCreateOptions === true
            ? { createOptions: { repos: createRepos } }
            : {}),
        };
      }

      if (operation === 'drone.create.container' || operation === 'drone.create.host') {
        const agent = seedAgent(payload.seedAgent);
        const repoBranchSource = payload.repoBranchSource === 'remote' ? 'remote' : 'host';
        const createPayload = {
          name: optionalText(payload.name),
          group: optionalText(payload.group),
          repoPath: optionalText(payload.repoPath),
          runtime: operation.endsWith('.host') ? 'host' : 'container',
          ...(payload.draft === true ? { draft: true } : {}),
          ...(typeof payload.persistVolume === 'boolean'
            ? { persistVolume: payload.persistVolume }
            : {}),
          pullHostBranchBeforeCreate: payload.pullHostBranchBeforeCreate === true,
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
          ...(payload.seedAgentPermissionMode === 'read-only'
            ? { seedAgentPermissionMode: 'read-only' }
            : {}),
          ...(optionalText(payload.seedPrompt)
            ? {
                seedPrompt: optionalText(payload.seedPrompt),
                seedSubmittedAt: optionalText(payload.seedSubmittedAt) ?? new Date().toISOString(),
              }
            : {}),
        };
        return await localHubRequest(access, '/api/drones', {
          method: 'POST',
          body: JSON.stringify(createPayload),
        });
      }

      const droneId = requiredText(payload.droneId, 'droneId');
      const encodedDrone = encodeURIComponent(droneId);
      if (operation === 'drone.delete') {
        await localHubRequest(access, `/api/drones/${encodedDrone}`, { method: 'DELETE' });
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

      const chatName = requiredText(payload.chatName ?? 'default', 'chatName');
      const chatPath = `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}`;
      if (operation === 'chat.read') {
        const [result, pendingResult] = await Promise.all([
          localHubRequest(access, chatPath),
          localHubRequest(access, `${chatPath}/pending`),
        ]);
        const latestAgentTurnId = optionalText(result?.readState?.latestAgentTurnId) ?? null;
        const latestAgentRevision = Number.isSafeInteger(result?.readState?.latestAgentRevision)
          ? Number(result.readState.latestAgentRevision)
          : 0;
        const marked = await localHubRequest(access, `${chatPath}/read`, {
          method: 'POST',
          body: JSON.stringify({
            latestAgentTurnId,
            latestAgentRevision,
            updatedByDeviceId: context?.sourceDevice?.id ?? null,
          }),
        });
        if (result?.agent?.kind === 'native') {
          const ensured = await localHubRequest(access, `${chatPath}/native`, {
            method: 'POST',
            body: '{}',
          });
          const nativeChatId = requiredText(ensured?.nativeChatId, 'nativeChatId');
          const history = await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/history?limit=100`,
          );
          const thread = Array.isArray(ensured?.threads)
            ? ensured.threads.find((item: any) => String(item?.id ?? '') === nativeChatId)
            : null;
          const pendingApprovals = (Array.isArray(ensured?.pendingApprovals)
            ? ensured.pendingApprovals
            : []
          ).filter(
            (approval: any) =>
              String(approval?.threadId ?? '') === nativeChatId &&
              approval?.status === 'pending',
          );
          return {
            droneId,
            chatName,
            historyKind: 'messages',
            nativeChatId,
            history,
            streamingMessages: Array.isArray(ensured?.streamingMessages)
              ? ensured.streamingMessages
              : ensured?.streamingMessage
                ? [ensured.streamingMessage]
                : [],
            pendingApprovals,
            thread,
            agent: result.agent,
            model: thread?.model ?? result.model ?? null,
            reasoning: thread?.thinkingLevel ?? null,
            pending: Array.isArray(thread?.queuedPrompts)
              ? thread.queuedPrompts.map((prompt: any) => ({
                  ...prompt,
                  state: prompt?.status ?? 'queued',
                }))
              : [],
            readState: marked?.readState ?? result?.readState ?? null,
            agentPermissionMode: 'full-access',
          };
        }
        return {
          droneId,
          chatName,
          historyKind: 'turns',
          turns: result.turns ?? [],
          agent: result.agent ?? null,
          model: result.model ?? null,
          reasoning: result.reasoning ?? null,
          pending: compactPendingPrompts(pendingResult?.pending),
          readState: marked?.readState ?? result?.readState ?? null,
          agentPermissionMode:
            result.agentPermissionMode === 'read-only' ? 'read-only' : 'full-access',
        };
      }
      if (operation === 'chat.models') {
        const nativeChatId = optionalText(payload.nativeChatId);
        if (nativeChatId) {
          const ensured = await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(nativeChatId)}`,
          );
          const thread = Array.isArray(ensured?.threads)
            ? ensured.threads.find((item: any) => String(item?.id ?? '') === nativeChatId)
            : null;
          return {
            droneId,
            chatName,
            agent: { kind: 'native' },
            provider: thread?.provider ?? null,
            model: thread?.model ?? null,
            reasoning: thread?.thinkingLevel ?? null,
            models: Array.isArray(ensured?.models)
              ? ensured.models.map((item: any) => ({
                  id: String(item?.id ?? ''),
                  label: String(item?.name ?? item?.id ?? ''),
                  provider: String(item?.provider ?? ''),
                  thinkingLevel: String(item?.thinkingLevel ?? ''),
                  reasoningLevels: item?.reasoning
                    ? ['off', 'low', 'medium', 'high']
                    : ['off'],
                }))
              : [],
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
        const nativeChatId = optionalText(payload.nativeChatId);
        if (nativeChatId) {
          return await localHubRequest(
            access,
            `/api/assistant/threads/${encodeURIComponent(nativeChatId)}`,
            {
              method: 'PATCH',
              body: JSON.stringify({
                ...(model ? { model } : {}),
                ...(optionalText(payload.provider) ? { provider: optionalText(payload.provider) } : {}),
                ...(optionalText(payload.thinkingLevel)
                  ? { thinkingLevel: optionalText(payload.thinkingLevel) }
                  : {}),
                ...(typeof payload.autoApprove === 'boolean'
                  ? { autoApprove: payload.autoApprove }
                  : {}),
              }),
            },
          );
        }
        return await localHubRequest(access, `${chatPath}/config`, {
          method: 'POST',
          body: JSON.stringify({ model: model || null }),
        });
      }
      if (operation === 'chat.approval.resolve') {
        const nativeChatId = requiredText(payload.nativeChatId, 'nativeChatId');
        const approvalId = requiredText(payload.approvalId, 'approvalId');
        const decision = payload.approved === true ? 'approve' : 'deny';
        return await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/approvals/${encodeURIComponent(approvalId)}/${decision}`,
          { method: 'POST', body: '{}' },
        );
      }
      if (operation === 'chat.message.delete') {
        const nativeChatId = requiredText(payload.nativeChatId, 'nativeChatId');
        const messageId = requiredText(payload.messageId, 'messageId');
        return await localHubRequest(
          access,
          `/api/assistant/threads/${encodeURIComponent(nativeChatId)}/messages/${encodeURIComponent(messageId)}?following=${payload.deleteFollowing === true}`,
          { method: 'DELETE' },
        );
      }
      if (operation === 'chat.prompt') {
        const prompt = requiredText(payload.prompt, 'prompt');
        const chat = await localHubRequest(access, chatPath);
        if (chat?.agent?.kind === 'native') {
          const ensured = await localHubRequest(access, `${chatPath}/native`, {
            method: 'POST',
            body: '{}',
          });
          const nativeChatId = requiredText(ensured?.nativeChatId, 'nativeChatId');
          const acknowledgement = await submitNativeChatPrompt(access, nativeChatId, prompt);
          return {
            accepted: true,
            nativeChatId,
            queuedPrompt:
              acknowledgement?.type === 'queued' ? acknowledgement.prompt ?? null : null,
          };
        }
        return await localHubRequest(access, `${chatPath}/prompt`, {
          method: 'POST',
          body: JSON.stringify({ prompt }),
        });
      }
      if (operation === 'chat.stop') {
        const chat = await localHubRequest(access, chatPath);
        if (chat?.agent?.kind === 'native') {
          const ensured = await localHubRequest(access, `${chatPath}/native`, {
            method: 'POST',
            body: '{}',
          });
          const nativeChatId = requiredText(ensured?.nativeChatId, 'nativeChatId');
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
  };
}
