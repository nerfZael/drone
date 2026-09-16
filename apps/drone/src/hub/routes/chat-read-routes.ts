import type { HubRouter } from '../hub-router';
import type { ChatReadService } from '../chat-read/ChatReadService';

export function registerChatReadRoutes(router: HubRouter, service: ChatReadService): void {
  router.get('/api/drones/:droneRef/chats/:chatName/messages', async ({ params, url, json }) => {
    try {
      const result = await service.read({
        droneRef: decodeURIComponent(params.droneRef),
        chatName: decodeURIComponent(params.chatName) || 'default',
        limit: Number(url.searchParams.get('limit') ?? 10),
        maxChars: Number(url.searchParams.get('maxChars') ?? 4000),
        includeActivity: url.searchParams.get('activity') === 'full',
      });
      json(result.ok ? 200 : result.statusCode, result);
    } catch (error) {
      json(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
}
