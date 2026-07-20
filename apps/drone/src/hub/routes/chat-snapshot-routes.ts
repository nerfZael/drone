import { sendJson as json } from '../hub-http';
import type { LegacyRouteDependencyContract, LegacyRouteHandler } from './legacy-route';

type ChatSnapshotRouteDependencyName =
  | 'isSafePromptId'
  | 'resolveDroneOrRespond'
  | 'restoreDockerSnapshotForTranscriptTurn';

export type ChatSnapshotRouteDependencies =
  LegacyRouteDependencyContract<ChatSnapshotRouteDependencyName>;

export function createChatSnapshotRouteHandler(
  deps: ChatSnapshotRouteDependencies,
): LegacyRouteHandler {
  const {
    isSafePromptId,
    resolveDroneOrRespond,
    restoreDockerSnapshotForTranscriptTurn,
  } = deps;
  return async ({ req, res, url: u, method, parts }) => {
    const handled = await (async (): Promise<false | void> => {
      // POST /api/drones/:id/chats/:chat/transcript/:promptId/docker-snapshot/:snapshotId/rollback
      if (
        method === 'POST' &&
        parts.length === 10 &&
        parts[0] === 'api' &&
        parts[1] === 'drones' &&
        parts[3] === 'chats' &&
        parts[5] === 'transcript' &&
        parts[7] === 'docker-snapshot' &&
        parts[9] === 'rollback'
      ) {
        const droneRef = decodeURIComponent(parts[2]);
        const chatName = decodeURIComponent(parts[4]) || 'default';
        const promptId = String(decodeURIComponent(parts[6] ?? '')).trim();
        const snapshotId = String(decodeURIComponent(parts[8] ?? '')).trim();
        if (!isSafePromptId(promptId)) {
          json(res, 400, { ok: false, error: 'invalid promptId' });
          return;
        }
        if (!/^[0-9a-f]{8,64}$/i.test(snapshotId)) {
          json(res, 400, { ok: false, error: 'invalid snapshotId' });
          return;
        }
        const resolved = await resolveDroneOrRespond(res, droneRef);
        if (!resolved) return;
        try {
          await restoreDockerSnapshotForTranscriptTurn({
            droneId: resolved.id,
            chatName,
            promptId,
            snapshotId,
          });
          json(res, 200, {
            ok: true,
            id: resolved.id,
            name: resolved.drone?.name ?? droneRef,
            chat: chatName,
            promptId,
            snapshotId,
          });
          return;
        } catch (e: any) {
          const status = Number((e as any)?.statusCode ?? 0);
          json(res, status > 0 ? status : 500, { ok: false, error: e?.message ?? String(e) });
          return;
        }
      }

      return false;
    })();
    return handled !== false;
  };
}
