import type { HubRouter } from '../hub-router';

export type NativeChatRouteDependencies = {
  assistantService: any;
  blipAssistantHost: any;
  getChatEntry: (input: { droneId: string; chatName: string }) => Promise<{ chat: any }>;
  inferChatAgent: (chat: any, drone?: any) => { kind: string };
  resolveDroneOrPendingForReadRef: (
    ref: string,
  ) => Promise<{ id: string; kind?: string; drone?: any } | null>;
};

export function registerNativeChatRoutes(
  apiRouter: HubRouter,
  deps: NativeChatRouteDependencies,
): void {
  const resolveNativeChat = async (droneRef: string, chatName: string) => {
    const resolved = await deps.resolveDroneOrPendingForReadRef(droneRef);
    if (!resolved || resolved.kind === 'pending') throw new Error(`unknown drone: ${droneRef}`);
    const { chat } = await deps.getChatEntry({ droneId: resolved.id, chatName });
    if (deps.inferChatAgent(chat, resolved.drone).kind !== 'native') {
      const error: Error & { statusCode?: number } = new Error(
        'chat does not use the Built-in agent',
      );
      error.statusCode = 409;
      throw error;
    }
    const chatId = String(chat?.id ?? '').trim();
    if (!chatId) throw new Error('chat has no stable identity');
    return { resolved, chat, chatId };
  };

  apiRouter.post(
    '/api/drones/:droneRef/chats/:chatName/native',
    async ({ params, json: respond }) => {
      try {
        const droneRef = decodeURIComponent(params.droneRef);
        const chatName = decodeURIComponent(params.chatName) || 'default';
        const { resolved, chat, chatId } = await resolveNativeChat(droneRef, chatName);
        const snapshot = await deps.assistantService.ensureNativeThread({
          id: chatId,
          droneId: resolved.id,
          chatName,
          title: chatName,
          provider: chat?.nativeProvider,
          model: chat?.model,
          thinkingLevel: chat?.reasoning,
        });
        respond(200, { ...snapshot, nativeChatId: chatId, droneId: resolved.id, chatName });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        const status = Number(error?.statusCode ?? 0) || (/unknown (drone|chat)/i.test(message) ? 404 : 400);
        respond(status, { ok: false, error: message });
      }
    },
  );

  apiRouter.delete(
    '/api/drones/:droneRef/chats/:chatName/native',
    async ({ params, json: respond }) => {
      try {
        const droneRef = decodeURIComponent(params.droneRef);
        const chatName = decodeURIComponent(params.chatName) || 'default';
        const { chatId } = await resolveNativeChat(droneRef, chatName);
        await deps.blipAssistantHost.deleteThread(chatId);
        await deps.assistantService.deleteThread(chatId);
        respond(200, { ok: true, deleted: true, nativeChatId: chatId });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        const status = Number(error?.statusCode ?? 0) || (/unknown (drone|chat)/i.test(message) ? 404 : 400);
        respond(status, { ok: false, error: message });
      }
    },
  );
}
