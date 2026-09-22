import type { ChatModelOverrides } from '../chat/selected-chat-model-overrides';
import { SelectedChatsComposer } from '../chat/SelectedChatsComposer';
import type { CanvasSendPrompt } from '../canvas/canvas-messaging';
import type { ChatInputProps } from '../chat/ChatInput';
import { useOptionalActiveComposer } from '../chat/ActiveComposerContext';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { isShortcutMatch } from './shortcuts';
import React from 'react';
import type { DroneSummary } from '../types';
import { requestJson } from '../http';
import { usePoll } from './hooks';
import { allDroneChatNames, latestChatPreview, type ChatPreviewPayload } from './drone-chats-model';
import { SidebarItemStateIndicator, sidebarChatDisplayState, sidebarDroneStateLabel } from '../overview/DroneCard';
import { DRONE_CHAT_DND_MIME, createCanvasChatNodeId } from './app-config';
import type { ComposerReference } from '../chat/composer-references';
import { busyChatNodeIdsForDrone, droneChatRequiresApproval } from './chat-node-helpers';
import { useDroneHubRuntimeStore } from './use-drone-hub-runtime-store';
import { selectSidebarChatNodes } from './sidebar-chat-selection';
import { SidebarContextMenu } from './SidebarContextMenu';
import { useChatsViewStore } from './chats-view-store';
import { chatClipboardHasContent, pastableClipboard, useChatClipboardStore } from './chat-clipboard-store';
import { runWithConcurrency } from '../canvas/clone-shortcuts';

const CHAT_PASTE_CONCURRENCY = 4;

export type DroneChatsPaneOptions = {
  renderChat: (chatName: string) => React.ReactNode;
  onSelectChat: (chatName: string) => void;
  sideChatNames: string[];
};

function ChatName({ drone, name, selected }: { drone: DroneSummary; name: string; selected: boolean }) {
  const nodeId = createCanvasChatNodeId(drone.id, name);
  const localBusy = useDroneHubRuntimeStore((state) => (state.localBusyChatCountByNodeId[nodeId] ?? 0) > 0);
  const localApproval = useDroneHubRuntimeStore((state) => Boolean(state.approvalRequiredByChatNodeId[nodeId]));
  const localUnread = useDroneHubRuntimeStore((state) => Boolean(state.unreadAgentMessageByChatNodeId[nodeId]));
  const unread = !selected && ((drone.unreadChats ?? []).includes(name) || localUnread);
  const state = sidebarChatDisplayState(drone, localBusy || busyChatNodeIdsForDrone(drone).includes(nodeId),
    localApproval || droneChatRequiresApproval(drone, name));
  const label = sidebarDroneStateLabel(state, unread);
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span role="img" aria-label={label} title={label} className="inline-flex shrink-0">
        <SidebarItemStateIndicator state={state} unread={unread} showReadyAnchor emphasized={selected} />
      </span>
      <span className="min-w-0 truncate font-medium text-[var(--fg)]" title={name}>{name}</span>
      {drone.draftChats?.[name] ? <span className="shrink-0 text-10 text-[var(--accent)]">Draft</span> : null}
    </span>
  );
}

function ChatListRow({ drone, name, active, selected, onSelect, onContextMenu, onDragStart }: {
  drone: DroneSummary; name: string; active: boolean; selected: boolean; onSelect: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onDragStart: (event: React.DragEvent<HTMLElement>) => void;
}) {
  const droneId = drone.id;
  const { value, loading, error } = usePoll(
    async (signal) => {
      const base = `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(name)}`;
      const payload = await requestJson<ChatPreviewPayload>(`${base}/messages?limit=20&maxChars=300`, { signal });
      if (payload.pendingTruncated) {
        const state = await requestJson<Pick<ChatPreviewPayload, 'pending'>>(`${base}/state?transcript=none`, { signal });
        payload.pending = state.pending;
      }
      return payload;
    }, 5000, [droneId, name],
  );
  const preview = value ? latestChatPreview(value) : null;
  return (
    <button type="button" draggable onDragStart={onDragStart} onClick={onSelect} onContextMenu={onContextMenu} aria-pressed={selected} aria-current={active ? 'true' : undefined}
      data-chat-drone-id={droneId} data-chat-name={name}
      className={`relative col-span-2 grid w-full select-none grid-cols-subgrid items-center gap-x-3 rounded-[var(--radius-medium)] px-2 py-1.5 text-left text-12 focus-visible:outline focus-visible:outline-[var(--accent)] ${
        selected ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'}`}>
      {selected ? (
        <span aria-hidden="true"
          className="pointer-events-none absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[var(--accent)] shadow-[0_0_6px_var(--accent-border)]" />
      ) : null}
      <ChatName drone={drone} name={name} selected={active} />
      {/* No speaker label: your own messages take the user tint, agent replies stay neutral. */}
      <span className="flex min-w-0 items-center"
        title={error ?? (preview ? `${preview.role === 'user' ? 'You' : 'Agent'}: ${preview.text}` : undefined)}>
        <span data-preview-role={preview && !error ? preview.role : undefined} className={`truncate ${
          error ? 'text-[var(--red)]'
            : preview?.role === 'user' ? 'text-[var(--user-muted)]'
              : selected ? 'text-[var(--fg-secondary)]' : 'text-[var(--muted)]'}`}>
          {error ? 'Preview unavailable · retrying…' : preview?.text ?? (loading ? 'Loading…' : 'No messages yet')}
        </span>
      </span>
    </button>
  );
}

export function DroneChatsDock({ drone, selectedChat, options, onDeleteChats, onSendToChats, onCloneChat, droneById }: {
  drone: DroneSummary; selectedChat: string; options: DroneChatsPaneOptions;
  /** Names drones referenced from elsewhere, e.g. dragged in from the sidebar. */
  droneById?: Record<string, DroneSummary>;
  onSendToChats?: CanvasSendPrompt;
  onCloneChat?: (droneId: string, chatName: string, opts?: { select?: boolean }) =>
    Promise<{ ok: boolean; chatName?: string; error?: string | null }>;
  onDeleteChats?: (targets: ReadonlyArray<{ droneId: string; chatName: string }>) =>
    Promise<Array<{ droneId: string; chatName: string; ok: boolean; error?: string | null }>>;
}) {
  // The dock tab picks the view, so the body keeps its full height for rows.
  const view = useChatsViewStore((state) => state.view);
  const names = allDroneChatNames(drone, options.sideChatNames);
  const [selection, setSelection] = React.useState<string[]>([selectedChat]);
  const anchorRef = React.useRef<string | null>(selectedChat);
  const [menu, setMenu] = React.useState<{ x: number; y: number; view: Window; names: string[] } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [deleteError, setDeleteError] = React.useState<string | null>(null);
  const clipboardHasChats = useChatClipboardStore((state) => chatClipboardHasContent(state, drone.id));
  React.useEffect(() => {
    setSelection([selectedChat]);
    anchorRef.current = selectedChat;
    setMenu(null);
  }, [drone.id, selectedChat]);
  const selectedNames = selection.filter((name) => names.includes(name));
  const activeComposer = useOptionalActiveComposer();
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [composerExpanded, setComposerExpanded] = React.useState(true);
  const [pendingComposerAction, setPendingComposerAction] = React.useState<'voice' | 'focus' | 'queue' | 'asap' | null>(null);
  React.useEffect(() => {
    if (!pendingComposerAction || !activeComposer) return;
    setPendingComposerAction(null);
    const root = rootRef.current?.querySelector<HTMLElement>('[data-selected-chats-composer]');
    const id = root?.querySelector<HTMLElement>('[data-active-composer-id]')?.dataset.activeComposerId;
    if (!id) return;
    activeComposer.focusComposer(id);
    if (activeComposer.ensureTargetId() !== id) return;
    if (pendingComposerAction === 'voice') activeComposer.toggleVoiceRecording();
    else if (pendingComposerAction === 'focus') root?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    else activeComposer.sendMessage(pendingComposerAction);
  }, [pendingComposerAction, activeComposer]);
  const copyChats = (chatNames: string[]) => {
    if (chatNames.length) useChatClipboardStore.getState().copy({ chats: chatNames.map((chatName) => ({ droneId: drone.id, chatName })) });
  };
  /** Clones the chats copied from this drone; the clones become the selection. */
  const pasteChats = async () => {
    const copied = pastableClipboard(useChatClipboardStore.getState(), drone.id).chats;
    if (!onCloneChat || !copied.length) return;
    setDeleteError(null);
    const pasted: string[] = [];
    const errors: string[] = [];
    await runWithConcurrency(copied, CHAT_PASTE_CONCURRENCY, async (source) => {
      try {
        const result = await onCloneChat(source.droneId, source.chatName, { select: false });
        if (result.ok && result.chatName) pasted.push(result.chatName);
        else if (!result.ok) errors.push(result.error || `Could not paste ${source.chatName}.`);
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    });
    if (pasted.length) {
      setSelection(pasted);
      anchorRef.current = pasted[0];
    }
    if (errors.length) setDeleteError(errors.join(' '));
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing) return;
    const element = event.target as HTMLElement;
    if (element.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [data-chats-individual-content]')) return;
    const key = event.key.toLowerCase();
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && (key === 'c' || key === 'v')) {
      // Selected text keeps the browser's own copy.
      if (key === 'c' && (!selectedNames.length || element.ownerDocument.getSelection()?.toString())) return;
      if (key === 'v' && (!onCloneChat || !chatClipboardHasContent(useChatClipboardStore.getState(), drone.id))) return;
      event.preventDefault();
      event.stopPropagation();
      if (key === 'c') copyChats(selectedNames);
      else void pasteChats();
      return;
    }
    if (!onSendToChats) return;
    const bindings = useDroneHubUiStore.getState().shortcutBindings;
    const voice = isShortcutMatch(bindings.toggleChatVoiceRecording, event.nativeEvent);
    const send = isShortcutMatch(bindings.sendActiveChatComposer, event.nativeEvent);
    const focus = isShortcutMatch(bindings.focusPrimaryChatInput, event.nativeEvent);
    const asap = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey;
    if (!voice && !send && !focus && !asap) return;
    event.preventDefault();
    event.stopPropagation();
    if (!selectedNames.length || !activeComposer) return;
    setComposerExpanded(true);
    setPendingComposerAction(voice ? 'voice' : focus ? 'focus' : asap ? 'asap' : 'queue');
  };
  const selectRow = (name: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const additive = event.ctrlKey || event.metaKey;
    setSelection(selectSidebarChatNodes({ currentNodeIds: selectedNames, orderedNodeIds: names,
      nodeId: name, anchorNodeId: anchorRef.current, additive, range: event.shiftKey }));
    if (!event.shiftKey) anchorRef.current = name;
    if (!additive && !event.shiftKey) options.onSelectChat(name);
  };
  /** Dragging a selected row carries the whole selection, e.g. into the composer as references. */
  const startRowDrag = (name: string, event: React.DragEvent<HTMLElement>) => {
    const dragged = selectedNames.includes(name) ? selectedNames : [name];
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(DRONE_CHAT_DND_MIME, JSON.stringify(dragged.map((chatName) => createCanvasChatNodeId(drone.id, chatName))));
  };
  const openPasteMenu = (event: React.MouseEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest('[data-chat-name], [data-selected-chats-composer]')) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY, view: event.currentTarget.ownerDocument.defaultView!, names: [] });
  };
  const openMenu = (name: string, event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const targets = selectedNames.includes(name) ? selectedNames : [name];
    if (!selectedNames.includes(name)) {
      setSelection(targets);
      anchorRef.current = name;
    }
    setMenu({ x: event.clientX, y: event.clientY, view: event.currentTarget.ownerDocument.defaultView!, names: targets });
  };
  const deleteChats = async (chatNames: string[]) => {
    if (!onDeleteChats || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const results = await onDeleteChats(chatNames.map((chatName) => ({ droneId: drone.id, chatName })));
      const deleted = new Set(results.filter((result) => result.ok).map((result) => result.chatName));
      setSelection((current) => current.filter((name) => !deleted.has(name)));
      const errors = results.map((result) => result.error).filter(Boolean);
      if (errors.length) setDeleteError(errors.join(' '));
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  };
  const gridRef = React.useRef<HTMLDivElement>(null);
  const [gridWidth, setGridWidth] = React.useState(0);
  React.useEffect(() => {
    const element = gridRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => setGridWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [view, names.length]);
  const gridColumns = Math.max(1, Math.min(Math.ceil(Math.sqrt(names.length)),
    gridWidth ? Math.max(1, Math.floor(gridWidth / 320)) : Infinity));
  const gridRows = Math.max(1, Math.ceil(names.length / gridColumns));
  return (
    <div ref={rootRef} onKeyDown={onKeyDown} onContextMenu={openPasteMenu} data-chats-window="true" className="flex h-full min-h-0 flex-col bg-[var(--panel)]">
      {menu ? <SidebarContextMenu x={menu.x} y={menu.y} view={menu.view} label="Chat actions"
        onClose={() => setMenu(null)} items={[
          ...(menu.names.length ? [{ id: 'copy-chat', shortcut: 'Ctrl+C',
            label: menu.names.length === 1 ? 'Copy chat' : `Copy ${menu.names.length} chats`,
            onSelect: () => copyChats(menu.names) }] : []),
          { id: 'paste-chat', label: 'Paste', shortcut: 'Ctrl+V', disabled: !clipboardHasChats || !onCloneChat,
            onSelect: () => { void pasteChats(); } },
          ...(menu.names.length ? [{ id: 'delete-chat', separatorBefore: true,
            label: menu.names.length === 1 ? 'Delete chat' : `Delete ${menu.names.length} chats`,
            tone: 'danger' as const, disabled: deleting || !onDeleteChats,
            onSelect: () => { void deleteChats(menu.names); } }] : []),
        ]} /> : null}
      {deleteError ? <div role="alert" className="p-2 text-12 text-[var(--red)]">{deleteError}</div> : null}
      {!names.length ? <div className="p-4 text-12 text-[var(--muted)]">No chats yet.</div> : view === 'list' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[fit-content(160px)_minmax(0,1fr)] content-start gap-x-3 overflow-auto p-1.5" aria-label="Drone chats">
          {names.map((name) => <ChatListRow key={name} drone={drone} name={name} active={selectedChat === name}
            selected={selectedNames.includes(name)} onSelect={(event) => selectRow(name, event)}
            onContextMenu={(event) => openMenu(name, event)} onDragStart={(event) => startRowDrag(name, event)} />)}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-2">
          <div ref={gridRef} className="grid min-h-0 flex-1 gap-2 overflow-hidden" aria-label="Chat grid"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))` }}>
          {names.map((name) => (
            <section key={name} aria-label={`Chat: ${name}`} data-chat-drone-id={drone.id} data-chat-name={name}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--chat-background)]">
              <button type="button" draggable onDragStart={(event) => startRowDrag(name, event)}
                onClick={(event) => selectRow(name, event)} onContextMenu={(event) => openMenu(name, event)}
                aria-pressed={selectedNames.includes(name)} title={`Open ${name} as main chat`}
                className={`flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-left text-12 ${selectedNames.includes(name) ? 'bg-[var(--selected)]' : 'hover:bg-[var(--hover)]'}`}>
                <span className="min-w-0 flex-1"><ChatName drone={drone} name={name} selected={selectedChat === name} /></span>
                <span className="text-11 text-[var(--muted)]">Open ↗</span>
              </button>
              <div data-chats-individual-content="true" className="flex min-h-0 flex-1 flex-col">{options.renderChat(name)}</div>
            </section>
          ))}
          </div>
        </div>
      )}
      {onSendToChats ? <ChatsWindowComposer key={drone.id} drone={drone} droneById={droneById} selectedNames={selectedNames}
        onSendToChats={onSendToChats} expanded={composerExpanded}
        onExpand={() => setComposerExpanded(true)} onCollapse={() => setComposerExpanded(false)} /> : null}
    </div>
  );
}

function ChatsWindowComposer({ drone, droneById, selectedNames, onSendToChats, expanded, onExpand, onCollapse }: {
  drone: DroneSummary;
  droneById?: Record<string, DroneSummary>;
  selectedNames: string[];
  onSendToChats: CanvasSendPrompt;
  expanded: boolean;
  onExpand: () => void;
  onCollapse: () => void;
}) {
  const [draft, setDraft] = React.useState('');
  const [references, setReferences] = React.useState<ComposerReference[]>([]);
  const [sending, setSending] = React.useState(false);
  const sendingRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const targets = selectedNames.map((chatName) => ({ droneId: drone.id, chatName }));
  const send = async (payload: Parameters<ChatInputProps['onSend']>[0], context: Parameters<ChatInputProps['onSend']>[1], overrides: ChatModelOverrides) => {
    if (sendingRef.current || targets.length === 0) return false;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    try {
      const result = await onSendToChats(targets, payload, context, overrides);
      setError(result.error || (result.ok ? null : 'Message could not be sent.'));
      return result.ok;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  return <SelectedChatsComposer surface="chats" selectionKey={`chats-window:${drone.id}`}
    selectedCount={selectedNames.length} selectedLabel={selectedNames.join(', ')}
    targets={targets} droneById={{ ...droneById, [drone.id]: drone }}
    expanded={expanded} onExpand={onExpand} onCollapse={onCollapse}
    sending={sending} draft={draft} onDraftChange={setDraft} error={error} onSend={send}
    references={references} onReferencesChange={setReferences} />;
}
