import React from 'react';

import { ChatInput, type ChatInputProps } from './ChatInput';
import { ChatLoadingState } from './ChatLoadingState';
import { ChatTranscriptFrame, type ChatTranscriptFrameProps } from './ChatTranscriptFrame';
import type { AgentChatSurfaceAdapter } from './agent-chat-surface-adapters';
import { droneNamesForReferences, pastedChatReferences } from '../app/chat-clipboard-store';
import {
  appendComposerReferences,
  composerReferenceTile,
  mergeComposerReferences,
  type ComposerReference,
} from './composer-references';

const ChatSurfaceAdapterContext = React.createContext<AgentChatSurfaceAdapter | null>(null);

export function useAgentChatSurfaceAdapter(): AgentChatSurfaceAdapter {
  const adapter = React.useContext(ChatSurfaceAdapterContext);
  if (!adapter) throw new Error('Agent chat surface components must be rendered inside ChatSurface.');
  return adapter;
}

export type ChatSurfaceProps = {
  adapter: AgentChatSurfaceAdapter;
  children: React.ReactNode;
  className?: string;
  ariaHidden?: boolean;
};

export function ChatSurface({ adapter, children, className = '', ariaHidden }: ChatSurfaceProps) {
  return (
    <ChatSurfaceAdapterContext.Provider value={adapter}>
      <div
        data-chat-surface="true"
        data-agent-type={adapter.agentType}
        data-tool-activity={adapter.capabilities.toolActivity}
        aria-hidden={ariaHidden}
        className={`relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-background)] [container-type:size] ${className}`}
      >
        {children}
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
    <div data-chat-transcript-surface="true" className="relative min-h-0 flex-1">
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
  const adapter = useAgentChatSurfaceAdapter();
  const { attachments, sendWhileWaiting } = adapter.capabilities;
  const references = useComposerPastedReferences(composer.resetKey);
  const { onSend, onSendInNewChat } = composer;
  const { send: sendWithReferences } = references;
  const onSendWithReferences = React.useCallback<ChatInputProps['onSend']>(
    (payload, context) => sendWithReferences(onSend, payload, context),
    [onSend, sendWithReferences],
  );
  const onSendInNewChatWithReferences = React.useMemo<ChatInputProps['onSendInNewChat']>(
    () => onSendInNewChat ? (payload, context) => sendWithReferences(onSendInNewChat, payload, context) : undefined,
    [onSendInNewChat, sendWithReferences],
  );

  return (
    <div className="relative flex-shrink-0" onPasteCapture={references.onPasteCapture}>
      {overlay}
      <ChatInput
        {...composer}
        onSend={onSendWithReferences}
        onSendInNewChat={onSendInNewChatWithReferences}
        referenceTiles={references.tiles}
        attachmentsEnabled={attachments !== 'none'}
        attachmentMode={attachments === 'files' ? 'files' : 'images'}
        allowSendWhileWaiting={sendWhileWaiting}
      />
    </div>
  );
}

/**
 * Drones and chats copied on the canvas or in the Chats window, pasted into an agent chat
 * composer: shown as tiles, and their names and IDs go out with the next message.
 */
function useComposerPastedReferences(resetKey: string) {
  const [state, setState] = React.useState<{ references: ComposerReference[]; droneNames: Record<string, string> }>(
    { references: [], droneNames: {} },
  );
  const stateRef = React.useRef(state);
  stateRef.current = state;
  // Another chat in the same composer starts without the previous chat's references.
  React.useEffect(() => setState({ references: [], droneNames: {} }), [resetKey]);
  const onPasteCapture = React.useCallback((event: React.ClipboardEvent) => {
    const pasted = pastedChatReferences(event.clipboardData);
    if (!pasted) return;
    event.preventDefault();
    event.stopPropagation();
    setState((current) => ({
      references: mergeComposerReferences(current.references, pasted.references),
      droneNames: { ...current.droneNames, ...pasted.droneNames },
    }));
  }, []);
  const send = React.useCallback(
    async (
      submit: ChatInputProps['onSend'],
      payload: Parameters<ChatInputProps['onSend']>[0],
      context: Parameters<ChatInputProps['onSend']>[1],
    ) => {
      const { references, droneNames } = stateRef.current;
      if (references.length === 0) return submit(payload, context);
      const sent = await submit(
        { ...payload, prompt: appendComposerReferences(payload.prompt, references, droneNamesForReferences(droneNames)) },
        context,
      );
      if (sent) {
        setState((current) => ({ ...current, references: current.references.filter((reference) => !references.includes(reference)) }));
      }
      return sent;
    },
    [],
  );
  const tiles = React.useMemo(() => {
    const names = droneNamesForReferences(state.droneNames);
    return state.references.map((reference) => ({
      ...composerReferenceTile(reference, names),
      onRemove: () => setState((current) => ({ ...current, references: current.references.filter((item) => item !== reference) })),
    }));
  }, [state]);
  return { onPasteCapture, send, tiles };
}

export type ChatSurfaceLoadingViewProps = Pick<
  ChatInputProps,
  | 'resetKey'
  | 'draftPersistenceKey'
  | 'droneName'
  | 'draftValue'
  | 'onDraftValueChange'
  | 'focusTargetId'
> & {
  loadingMessage?: string;
};

export function ChatSurfaceLoadingView({
  resetKey,
  draftPersistenceKey,
  droneName,
  draftValue,
  onDraftValueChange,
  focusTargetId,
  loadingMessage,
}: ChatSurfaceLoadingViewProps) {
  return (
    <>
      <div className="relative min-h-0 flex-1">
        <ChatLoadingState message={loadingMessage} />
      </div>
      <ChatSurfaceComposer
        resetKey={resetKey}
        draftPersistenceKey={draftPersistenceKey}
        droneName={droneName}
        draftValue={draftValue}
        onDraftValueChange={onDraftValueChange}
        focusTargetId={focusTargetId}
        promptError={null}
        waiting={false}
        disabled
        onSend={async () => false}
      />
    </>
  );
}
