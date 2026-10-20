import React from 'react';
import { Popover } from 'radix-ui';
import { UiActionMenu, type UiActionMenuEntry } from '../../ui/components';
import { IconMore } from '../overview/icons';
import type { DroneSummary } from '../types';
import { useChatClipboardStore } from '../app/chat-clipboard-store';
import type { ChannelMember, ChannelSubscriptionMode } from './channels-api';
import { chatDisplayName, subscriptionLabel } from './channel-presentation';
import { ChannelAvatar } from './ChannelMessageList';
import { IconAt, IconBell, IconBellOff, IconCheckSmall, IconNoRead, IconNoSend, IconPlusSmall } from './channel-icons';
import { useChatDropTarget, type DroppedChat } from './use-chat-drop-target';

type Props = {
  members: ChannelMember[];
  droneById: Readonly<Record<string, DroneSummary>>;
  onAdd: (chats: DroppedChat[]) => void;
  onRemove: (member: ChannelMember) => void;
  onUpdate: (member: ChannelMember, input: { canRead?: boolean; canSend?: boolean; subscription?: ChannelSubscriptionMode }) => void;
  onOpenChat: (droneId: string, chatName: string) => void;
  busyChatIds: ReadonlySet<string>;
};

function SubscriptionIcon({ mode, className }: { mode: ChannelSubscriptionMode; className?: string }) {
  if (mode === 'all') return <IconBell className={className} />;
  if (mode === 'mentions') return <IconAt className={className} />;
  return <IconBellOff className={className} />;
}

function AddChatsPicker({
  members,
  droneById,
  onAdd,
}: {
  members: ChannelMember[];
  droneById: Readonly<Record<string, DroneSummary>>;
  onAdd: (chats: DroppedChat[]) => void;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const copiedChats = useChatClipboardStore((state) => state.chats);
  const memberKeys = new Set(members.map((member) => `${member.droneId}\u0000${member.chatName}`));
  const needle = query.trim().toLowerCase();
  const groups = Object.values(droneById)
    .map((drone) => {
      const chats = [...new Set([...(drone.chats ?? []), ...(drone.sideChats ?? []).map((chat) => chat.name)])];
      const droneMatches = !needle || drone.name.toLowerCase().includes(needle);
      return {
        drone,
        chats: chats.filter((chatName) => droneMatches || chatName.toLowerCase().includes(needle)),
      };
    })
    .filter((group) => group.chats.length > 0)
    .sort((a, b) => a.drone.name.localeCompare(b.drone.name));
  return (
    <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          className="inline-flex h-6 items-center gap-1 rounded-[var(--radius-medium)] px-1.5 text-11 text-[var(--accent)] hover:bg-[var(--hover)]"
          title="Add chats to this channel"
        >
          <IconPlusSmall className="h-3.5 w-3.5" />
          Add
        </button>
      </Popover.Trigger>
      <Popover.Portal container={triggerRef.current?.ownerDocument.body}>
        <Popover.Content
          align="end"
          sideOffset={4}
          collisionPadding={8}
          onOpenAutoFocus={(event) => event.preventDefault()}
          className="z-50 flex max-h-[min(60vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--shadow-dialog)]"
        >
          <div className="border-b border-[var(--border-subtle)] p-1.5">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search drones and chats"
              aria-label="Search drones and chats"
              className="h-7 w-full rounded-[var(--radius-medium)] border border-[var(--field-border)] bg-[var(--field-bg)] px-2 text-xs text-[var(--field-fg)] placeholder:text-[var(--field-placeholder)] focus:border-[var(--accent-border)] focus:outline-none"
            />
          </div>
          {copiedChats.length ? (
            <button
              type="button"
              onClick={() => onAdd(copiedChats.map(({ droneId, chatName }) => ({ droneId, chatName })))}
              className="mx-1 mt-1 flex items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5 text-left text-xs text-[var(--accent)] hover:bg-[var(--hover)]"
            >
              <IconPlusSmall className="h-3.5 w-3.5" />
              Add {copiedChats.length === 1 ? 'the copied chat' : `${copiedChats.length} copied chats`}
            </button>
          ) : null}
          <div role="listbox" aria-label="Chats" className="min-h-0 flex-1 overflow-y-auto p-1">
            {groups.map(({ drone, chats }) => (
              <div key={drone.id} className="pb-1">
                <div className="truncate px-2 pb-0.5 pt-1.5 text-[10px] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                  {drone.name}
                </div>
                {chats.map((chatName) => {
                  const member = memberKeys.has(`${drone.id}\u0000${chatName}`);
                  return (
                    <button
                      key={chatName}
                      type="button"
                      role="option"
                      aria-selected={member}
                      disabled={member}
                      onClick={() => onAdd([{ droneId: drone.id, chatName }])}
                      className="flex w-full min-w-0 items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1 text-left text-xs text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:cursor-default disabled:text-[var(--muted)] disabled:hover:bg-transparent"
                    >
                      <span className="min-w-0 flex-1 truncate">{chatName}</span>
                      {member ? <IconCheckSmall className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" /> : null}
                    </button>
                  );
                })}
              </div>
            ))}
            {groups.length === 0 ? (
              <p className="px-2 py-3 text-xs text-[var(--muted)]">{needle ? `No chat matches “${query.trim()}”.` : 'No chats yet.'}</p>
            ) : null}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function MemberRow({
  member,
  busy,
  onRemove,
  onUpdate,
  onOpenChat,
}: {
  member: ChannelMember;
  busy: boolean;
  onRemove: () => void;
  onUpdate: Props['onUpdate'];
  onOpenChat: Props['onOpenChat'];
}) {
  const display = chatDisplayName(member);
  const subscriptionEntries: UiActionMenuEntry[] = [
    { kind: 'label', id: 'heading', label: 'Wake this chat on' },
    ...(['mentions', 'all', 'none'] as const).map((mode) => ({
      id: mode,
      label: subscriptionLabel(mode),
      icon: <SubscriptionIcon mode={mode} className="h-3.5 w-3.5" />,
      selectionRole: 'radio' as const,
      checked: member.subscription === mode,
      disabled: mode !== 'none' && (!member.canRead || !member.available),
    })),
  ];
  const moreEntries: UiActionMenuEntry[] = [
    { id: 'read', label: 'Can read messages', selectionRole: 'checkbox', checked: member.canRead },
    { id: 'send', label: 'Can send messages', selectionRole: 'checkbox', checked: member.canSend },
    { kind: 'separator', id: 'separator-open' },
    { id: 'open', label: 'Open chat', disabled: !member.available },
    { kind: 'separator', id: 'separator-remove' },
    { id: 'remove', label: 'Remove from channel', tone: 'danger' },
  ];
  const subscriptionTitle = !member.canRead
    ? 'Read access is off, so nothing in this channel wakes the chat'
    : `Subscription: ${subscriptionLabel(member.subscription, member.subscriptionPaused)}`;
  const addedBy = member.addedBy.kind === 'chat' ? `Added by ${member.addedBy.label}` : 'Added by you';
  return (
    <div
      className={`group flex min-w-0 items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5 hover:bg-[var(--hover)] ${member.available ? '' : 'opacity-55'}`}
      title={`${member.droneName} / ${member.chatName} · @${member.handle}\n${addedBy}${member.available ? '' : '\nArchived or deleted'}`}
      data-channel-member={member.chatId}
    >
      <ChannelAvatar author={{ kind: 'chat', chatId: member.chatId, droneName: member.droneName, chatName: member.chatName }} size="small" />
      <button
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => member.available && onOpenChat(member.droneId, member.chatName)}
        disabled={!member.available}
      >
        <span className="block truncate text-12 font-[var(--weight-medium)] text-[var(--fg)]">{display.name}</span>
        <span className="block truncate text-10 text-[var(--muted)]">
          {display.drone ? `${display.drone} · ` : ''}@{member.handle}
          {member.available ? '' : ' · unavailable'}
        </span>
      </button>
      {!member.canRead ? (
        <span title="Cannot read this channel" className="shrink-0 text-[var(--yellow)]"><IconNoRead className="h-3.5 w-3.5" /></span>
      ) : null}
      {!member.canSend ? (
        <span title="Cannot send messages" className="shrink-0 text-[var(--yellow)]"><IconNoSend className="h-3.5 w-3.5" /></span>
      ) : null}
      <div className={member.subscription === 'none' || !member.canRead ? 'text-[var(--muted-dim)]' : member.subscription === 'all' ? 'text-[var(--accent)]' : 'text-[var(--fg-secondary)]'}>
        <UiActionMenu
          label={subscriptionTitle}
          icon={<SubscriptionIcon mode={member.canRead ? member.subscription : 'none'} className="h-3.5 w-3.5" />}
          size="xsmall"
          disabled={busy}
          entries={subscriptionEntries}
          onSelect={(id) => onUpdate(member, { subscription: id as ChannelSubscriptionMode })}
          className="[&_button]:!border-transparent [&_button]:!bg-transparent"
        />
      </div>
      <div className="opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <UiActionMenu
          label={`Member options for ${display.name}`}
          icon={<IconMore className="h-3.5 w-3.5" />}
          size="xsmall"
          disabled={busy}
          entries={moreEntries}
          onSelect={(id) => {
            if (id === 'read') onUpdate(member, { canRead: !member.canRead });
            else if (id === 'send') onUpdate(member, { canSend: !member.canSend });
            else if (id === 'open') onOpenChat(member.droneId, member.chatName);
            else if (id === 'remove') onRemove();
          }}
          className="[&_button]:!border-transparent [&_button]:!bg-transparent"
        />
      </div>
    </div>
  );
}

/**
 * Who is in the channel and what wakes them. Chats join by search, by dragging them in from
 * the sidebar, the Chats window or a canvas, or by pasting chats copied there.
 */
export function ChannelMembersPanel({ members, droneById, onAdd, onRemove, onUpdate, onOpenChat, busyChatIds }: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const drop = useChatDropTarget(rootRef, droneById, onAdd);
  return (
    <aside
      ref={rootRef}
      tabIndex={-1}
      aria-label="Channel members"
      className={`flex min-h-0 w-full flex-col outline-none transition-shadow ${drop.over ? 'shadow-[inset_0_0_0_2px_var(--accent)]' : ''}`}
      {...drop.props}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-3">
        <span className="dh-type-eyebrow">Members</span>
        <span className="text-10 tabular-nums text-[var(--muted)]">{members.length + 1}</span>
        <div className="ml-auto">
          <AddChatsPicker members={members} droneById={droneById} onAdd={onAdd} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        <div className="flex items-center gap-2 rounded-[var(--radius-medium)] px-2 py-1.5" title="You are in every channel. Agents mention you as @user.">
          <ChannelAvatar author={{ kind: 'user', handle: 'user' }} size="small" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-12 font-[var(--weight-medium)] text-[var(--user)]">You</span>
            <span className="block truncate text-10 text-[var(--muted)]">@user</span>
          </span>
        </div>
        {members.map((member) => (
          <MemberRow
            key={member.chatId}
            member={member}
            busy={busyChatIds.has(member.chatId)}
            onRemove={() => onRemove(member)}
            onUpdate={onUpdate}
            onOpenChat={onOpenChat}
          />
        ))}
        {members.length === 0 ? (
          <p className="px-2 py-3 text-11 leading-relaxed text-[var(--muted)]">
            Only you so far. Add agent chats with Add, by dragging them here from the sidebar, the Chats window or a
            canvas, or by pasting chats you copied there.
          </p>
        ) : null}
      </div>
    </aside>
  );
}
