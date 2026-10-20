import React from 'react';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { UiActionMenu, UiButton, UiPaneState, UiPanelStatusStrip, UiToolbarButton } from '../../ui/components';
import { IconMore } from '../overview/icons';
import type { DroneSummary } from '../types';
import {
  addChannelMembers,
  createChannel,
  deleteChannel,
  loadOlderChannelMessages,
  markChannelRead,
  removeChannelMember,
  renameChannel,
  sendChannelMessage,
  updateChannelMember,
  useChannelDetail,
  useChannelList,
  useChannelMessages,
  useRefreshChannels,
  type ChannelMember,
  type ChannelMessage,
  type ChannelSummary,
} from './channels-api';
import { markChannelBeingRead, useChannelsUiStore } from './channels-ui-store';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';
import { ChannelMessageList } from './ChannelMessageList';
import { ChannelComposer, channelDraftKey } from './ChannelComposer';
import { ChannelMembersPanel } from './ChannelMembersPanel';
import { IconClose, IconHash, IconList, IconPlusSmall, IconUsers } from './channel-icons';
import type { DroppedChat } from './use-chat-drop-target';

type Props = {
  droneById: Readonly<Record<string, DroneSummary>>;
  onOpenChat: (droneId: string, chatName: string) => void;
};

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function useElementWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(1000);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView ?? window;
    const observer = new view.ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 1000));
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * Whether the user is looking at this pane: shown, in the focused window. Only then does
 * reading mark the channel read, so mentions that arrive while you work elsewhere stay unread.
 */
function useBeingRead(ref: React.RefObject<HTMLElement | null>): boolean {
  const [beingRead, setBeingRead] = React.useState(false);
  React.useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const view = element.ownerDocument.defaultView ?? window;
    const update = () =>
      setBeingRead(
        element.ownerDocument.visibilityState === 'visible' && element.ownerDocument.hasFocus() && element.offsetWidth > 0,
      );
    update();
    const observer = new view.ResizeObserver(update);
    observer.observe(element);
    element.ownerDocument.addEventListener('visibilitychange', update);
    view.addEventListener('focus', update);
    view.addEventListener('blur', update);
    return () => {
      observer.disconnect();
      element.ownerDocument.removeEventListener('visibilitychange', update);
      view.removeEventListener('focus', update);
      view.removeEventListener('blur', update);
    };
  }, [ref]);
  return beingRead;
}

function NameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (name: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = React.useState(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async () => {
    const name = value.trim();
    if (!name || busy) return;
    if (name === initial.trim()) return onCancel();
    setBusy(true);
    try {
      await onSubmit(name);
    } catch (cause) {
      setError(errorText(cause));
      setBusy(false);
    }
  };
  return (
    <div className="px-1.5 py-0.5">
      <div className="flex items-center gap-1 rounded-[var(--radius-medium)] border border-[var(--accent-border)] bg-[var(--field-bg)] px-1.5">
        <IconHash className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
        <input
          autoFocus
          value={value}
          disabled={busy}
          maxLength={80}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onBlur={() => {
            if (!busy && !value.trim()) onCancel();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onCancel();
            }
          }}
          className="h-7 min-w-0 flex-1 bg-transparent text-12 text-[var(--field-fg)] outline-none placeholder:text-[var(--field-placeholder)]"
        />
      </div>
      {error ? <div className="px-1 pt-0.5 text-10 text-[var(--red)]">{error}</div> : null}
    </div>
  );
}

function ChannelList({
  channels,
  selectedId,
  onSelect,
  creating,
  onStartCreate,
  onCreate,
  onCancelCreate,
  renamingId,
  onStartRename,
  onRename,
  onCancelRename,
  onDelete,
}: {
  channels: ChannelSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  creating: boolean;
  onStartCreate: () => void;
  onCreate: (name: string) => Promise<void>;
  onCancelCreate: () => void;
  renamingId: string | null;
  onStartRename: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
  onCancelRename: () => void;
  onDelete: (channel: ChannelSummary) => void;
}) {
  return (
    <nav aria-label="Channels" className="flex min-h-0 w-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] pl-3 pr-1.5">
        <span className="dh-type-eyebrow">Channels</span>
        <button
          type="button"
          onClick={onStartCreate}
          className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--accent)]"
          title="New channel"
          aria-label="New channel"
        >
          <IconPlusSmall className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1.5">
        {channels.map((channel) =>
          renamingId === channel.id ? (
            <NameInput
              key={channel.id}
              initial={channel.name}
              placeholder="Channel name"
              onSubmit={(name) => onRename(channel.id, name)}
              onCancel={onCancelRename}
            />
          ) : (
            <div
              key={channel.id}
              className={`group mx-1.5 flex min-w-0 items-center rounded-[var(--radius-medium)] ${
                channel.id === selectedId ? 'bg-[var(--accent-subtle)]' : 'hover:bg-[var(--hover)]'
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(channel.id)}
                onDoubleClick={() => onStartRename(channel.id)}
                aria-current={channel.id === selectedId ? 'page' : undefined}
                className={`flex h-7 min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-12 ${
                  channel.id === selectedId
                    ? 'text-[var(--fg-strong)]'
                    : channel.unreadCount > 0
                      ? 'font-[var(--weight-semibold)] text-[var(--fg)]'
                      : 'text-[var(--fg-secondary)]'
                }`}
                title={`#${channel.name} · ${channel.memberCount} member chat${channel.memberCount === 1 ? '' : 's'}`}
              >
                <IconHash className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                {channel.mentionCount > 0 ? (
                  <span className="mr-1 inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-[var(--red)] px-1 text-[9px] font-[var(--weight-bold)] tabular-nums text-white" title={`${channel.mentionCount} mention${channel.mentionCount === 1 ? '' : 's'} of you`}>
                    {channel.mentionCount > 99 ? '99+' : channel.mentionCount}
                  </span>
                ) : channel.unreadCount > 0 && channel.id !== selectedId ? (
                  <span className="mr-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--fg-secondary)]" title={`${channel.unreadCount} unread`} />
                ) : null}
              </button>
              <div className="shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                <UiActionMenu
                  label={`Channel options for #${channel.name}`}
                  icon={<IconMore className="h-3.5 w-3.5" />}
                  size="xsmall"
                  entries={[
                    { id: 'rename', label: 'Rename channel' },
                    { kind: 'separator', id: 'separator' },
                    { id: 'delete', label: 'Delete channel', tone: 'danger' },
                  ]}
                  onSelect={(id) => (id === 'rename' ? onStartRename(channel.id) : onDelete(channel))}
                  className="[&_button]:!border-transparent [&_button]:!bg-transparent"
                />
              </div>
            </div>
          ),
        )}
        {creating ? (
          <NameInput initial="" placeholder="New channel name" onSubmit={onCreate} onCancel={onCancelCreate} />
        ) : (
          <button
            type="button"
            onClick={onStartCreate}
            className="mx-1.5 flex h-7 w-[calc(100%-0.75rem)] items-center gap-1.5 rounded-[var(--radius-medium)] px-2 text-left text-12 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
          >
            <IconPlusSmall className="h-3.5 w-3.5" />
            New channel
          </button>
        )}
      </div>
    </nav>
  );
}

function ChannelView({
  channel,
  droneById,
  onOpenChat,
  membersOpen,
  membersOverlay,
  onToggleMembers,
  listToggle,
  onRename,
}: {
  channel: ChannelSummary;
  droneById: Props['droneById'];
  onOpenChat: Props['onOpenChat'];
  membersOpen: boolean;
  membersOverlay: boolean;
  onToggleMembers: () => void;
  listToggle: React.ReactNode;
  onRename: () => void;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const refresh = useRefreshChannels();
  const detail = useChannelDetail(channel.id);
  const latest = useChannelMessages(channel.id);
  const [older, setOlder] = React.useState<{ messages: ChannelMessage[]; hasMore: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const loadingOlderRef = React.useRef(false);
  const [replyTo, setReplyTo] = React.useState<ChannelMessage | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busyChatIds, setBusyChatIds] = React.useState<ReadonlySet<string>>(new Set());
  // Where "New" goes: fixed when the channel opens, so reading does not move it.
  const [firstUnreadSeq, setFirstUnreadSeq] = React.useState<number | null>(() =>
    channel.lastSeq > channel.userLastReadSeq ? channel.userLastReadSeq + 1 : null,
  );
  const beingRead = useBeingRead(rootRef);
  const members = detail.data?.members ?? [];

  // Older pages count only while they still meet the newest page; a burst of more new messages
  // than one page would leave a gap, so the list then starts again from the newest page.
  const latestFirstSeq = latest.data?.messages[0]?.seq;
  const olderLastSeq = older?.messages[older.messages.length - 1]?.seq;
  const olderJoins = Boolean(older) && (latestFirstSeq === undefined || olderLastSeq === undefined || latestFirstSeq <= olderLastSeq + 1);
  React.useEffect(() => {
    if (older && !olderJoins) setOlder(null);
  }, [older, olderJoins]);
  const shownOlder = olderJoins ? older : null;
  const messages = React.useMemo(() => {
    const byId = new Map<string, ChannelMessage>();
    for (const message of shownOlder?.messages ?? []) byId.set(message.id, message);
    for (const message of latest.data?.messages ?? []) byId.set(message.id, message);
    return [...byId.values()].sort((a, b) => a.seq - b.seq);
  }, [latest.data, shownOlder]);
  const hasMore = shownOlder ? shownOlder.hasMore : Boolean(latest.data?.hasMore);
  const lastSeq = messages[messages.length - 1]?.seq ?? 0;

  React.useEffect(() => {
    if (!beingRead || !lastSeq || lastSeq <= channel.userLastReadSeq) return;
    void markChannelRead(channel.id, lastSeq).then(() => refresh()).catch(() => {});
  }, [beingRead, channel.id, channel.userLastReadSeq, lastSeq, refresh]);
  React.useEffect(() => (beingRead ? markChannelBeingRead(channel.id) : undefined), [beingRead, channel.id]);

  const loadOlder = React.useCallback(async () => {
    const first = messages[0];
    // Scroll events fire faster than state updates: the ref keeps it to one request.
    if (!first || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      const page = await loadOlderChannelMessages(channel.id, first.seq);
      // Everything shown so far stays with the older pages, so they still meet the newest page as it moves on.
      setOlder({ messages: [...page.messages, ...messages], hasMore: page.hasMore });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [channel.id, messages]);

  const run = async (chatIds: string[], work: () => Promise<unknown>) => {
    setError(null);
    setBusyChatIds((current) => new Set([...current, ...chatIds]));
    try {
      await work();
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setBusyChatIds((current) => new Set([...current].filter((id) => !chatIds.includes(id))));
      refresh(channel.id);
    }
  };
  const addMembers = (chats: DroppedChat[]) => {
    if (!chats.length) return;
    void run([], async () => {
      const result = await addChannelMembers(channel.id, chats.map(({ droneId, chatName }) => ({ droneId, chatName })));
      if (result.subscriptionErrors?.length) {
        setError(`Added, but could not subscribe ${result.subscriptionErrors.length} chat(s) to mentions: ${result.subscriptionErrors[0]!.error}`);
      }
    });
  };
  const updateMember = (member: ChannelMember, input: Parameters<typeof updateChannelMember>[2]) =>
    void run([member.chatId], () => updateChannelMember(channel.id, member.chatId, input));
  const removeMember = (member: ChannelMember) =>
    void run([member.chatId], () => removeChannelMember(channel.id, member.chatId));

  const membersPanel = (
    <ChannelMembersPanel
      members={members}
      droneById={droneById}
      onAdd={addMembers}
      onRemove={removeMember}
      onUpdate={updateMember}
      onOpenChat={onOpenChat}
      busyChatIds={busyChatIds}
    />
  );
  const loadError = detail.error ?? latest.error;
  return (
    // The composer takes the chat shortcuts (Q records, S sends) anywhere in the channel.
    <div ref={rootRef} className="relative flex min-h-0 min-w-0 flex-1" data-composer-scope="channel">
      <section aria-label={`#${channel.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-background)]">
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--border-subtle)] px-2">
          {listToggle}
          <button
            type="button"
            className="flex min-w-0 items-center gap-1 rounded-[var(--radius-medium)] px-1 py-0.5 text-left hover:bg-[var(--hover)]"
            onDoubleClick={onRename}
            title="Double-click to rename"
          >
            <IconHash className="h-4 w-4 shrink-0 text-[var(--muted)]" />
            <span className="min-w-0 truncate text-13 font-[var(--weight-semibold)] text-[var(--fg-strong)]">{channel.name}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            <UiToolbarButton
              size="xsmall"
              pressed={membersOpen}
              onClick={onToggleMembers}
              leadingIcon={<IconUsers className="h-3.5 w-3.5" />}
              title={membersOpen ? 'Hide members' : 'Show members'}
            >
              {members.length + 1}
            </UiToolbarButton>
          </div>
        </header>
        {error || loadError ? (
          <UiPanelStatusStrip
            tone="danger"
            action={
              <UiToolbarButton size="xsmall" onClick={() => { setError(null); refresh(channel.id); }}>
                Dismiss
              </UiToolbarButton>
            }
          >
            {error ?? errorText(loadError)}
          </UiPanelStatusStrip>
        ) : null}
        {latest.isLoading ? (
          <UiPaneState kind="loading" title={`Loading #${channel.name}…`} />
        ) : (
          <ChannelMessageList
            channelName={channel.name}
            messages={messages}
            members={members}
            hasMore={hasMore}
            loadingOlder={loadingOlder}
            onLoadOlder={() => void loadOlder()}
            firstUnreadSeq={firstUnreadSeq}
            onReply={setReplyTo}
            onOpenChat={onOpenChat}
            emptyState={
              <div className="px-4 pt-8">
                <div className="flex h-12 w-12 items-center justify-center rounded-[12px] bg-[var(--accent-subtle)] text-[var(--accent)]">
                  <IconHash className="h-6 w-6" />
                </div>
                <div className="mt-3 text-[20px] font-[var(--weight-semibold)] text-[var(--fg-strong)]">Welcome to #{channel.name}</div>
                <p className="mt-1 max-w-[34rem] text-12 leading-relaxed text-[var(--muted)]">
                  {members.length
                    ? 'Member chats can read and post here through the DroneHub MCP server. @mention a chat to wake it; replying to its message works too.'
                    : 'Add agent chats from the members panel, then @mention them to get their attention. They read and post here through the DroneHub MCP server.'}
                </p>
              </div>
            }
          />
        )}
        <ChannelComposer
          channelId={channel.id}
          channelName={channel.name}
          members={members.filter((member) => member.available)}
          replyTo={replyTo}
          onCancelReply={() => setReplyTo(null)}
          onSend={async (text, replyToId) => {
            await sendChannelMessage(channel.id, text, replyToId);
            setReplyTo(null);
            setFirstUnreadSeq(null);
            refresh(channel.id);
          }}
        />
      </section>
      {membersOpen ? (
        membersOverlay ? (
          <div className="absolute inset-y-0 right-0 z-20 flex w-[min(17rem,85%)] border-l border-[var(--border-subtle)] bg-[var(--panel)] shadow-[var(--shadow-dialog)]">
            {membersPanel}
          </div>
        ) : (
          <div className="flex w-[15.5rem] shrink-0 border-l border-[var(--border-subtle)] bg-[var(--panel-alt)]">{membersPanel}</div>
        )
      ) : null}
    </div>
  );
}

/**
 * Channels: chat rooms shared by the user and agent chats from any drone. The window
 * belongs to the Hub, not a drone, so switching drones leaves it as it is.
 */
export function ChannelsDock({ droneById, onOpenChat }: Props) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const width = useElementWidth(rootRef);
  const confirm = useAppConfirmDialog();
  const refresh = useRefreshChannels();
  const list = useChannelList();
  const selectedId = useChannelsUiStore((state) => state.selectedChannelId);
  const select = useChannelsUiStore((state) => state.select);
  const membersOpen = useChannelsUiStore((state) => state.membersOpen);
  const setMembersOpen = useChannelsUiStore((state) => state.setMembersOpen);
  const [creating, setCreating] = React.useState(false);
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [listOpen, setListOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const compactList = width < 560;
  const channels = list.data ?? [];
  const selected = channels.find((channel) => channel.id === selectedId) ?? null;

  // A deleted or unknown selection falls back to the first channel.
  React.useEffect(() => {
    if (!list.data || selected) return;
    const first = list.data[0]?.id ?? null;
    if (first !== selectedId) select(first);
  }, [list.data, select, selected, selectedId]);

  const create = async (name: string) => {
    const channel = await createChannel(name);
    setCreating(false);
    select(channel.id);
    setListOpen(false);
    refresh(channel.id);
  };
  const rename = async (id: string, name: string) => {
    await renameChannel(id, name);
    setRenamingId(null);
    refresh(id);
  };
  const remove = async (channel: ChannelSummary) => {
    const ok = await confirm({
      title: `Delete #${channel.name}?`,
      message: `Its messages are deleted and its ${channel.memberCount} member chat${channel.memberCount === 1 ? '' : 's'} stop receiving its messages.`,
      confirmLabel: 'Delete channel',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteChannel(channel.id);
      // Its unsent draft and editor mode go with it.
      const ui = useDroneHubUiStore.getState();
      ui.setChatInputDraft(channelDraftKey(channel.id), '');
      ui.setChatInputEditorMode(channelDraftKey(channel.id), false);
    } catch (cause) {
      setError(errorText(cause));
    }
    refresh();
  };

  const listPanel = (
    <ChannelList
      channels={channels}
      selectedId={selectedId}
      onSelect={(id) => {
        select(id);
        setListOpen(false);
      }}
      creating={creating}
      onStartCreate={() => {
        setCreating(true);
        setListOpen(true);
      }}
      onCreate={create}
      onCancelCreate={() => setCreating(false)}
      renamingId={renamingId}
      onStartRename={(id) => {
        setRenamingId(id);
        setListOpen(true);
      }}
      onRename={rename}
      onCancelRename={() => setRenamingId(null)}
      onDelete={(channel) => void remove(channel)}
    />
  );
  const unreadElsewhere = channels.some((channel) => channel.id !== selectedId && (channel.unreadCount > 0 || channel.mentionCount > 0));
  const listToggle = compactList ? (
    <button
      type="button"
      onClick={() => setListOpen((open) => !open)}
      className="relative inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-medium)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
      title={listOpen ? 'Hide channels' : 'Show channels'}
      aria-label={listOpen ? 'Hide channels' : 'Show channels'}
      aria-expanded={listOpen}
    >
      {listOpen ? <IconClose className="h-3.5 w-3.5" /> : <IconList className="h-3.5 w-3.5" />}
      {unreadElsewhere && !listOpen ? <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--red)]" /> : null}
    </button>
  ) : null;

  let content: React.ReactNode;
  if (list.isLoading) {
    content = <UiPaneState kind="loading" title="Loading channels…" />;
  } else if (list.error) {
    content = (
      <UiPaneState
        kind="error"
        title="Channels failed to load"
        description={errorText(list.error)}
        action={<UiToolbarButton onClick={() => refresh()}>Retry</UiToolbarButton>}
      />
    );
  } else if (!selected) {
    content = (
      <div className="flex min-h-0 flex-1 flex-col">
        {compactList ? <div className="flex h-10 shrink-0 items-center border-b border-[var(--border-subtle)] px-2">{listToggle}</div> : null}
        <UiPaneState
          kind="empty"
          icon={<IconHash className="h-6 w-6" />}
          title="No channels yet"
          description="Channels are chat rooms for you and your agent chats, across drones. Add chats as members and they can read, post, reply and @mention each other through the DroneHub MCP server."
          action={
            <UiButton
              variant="primary"
              onClick={() => {
                setCreating(true);
                setListOpen(true);
              }}
            >
              Create a channel
            </UiButton>
          }
        />
      </div>
    );
  } else {
    content = (
      <ChannelView
        key={selected.id}
        channel={selected}
        droneById={droneById}
        onOpenChat={onOpenChat}
        membersOpen={membersOpen}
        membersOverlay={width < 820}
        onToggleMembers={() => setMembersOpen(!membersOpen)}
        listToggle={listToggle}
        onRename={() => {
          setRenamingId(selected.id);
          setListOpen(true);
        }}
      />
    );
  }

  return (
    <div ref={rootRef} className="dh-channels relative flex h-full min-h-0 w-full flex-col bg-[var(--panel)]" data-channels-dock="">
      {error ? (
        <UiPanelStatusStrip tone="danger" action={<UiToolbarButton size="xsmall" onClick={() => setError(null)}>Dismiss</UiToolbarButton>}>
          {error}
        </UiPanelStatusStrip>
      ) : null}
      <div className="relative flex min-h-0 flex-1">
        {!compactList ? (
          <div className="flex w-[13.5rem] shrink-0 border-r border-[var(--border-subtle)] bg-[var(--panel-alt)]">{listPanel}</div>
        ) : listOpen || creating || renamingId ? (
          <div className="absolute inset-y-0 left-0 z-30 flex w-[min(15rem,85%)] border-r border-[var(--border-subtle)] bg-[var(--panel)] shadow-[var(--shadow-dialog)]">
            {listPanel}
          </div>
        ) : null}
        {content}
      </div>
    </div>
  );
}
