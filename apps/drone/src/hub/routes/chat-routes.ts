import {
  createChatManagementRouteHandler,
  type ChatManagementRouteDependencies,
} from './chat-management-routes';
import {
  createChatPromptRouteHandler,
  type ChatPromptRouteDependencies,
} from './chat-prompt-routes';
import {
  createChatSnapshotRouteHandler,
  type ChatSnapshotRouteDependencies,
} from './chat-snapshot-routes';
import {
  createChatTranscriptRouteHandler,
  type ChatTranscriptRouteDependencies,
} from './chat-transcript-routes';
import type { LegacyRouteHandler } from './legacy-route';

export type ChatRouteDependencies = ChatPromptRouteDependencies &
  ChatManagementRouteDependencies &
  ChatTranscriptRouteDependencies &
  ChatSnapshotRouteDependencies;

export function createChatRouteHandler(deps: ChatRouteDependencies): LegacyRouteHandler {
  const handlers = [
    createChatPromptRouteHandler(deps),
    createChatManagementRouteHandler(deps),
    createChatTranscriptRouteHandler(deps),
    createChatSnapshotRouteHandler(deps),
  ];
  return async (request) => {
    for (const handler of handlers) {
      if (await handler(request)) return true;
    }
    return false;
  };
}
