import React from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ChatInput, type ChatSendPayload, EmptyState } from '../chat';
import { GroupMultiChatColumn } from './GroupMultiChatColumn';
import {
  GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX,
  GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX,
  clampGroupMultiChatColumnWidthPx,
} from './app-config';
import { IconChat, IconChevron, IconDrone } from './icons';
import type { DroneSummary } from '../types';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';

type GroupMultiChatData = {
  group: string;
  items: DroneSummary[];
};

type GroupMultiChatWorkspaceProps = {
  selectedGroupMultiChatData: GroupMultiChatData;
  groupBroadcastPromptError: string | null;
  groupBroadcastSending: boolean;
  onSendGroupBroadcastPrompt: (payload: ChatSendPayload) => Promise<boolean>;
  nowMs: number;
  uiDroneName: (nameRaw: string) => string;
  onSelectDroneCard: (droneId: string) => void;
  onDeleteDrone: (droneId: string) => void;
  deletingDrones: Record<string, boolean>;
  onParseJobsFromAgentMessage: (opts: { turn: number; message: string }) => void;
};

export function GroupMultiChatWorkspace({
  selectedGroupMultiChatData,
  groupBroadcastPromptError,
  groupBroadcastSending,
  onSendGroupBroadcastPrompt,
  nowMs,
  uiDroneName,
  onSelectDroneCard,
  onDeleteDrone,
  deletingDrones,
  onParseJobsFromAgentMessage,
}: GroupMultiChatWorkspaceProps) {
  const {
    selectedChat,
    groupMultiChatColumnWidth,
    groupBroadcastExpanded,
    setGroupMultiChatColumnWidth,
    setGroupBroadcastExpanded,
    setSelectedGroupMultiChat,
    setChatInputDraft,
  } = useDroneHubUiStore(
    useShallow((s) => ({
      selectedChat: s.selectedChat,
      groupMultiChatColumnWidth: s.groupMultiChatColumnWidth,
      groupBroadcastExpanded: s.groupBroadcastExpanded,
      setGroupMultiChatColumnWidth: s.setGroupMultiChatColumnWidth,
      setGroupBroadcastExpanded: s.setGroupBroadcastExpanded,
      setSelectedGroupMultiChat: s.setSelectedGroupMultiChat,
      setChatInputDraft: s.setChatInputDraft,
    })),
  );
  const broadcastDraftKey = React.useMemo(
    () => `group-broadcast:${selectedGroupMultiChatData.group}:${selectedChat || 'default'}`,
    [selectedGroupMultiChatData.group, selectedChat],
  );
  const broadcastDraftValue = useDroneHubUiStore((s) => s.chatInputDrafts[broadcastDraftKey] ?? '');

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
      <div className="flex-shrink-0 bg-[var(--panel-alt)] border-b border-[var(--border)] px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
              Group Multi-Chat
            </div>
            <div className="mt-1 text-[15px] font-semibold text-[var(--fg)] truncate" style={{ fontFamily: 'var(--display)' }}>
              {selectedGroupMultiChatData.group}
            </div>
            <div className="text-[11px] text-[var(--muted)] mt-1">
              One column per drone. Open any column title to jump into its full chat + panel view.
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="inline-flex items-center gap-2 h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]">
              <span className="text-[9px] font-semibold tracking-wide uppercase text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
                Width
              </span>
              <input
                type="range"
                min={GROUP_MULTI_CHAT_COLUMN_WIDTH_MIN_PX}
                max={GROUP_MULTI_CHAT_COLUMN_WIDTH_MAX_PX}
                step={10}
                value={groupMultiChatColumnWidth}
                onChange={(e) => setGroupMultiChatColumnWidth(clampGroupMultiChatColumnWidthPx(Number(e.target.value)))}
                className="w-[92px] accent-[var(--accent)]"
                title="Adjust width for all columns"
                aria-label="Adjust width for all group multi-chat columns"
              />
              <button
                type="button"
                onClick={() => setGroupMultiChatColumnWidth(GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX)}
                disabled={groupMultiChatColumnWidth === GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX}
                className={`inline-flex items-center h-5 px-1.5 rounded border text-[9px] font-semibold tracking-wide uppercase transition-all ${
                  groupMultiChatColumnWidth === GROUP_MULTI_CHAT_COLUMN_WIDTH_DEFAULT_PX
                    ? 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] opacity-40 cursor-not-allowed'
                    : 'border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
                title="Reset column width"
              >
                Reset
              </button>
            </div>
            <span className="inline-flex items-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-mono text-[var(--muted-dim)]">
              {selectedGroupMultiChatData.items.length} drone{selectedGroupMultiChatData.items.length !== 1 ? 's' : ''}
            </span>
            <button
              type="button"
              onClick={() => setGroupBroadcastExpanded((v) => !v)}
              className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                groupBroadcastExpanded
                  ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--accent)] shadow-[0_0_0_1px_rgba(167,139,250,.15)]'
                  : 'border-[var(--accent-muted)] bg-[rgba(167,139,250,.08)] text-[var(--accent)] hover:bg-[var(--accent-subtle)] hover:shadow-[var(--glow-accent)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title={groupBroadcastExpanded ? 'Hide broadcast composer' : 'Broadcast a message to all drones'}
              aria-expanded={groupBroadcastExpanded}
            >
              <IconChat className={groupBroadcastExpanded ? 'opacity-90' : 'opacity-80'} />
              Broadcast
              <IconChevron down={groupBroadcastExpanded} className="opacity-80" />
            </button>
            <button
              type="button"
              onClick={() => setSelectedGroupMultiChat(null)}
              className="inline-flex items-center h-7 px-2 rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] text-[10px] font-semibold tracking-wide uppercase text-[var(--muted-dim)] hover:text-[var(--muted)] hover:border-[var(--border)] transition-all"
              style={{ fontFamily: 'var(--display)' }}
              title="Exit group multi-chat view"
            >
              Close
            </button>
          </div>
        </div>
      </div>
      <div
        className={`flex-shrink-0 overflow-hidden border-b border-[var(--border)] bg-[rgba(255,255,255,.01)] transition-[max-height,opacity,padding] duration-200 ease-out ${
          groupBroadcastExpanded ? 'max-h-[220px] opacity-100 px-3' : 'max-h-0 opacity-0 px-3 pointer-events-none'
        }`}
        aria-hidden={!groupBroadcastExpanded}
      >
        <ChatInput
          resetKey={`group-broadcast:${selectedGroupMultiChatData.group}:${selectedChat || 'default'}`}
          droneName="all drones"
          draftValue={broadcastDraftValue}
          onDraftValueChange={(next) => setChatInputDraft(broadcastDraftKey, next)}
          promptError={groupBroadcastPromptError}
          sending={groupBroadcastSending}
          waiting={false}
          disabled={groupBroadcastSending || selectedGroupMultiChatData.items.length === 0}
          autoFocus={false}
          modeHint=""
          onSend={onSendGroupBroadcastPrompt}
        />
      </div>
      <div className="flex-1 min-h-0 overflow-hidden px-4 py-4">
        {selectedGroupMultiChatData.items.length === 0 ? (
          <div className="h-full overflow-auto">
            <EmptyState
              icon={<IconDrone className="w-8 h-8 text-[var(--muted-dim)]" />}
              title="No drones in this group"
              description="Add drones to this group from the sidebar drag-and-drop controls."
            />
          </div>
        ) : (
          <div className="h-full min-h-0 overflow-x-auto overflow-y-hidden pb-2">
            <div className="h-full min-h-0 w-max flex gap-3 items-stretch pr-4">
              {selectedGroupMultiChatData.items.map((d) => (
                <GroupMultiChatColumn
                  key={`group-chat:${selectedGroupMultiChatData.group}:${d.id}`}
                  drone={d}
                  droneLabel={uiDroneName(d.name)}
                  preferredChat={selectedChat || 'default'}
                  nowMs={nowMs}
                  onOpenDrone={() => onSelectDroneCard(d.id)}
                  onDeleteDrone={() => onDeleteDrone(d.id)}
                  deleteBusy={Boolean(deletingDrones[d.id])}
                  onCreateJobs={onParseJobsFromAgentMessage}
                  columnWidthPx={groupMultiChatColumnWidth}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
