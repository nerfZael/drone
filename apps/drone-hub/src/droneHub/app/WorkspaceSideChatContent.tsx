import React from 'react';
import { SideChatControls } from './SideChatControls';
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
  onOpenAsMain(): void;
};

const nativeAdapter = adaptNativeAgentChatSurface();

export function WorkspaceSideChatContent({
  chat,
  drone,
  busy,
  onKeep,
  onOpenSource,
  onOpenAsMain,
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
        <SideChatControls chat={chat} busy={busy} onKeep={onKeep} onOpenSource={onOpenSource} onMove={onOpenAsMain} />
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
              onOpenFileReference={messageFeatures.onOpenFileReference}
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
