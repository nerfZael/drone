import { DRONE_CONTROL_CAPABILITY } from '@drone/device-protocol';
import type { CapabilityHandler } from './device-mesh-types';
import { localHubRequest, type LocalHubAccess } from './local-hub-request';

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
    async invoke(operation, rawPayload) {
      const payload = object(rawPayload);
      if (operation === 'drones.list') {
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
        return {
          schemaVersion: 3,
          drones,
          repoPathByDroneId: Object.fromEntries(
            drones
              .map((drone) => [drone.id, drone.repoPath] as const)
              .filter(([droneId, repoPath]) => Boolean(droneId && repoPath)),
          ),
          sidebar: {
            registeredRepoPaths: textList(
              Array.isArray(reposResult.repos)
                ? reposResult.repos.map((repo: unknown) => object(repo).path)
                : [],
            ),
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
        };
      }

      if (operation === 'drone.create.container' || operation === 'drone.create.host') {
        const createPayload = {
          name: typeof payload.name === 'string' ? payload.name.trim() : undefined,
          repoPath: typeof payload.repoPath === 'string' ? payload.repoPath.trim() : undefined,
          seedPrompt:
            typeof payload.seedPrompt === 'string' ? payload.seedPrompt.trim() : undefined,
          runtime: operation.endsWith('.host') ? 'host' : 'container',
        };
        return await localHubRequest(access, '/api/drones', {
          method: 'POST',
          body: JSON.stringify(createPayload),
        });
      }

      const droneId = requiredText(payload.droneId, 'droneId');
      const encodedDrone = encodeURIComponent(droneId);
      if (operation === 'chats.list') {
        const result = await localHubRequest(access, `/api/drones/${encodedDrone}/chats`);
        return { droneId, chats: result.chats ?? [] };
      }

      const chatName = requiredText(payload.chatName ?? 'default', 'chatName');
      const chatPath = `/api/drones/${encodedDrone}/chats/${encodeURIComponent(chatName)}`;
      if (operation === 'chat.read') {
        const result = await localHubRequest(access, chatPath);
        return {
          droneId,
          chatName,
          turns: result.turns ?? [],
          agent: result.agent ?? null,
          model: result.model ?? null,
        };
      }
      if (operation === 'chat.models') {
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
        return await localHubRequest(access, `${chatPath}/config`, {
          method: 'POST',
          body: JSON.stringify({ model: model || null }),
        });
      }
      if (operation === 'chat.prompt') {
        const prompt = requiredText(payload.prompt, 'prompt');
        return await localHubRequest(access, `${chatPath}/prompt`, {
          method: 'POST',
          body: JSON.stringify({ prompt }),
        });
      }
      if (operation === 'chat.stop') {
        return await localHubRequest(access, `${chatPath}/stop`, { method: 'POST', body: '{}' });
      }
      throw Object.assign(new Error(`unsupported drone-control operation: ${operation}`), {
        code: 'UNSUPPORTED_OPERATION',
      });
    },
  };
}
