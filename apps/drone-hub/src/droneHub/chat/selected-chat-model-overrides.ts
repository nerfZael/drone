import { chatRuntimeCacheKey, readFreshChatRuntimeCache, writeChatRuntimeCache } from '../app/chat-runtime-cache';

/** Missing fields preserve that chat's settings; null explicitly chooses the agent default. */
export type ChatModelOverrides = { model?: string | null; reasoning?: string | null };

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

export async function applyChatModelOverrides(
  requestJson: RequestJson,
  target: { droneId: string; chatName: string },
  overrides: ChatModelOverrides = {},
): Promise<void> {
  const settings = {
    ...(overrides.model !== undefined ? { model: overrides.model } : {}),
    ...(overrides.reasoning !== undefined ? { reasoning: overrides.reasoning } : {}),
  };
  if (Object.keys(settings).length === 0) return;
  await requestJson(`/api/drones/${encodeURIComponent(target.droneId)}/chats/${encodeURIComponent(target.chatName)}/config`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(settings),
  });
  const key = chatRuntimeCacheKey(target.droneId, target.chatName);
  const info = readFreshChatRuntimeCache(key)?.chatInfo;
  if (info) writeChatRuntimeCache(key, { chatInfo: { ...info, ...settings } });
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('drone-hub:chat-model-settings-changed', {
    detail: { ...target, settings },
  }));
}
