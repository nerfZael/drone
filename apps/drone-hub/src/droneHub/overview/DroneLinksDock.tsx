import React from 'react';
import type { DronePortMapping, PortReachabilityByHostPort } from '../types';

export function DroneLinksDock({
  droneName,
  agentLabel,
  chatName,
  portRows,
  selectedPort,
  portReachabilityByHostPort,
  onSelectPort,
  portsLoading,
  portsError,
}: {
  droneName: string;
  agentLabel: string;
  chatName: string;
  portRows: DronePortMapping[];
  selectedPort: DronePortMapping | null;
  portReachabilityByHostPort: PortReachabilityByHostPort;
  onSelectPort: (port: DronePortMapping | null) => void;
  portsLoading: boolean;
  portsError: string | null;
}) {
  const selectedKey = selectedPort ? `${selectedPort.containerPort}:${selectedPort.hostPort}` : '';
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
              const url = `http://localhost:${p.hostPort}`;
              const portKey = `${p.containerPort}:${p.hostPort}`;
              const selected = selectedKey === portKey;
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
                  <div className="min-w-0 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectPort(selected ? null : p)}
                      className={`px-2 py-0.5 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                        selected
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-muted)] shadow-[0_0_8px_rgba(167,139,250,.1)]'
                          : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] border-[var(--border-subtle)] hover:text-[var(--muted)] hover:border-[var(--border)]'
                      }`}
                      style={{ fontFamily: 'var(--display)' }}
                      title={selected ? `Hide browser for container:${p.containerPort}` : `Open browser for container:${p.containerPort}`}
                    >
                      {selected ? 'Active' : 'Browser'}
                    </button>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate text-[var(--accent)] hover:text-[var(--fg)] tabular-nums font-mono text-[10px] transition-colors"
                      title={`Open ${url}`}
                    >
                      :{p.hostPort}
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
