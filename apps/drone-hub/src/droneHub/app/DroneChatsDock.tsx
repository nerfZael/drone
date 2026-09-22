import React from 'react';
import type { DroneSummary } from '../types';
import { requestJson } from '../http';
import { UiToolbarButton } from '../../ui/components';
import { usePoll } from './hooks';
import { allDroneChatNames, latestChatPreview, type ChatPreviewPayload } from './drone-chats-model';
import { SidebarItemStateIndicator, sidebarChatDisplayState, sidebarDroneStateLabel } from '../overview/DroneCard';
import { createCanvasChatNodeId } from './app-config';
import { busyChatNodeIdsForDrone, droneChatRequiresApproval } from './chat-node-helpers';
import { useDroneHubRuntimeStore } from './use-drone-hub-runtime-store';

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

function ChatListRow({ drone, name, selected, onSelect }: {
  drone: DroneSummary; name: string; selected: boolean; onSelect: () => void;
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
    <button type="button" onClick={onSelect} aria-current={selected ? 'true' : undefined}
      className={`col-span-2 grid w-full grid-cols-subgrid items-center gap-x-3 border-b border-[var(--border-subtle)] py-2.5 text-left text-12 hover:bg-[var(--hover)] focus-visible:outline focus-visible:outline-[var(--accent)] ${selected ? 'bg-[var(--accent-subtle)]' : ''}`}>
      <ChatName drone={drone} name={name} selected={selected} />
      <span className="flex min-w-0 items-center gap-1.5" title={error ?? preview?.text}>
        {preview && !error ? <span className={`shrink-0 text-10 ${preview.role === 'user' ? 'text-[var(--accent)]' : 'text-[var(--fg-secondary)]'}`}>
          {preview.role === 'user' ? 'You' : 'Agent'}
        </span> : null}
        <span className={`truncate ${error ? 'text-[var(--red)]' : 'text-[var(--muted)]'}`}>
          {error ? 'Preview unavailable · retrying…' : preview?.text ?? (loading ? 'Loading…' : 'No messages yet')}
        </span>
      </span>
    </button>
  );
}

export function DroneChatsDock({ drone, selectedChat, options }: {
  drone: DroneSummary; selectedChat: string; options: DroneChatsPaneOptions;
}) {
  const [view, setView] = React.useState<'list' | 'grid'>('list');
  const names = allDroneChatNames(drone, options.sideChatNames);
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
  const viewToggle = (
    <div role="group" aria-label="Chat view" className="flex shrink-0 gap-1">
      <UiToolbarButton pressed={view === 'list'} onClick={() => setView('list')}>List</UiToolbarButton>
      <UiToolbarButton pressed={view === 'grid'} onClick={() => setView('grid')}>Grid</UiToolbarButton>
    </div>
  );
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--panel)]">
      {!names.length ? <div className="p-4 text-12 text-[var(--muted)]">No chats yet.</div> : view === 'list' ? (
        <div className="grid min-h-0 flex-1 grid-cols-[fit-content(160px)_minmax(0,1fr)] content-start gap-x-3 overflow-auto px-3" aria-label="Drone chats">
          <div className="col-span-2 grid grid-cols-subgrid items-center gap-x-3 border-b border-[var(--border)] py-1 text-11 text-[var(--muted)]">
            <span>Chat</span>
            <div className="flex min-w-0 items-center justify-between gap-2"><span className="truncate">Latest message</span>{viewToggle}</div>
          </div>
          {names.map((name) => <ChatListRow key={name} drone={drone} name={name}
            selected={selectedChat === name} onSelect={() => options.onSelectChat(name)} />)}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-3">
          <div className="flex shrink-0 justify-end">{viewToggle}</div>
          <div ref={gridRef} className="grid min-h-0 flex-1 gap-3 overflow-hidden" aria-label="Chat grid"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))` }}>
          {names.map((name) => (
            <section key={name} aria-label={`Chat: ${name}`} data-chat-drone-id={drone.id} data-chat-name={name}
              className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--chat-background)]">
              <button type="button" onClick={() => options.onSelectChat(name)} title={`Open ${name} as main chat`}
                className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-left text-12 hover:bg-[var(--hover)]">
                <span className="min-w-0 flex-1"><ChatName drone={drone} name={name} selected={selectedChat === name} /></span>
                <span className="text-11 text-[var(--muted)]">Open ↗</span>
              </button>
              <div className="flex min-h-0 flex-1 flex-col">{options.renderChat(name)}</div>
            </section>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}
