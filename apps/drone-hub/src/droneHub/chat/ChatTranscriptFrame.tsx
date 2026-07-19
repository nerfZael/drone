import React from 'react';
import { TranscriptSkeleton } from './TranscriptSkeleton';

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
    loadingMessage = 'Loading chat messages...',
    hasContent,
    emptyState,
    children,
    contentRef,
  },
  ref,
) {
  return (
    <div ref={ref} className="h-full min-h-0 min-w-0 overflow-auto">
      {loading ? (
        <TranscriptSkeleton message={loadingMessage} />
      ) : hasContent ? (
        <div ref={contentRef} className="mx-auto flex max-w-[1170px] flex-col gap-6 px-6 py-5">
          {children}
        </div>
      ) : (
        emptyState
      )}
    </div>
  );
});
