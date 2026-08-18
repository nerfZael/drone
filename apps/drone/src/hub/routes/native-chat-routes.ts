import type { BlipHistoryPage } from '@blip/protocol';
import type { HubRouter } from '../hub-router';

export type NativeChatRouteDependencies = {
  nativeChatLifecycle: any;
  nativeChatHistoryPage: (
    threadId: string,
    input?: { before?: number; limit?: number },
  ) => Promise<BlipHistoryPage>;
  getChatEntry: (input: { droneId: string; chatName: string }) => Promise<{ chat: any }>;
  inferChatAgent: (chat: any, drone?: any) => { kind: string };
  resolveDroneOrPendingForReadRef: (
    ref: string,
  ) => Promise<{ id: string; kind?: string; drone?: any } | null>;
  createRequestTimer?: () => {
    mark: (name: string) => void;
    setHeader: (res: any) => void;
  };
  logSlowHubRequest?: (
    label: string,
    timer: any,
    meta?: Record<string, unknown>,
  ) => void;
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

  apiRouter.get(
    '/api/drones/:droneRef/chats/:chatName/native',
    async ({ params, json: respond }) => {
      try {
        const droneRef = decodeURIComponent(params.droneRef);
        const chatName = decodeURIComponent(params.chatName) || 'default';
        const { resolved, chatId } = await resolveNativeChat(droneRef, chatName);
        respond(200, {
          ok: true,
          nativeChatId: chatId,
          droneId: resolved.id,
          chatName,
        });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        const status =
          Number(error?.statusCode ?? 0) || (/unknown (drone|chat)/i.test(message) ? 404 : 400);
        respond(status, { ok: false, error: message });
      }
    },
  );

  apiRouter.post(
    '/api/drones/:droneRef/chats/:chatName/native',
    async ({ params, url, res, json: respond }) => {
      const timer = deps.createRequestTimer?.();
      let droneRef = '';
      let chatName = 'default';
      try {
        droneRef = decodeURIComponent(params.droneRef);
        chatName = decodeURIComponent(params.chatName) || 'default';
        const { resolved, chat, chatId } = await resolveNativeChat(droneRef, chatName);
        timer?.mark('resolve');
        const snapshot = await deps.nativeChatLifecycle.ensure({
          id: chatId,
          droneId: resolved.id,
          chatName,
          provider: chat?.nativeProvider,
          model: chat?.model,
          thinkingLevel: chat?.reasoning,
          agentPermissionMode: chat?.agentPermissionMode,
          approvalPolicy: chat?.approvalPolicy,
        });
        timer?.mark('ensure');
        const includeHistory = url.searchParams.get('includeHistory') === '1';
        const initialHistory = includeHistory
          ? await deps.nativeChatHistoryPage(chatId, { limit: 200 }).catch(() => undefined)
          : undefined;
        if (includeHistory) timer?.mark('history');
        timer?.mark('format');
        timer?.setHeader(res);
        if (timer) {
          deps.logSlowHubRequest?.('native chat bootstrap', timer, {
            droneId: resolved.id,
            chatName,
            includeHistory,
            historyCount: initialHistory?.entries?.length ?? 0,
            status: 200,
          });
        }
        respond(200, {
          ...snapshot,
          nativeChatId: chatId,
          droneId: resolved.id,
          chatName,
          ...(initialHistory ? { initialHistory } : {}),
        });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        const status = Number(error?.statusCode ?? 0) || (/unknown (drone|chat)/i.test(message) ? 404 : 400);
        timer?.mark('error');
        timer?.setHeader(res);
        if (timer) {
          deps.logSlowHubRequest?.('native chat bootstrap', timer, {
            droneRef,
            chatName,
            status,
            error: message,
          });
        }
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
        await deps.nativeChatLifecycle.delete(chatId);
        respond(200, { ok: true, deleted: true, nativeChatId: chatId });
      } catch (error: any) {
        const message = String(error?.message ?? error);
        const status = Number(error?.statusCode ?? 0) || (/unknown (drone|chat)/i.test(message) ? 404 : 400);
        respond(status, { ok: false, error: message });
      }
    },
  );
}
