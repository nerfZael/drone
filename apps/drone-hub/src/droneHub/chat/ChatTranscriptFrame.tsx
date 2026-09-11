import React from 'react';
import { ChatLoadingState } from './ChatLoadingState';
import { recordChatRenderDuration } from '../app/chat-load-telemetry';

export type ChatTranscriptFrameProps = {
  loading: boolean;
  loadingMessage?: string;
  hasContent: boolean;
  emptyState: React.ReactNode;
  children: React.ReactNode;
  contentRef?: React.Ref<HTMLDivElement>;
};

export const ChatTranscriptFrame = React.forwardRef<HTMLDivElement, ChatTranscriptFrameProps>(function ChatTranscriptFrame(
  {
    loading,
    loadingMessage = 'Loading conversation…',
    hasContent,
    emptyState,
    children,
    contentRef,
  },
  ref,
) {
  return (
    <React.Profiler id="transcript" onRender={(_id, _phase, duration) => recordChatRenderDuration(duration)}>
    <div ref={ref} data-chat-transcript-scroll="true" className="h-full min-h-0 min-w-0 overflow-auto">
      {loading ? (
        <ChatLoadingState message={loadingMessage} />
      ) : hasContent ? (
        <div ref={contentRef} className="dh-chat-transcript mx-auto flex max-w-[1170px] flex-col gap-6 px-6 py-5">
          {children}
        </div>
      ) : (
        emptyState
      )}
    </div>
    </React.Profiler>
  );
});
