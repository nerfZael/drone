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
  | 'automation'
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

  return (
    <ChatSurfaceTranscript {...frame}>
      {items.map((item) => {
        if (item.kind === 'tool' && !toolActivityVisible) return null;
        return <React.Fragment key={item.key}>{item.content}</React.Fragment>;
      })}
    </ChatSurfaceTranscript>
  );
}
