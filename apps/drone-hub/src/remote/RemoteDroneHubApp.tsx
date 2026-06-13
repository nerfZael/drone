import React from 'react';
import { DockableDroneWorkspace } from '../droneHub/app/DockableDroneWorkspace';
import { IconSidebarExpand } from '../droneHub/app/icons';
import { ChatInput, EmptyState, PendingTranscriptTurn, TranscriptTurn, type ChatSendPayload, type DroneHubTask, type DroneHubTaskSpawnMode } from '../droneHub/chat';
import { IconBot } from '../droneHub/chat/icons';
import { RemoteMobileSidebarDrawer } from './RemoteMobileSidebarDrawer';
import { RemoteHubSidebar } from './RemoteHubSidebar';
import { REMOTE_HUB_CAPABILITIES } from './remote-capabilities';
import { useRemoteHubModel } from './useRemoteHubModel';

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
  const [mobileSidebarOpen, setMobileSidebarOpen] = React.useState(false);
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

  const chatContent = (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded border border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] md:hidden"
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open sidebar"
              title="Open sidebar"
            >
              <IconSidebarExpand className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold" style={{ fontFamily: 'var(--display)' }}>{model.selectedDrone?.name ?? 'No drone selected'}</div>
              <div className="text-[11px] text-[var(--muted)]">Container-only remote surface</div>
            </div>
          </div>
          <button className="md:hidden rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--muted)]" onClick={() => void model.logout()}>
            Log out
          </button>
        </div>
      </header>

      {model.error ? <div className="border-b border-[rgba(248,113,113,.35)] bg-[rgba(248,113,113,.08)] px-3 py-2 text-[12px] text-[var(--red)]">{model.error}</div> : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        <div className="mx-auto flex max-w-[1170px] flex-col gap-6 px-2 py-2">
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
          {model.transcripts.length === 0 && model.pending.length === 0 ? (
            <div className="min-h-[280px]">
              <EmptyState
                icon={<IconBot className="h-8 w-8 text-[var(--muted)]" />}
                title="No messages yet"
                description={model.selectedDrone ? `Send a prompt to ${model.selectedDrone.name} to see the conversation here.` : 'No container drone is selected.'}
              />
            </div>
          ) : null}
        </div>
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
    <main className="fixed inset-0 flex bg-[var(--panel)] text-[var(--fg)]">
      <RemoteMobileSidebarDrawer
        open={mobileSidebarOpen}
        drones={model.drones}
        selectedDroneId={model.selectedDrone?.id ?? null}
        activeChatName={model.selectedChat}
        onOpenChange={setMobileSidebarOpen}
        onSelectDrone={model.setSelectedDroneId}
        onSelectChat={model.setSelectedChat}
      />

      <aside className="hidden w-[300px] shrink-0 border-r border-[var(--border)] bg-[var(--sidebar)] p-3 md:flex md:flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>Remote</div>
            <div className="text-[17px] font-semibold" style={{ fontFamily: 'var(--display)' }}>Drone Hub</div>
          </div>
          <button className="rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--hover)]" onClick={() => void model.logout()}>
            Log out
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RemoteHubSidebar
            drones={model.drones}
            selectedDroneId={model.selectedDrone?.id ?? null}
            activeChatName={model.selectedChat}
            onSelectDrone={model.setSelectedDroneId}
            onSelectChat={model.setSelectedChat}
          />
        </div>
      </aside>

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
