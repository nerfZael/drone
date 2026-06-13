import React from 'react';
import { TranscriptSkeleton } from './TranscriptSkeleton';

type ChatTranscriptFrameProps = {
  loading: boolean;
  loadingMessage?: string;
  hasContent: boolean;
  emptyState: React.ReactNode;
  children: React.ReactNode;
};

export function ChatTranscriptFrame({
  loading,
  loadingMessage = 'Loading chat messages...',
  hasContent,
  emptyState,
  children,
}: ChatTranscriptFrameProps) {
  return (
    <div className="h-full min-h-0 min-w-0 overflow-auto">
      {loading ? (
        <TranscriptSkeleton message={loadingMessage} />
      ) : hasContent ? (
        <div className="mx-auto flex max-w-[1170px] flex-col gap-6 px-6 py-5">
          {children}
        </div>
      ) : (
        emptyState
      )}
    </div>
  );
}
