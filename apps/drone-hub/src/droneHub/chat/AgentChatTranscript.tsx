import React from 'react';

import {
  ChatSurfaceTranscript,
  type ChatSurfaceTranscriptProps,
  useAgentChatSurfaceAdapter,
} from './ChatSurface';

export type AgentChatTranscriptItemKind =
  | 'message'
  | 'tool'
  | 'pending'
  | 'approval'
  | 'status'
  | 'sentinel';

export type AgentChatTranscriptItem = {
  key: string;
  kind: AgentChatTranscriptItemKind;
  latestActivityEligible?: boolean;
  content:
    | React.ReactNode
    | ((state: { isLatestActivity: boolean }) => React.ReactNode);
};

export type AgentChatTranscriptProps = Omit<ChatSurfaceTranscriptProps, 'children'> & {
  items: AgentChatTranscriptItem[];
};

export function AgentChatTranscript({ items, ...frame }: AgentChatTranscriptProps) {
  const adapter = useAgentChatSurfaceAdapter();
  const toolActivityVisible = adapter.capabilities.toolActivity === 'visible';
  const visibleItems = toolActivityVisible
    ? items
    : items.filter((item) => item.kind !== 'tool');
  let latestActivityIndex = -1;
  for (let index = visibleItems.length - 1; index >= 0; index -= 1) {
    const item = visibleItems[index];
    if (item?.latestActivityEligible === false) continue;
    const kind = item?.kind;
    if (kind === 'message' || kind === 'tool' || kind === 'pending') {
      latestActivityIndex = index;
      break;
    }
  }

  return (
    <ChatSurfaceTranscript {...frame}>
      {visibleItems.map((item, index) => {
        const followsTool = item.kind === 'tool' && visibleItems[index - 1]?.kind === 'tool';
        const content = typeof item.content === 'function'
          ? item.content({ isLatestActivity: index === latestActivityIndex })
          : item.content;
        return followsTool ? (
          <div key={item.key} data-transcript-item-kind={item.kind} className="-mt-5">
            {content}
          </div>
        ) : (
          <React.Fragment key={item.key}>{content}</React.Fragment>
        );
      })}
    </ChatSurfaceTranscript>
  );
}
