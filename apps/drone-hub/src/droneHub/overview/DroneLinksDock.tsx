import React from 'react';
import type { DronePortMapping, PortReachabilityByHostPort } from '../types';

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
          className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.12em] uppercase"
          style={{ fontFamily: 'var(--display)' }}
        >
          Links
        </div>
        <div
          className="text-[10px] text-[var(--muted-dim)] tabular-nums font-mono"
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

      <div className="px-3 py-2 text-[11px]">
        {portsError && <div className="text-[11px] text-[var(--red)] truncate" title={portsError}>{portsError}</div>}
        {!portsError && portRows.length === 0 && (
          <div className="text-[11px] text-[var(--muted-dim)]">No mapped ports</div>
        )}
        {!portsError && portRows.length > 0 && (
          <div className="max-h-[164px] overflow-auto pr-1 flex flex-col gap-1.5">
            {portRows.map((p) => {
              const routedUrl = `http://localhost:${p.hostPort}`;
              const reachability = portReachabilityByHostPort[String(p.hostPort)] ?? 'checking';
              const isReachable = reachability === 'up';
              return (
                <div key={`${p.containerPort}:${p.hostPort}`} className="flex items-center justify-between gap-3">
                  <span className="text-[var(--muted-dim)] flex-shrink-0 tabular-nums inline-flex items-center gap-1.5 font-mono text-[10px]" title="container → host">
                    {isReachable ? (
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse-dot"
                        title={`Container port ${p.containerPort} looks reachable`}
                      />
                    ) : (
                      <span className="w-1.5 h-1.5 rounded-full bg-[var(--border)]" />
                    )}
                    {p.containerPort}→{p.hostPort}
                  </span>
                  <div className="min-w-0 flex items-center gap-1.5 font-mono text-[10px]">
                    <a
                      href={routedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-[var(--accent)] hover:text-[var(--fg)] tabular-nums font-mono text-[10px] transition-colors"
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

        <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Agent</span>
            <span className="min-w-0 truncate text-[var(--muted)] text-[11px]" title={agentLabel}>
              {agentLabel}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] text-[var(--muted-dim)] tracking-wide uppercase" style={{ fontFamily: 'var(--display)' }}>Chat</span>
            <span className="min-w-0 truncate text-[var(--muted)] text-[11px] font-mono" title={chatName}>
              {chatName}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
