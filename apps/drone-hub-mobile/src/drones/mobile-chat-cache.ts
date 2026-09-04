import type { BoundedSwrCache } from './bounded-swr-cache';

export function mobileChatCacheKey(targetId: string, droneId: string, chatName: string): string {
  return `${targetId}\0${droneId}\0${chatName}`;
}

export function invalidateMobileChatCache<T>(
  cache: BoundedSwrCache<T>,
  scope: { targetId: string; droneId?: string; chatName?: string },
): void {
  if (scope.droneId && scope.chatName) {
    cache.delete(mobileChatCacheKey(scope.targetId, scope.droneId, scope.chatName));
    return;
  }
  const prefix = scope.droneId ? `${scope.targetId}\0${scope.droneId}\0` : `${scope.targetId}\0`;
  cache.deleteMatching((key) => key.startsWith(prefix));
}

export function mobileChatCacheScopeIncludes(
  scope: { targetId: string; droneId?: string; chatName?: string },
  identity: { targetId: string; droneId: string; chatName: string },
): boolean {
  return (
    scope.targetId === identity.targetId &&
    (!scope.droneId || scope.droneId === identity.droneId) &&
    (!scope.chatName || scope.chatName === identity.chatName)
  );
}
