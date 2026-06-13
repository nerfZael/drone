import React from 'react';
import { ChatInput, EmptyState, PendingTranscriptTurn, TranscriptTurn, type ChatSendPayload, type DroneHubTask, type DroneHubTaskSpawnMode } from '../droneHub/chat';
import { IconBot } from '../droneHub/chat/icons';
import { useRemoteHubModel } from './useRemoteHubModel';

function StatusPill({ label, tone }: { label: string; tone: 'good' | 'muted' | 'busy' | 'bad' }) {
  const cls =
    tone === 'good'
      ? 'border-[rgba(34,197,94,.35)] text-[var(--green)] bg-[rgba(34,197,94,.08)]'
      : tone === 'busy'
        ? 'border-[rgba(250,204,21,.35)] text-[var(--yellow)] bg-[rgba(250,204,21,.08)]'
        : tone === 'bad'
          ? 'border-[rgba(248,113,113,.35)] text-[var(--red)] bg-[rgba(248,113,113,.08)]'
          : 'border-[var(--border-subtle)] text-[var(--muted)] bg-[rgba(255,255,255,.02)]';
  return <span className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>;
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
        <div className="min-h-0 flex-1 overflow-y-auto space-y-1">
          {model.drones.map((drone) => (
            <button
              key={drone.id}
              type="button"
              onClick={() => model.setSelectedDroneId(drone.id)}
              className={`w-full rounded border px-3 py-2 text-left transition ${model.selectedDrone?.id === drone.id ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)]' : 'border-transparent hover:border-[var(--border-subtle)] hover:bg-[var(--hover)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-semibold">{drone.name}</span>
                <StatusPill label={drone.busy ? 'Busy' : drone.statusOk ? 'Ready' : 'Down'} tone={drone.busy ? 'busy' : drone.statusOk ? 'good' : 'bad'} />
              </div>
              {drone.group ? <div className="mt-1 truncate text-[11px] text-[var(--muted-dim)]">{drone.group}</div> : null}
            </button>
          ))}
          {model.drones.length === 0 ? <div className="px-3 py-4 text-[12px] text-[var(--muted)]">No container drones available.</div> : null}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-[var(--border)] bg-[var(--panel-alt)] px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold" style={{ fontFamily: 'var(--display)' }}>{model.selectedDrone?.name ?? 'No drone selected'}</div>
              <div className="text-[11px] text-[var(--muted)]">Container-only remote surface</div>
            </div>
            <button className="md:hidden rounded border border-[var(--border-subtle)] px-2 py-1 text-[11px] text-[var(--muted)]" onClick={() => void model.logout()}>
              Log out
            </button>
          </div>
          {model.drones.length > 1 ? (
            <select
              value={model.selectedDrone?.id ?? ''}
              onChange={(event) => model.setSelectedDroneId(event.target.value)}
              className="mt-2 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)] md:hidden"
            >
              {model.drones.map((drone) => (
                <option key={drone.id} value={drone.id}>
                  {drone.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="mt-2 flex gap-1 overflow-x-auto">
            {model.chats.map((chat) => (
              <button
                key={chat}
                type="button"
                onClick={() => model.setSelectedChat(chat)}
                className={`rounded border px-2.5 py-1 text-[12px] ${model.selectedChat === chat ? 'border-[var(--accent-muted)] bg-[var(--accent-subtle)] text-[var(--fg)]' : 'border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)]'}`}
              >
                {chat}
              </button>
            ))}
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
                actionsEnabled={false}
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
              attachmentsEnabled={false}
              automationActions={[]}
              focusTargetId="remote-primary-chat"
              onStop={model.selectedDrone ? () => model.stopChat() : undefined}
              onSend={sendPrompt}
            />
          </div>
        </footer>
      </section>
    </main>
  );
}
