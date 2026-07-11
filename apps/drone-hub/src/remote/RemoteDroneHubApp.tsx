import React from 'react';
import { FrontendUpdatePrompt } from '../FrontendUpdatePrompt';
import { type RightPanelTab } from '../droneHub/app/app-config';
import { DockableDroneWorkspace } from '../droneHub/app/DockableDroneWorkspace';
import { DroneWorkspaceHeaderFrame } from '../droneHub/app/DroneWorkspaceHeaderFrame';
import { droneHomePath } from '../droneHub/app/helpers';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import { useMobileViewport } from '../droneHub/app/use-mobile-viewport';
import { ChatInput, ChatTranscriptFrame, EmptyState, PendingTranscriptTurn, TranscriptTurn, type ChatSendPayload, type DroneHubTask, type DroneHubTaskSpawnMode } from '../droneHub/chat';
import { IconBot } from '../droneHub/chat/icons';
import { ASSISTANT_OPEN_DRONE_CHAT_EVENT, type AssistantOpenDroneChatEventDetail } from '../droneHub/assistant/open-drone-chat-event';
import { RemoteMobileSidebarDrawer } from './RemoteMobileSidebarDrawer';
import { RemoteMobileToolDrawer } from './RemoteMobileToolDrawer';
import { RemoteCreateDroneModal } from './RemoteCreateDroneModal';
import { RemoteHeaderActions } from './RemoteHeaderActions';
import { RemoteHubSidebar } from './RemoteHubSidebar';
import { RemoteRepoPanel, RemoteRepoPanels } from './RemoteRepoPanels';
import { RemoteRuntimeMetadata } from './RemoteRuntimeMetadata';
import { REMOTE_HUB_CAPABILITIES } from './remote-capabilities';
import { canOpenRemoteAssistantDrone } from './remote-assistant-navigation';
import { useRemoteHubModel } from './useRemoteHubModel';

type TouchPoint = {
  x: number;
  y: number;
};

const MOBILE_SIDEBAR_SWIPE_DISTANCE_PX = 56;
const MOBILE_SIDEBAR_SWIPE_VERTICAL_TOLERANCE_PX = 72;

function touchPoint(touch: React.Touch): TouchPoint {
  return { x: touch.clientX, y: touch.clientY };
}

function isMobileSidebarOpenSwipe(start: TouchPoint | null, end: TouchPoint): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = Math.abs(end.y - start.y);
  return deltaX >= MOBILE_SIDEBAR_SWIPE_DISTANCE_PX && deltaY <= MOBILE_SIDEBAR_SWIPE_VERTICAL_TOLERANCE_PX;
}

function isMobileToolOpenSwipe(start: TouchPoint | null, end: TouchPoint): boolean {
  if (!start) return false;
  const deltaX = end.x - start.x;
  const deltaY = Math.abs(end.y - start.y);
  return deltaX <= -MOBILE_SIDEBAR_SWIPE_DISTANCE_PX && deltaY <= MOBILE_SIDEBAR_SWIPE_VERTICAL_TOLERANCE_PX;
}

function isSwipeIgnoredTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button,a,input,textarea,select,[role="button"],[role="menuitem"]'));
}

function PairingRequired() {
  return (
    <main className="fixed inset-0 flex items-center justify-center bg-[var(--panel)] px-4">
      <section className="w-full max-w-md rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] p-5 shadow-[0_24px_80px_rgba(0,0,0,.35)]">
        <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
          Remote Drone Hub
        </div>
        <h1 className="mt-2 text-[24px] font-semibold text-[var(--fg)]" style={{ fontFamily: 'var(--display)' }}>
          Pairing required
        </h1>
        <p className="mt-2 text-[13px] leading-6 text-[var(--muted)]">
          Create a pairing QR from the local Drone Hub settings, then scan it on this device.
        </p>
      </section>
    </main>
  );
}

export function RemoteDroneHubApp() {
  const isMobileViewport = useMobileViewport();
  const setSidebarCollapsed = useDroneHubUiStore((state) => state.setSidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const [mobileToolOpen, setMobileToolOpen] = React.useState(false);
  const [createDroneOpen, setCreateDroneOpen] = React.useState(false);
  const model = useRemoteHubModel({ pauseChatPolling: isMobileViewport && (mobileSidebarOpen || mobileToolOpen) });
  const assistantNavigationDronesRef = React.useRef(model.drones);
  assistantNavigationDronesRef.current = model.drones;
  const selectedDroneHomePath = React.useMemo(() => droneHomePath(model.selectedDrone), [model.selectedDrone]);
  const mobileSidebarSwipeStartRef = React.useRef<TouchPoint | null>(null);
  const setRemoteMobileSidebarOpen = React.useCallback(
    (open: boolean) => {
      if (open) {
        setSidebarCollapsed(false);
        setMobileToolOpen(false);
      }
      setMobileSidebarOpen(open);
    },
    [setSidebarCollapsed],
  );
  const setRemoteMobileToolOpen = React.useCallback((open: boolean) => {
    if (open) setMobileSidebarOpen(false);
    setMobileToolOpen(open);
  }, []);
  const transcriptMessageId = React.useCallback((turn: any) => String(turn?.id ?? `${turn?.turn ?? ''}:${turn?.at ?? ''}`), []);
  const noopCreateJobs = React.useCallback(() => {}, []);
  const noopSpawnTask = React.useCallback(async (_mode: DroneHubTaskSpawnMode, _task: DroneHubTask) => {
    return { ok: false, error: 'Task spawning is not available in remote Hub.' };
  }, []);
  const noopToggleTldr = React.useCallback(() => {}, []);
  const noopHoverAgentMessage = React.useCallback(() => {}, []);
  const openExternalLink = React.useCallback((href: string) => {
    const url = String(href ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return false;
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  }, []);
  const sendPrompt = React.useCallback(async (payload: ChatSendPayload) => {
    return Boolean(await model.sendPrompt(payload));
  }, [model]);
  const selectedChatIsDraft =
    model.draftChats?.[model.selectedChat] === true || model.selectedDrone?.draftChats?.[model.selectedChat] === true;
  const selectedIsDraft = model.selectedDrone?.draft === true || model.selectedDrone?.hubPhase === 'draft' || selectedChatIsDraft;

  React.useEffect(() => {
    const openAssistantDroneChat = (event: Event) => {
      const detail = (event as CustomEvent<AssistantOpenDroneChatEventDetail>).detail;
      const droneId = String(detail?.droneId ?? '').trim();
      if (!canOpenRemoteAssistantDrone(assistantNavigationDronesRef.current, droneId)) return;
      model.setSelectedDroneId(droneId);
      model.setSelectedChat(String(detail?.chatName ?? '').trim() || 'default');
    };
    window.addEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, openAssistantDroneChat);
    return () => window.removeEventListener(ASSISTANT_OPEN_DRONE_CHAT_EVENT, openAssistantDroneChat);
  }, [model.setSelectedChat, model.setSelectedDroneId]);

  React.useEffect(() => {
    if (!model.authenticated) return;
    void fetch('/api/assistant/context', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        activeDroneId: model.selectedDrone?.id ?? null,
        activeDroneName: model.selectedDrone?.name ?? null,
        activeChatName: model.selectedDrone ? model.selectedChat || 'default' : null,
        appView: 'workspace',
      }),
    }).catch(() => {
      // Context reporting is best effort; Assistant threads still work without it.
    });
  }, [model.authenticated, model.selectedChat, model.selectedDrone?.id, model.selectedDrone?.name]);

  React.useEffect(() => {
    if (!model.authenticated || typeof window.EventSource === 'undefined') return;
    const source = new window.EventSource('/api/assistant/events');
    const handleAssistantChange = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        const action = data?.uiAction;
        const droneId = String(action?.droneId ?? action?.droneIds?.[0] ?? '').trim();
        if (
          action?.type !== 'open_drone_chat' ||
          !canOpenRemoteAssistantDrone(assistantNavigationDronesRef.current, droneId)
        ) {
          return;
        }
        model.setSelectedDroneId(droneId);
        model.setSelectedChat(String(action?.chatName ?? '').trim() || 'default');
      } catch {
        // Ignore malformed Assistant events.
      }
    };
    source.addEventListener('assistant_change', handleAssistantChange);
    return () => source.close();
  }, [model.authenticated, model.setSelectedChat, model.setSelectedDroneId]);

  const renderRemoteToolPane = React.useCallback(
    (tab: RightPanelTab) => {
      if (!model.selectedDrone || (tab !== 'files' && tab !== 'changes' && tab !== 'prs' && tab !== 'assistant')) return null;
      if (tab === 'assistant') return <RemoteRepoPanel drone={model.selectedDrone} panel="assistant" />;
      return <RemoteRepoPanels drone={model.selectedDrone} />;
    },
    [model.selectedDrone],
  );
  const openCreateDrone = React.useCallback(() => {
    setCreateDroneOpen(true);
    setRemoteMobileSidebarOpen(false);
    setRemoteMobileToolOpen(false);
  }, [setRemoteMobileSidebarOpen, setRemoteMobileToolOpen]);
  const handleCreatedDrone = React.useCallback(
    (droneId: string) => {
      void model.reloadDrones(droneId);
    },
    [model],
  );
  const beginMobileOpenSwipe = React.useCallback(
    (event: React.TouchEvent) => {
      if (!isMobileViewport || mobileSidebarOpen || mobileToolOpen || isSwipeIgnoredTarget(event.target)) {
        mobileSidebarSwipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      mobileSidebarSwipeStartRef.current = touch ? touchPoint(touch) : null;
    },
    [isMobileViewport, mobileSidebarOpen, mobileToolOpen],
  );
  const endMobileOpenSwipe = React.useCallback(
    (event: React.TouchEvent) => {
      if (!isMobileViewport || mobileSidebarOpen || mobileToolOpen) {
        mobileSidebarSwipeStartRef.current = null;
        return;
      }
      const touch = event.changedTouches[0];
      if (touch) {
        const end = touchPoint(touch);
        if (isMobileSidebarOpenSwipe(mobileSidebarSwipeStartRef.current, end)) {
          setRemoteMobileSidebarOpen(true);
        } else if (model.selectedDrone && isMobileToolOpenSwipe(mobileSidebarSwipeStartRef.current, end)) {
          setRemoteMobileToolOpen(true);
        }
      }
      mobileSidebarSwipeStartRef.current = null;
    },
    [isMobileViewport, mobileSidebarOpen, mobileToolOpen, model.selectedDrone, setRemoteMobileSidebarOpen, setRemoteMobileToolOpen],
  );

  const chatContent = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DroneWorkspaceHeaderFrame>
        <div className="flex h-[52px] items-center px-4">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold" style={{ fontFamily: 'var(--display)' }}>{model.selectedDrone?.name ?? 'No drone selected'}</div>
                <RemoteRuntimeMetadata
                  hasDrone={Boolean(model.selectedDrone)}
                  repoPath={model.selectedDrone?.repoPath ?? ''}
                  agent={model.chatRuntime.agent}
                  configuredModel={model.chatRuntime.configuredModel}
                  transcripts={model.transcripts}
                  loading={model.chatRuntime.loading}
                  error={model.chatRuntime.error}
                  draft={selectedChatIsDraft}
                />
              </div>
            </div>
            <RemoteHeaderActions
              selectedDrone={model.selectedDrone}
              onCreateChat={model.createChat}
              onCloneDrone={model.cloneDrone}
              onRenameDrone={model.renameDrone}
              onLogout={model.logout}
            />
          </div>
        </div>
      </DroneWorkspaceHeaderFrame>

      {model.error ? <div className="border-b border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12px] text-[var(--red)]">{model.error}</div> : null}

      <div className="min-h-0 flex-1">
        <ChatTranscriptFrame
          loading={model.chatStateLoading}
          loadingMessage={`Loading ${model.selectedDrone?.name ?? 'remote drone'} / ${model.selectedChat}...`}
          hasContent={model.chatTimeline.length > 0}
          emptyState={
            <EmptyState
              icon={<IconBot className="h-8 w-8 text-[var(--muted)]" />}
              title="No messages yet"
              description={model.selectedDrone ? `Send a prompt to ${model.selectedDrone.name} to see the conversation here.` : 'No container drone is selected.'}
            />
          }
        >
          {model.chatTimeline.map((entry) =>
            entry.kind === 'transcript' ? (
              <TranscriptTurn
                key={entry.key}
                item={entry.item}
                parsingJobs={false}
                onCreateJobs={noopCreateJobs}
                onSpawnDroneHubTask={noopSpawnTask}
                messageId={transcriptMessageId(entry.item)}
                tldr={null}
                showTldr={false}
                onToggleTldr={noopToggleTldr}
                onHoverAgentMessage={noopHoverAgentMessage}
                onOpenLink={openExternalLink}
                droneId={model.selectedDrone?.id}
                droneHomePath={selectedDroneHomePath}
                showRoleIcons={false}
                actionsEnabled={REMOTE_HUB_CAPABILITIES.transcriptActions}
              />
            ) : (
              <PendingTranscriptTurn
                key={entry.key}
                item={entry.item}
                showRoleIcons={false}
                droneId={model.selectedDrone?.id}
                droneHomePath={selectedDroneHomePath}
                onOpenLink={openExternalLink}
              />
            ),
          )}
        </ChatTranscriptFrame>
      </div>

      <footer className="border-t border-[var(--border)] bg-[var(--panel-alt)] p-3">
        <div className="mx-auto max-w-[1170px]">
          <ChatInput
            resetKey={`${model.selectedDrone?.id ?? 'none'}:${model.selectedChat}`}
            droneName={model.selectedDrone?.name ?? 'remote drone'}
            draftValue={model.draft}
            onDraftValueChange={model.setDraft}
            promptError={model.error}
            sending={model.sending}
            publishing={model.publishing}
            waiting={model.pending.some((item) => item.state !== 'failed')}
            disabled={!model.selectedDrone || model.chatStateLoading}
            attachmentsEnabled={REMOTE_HUB_CAPABILITIES.attachments}
            automationActions={[]}
            focusTargetId="remote-primary-chat"
            onStop={model.selectedDrone ? () => model.stopChat() : undefined}
            onPublish={selectedIsDraft ? () => model.publishDraft() : undefined}
            onSend={sendPrompt}
          />
        </div>
      </footer>
    </div>
  );

  if (model.loading) {
    return (
      <main className="fixed inset-0 flex items-center justify-center bg-[var(--panel)] text-[var(--muted)]">
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--panel-alt)] px-4 py-3 text-[12px] font-semibold uppercase tracking-wide">Loading remote Hub...</div>
      </main>
    );
  }
  if (!model.authenticated) return <PairingRequired />;

  return (
    <main
      className="fixed inset-0 flex bg-[var(--panel)] text-[var(--fg)]"
      onTouchStart={mobileSidebarOpen || mobileToolOpen ? undefined : beginMobileOpenSwipe}
      onTouchEnd={mobileSidebarOpen || mobileToolOpen ? undefined : endMobileOpenSwipe}
    >
      <RemoteMobileSidebarDrawer
        open={mobileSidebarOpen}
        drones={model.drones}
        selectedDroneId={model.selectedDrone?.id ?? null}
        activeChatName={model.selectedChat}
        unreadAgentMessageByChatNodeId={model.unreadAgentMessageByChatNodeId}
        onOpenChange={setRemoteMobileSidebarOpen}
        onSelectDrone={model.setSelectedDroneId}
        onSelectChat={model.setSelectedChat}
        onOpenCreateDrone={openCreateDrone}
      />
      <RemoteMobileToolDrawer
        open={mobileToolOpen}
        drone={model.selectedDrone}
        onOpenChange={setRemoteMobileToolOpen}
      />

      <div className="hidden md:contents">
        <RemoteHubSidebar
          drones={model.drones}
          selectedDroneId={model.selectedDrone?.id ?? null}
          activeChatName={model.selectedChat}
          unreadAgentMessageByChatNodeId={model.unreadAgentMessageByChatNodeId}
          onSelectDrone={model.setSelectedDroneId}
          onSelectChat={model.setSelectedChat}
          onOpenCreateDrone={openCreateDrone}
        />
      </div>

      <section className="flex min-w-0 flex-1 flex-col">
        {model.selectedDrone ? (
          <DockableDroneWorkspace
            currentDrone={model.selectedDrone}
            activeChatName={model.selectedChat}
            layoutScope="chat"
            paneHeaderMode="compact"
            toolPaneOpen={REMOTE_HUB_CAPABILITIES.toolPanesEnabled && !isMobileViewport}
            activeToolTab="changes"
            openRequestNonce={0}
            resetLayoutNonce={0}
            chatContent={chatContent}
            renderToolPane={renderRemoteToolPane}
            previewTab="preview"
          />
        ) : (
          chatContent
        )}
      </section>
      <RemoteCreateDroneModal
        open={createDroneOpen}
        drones={model.drones}
        selectedDrone={model.selectedDrone}
        selectedChat={model.selectedChat}
        onClose={() => setCreateDroneOpen(false)}
        onCreated={handleCreatedDrone}
      />
      <FrontendUpdatePrompt />
    </main>
  );
}
