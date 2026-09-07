import { WorkspaceLoadDiagnostics } from '@drone/hub-model';
import { recordUiAction } from '../../ui-diagnostics';

export const desktopWorkspaceLoads = new WorkspaceLoadDiagnostics({
  uuid: () => crypto.randomUUID(),
  platform: 'web',
  save: async (record) => {
    await fetch('/api/telemetry/file-load', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(record), keepalive: true,
    });
  },
});

export function beginDesktopWorkspaceLoad(kind: 'file-open' | 'directory-load', droneId: string, path: string) {
  recordUiAction({ action: kind, droneId, path });
  return desktopWorkspaceLoads.start(kind, { targetDeviceId: 'desktop', droneId, chatName: 'default', path });
}

export function desktopWorkspaceCommitted(kind: 'file-open' | 'directory-load', droneId: string, path: string, error = false) {
  const id = desktopWorkspaceLoads.find(kind, { droneId, path });
  if (error) desktopWorkspaceLoads.finish(id, 'error');
  else desktopWorkspaceLoads.committed(id);
}

export function observeDesktopFilesystemRequest(raw: string) {
  let url: URL;
  try { url = new URL(raw, 'http://hub.local'); } catch { return null; }
  const match = url.pathname.match(/^\/api\/drones\/([^/]+)\/fs\/(file|list)$/);
  if (!match) return null;
  let droneId: string;
  try { droneId = decodeURIComponent(match[1]); } catch { return null; }
  const path = url.searchParams.get('path') ?? '';
  const kind = match[2] === 'list' ? 'directory-load' : 'file-open';
  const id = desktopWorkspaceLoads.find(kind, { droneId, path }) ??
    (kind === 'directory-load' ? desktopWorkspaceLoads.find('file-open', { droneId }) : undefined);
  // File watches and background refreshes must not masquerade as user opens.
  if (!id) return null;
  const observation = desktopWorkspaceLoads.observe({ droneId, path }, kind === 'file-open' ? 'file.preview' : 'files.list', crypto.randomUUID(), id);
  let response: Response | undefined;
  return {
    response(value: Response) {
      response = value;
      observation?.mark('fetchMs');
      observation?.serverId(value.headers.get('x-drone-request-id') ?? undefined);
      for (const part of (value.headers.get('server-timing') ?? '').split(',')) {
        const entry = part.trim().match(/^([a-zA-Z0-9_]+);dur=([\d.]+)/);
        if (entry) observation?.timing(`server.${entry[1]}`, Number(entry[2]));
      }
    },
    finish({ responseBytes, parseMs }: { responseBytes: number; parseMs: number }) {
      observation?.mark('responseReadyMs');
      observation?.timing('responseBytes', responseBytes);
      observation?.timing('parseMs', parseMs);
      observation?.finish(response?.ok ? 'completed' : 'error');
      desktopWorkspaceLoads.mark(id, 'responseReceived');
    },
    fail(error: unknown) {
      const aborted = (error as { name?: string })?.name === 'AbortError';
      observation?.finish(aborted ? 'aborted' : 'error');
      // Navigation owners decide whether a failed request is recoverable.
    },
  };
}
