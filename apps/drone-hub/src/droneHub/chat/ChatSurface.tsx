import React from 'react';

import { ChatInput, type ChatInputProps } from './ChatInput';
import { ChatTranscriptFrame, type ChatTranscriptFrameProps } from './ChatTranscriptFrame';
import type { AgentChatSurfaceAdapter } from './agent-chat-surface-adapters';

const ChatSurfaceAdapterContext = React.createContext<AgentChatSurfaceAdapter | null>(null);

export type ChatSurfaceProps = {
  adapter: AgentChatSurfaceAdapter;
  children: React.ReactNode;
  overlay?: React.ReactNode;
  className?: string;
  rootRef?: React.Ref<HTMLDivElement>;
  ariaHidden?: boolean;
};

export function ChatSurface({
  adapter,
  children,
  overlay,
  className = '',
  rootRef,
  ariaHidden,
}: ChatSurfaceProps) {
  return (
    <ChatSurfaceAdapterContext.Provider value={adapter}>
      <div
        ref={rootRef}
        data-chat-surface="true"
        data-agent-type={adapter.agentType}
        data-tool-activity={adapter.capabilities.toolActivity}
        aria-hidden={ariaHidden}
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col ${className}`}
      >
        {children}
        {overlay}
      </div>
    </ChatSurfaceAdapterContext.Provider>
  );
}

export type ChatSurfaceTranscriptProps = ChatTranscriptFrameProps & {
  scrollRef?: React.Ref<HTMLDivElement>;
};

export function ChatSurfaceTranscript({
  scrollRef,
  contentRef,
  loading,
  loadingMessage,
  hasContent,
  emptyState,
  children,
}: ChatSurfaceTranscriptProps) {
  return (
    <div className="relative min-h-0 flex-1">
      <ChatTranscriptFrame
        ref={scrollRef}
        contentRef={contentRef}
        loading={loading}
        loadingMessage={loadingMessage}
        hasContent={hasContent}
        emptyState={emptyState}
      >
        {children}
      </ChatTranscriptFrame>
    </div>
  );
}

export type ChatSurfaceComposerProps = Omit<
  ChatInputProps,
  'attachmentsEnabled' | 'attachmentMode' | 'allowSendWhileWaiting'
> & {
  overlay?: React.ReactNode;
};

export function ChatSurfaceComposer({ overlay, ...composer }: ChatSurfaceComposerProps) {
  const adapter = React.useContext(ChatSurfaceAdapterContext);
  if (!adapter) throw new Error('ChatSurfaceComposer must be rendered inside ChatSurface.');
  const { attachments, sendWhileWaiting } = adapter.capabilities;

  return (
    <div className="relative flex-shrink-0">
      {overlay}
      <ChatInput
        {...composer}
        attachmentsEnabled={attachments !== 'none'}
        attachmentMode={attachments === 'files' ? 'files' : 'images'}
        allowSendWhileWaiting={sendWhileWaiting}
      />
    </div>
  );
}
