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

function droneSummary(drone: any) {
  return {
    id: String(drone?.id ?? drone?.name ?? ''),
    name: String(drone?.name ?? drone?.id ?? ''),
    runtime: String(drone?.runtime ?? 'container'),
    phase: String(drone?.phase ?? drone?.hub?.phase ?? ''),
    status: String(drone?.status ?? ''),
    group: drone?.group ?? null,
  };
}

export function createDroneControlCapability(access: LocalHubAccess): CapabilityHandler {
  return {
    descriptor: DRONE_CONTROL_CAPABILITY,
    async invoke(operation, rawPayload) {
      const payload = object(rawPayload);
      if (operation === 'drones.list') {
        const result = await localHubRequest(access, '/api/drones');
        return { drones: Array.isArray(result.drones) ? result.drones.map(droneSummary) : [] };
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
