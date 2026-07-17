import type { HubAssistantService } from '../src/hub/assistant';

let nextChatId = 0;

export function ensureTestNativeChat(
  service: HubAssistantService,
  input: {
    id?: string;
    droneId?: string;
    chatName?: string;
    provider?: string;
    model?: string;
    thinkingLevel?: string;
  } = {},
) {
  nextChatId += 1;
  const id = input.id ?? `native-test-chat-${nextChatId}`;
  const chatName = input.chatName ?? id;
  return service.ensureNativeThread({
    id,
    droneId: input.droneId ?? 'native-test-drone',
    chatName,
    title: chatName,
    provider: input.provider,
    model: input.model,
    thinkingLevel: input.thinkingLevel,
  });
}
