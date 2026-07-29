import React from 'react';
import {
  UiPaneState,
  UiPanel,
  UiPanelBody,
  UiPanelHeader,
  UiStatusChip,
  UiStatusDot,
} from '../../ui/components';
import type { DronePortMapping, PortReachabilityByHostPort } from '../types';

export type DroneLinksContentProps = {
  agentLabel: string;
  chatName: string;
  portRows: DronePortMapping[];
  portReachabilityByHostPort: PortReachabilityByHostPort;
  portsError: string | null;
};

export function DroneLinksContent({
  agentLabel,
  chatName,
  portRows,
  portReachabilityByHostPort,
  portsError,
}: DroneLinksContentProps) {
  return (
    <div className="px-3 py-2 text-[var(--text-11)]">
      {portsError ? (
        <UiPaneState
          kind="error"
          title="Could not load mapped ports"
          description={portsError}
          compact
        />
      ) : null}
      {!portsError && portRows.length === 0 && (
        <UiPaneState
          kind="empty"
          title="No mapped ports"
          description="Published services will appear here."
          compact
        />
      )}
      {!portsError && portRows.length > 0 && (
        <div className="flex max-h-[164px] flex-col gap-1.5 overflow-auto pr-1">
          {portRows.map((p) => {
            const routedUrl = `http://localhost:${p.hostPort}`;
            const reachability = portReachabilityByHostPort[String(p.hostPort)] ?? 'checking';
            const isReachable = reachability === 'up';
            return (
              <div key={`${p.containerPort}:${p.hostPort}`} className="flex items-center justify-between gap-3">
                <span className="inline-flex flex-shrink-0 items-center gap-1.5 font-mono text-[var(--text-10)] tabular-nums text-[var(--muted-dim)]" title="container → host">
                  <UiStatusDot
                    tone={
                      reachability === 'up'
                        ? 'accent'
                        : reachability === 'checking'
                          ? 'info'
                          : 'neutral'
                    }
                    pulse={isReachable}
                    label={
                      reachability === 'up'
                        ? `Container port ${p.containerPort} looks reachable`
                        : reachability === 'checking'
                          ? `Checking container port ${p.containerPort}`
                          : `Container port ${p.containerPort} is not reachable`
                    }
                    className="h-1.5 w-1.5 [&>span]:h-1.5 [&>span]:w-1.5"
                  />
                  {p.containerPort}→{p.hostPort}
                </span>
                <div className="flex min-w-0 items-center gap-1.5 font-mono text-[var(--text-10)]">
                  <a
                    href={routedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="min-w-0 truncate font-mono text-[var(--text-10)] tabular-nums text-[var(--link)] transition-colors hover:text-[var(--link-hover)]"
                    title={`Open container:${p.containerPort} via ${routedUrl}`}
                  >
                    :{p.containerPort}
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1.5 border-t border-[var(--border-subtle)] pt-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--text-10)] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Agent</span>
          <span className="min-w-0 truncate text-[var(--text-11)] text-[var(--muted)]" title={agentLabel}>
            {agentLabel}
          </span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[var(--text-10)] uppercase tracking-wide text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Chat</span>
          <span className="min-w-0 truncate font-mono text-[var(--text-11)] text-[var(--muted)]" title={chatName}>
            {chatName}
          </span>
        </div>
      </div>
    </div>
  );
}

export function DroneLinksDock({
  droneId,
  droneName,
  agentLabel,
  chatName,
  portRows,
  portReachabilityByHostPort,
  portsLoading,
  portsError,
}: {
  droneId: string;
  droneName: string;
  agentLabel: string;
  chatName: string;
  portRows: DronePortMapping[];
  portReachabilityByHostPort: PortReachabilityByHostPort;
  portsLoading: boolean;
  portsError: string | null;
}) {
  const upCount = React.useMemo(
    () => portRows.filter((p) => (portReachabilityByHostPort[String(p.hostPort)] ?? 'checking') === 'up').length,
    [portRows, portReachabilityByHostPort],
  );

  return (
    <UiPanel
      flush
      surface="alternate"
      className="h-full w-full"
      data-drone-id={droneId}
    >
      <UiPanelHeader
        title="Links"
        description={droneName}
        density="compact"
        meta={
          <UiStatusChip
            tone={portsError ? 'danger' : portsLoading ? 'info' : upCount > 0 ? 'success' : 'neutral'}
          title={
            portsLoading
              ? 'Loading ports…'
              : portsError
                ? `Ports error: ${portsError}`
                : `${upCount}/${portRows.length} reachable port${portRows.length !== 1 ? 's' : ''}`
          }
          >
            {portsLoading ? 'Loading' : portsError ? 'Error' : `${upCount}/${portRows.length}`}
          </UiStatusChip>
        }
      />
      <UiPanelBody scroll>
        {portsLoading && portRows.length === 0 && !portsError ? (
          <UiPaneState kind="loading" title="Loading mapped ports…" />
        ) : (
          <DroneLinksContent
            agentLabel={agentLabel}
            chatName={chatName}
            portRows={portRows}
            portReachabilityByHostPort={portReachabilityByHostPort}
            portsError={portsError}
          />
        )}
      </UiPanelBody>
    </UiPanel>
  );
}
