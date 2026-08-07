import React from 'react';
import { AssistantMessageRow } from '../assistant/AssistantTranscript';
import { ApprovalCard } from '../assistant/AssistantWorkflowCards';
import { ChatInput, EmptyState } from '../chat';
import { IconChat, IconDrone, IconFolder } from '../icons';
import { DeviceConnectionIndicator } from './DeviceConnectionIndicator';
import { DesktopDevicePicker } from './DesktopDevicePicker';
import { useDesktopDevice } from './DesktopDeviceProvider';
import {
  IconDevices,
  IconPlusOutline,
  IconSidebarCollapse,
  IconSidebarExpand,
  IconSpinner,
} from './icons';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { useRemoteDroneHub, type RemoteDroneSummary } from './use-remote-drone-hub';

const REMOTE_SIDEBAR_WIDTH_PX = 308;

type RemoteSidebarUiState = {
  sidebarDockSide: 'left' | 'right';
  sidebarCollapsed: boolean;
  setSidebarCollapsed(collapsed: boolean): void;
};

type RemoteDroneGroup = {
  key: string;
  label: string;
  drones: RemoteDroneSummary[];
};

function remoteDroneGroups(drones: RemoteDroneSummary[]): RemoteDroneGroup[] {
  const groups = new Map<string, RemoteDroneGroup>();
  for (const drone of drones) {
    const key = drone.repoPath ? `repo:${drone.repoPath}` : `group:${drone.group || 'Other'}`;
    const pathParts = drone.repoPath.split('/').filter(Boolean);
    const label = pathParts[pathParts.length - 1] || drone.group || 'Other';
    const group: RemoteDroneGroup = groups.get(key) ?? { key, label, drones: [] };
    group.drones.push(drone);
    groups.set(key, group);
  }
  return [...groups.values()];
}

function RemoteSidebar({
  model,
  routeAvailable,
  dockSide,
  onCollapse,
}: {
  model: ReturnType<typeof useRemoteDroneHub>;
  routeAvailable: boolean;
  dockSide: 'left' | 'right';
  onCollapse(): void;
}) {
  const groups = React.useMemo(() => remoteDroneGroups(model.drones), [model.drones]);
  const connectionLabel = !routeAvailable
    ? 'Offline'
    : model.loadingDrones && model.drones.length === 0
      ? 'Checking access'
      : model.listError && model.drones.length === 0
        ? 'Control unavailable'
        : 'Connected';
  return (
    <aside
      data-drone-sidebar-root="true"
      data-drone-sidebar-shell="remote"
      data-sidebar-dock-side={dockSide}
      className={`flex min-h-0 flex-shrink-0 flex-col overflow-hidden bg-[var(--sidebar-bg)] [font-family:var(--sidebar-font)] ${
        dockSide === 'right' ? 'border-l' : 'border-r'
      } border-[var(--border)]`}
      style={{ width: `min(${REMOTE_SIDEBAR_WIDTH_PX}px, 100vw)` }}
    >
      <div className="flex h-11 flex-shrink-0 select-none items-center border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] pl-3 pr-2">
        <div className="flex w-full items-center justify-between gap-2">
          <span className="flex-shrink-0 text-left dh-type-sidebar-brand">DRONE HUB</span>
          <DesktopDevicePicker />
        </div>
      </div>

      <div className="dh-sidebar-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2">
        {!routeAvailable && groups.length === 0 ? (
          <div className="flex items-start gap-2.5 px-2 py-3">
            <DeviceConnectionIndicator online={false} className="mt-1" />
            <div className="min-w-0">
              <div className="dh-type-control-compact text-[var(--sidebar-fg)]">
                Device offline
              </div>
              <div className="mt-1 text-[var(--text-9)] leading-relaxed text-[var(--sidebar-meta-fg)]">
                Drones will appear when it reconnects.
              </div>
            </div>
          </div>
        ) : null}
        {model.loadingDrones && model.drones.length === 0 ? (
          <div className="flex items-center gap-2 px-2 py-4 text-[var(--text-10)] text-[var(--muted)]">
            <IconSpinner className="h-3.5 w-3.5 animate-spin" /> Loading drones…
          </div>
        ) : null}
        {model.listError && model.drones.length === 0 ? (
          <div className="rounded-[var(--radius-medium)] border border-[var(--red-border)] bg-[var(--red-subtle)] p-3">
            <div className="text-[var(--text-10)] text-[var(--red)]">{model.listError}</div>
            <button
              type="button"
              className="mt-2 dh-type-control-compact text-[var(--accent)] hover:underline"
              onClick={() => void model.loadDrones()}
            >
              Try again
            </button>
          </div>
        ) : null}
        {routeAvailable &&
        !model.loadingDrones &&
        !model.listError &&
        model.drones.length === 0 ? (
          <div className="px-2 py-6 text-center text-[var(--text-10)] text-[var(--muted)]">
            This device has no drones yet.
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex h-7 items-center gap-1.5 px-1.5 dh-type-control-compact text-[var(--muted)]">
                <IconFolder className="h-3.5 w-3.5 opacity-70" />
                <span className="truncate">{group.label}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                {group.drones.map((drone) => {
                  const selected = drone.id === model.selectedDrone?.id;
                  const busy = drone.busyChats.length > 0;
                  return (
                    <div key={drone.id}>
                      <button
                        type="button"
                        className={`relative flex h-8 w-full items-center gap-2 rounded-[var(--radius-medium)] px-2 text-left text-[var(--text-11)] transition-colors hover:bg-[var(--hover)] ${
                          selected
                            ? 'bg-[var(--sidebar-row-selected-bg)] text-[var(--sidebar-fg-active)]'
                            : 'text-[var(--sidebar-fg)]'
                        }`}
                        onClick={() => model.selectDrone(drone)}
                      >
                        <span
                          className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                            !drone.statusOk
                              ? 'bg-[var(--red)]'
                              : busy
                                ? 'animate-pulse bg-[var(--yellow)]'
                                : 'bg-[var(--green)]'
                          }`}
                        />
                        <span className="min-w-0 flex-1 truncate">{drone.name}</span>
                        {drone.runtime === 'host' ? (
                          <span className="text-[var(--text-9)] uppercase text-[var(--muted-dim)]">
                            host
                          </span>
                        ) : null}
                      </button>
                      {selected && drone.chats.length > 0 ? (
                        <div className="ml-3 border-l border-[var(--border-subtle)] pl-2">
                          {drone.chats.map((chat) => {
                            const active = chat === model.selectedChat;
                            const unread = drone.unreadChats.includes(chat);
                            return (
                              <button
                                key={chat}
                                type="button"
                                className={`flex h-[26px] w-full items-center gap-2 rounded-[var(--radius-small)] px-2 text-left text-[var(--text-10)] transition-colors hover:bg-[var(--hover)] ${
                                  active ? 'text-[var(--accent)]' : 'text-[var(--sidebar-subitem-fg)]'
                                }`}
                                onClick={() => model.selectChat(drone.id, chat)}
                              >
                                <IconChat className="h-3 w-3 opacity-70" />
                                <span className="min-w-0 flex-1 truncate">{chat}</span>
                                {unread ? (
                                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--green)]" />
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>

      <div className="flex h-10 flex-shrink-0 items-center justify-between border-t border-[var(--border)] px-2">
        <span className="flex min-w-0 items-center gap-2 truncate px-1 text-[var(--text-9)] text-[var(--muted-dim)]">
          <DeviceConnectionIndicator online={routeAvailable} />
          {connectionLabel}
        </span>
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
          title="Collapse sidebar"
          aria-label="Collapse sidebar"
          onClick={onCollapse}
        >
          <IconSidebarCollapse className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}

function RemoteMain({
  model,
  routeAvailable,
  sidebarCollapsed,
  onExpandSidebar,
}: {
  model: ReturnType<typeof useRemoteDroneHub>;
  routeAvailable: boolean;
  sidebarCollapsed: boolean;
  onExpandSidebar(): void;
}) {
  const {
    selectedDevice,
    refresh: refreshDeviceStatus,
    refreshing: deviceStatusLoading,
  } = useDesktopDevice();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const deviceName = selectedDevice?.name ?? 'This device';
  const noDrones = !model.loadingDrones && !model.listError && model.drones.length === 0;

  React.useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [model.messages.length, model.pendingCount]);

  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--chat-background)]">
      <header className="flex h-11 flex-shrink-0 items-center gap-3 border-b border-[var(--app-header-border)] bg-[var(--app-header-bg)] px-3">
        {sidebarCollapsed ? (
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
            title="Expand sidebar"
            aria-label="Expand sidebar"
            onClick={onExpandSidebar}
          >
            <IconSidebarExpand className="h-4 w-4" />
          </button>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="truncate dh-type-heading text-[var(--fg)]">
            {model.selectedDrone?.name ?? selectedDevice?.name ?? 'Remote Drone Hub'}
          </div>
          <div className="truncate text-[var(--text-9)] text-[var(--muted)]">
            {model.selectedDrone
              ? `${selectedDevice?.name ?? 'Remote device'} · ${model.selectedChat || 'No chat selected'}`
              : !routeAvailable
                ? 'Offline · reconnecting automatically'
                : model.loadingDrones
                  ? 'Checking for drones…'
                  : model.drones.length === 0
                    ? 'No drones available'
                    : `${model.drones.length} ${model.drones.length === 1 ? 'drone' : 'drones'} available`}
          </div>
        </div>
        {model.selectedDrone ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-medium)] px-2.5 dh-type-control-compact text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!routeAvailable || model.creatingChat}
            onClick={() => void model.createChat()}
          >
            {model.creatingChat ? (
              <IconSpinner className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <IconPlusOutline className="h-3.5 w-3.5" />
            )}
            New chat
          </button>
        ) : null}
        <button
          type="button"
          className="inline-flex h-8 items-center rounded-[var(--radius-medium)] px-2.5 dh-type-control-compact text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-45"
          disabled={routeAvailable ? model.loadingDrones : deviceStatusLoading}
          onClick={() =>
            void (routeAvailable ? model.loadDrones() : refreshDeviceStatus())
          }
        >
          {routeAvailable ? 'Refresh' : 'Retry'}
        </button>
      </header>

      {!routeAvailable && model.selectedDrone ? (
        <div className="flex items-center justify-center gap-2 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-2 text-center text-[var(--text-10)] text-[var(--muted)]">
          <DeviceConnectionIndicator online={false} />
          Device offline · This chat is still readable, but sending is paused until it reconnects.
        </div>
      ) : null}

      {!routeAvailable && !model.selectedDrone ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={
              <span className="relative inline-flex">
                <IconDevices className="h-7 w-7 text-[var(--yellow)]" />
                <span className="absolute -bottom-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--chat-background)]">
                  <DeviceConnectionIndicator online={false} />
                </span>
              </span>
            }
            title={`${deviceName} is offline`}
            description="Drone Hub can’t reach this device. Make sure the app is running there and that both devices are connected to the internet or the same local network."
            actions={
              <div className="flex flex-col items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-9 items-center justify-center rounded-[var(--radius-medium)] border border-[var(--border)] bg-[var(--surface-softest)] px-4 dh-type-control text-[var(--fg-secondary)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-45"
                  disabled={deviceStatusLoading}
                  onClick={() => void refreshDeviceStatus()}
                >
                  {deviceStatusLoading ? 'Checking…' : 'Retry connection'}
                </button>
                <span className="flex items-center gap-2 text-[var(--text-9)] text-[var(--muted-dim)]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--muted-dim)]" />
                  Checking automatically
                </span>
              </div>
            }
          />
        </div>
      ) : model.loadingDrones && model.drones.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<IconSpinner className="h-6 w-6 animate-spin text-[var(--accent)]" />}
            title="Checking this device"
            description={`Looking for drones available on ${deviceName}.`}
          />
        </div>
      ) : model.listError && model.drones.length === 0 ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<IconDevices className="h-7 w-7 text-[var(--red)]" />}
            title="Couldn’t load this device"
            description="The device is connected, but it did not make drone control available. Keep Drone Hub open on that device, then try again."
            actions={
              <button
                type="button"
                className="rounded-[var(--radius-medium)] border border-[var(--border)] px-4 py-2 dh-type-control text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
                onClick={() => void model.loadDrones()}
              >
                Try again
              </button>
            }
          />
        </div>
      ) : noDrones ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<IconDrone className="h-7 w-7 text-[var(--muted)]" />}
            title="No drones on this device"
            description={`There aren’t any drones on ${deviceName} yet. Create one there and it will appear here automatically.`}
          />
        </div>
      ) : !model.selectedDrone ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<IconDrone className="h-7 w-7 text-[var(--accent)]" />}
            title="Choose a drone"
            description={`Select a drone on ${deviceName} to open its chats and send prompts.`}
          />
        </div>
      ) : !model.selectedChat ? (
        <div className="min-h-0 flex-1">
          <EmptyState
            icon={<IconChat className="h-7 w-7 text-[var(--accent)]" />}
            title="No chats yet"
            description="Create a chat to start using this drone from the desktop app."
            actions={
              <button
                type="button"
                className="rounded-[var(--radius-medium)] bg-[var(--accent)] px-3 py-2 dh-type-control text-[var(--accent-contrast)] disabled:opacity-45"
                disabled={!routeAvailable || model.creatingChat}
                onClick={() => void model.createChat()}
              >
                Create chat
              </button>
            }
          />
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto flex min-h-full w-full max-w-[var(--chat-prose-max)] flex-col px-5 py-6">
              {model.loadingChat && model.messages.length === 0 ? (
                <div className="flex flex-1 items-center justify-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                  <IconSpinner className="h-4 w-4 animate-spin" /> Loading chat…
                </div>
              ) : model.messages.length === 0 &&
                model.pendingApprovals.length === 0 &&
                model.pendingCount === 0 ? (
                <div className="flex flex-1 items-center justify-center text-center text-[var(--text-11)] text-[var(--muted)]">
                  Send a prompt to start this remote chat.
                </div>
              ) : (
                <div className="space-y-4">
                  {model.messages.map((message, index) => (
                    <AssistantMessageRow
                      key={message.id ?? `${message.role}:${message.createdAt ?? index}`}
                      message={message}
                      showToolCalls
                    />
                  ))}
                  {model.pendingApprovals.map((approval) => {
                    const detailsTruncated = approval.args?.truncated === true;
                    return (
                      <ApprovalCard
                        key={approval.id}
                        approval={approval}
                        busy={model.approvalBusyId === approval.id}
                        disabled={!routeAvailable}
                        approveDisabled={detailsTruncated}
                        warning={
                          detailsTruncated
                            ? 'The request details were truncated in transit. Deny it here or review the complete request on its home device.'
                            : undefined
                        }
                        onApprove={() => void model.resolveApproval(approval, true)}
                        onDeny={() => void model.resolveApproval(approval, false)}
                      />
                    );
                  })}
                  {model.pendingCount > 0 ? (
                    <div className="flex items-center gap-2 py-2 text-[var(--text-10)] text-[var(--muted)]">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--yellow)]" />
                      {model.pendingCount === 1
                        ? 'A prompt is queued on the remote device.'
                        : `${model.pendingCount} prompts are queued on the remote device.`}
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </div>
          <ChatInput
            resetKey={`${selectedDevice?.id}:${model.selectedDrone.id}:${model.selectedChat}`}
            draftPersistenceKey={`remote:${selectedDevice?.id ?? 'unknown'}:drone:${model.selectedDrone.id}:chat:${model.selectedChat}`}
            droneName={model.selectedDrone.name}
            promptError={model.chatError}
            waiting={model.waiting}
            allowSendWhileWaiting
            disabled={!routeAvailable}
            attachmentsEnabled
            attachmentMode={model.attachmentMode}
            onStop={model.waiting ? model.stop : undefined}
            stopping={model.stopping}
            onSend={async ({ prompt, attachments, promptId }, context) =>
              await model.sendPrompt(prompt, attachments, context.deliveryMode, promptId)
            }
          />
        </>
      )}
    </main>
  );
}

function RemoteDeviceWorkspaceTarget({
  targetDeviceId,
  routeAvailable,
}: {
  targetDeviceId: string;
  routeAvailable: boolean;
}) {
  const sidebarDockSide = useDroneHubUiStore(
    (state: RemoteSidebarUiState) => state.sidebarDockSide,
  );
  const sidebarCollapsed = useDroneHubUiStore(
    (state: RemoteSidebarUiState) => state.sidebarCollapsed,
  );
  const setSidebarCollapsed = useDroneHubUiStore(
    (state: RemoteSidebarUiState) => state.setSidebarCollapsed,
  );
  const model = useRemoteDroneHub(targetDeviceId, routeAvailable);
  const sidebar = sidebarCollapsed ? null : (
    <RemoteSidebar
      model={model}
      routeAvailable={routeAvailable}
      dockSide={sidebarDockSide}
      onCollapse={() => setSidebarCollapsed(true)}
    />
  );
  const main = (
    <RemoteMain
      model={model}
      routeAvailable={routeAvailable}
      sidebarCollapsed={sidebarCollapsed}
      onExpandSidebar={() => setSidebarCollapsed(false)}
    />
  );

  return (
    <div data-drone-app-shell="true" className="fixed inset-0 flex h-screen overflow-hidden">
      {sidebarDockSide === 'right' ? (
        <>
          {main}
          {sidebar}
        </>
      ) : (
        <>
          {sidebar}
          {main}
        </>
      )}
    </div>
  );
}

export function RemoteDeviceWorkspace() {
  const { selectedDeviceId, remoteRouteAvailable } = useDesktopDevice();
  return (
    <RemoteDeviceWorkspaceTarget
      key={selectedDeviceId}
      targetDeviceId={selectedDeviceId}
      routeAvailable={remoteRouteAvailable}
    />
  );
}
