import type { HubRouter } from '../hub-router';
import type { ResolvedDrone } from '../drone-lifecycle-service';
import {
  normalizeChatCurrentWorktree,
  normalizeWorktreePath,
  type ChatCurrentWorktree,
  type RepoWorktree,
  type RepoWorktrees,
} from '../repo-worktrees';

type ChatRef = { droneId: string; chatName: string };

export type RepoWorktreeRouteDependencies = {
  worktrees: Pick<RepoWorktrees, 'list' | 'find'>;
  /** The drone with a repository attached; throws an error with `status` otherwise. */
  resolveRepoDrone: (ref: string) => Promise<ResolvedDrone & { runtime: 'host' | 'container' }>;
  readChatWorktree: (chat: ChatRef) => Promise<unknown>;
  /** Throws an error with `status` 404 when the chat does not exist. */
  writeChatWorktree: (chat: ChatRef, worktree: ChatCurrentWorktree | null) => Promise<void>;
  now?: () => string;
};

/**
 * The worktrees of a drone's repository, and the one each chat says it works in. Agents report theirs through the
 * DroneHub MCP server; the Changes explorer lists the worktrees and follows the chat it is shown with.
 */
export function registerRepoWorktreeRoutes(router: HubRouter, deps: RepoWorktreeRouteDependencies) {
  const statusOf = (error: any) => (typeof error?.status === 'number' ? error.status : 400);
  const now = deps.now ?? (() => new Date().toISOString());

  /** The chat's worktree as the explorer should use it: null when it is gone or is the main checkout. */
  const chatWorktreeIn = (
    runtime: 'host' | 'container',
    worktrees: RepoWorktree[],
    stored: ChatCurrentWorktree | null,
  ) => {
    if (!stored) return null;
    const wanted = normalizeWorktreePath(runtime, stored.path);
    const listed = worktrees.find((worktree) => worktree.path === wanted) ?? null;
    return { ...stored, available: Boolean(listed), main: Boolean(listed?.main), branch: listed?.branch ?? stored.branch };
  };

  // GET /api/drones/:drone/repo/worktrees?chat=<name>
  router.get('/api/drones/:drone/repo/worktrees', async ({ params, url, json, fail }) => {
    try {
      const resolved = await deps.resolveRepoDrone(params.drone);
      const worktrees = await deps.worktrees.list(resolved.id, resolved.drone);
      const chatName = url.searchParams.get('chat')?.trim() || '';
      const stored = chatName
        ? normalizeChatCurrentWorktree(await deps.readChatWorktree({ droneId: resolved.id, chatName }).catch(() => null))
        : null;
      json(200, {
        ok: true,
        id: resolved.id,
        runtime: resolved.runtime,
        worktrees,
        chatWorktree: chatWorktreeIn(resolved.runtime, worktrees, stored),
      });
    } catch (error: any) {
      fail(statusOf(error), error?.message ?? String(error));
    }
  });

  // GET /api/drones/:drone/chats/:chat/worktree
  router.get('/api/drones/:drone/chats/:chat/worktree', async ({ params, json, fail }) => {
    try {
      const resolved = await deps.resolveRepoDrone(params.drone);
      const stored = normalizeChatCurrentWorktree(
        await deps.readChatWorktree({ droneId: resolved.id, chatName: params.chat || 'default' }),
      );
      const worktrees = await deps.worktrees.list(resolved.id, resolved.drone);
      json(200, { ok: true, worktree: chatWorktreeIn(resolved.runtime, worktrees, stored) });
    } catch (error: any) {
      fail(statusOf(error), error?.message ?? String(error));
    }
  });

  // POST /api/drones/:drone/chats/:chat/worktree  { path?: string, branch?: string, clear?: boolean }
  router.post('/api/drones/:drone/chats/:chat/worktree', async ({ params, readJson, json, fail }) => {
    try {
      const body = (await readJson<{ path?: unknown; branch?: unknown; clear?: unknown }>()) ?? {};
      const resolved = await deps.resolveRepoDrone(params.drone);
      const chat = { droneId: resolved.id, chatName: params.chat || 'default' };
      const requestedPath = typeof body.path === 'string' ? body.path.trim() : '';
      const requestedBranch = typeof body.branch === 'string' ? body.branch.trim() : '';
      if (body.clear === true || (!requestedPath && !requestedBranch)) {
        await deps.writeChatWorktree(chat, null);
        json(200, { ok: true, worktree: null, main: true });
        return;
      }
      const worktree = await deps.worktrees.find(resolved.id, resolved.drone, {
        ...(requestedPath ? { path: requestedPath } : {}),
        ...(requestedBranch ? { branch: requestedBranch } : {}),
      });
      // The main checkout is what everyone sees anyway; reporting it clears the chat's worktree.
      const stored = worktree.main ? null : { path: worktree.path, branch: worktree.branch, reportedAt: now() };
      await deps.writeChatWorktree(chat, stored);
      json(200, { ok: true, worktree: stored, main: worktree.main, path: worktree.path, branch: worktree.branch });
    } catch (error: any) {
      fail(statusOf(error), error?.message ?? String(error));
    }
  });
}
