import React from 'react';
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
      {portsError && <div className="truncate text-[var(--text-11)] text-[var(--red)]" title={portsError}>{portsError}</div>}
      {!portsError && portRows.length === 0 && (
        <div className="text-[var(--text-11)] text-[var(--muted-dim)]">No mapped ports</div>
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
                  {isReachable ? (
                    <span
                      className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] animate-pulse-dot"
                      title={`Container port ${p.containerPort} looks reachable`}
                    />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-[var(--border)]" />
                  )}
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
    <div className="w-full h-full bg-[var(--panel-alt)] overflow-auto relative">

      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div
          className="text-[var(--text-10)] font-[var(--weight-semibold)] text-[var(--muted-dim)] tracking-[0.12em] uppercase"
          style={{ fontFamily: 'var(--display)' }}
        >
          Links
        </div>
        <div
          className="text-[var(--text-10)] text-[var(--muted-dim)] tabular-nums font-mono"
          title={
            portsLoading
              ? 'Loading ports…'
              : portsError
                ? `Ports error: ${portsError}`
                : `${upCount}/${portRows.length} reachable port${portRows.length !== 1 ? 's' : ''}`
          }
        >
          {portsLoading ? '…' : portsError ? 'error' : `${upCount}/${portRows.length}`}
        </div>
      </div>

      <DroneLinksContent
        agentLabel={agentLabel}
        chatName={chatName}
        portRows={portRows}
        portReachabilityByHostPort={portReachabilityByHostPort}
        portsError={portsError}
      />
    </div>
  );
}
