import React from 'react';
import { ChatSurface, adaptNativeAgentChatSurface } from '../chat';
import { AssistantDock, type AssistantMessageFeatures } from '../assistant/AssistantDock';
import { GroupMultiChatColumn, type GroupMultiChatColumnProps } from './GroupMultiChatColumn';
import type { WorkspaceSideChat } from './use-workspace-side-chats';
import { SideChatForkContext } from '../chat/SideChatForkContext';

type Props = Pick<
  GroupMultiChatColumnProps,
  | 'drone'
  | 'onSendPromptInNewChat'
  | 'onCreateQueuedNewChatNow'
  | 'onCreateNewChatAutoFocusHandled'
  | 'promotingNewChatActionById'
  | 'promoteNewChatActionErrorById'
> & {
  chat: WorkspaceSideChat;
  busy: boolean;
  messageFeatures: AssistantMessageFeatures;
  onKeep(): void;
  onOpenSource(): void;
};

const nativeAdapter = adaptNativeAgentChatSurface();

export function WorkspaceSideChatContent({
  chat,
  drone,
  busy,
  onKeep,
  onOpenSource,
  messageFeatures,
  ...actions
}: Props) {
  return (
    <SideChatForkContext.Provider
      value={{
        droneId: drone.id,
        chatName: chat.name,
        busy,
        supported:
          chat.agent.kind === 'native' ||
          ['codex', 'claude', 'opencode'].includes(chat.agent.id ?? ''),
      }}
    >
      <div
        data-side-chat-name={chat.name}
        className="flex h-full min-h-0 min-w-0 flex-col bg-[var(--chat-background)]"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-2 py-1 text-[var(--text-10)] text-[var(--muted)]">
          <button
            className="min-w-0 flex-1 truncate text-left hover:text-[var(--accent)]"
            onClick={onOpenSource}
            title={`Open source chat · checkpoint ${chat.checkpointId}`}
          >
            Branched from {chat.sourceChatName}
          </button>
          <button
            disabled={busy}
            onClick={onKeep}
            className="shrink-0 hover:text-[var(--accent)] disabled:opacity-50"
          >
            Keep in sidebar
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {chat.agent.kind === 'native' ? (
            <ChatSurface adapter={nativeAdapter}>
              <AssistantDock
                {...actions}
                onCreateQueuedNewChatNow={(id) => actions.onCreateQueuedNewChatNow(id, chat.name)}
                nativeChat={{ droneId: drone.id, chatName: chat.name }}
                messageFeatures={messageFeatures}
                autoFocus={false}
                focusTargetId={`side-chat:${chat.name}`}
              />
            </ChatSurface>
          ) : (
            <GroupMultiChatColumn
              {...actions}
              compact
              drone={{ ...drone, sideChats: [...(drone.sideChats ?? []), chat] }}
              preferredChat={chat.name}
              onOpenDrone={onOpenSource}
              onDeleteDrone={() => {}}
              focusedNewChatActionId=""
              columnWidthPx={320}
            />
          )}
        </div>
      </div>
    </SideChatForkContext.Provider>
  );
}
