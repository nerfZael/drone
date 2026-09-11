import { isSideChatEntry } from './side-chat-checkpoint';
import { isWorkflowChatEntry } from './workflows/workflow-chat-metadata';

export type ChatCatalogMetadata = {
  type: 'ordinary' | 'side' | 'workflow';
  draft: boolean;
  sourceChatName?: string;
  checkpointId?: string;
};

/** Chat identity and kind are independent of sidebar visibility. */
export function chatCatalogMetadata(entry: any): ChatCatalogMetadata {
  const side = isSideChatEntry(entry);
  return {
    type: side ? 'side' : isWorkflowChatEntry(entry) ? 'workflow' : 'ordinary',
    draft: entry?.draft === true,
    ...(side && entry?.sideChatOrigin?.sourceChatName
      ? { sourceChatName: String(entry.sideChatOrigin.sourceChatName) }
      : {}),
    ...(side && entry?.sideChatOrigin?.checkpointId
      ? { checkpointId: String(entry.sideChatOrigin.checkpointId) }
      : {}),
  };
}

function cleanString(value: unknown, fallback = ''): string {
  return String(value ?? '').trim() || fallback;
}

export type McpChatListEntry = ChatCatalogMetadata & {
  name: string;
  resourceId?: string;
  agent?:
    | { kind: 'native' }
    | { kind: 'builtin'; id: string }
    | { kind: 'custom'; id: string; label: string };
  provider?: string;
  model?: string;
  reasoning?: string;
};

function normalizeMcpChatAgent(value: any): McpChatListEntry['agent'] {
  if (value?.kind === 'native') return { kind: 'native' };
  if (value?.kind === 'builtin') {
    const id = cleanString(value.id);
    return id ? { kind: 'builtin', id } : undefined;
  }
  if (value?.kind === 'custom') {
    const id = cleanString(value.id);
    const label = cleanString(value.label, id || 'Custom');
    return id ? { kind: 'custom', id, label } : undefined;
  }
  return undefined;
}

export function normalizeMcpChatList(response: any): McpChatListEntry[] {
  const draftByChat: Record<string, boolean> =
    response?.draftChats &&
    typeof response.draftChats === 'object' &&
    !Array.isArray(response.draftChats)
      ? Object.fromEntries(
          Object.entries(response.draftChats)
            .map(([name, draft]) => [cleanString(name), draft === true] as const)
            .filter(([name, draft]) => Boolean(name) && draft),
        )
      : {};
  const chatIdByName = Object.fromEntries(
    (Array.isArray(response?.chatDetails) ? response.chatDetails : [])
      .map(
        (item: any) => [cleanString(item?.chat ?? item?.name), cleanString(item?.chatId)] as const,
      )
      .filter(([name, id]: readonly [string, string]) => Boolean(name && id)),
  );
  const chatDetailByName = new Map<string, any>(
    (Array.isArray(response?.chatDetails) ? response.chatDetails : [])
      .map((item: any) => [cleanString(item?.chat ?? item?.name), item] as const)
      .filter(([name]: readonly [string, any]) => Boolean(name)),
  );
  for (const item of Array.isArray(response?.chatDetails) ? response.chatDetails : []) {
    const name = cleanString(item?.chat ?? item?.name);
    if (name && item?.draft === true) draftByChat[name] = true;
  }
  return (Array.isArray(response?.chats) ? response.chats : [])
    .map((item: any) => {
      const name =
        typeof item === 'string' ? cleanString(item) : cleanString(item?.chat ?? item?.name);
      if (!name) return null;
      const resourceId =
        (typeof item === 'object' ? cleanString(item?.chatId ?? item?.id) : '') ||
        chatIdByName[name];
      const detail = chatDetailByName.get(name) ?? (typeof item === 'object' ? item : {});
      const provider = cleanString(detail?.provider);
      const model = cleanString(detail?.model);
      const reasoning = cleanString(detail?.reasoning);
      const agent = normalizeMcpChatAgent(detail?.agent);
      return {
        name,
        type: detail?.type === 'side' || detail?.type === 'workflow' ? detail.type : 'ordinary',
        draft: (typeof item === 'object' && item?.draft === true) || draftByChat[name] === true,
        ...(cleanString(detail?.sourceChatName)
          ? { sourceChatName: cleanString(detail.sourceChatName) }
          : {}),
        ...(cleanString(detail?.checkpointId)
          ? { checkpointId: cleanString(detail.checkpointId) }
          : {}),
        ...(resourceId ? { resourceId } : {}),
        ...(agent ? { agent } : {}),
        ...(provider ? { provider } : {}),
        ...(model ? { model } : {}),
        ...(reasoning ? { reasoning } : {}),
      };
    })
    .filter((entry: McpChatListEntry | null): entry is McpChatListEntry => Boolean(entry));
}
