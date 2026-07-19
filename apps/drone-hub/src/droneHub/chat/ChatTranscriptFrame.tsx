import React from 'react';
import { ChatLoadingState } from './ChatLoadingState';

const useClientLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect;

export type ChatTranscriptFrameProps = {
  loading: boolean;
  loadingMessage?: string;
  hasContent: boolean;
  emptyState: React.ReactNode;
  children: React.ReactNode;
  contentRef?: React.Ref<HTMLDivElement>;
  initialScrollKey?: string;
};

export const ChatTranscriptFrame = React.forwardRef<HTMLDivElement, ChatTranscriptFrameProps>(function ChatTranscriptFrame(
  {
    loading,
    loadingMessage = 'Loading conversation…',
    hasContent,
    emptyState,
    children,
    contentRef,
    initialScrollKey,
  },
  ref,
) {
  const scrollNodeRef = React.useRef<HTMLDivElement | null>(null);
  const lastInitialScrollKeyRef = React.useRef<string | null>(null);
  React.useImperativeHandle(ref, () => scrollNodeRef.current as HTMLDivElement);

  useClientLayoutEffect(() => {
    if (!initialScrollKey || loading || !hasContent) return;
    if (lastInitialScrollKeyRef.current === initialScrollKey) return;

    const scrollToBottom = () => {
      const node = scrollNodeRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    };
    scrollToBottom();
    // Selection effects can replace the previous chat's cached content after this layout pass.
    // Only mark the new chat as initialized once that state has had a frame to settle.
    const frame = requestAnimationFrame(() => {
      scrollToBottom();
      lastInitialScrollKeyRef.current = initialScrollKey;
    });
    return () => cancelAnimationFrame(frame);
  }, [hasContent, initialScrollKey, loading]);

  return (
    <div ref={scrollNodeRef} className="h-full min-h-0 min-w-0 overflow-auto">
      {loading ? (
        <ChatLoadingState message={loadingMessage} />
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
