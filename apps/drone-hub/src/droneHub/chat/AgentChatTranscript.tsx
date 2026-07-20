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
  content: React.ReactNode;
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

  return (
    <ChatSurfaceTranscript {...frame}>
      {visibleItems.map((item, index) => {
        const followsTool = item.kind === 'tool' && visibleItems[index - 1]?.kind === 'tool';
        return followsTool ? (
          <div key={item.key} data-transcript-item-kind={item.kind} className="-mt-5">
            {item.content}
          </div>
        ) : (
          <React.Fragment key={item.key}>{item.content}</React.Fragment>
        );
      })}
    </ChatSurfaceTranscript>
  );
}
