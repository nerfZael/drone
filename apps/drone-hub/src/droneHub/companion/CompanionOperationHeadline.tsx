import React from 'react';
import type { CompanionProposalOperation } from '@drone/assistant-chat';

function Name({ children }: { children: React.ReactNode }) {
  return <span className="font-[var(--weight-medium)] text-[var(--fg)]">{children}</span>;
}

const ACTION_TONE_CLASS: Record<'create' | 'delete' | 'clone' | 'rename' | 'message', string> = {
  create: 'text-[var(--green)]',
  delete: 'text-[var(--red)]',
  clone: 'text-[var(--accent)]',
  rename: 'text-[var(--yellow)]',
  message: 'text-[var(--info)]',
};

function Action({ kind, children }: { kind: keyof typeof ACTION_TONE_CLASS; children: React.ReactNode }) {
  return (
    <span className={`font-[var(--weight-semibold)] ${ACTION_TONE_CLASS[kind]}`}>{children}</span>
  );
}

/** Operation headline: a fixed, colored action verb followed by what it applies to. */
export function CompanionOperationHeadline({
  operation,
  droneLabel,
}: {
  operation: CompanionProposalOperation;
  droneLabel(droneId: string): string;
}) {
  const drone = 'droneId' in operation ? droneLabel(operation.droneId) : '';
  switch (operation.type) {
    case 'create_group':
      return <><Action kind="create">Create group</Action> <Name>{operation.name}</Name></>;
    case 'delete_group':
      return <><Action kind="delete">Delete group</Action> <Name>{operation.name}</Name> and its contents</>;
    case 'rename_group':
      return <><Action kind="rename">Rename group</Action> <Name>{operation.name}</Name> to <Name>{operation.newName}</Name></>;
    case 'create_drone':
      return (
        <>
          <Action kind="create">{operation.draft ? 'Create draft drone' : 'Create drone'}</Action>
          {operation.name ? <> <Name>{operation.name}</Name></> : null}
        </>
      );
    case 'clone_drone':
      return <><Action kind="clone">Clone drone</Action> <Name>{operation.sourceDroneId}</Name> as <Name>{operation.name}</Name></>;
    case 'delete_drone':
      return <><Action kind="delete">Delete drone</Action> <Name>{drone}</Name></>;
    case 'rename_drone':
      return <><Action kind="rename">Rename drone</Action> <Name>{drone}</Name> to <Name>{operation.newName}</Name></>;
    case 'create_chat':
      return <><Action kind="create">{operation.draft ? 'Create draft chat' : 'Create chat'}</Action> <Name>{operation.chatName}</Name> in <Name>{drone}</Name></>;
    case 'clone_chat':
      return <><Action kind="clone">{operation.sideChat ? 'Fork as side chat' : 'Clone chat'}</Action> <Name>{operation.sourceChat}</Name> as <Name>{operation.chatName}</Name> in <Name>{drone}</Name></>;
    case 'delete_chat':
      return <><Action kind="delete">Delete chat</Action> <Name>{operation.chatName}</Name> from <Name>{drone}</Name></>;
    case 'rename_chat':
      return <><Action kind="rename">Rename chat</Action> <Name>{operation.chatName}</Name> to <Name>{operation.newName}</Name></>;
    case 'create_chat_group':
      return <><Action kind="create">Create chat group</Action> <Name>{[operation.parentGroup, operation.group].filter(Boolean).join('/')}</Name> in <Name>{drone}</Name></>;
    case 'rename_chat_group':
      return <><Action kind="rename">Rename chat group</Action> <Name>{operation.group}</Name> to <Name>{operation.newName}</Name> in <Name>{drone}</Name></>;
    case 'delete_chat_group':
      return <><Action kind="delete">Delete chat group</Action> <Name>{operation.group}</Name> in <Name>{drone}</Name>, keeping its chats</>;
    case 'set_drone_group':
      return <><Action kind="rename">Move drone</Action> <Name>{drone}</Name> to <Name>{operation.group || 'Ungrouped'}</Name></>;
    case 'move_chats':
      return <><Action kind="rename">Move chats</Action> in <Name>{drone}</Name> to <Name>{operation.targetGroup || 'Root'}</Name></>;
    case 'send_message':
      return <><Action kind="message">Send message</Action> to <Name>{drone}</Name></>;
  }
}

