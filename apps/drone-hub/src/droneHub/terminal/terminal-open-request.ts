import { requestJson } from '../http';

export type ShellTerminalTarget = { droneId: string; cwd: string; sessionName: string };
export type ShellTerminalOpened = {
  sessionName: string;
  reused?: boolean;
  transport?: string;
  diagnostics?: unknown;
  requestId?: string;
  requestMs?: number;
};

export function createTerminalOpenRequests(request: typeof requestJson) {
  const pending = new Map<string, { promise: Promise<ShellTerminalOpened>; expires: number }>();
  const key = (target: ShellTerminalTarget) =>
    JSON.stringify([target.droneId, target.cwd, target.sessionName]);
  return {
    invalidate(target: ShellTerminalTarget) {
      pending.delete(key(target));
    },
    open(target: ShellTerminalTarget): Promise<ShellTerminalOpened> {
      const id = key(target);
      const existing = pending.get(id);
      if (existing && existing.expires > Date.now()) return existing.promise;
      const requestId = crypto.randomUUID();
      const started = performance.now();
      const params = new URLSearchParams({
        mode: 'shell',
        cwd: target.cwd,
        session: target.sessionName,
      });
      const entry = {
        promise: Promise.resolve(null as unknown as ShellTerminalOpened),
        expires: Infinity,
      };
      entry.promise = request<ShellTerminalOpened>(
        `/api/drones/${encodeURIComponent(target.droneId)}/terminal/open?${params}`,
        { method: 'POST' },
      )
        .then((result) => {
          if (!result.sessionName)
            throw new Error('terminal session did not return a session name');
          entry.expires = Date.now() + 3000;
          return { ...result, requestId, requestMs: performance.now() - started };
        })
        .catch((error) => {
          if (pending.get(id) === entry) pending.delete(id);
          throw error;
        });
      pending.set(id, entry);
      // Only retain a small set of recent/in-flight prewarms. Eviction does not
      // cancel creation; explicit session names keep retries idempotent.
      while (pending.size > 64) pending.delete(pending.keys().next().value!);
      return entry.promise;
    },
  };
}

export const terminalOpenRequests = createTerminalOpenRequests(requestJson);

export function prewarmShellTerminal(droneId: string, cwd: string) {
  void import('./DroneTerminalDock').catch(() => {});
  return terminalOpenRequests.open({ droneId, cwd, sessionName: 'drone-hub-shell' });
}
