import React from 'react';
import { DockableDroneWorkspace } from '../droneHub/app/DockableDroneWorkspace';
import { DroneWorkspaceHeaderFrame } from '../droneHub/app/DroneWorkspaceHeaderFrame';
import { useDroneHubUiStore } from '../droneHub/app/use-drone-hub-ui-store';
import { useMobileViewport } from '../droneHub/app/use-mobile-viewport';
import { ChatInput, ChatTranscriptFrame, EmptyState, PendingTranscriptTurn, TranscriptTurn, type ChatSendPayload, type DroneHubTask, type DroneHubTaskSpawnMode } from '../droneHub/chat';
import { IconBot } from '../droneHub/chat/icons';
import { RemoteMobileSidebarDrawer } from './RemoteMobileSidebarDrawer';
import { RemoteHubSidebar } from './RemoteHubSidebar';
import { REMOTE_HUB_CAPABILITIES } from './remote-capabilities';
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
  const model = useRemoteHubModel();
  const isMobileViewport = useMobileViewport();
  const setSidebarCollapsed = useDroneHubUiStore((state) => state.setSidebarCollapsed);
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
  const mobileSidebarSwipeStartRef = React.useRef<TouchPoint | null>(null);
  const setRemoteMobileSidebarOpen = React.useCallback(
    (open: boolean) => {
      if (open) setSidebarCollapsed(false);
      setMobileSidebarOpen(open);
    },
    [setSidebarCollapsed],
  );
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
  const renderRemoteToolPane = React.useCallback(() => null, []);
  const beginMobileOpenSwipe = React.useCallback(
    (event: React.TouchEvent) => {
      if (!isMobileViewport || mobileSidebarOpen || isSwipeIgnoredTarget(event.target)) {
        mobileSidebarSwipeStartRef.current = null;
        return;
      }
      const touch = event.touches[0];
      mobileSidebarSwipeStartRef.current = touch ? touchPoint(touch) : null;
    },
    [isMobileViewport, mobileSidebarOpen],
  );
  const endMobileOpenSwipe = React.useCallback(
    (event: React.TouchEvent) => {
      if (!isMobileViewport || mobileSidebarOpen) {
        mobileSidebarSwipeStartRef.current = null;
        return;
      }
      const touch = event.changedTouches[0];
      if (touch && isMobileSidebarOpenSwipe(mobileSidebarSwipeStartRef.current, touchPoint(touch))) {
        setRemoteMobileSidebarOpen(true);
      }
      mobileSidebarSwipeStartRef.current = null;
    },
    [isMobileViewport, mobileSidebarOpen, setRemoteMobileSidebarOpen],
  );

  const chatContent = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <DroneWorkspaceHeaderFrame>
        <div className="flex h-[52px] items-center px-4">
          <div className="flex w-full items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold" style={{ fontFamily: 'var(--display)' }}>{model.selectedDrone?.name ?? 'No drone selected'}</div>
                <div className="text-[11px] text-[var(--muted)]">Container-only remote surface</div>
              </div>
            </div>
            <button className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => void model.logout()}>
              Log out
            </button>
          </div>
        </div>
      </DroneWorkspaceHeaderFrame>

      {model.error ? <div className="border-b border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12px] text-[var(--red)]">{model.error}</div> : null}

      <div className="min-h-0 flex-1">
        <ChatTranscriptFrame
          loading={false}
          hasContent={model.transcripts.length > 0 || model.pending.length > 0}
          emptyState={
            <EmptyState
              icon={<IconBot className="h-8 w-8 text-[var(--muted)]" />}
              title="No messages yet"
              description={model.selectedDrone ? `Send a prompt to ${model.selectedDrone.name} to see the conversation here.` : 'No container drone is selected.'}
            />
          }
        >
          {model.transcripts.map((turn) => (
            <TranscriptTurn
              key={turn.id ?? `${turn.turn}-${turn.at}`}
              item={turn}
              parsingJobs={false}
              onCreateJobs={noopCreateJobs}
              onSpawnDroneHubTask={noopSpawnTask}
              messageId={transcriptMessageId(turn)}
              tldr={null}
              showTldr={false}
              onToggleTldr={noopToggleTldr}
              onHoverAgentMessage={noopHoverAgentMessage}
              onOpenLink={openExternalLink}
              droneId={model.selectedDrone?.id}
              droneHomePath={undefined}
              showRoleIcons={false}
              actionsEnabled={REMOTE_HUB_CAPABILITIES.transcriptActions}
            />
          ))}
          {model.pending.length > 0 ? (
            model.pending.map((item) => (
              <PendingTranscriptTurn
                key={item.id}
                item={item}
                showRoleIcons={false}
                droneId={model.selectedDrone?.id}
                droneHomePath={undefined}
                onOpenLink={openExternalLink}
              />
            ))
          ) : null}
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
            waiting={model.pending.some((item) => item.state !== 'failed')}
            disabled={!model.selectedDrone}
            attachmentsEnabled={REMOTE_HUB_CAPABILITIES.attachments}
            automationActions={[]}
            focusTargetId="remote-primary-chat"
            onStop={model.selectedDrone ? () => model.stopChat() : undefined}
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
      onTouchStart={beginMobileOpenSwipe}
      onTouchEnd={endMobileOpenSwipe}
    >
      <RemoteMobileSidebarDrawer
        open={mobileSidebarOpen}
        drones={model.drones}
        selectedDroneId={model.selectedDrone?.id ?? null}
        activeChatName={model.selectedChat}
        onOpenChange={setRemoteMobileSidebarOpen}
        onSelectDrone={model.setSelectedDroneId}
        onSelectChat={model.setSelectedChat}
      />

      <div className="hidden md:contents">
        <RemoteHubSidebar
          drones={model.drones}
          selectedDroneId={model.selectedDrone?.id ?? null}
          activeChatName={model.selectedChat}
          onSelectDrone={model.setSelectedDroneId}
          onSelectChat={model.setSelectedChat}
        />
      </div>

      <section className="flex min-w-0 flex-1 flex-col">
        {model.selectedDrone ? (
          <DockableDroneWorkspace
            currentDrone={model.selectedDrone}
            activeChatName={model.selectedChat}
            layoutScope="chat"
            paneHeaderMode="compact"
            toolPaneOpen={REMOTE_HUB_CAPABILITIES.toolPanesEnabled}
            activeToolTab="files"
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
    </main>
  );
}
