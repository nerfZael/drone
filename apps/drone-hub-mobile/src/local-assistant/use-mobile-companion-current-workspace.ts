import React from 'react';
import { COMPANION_CAPABILITY } from '@drone/device-protocol';
import type { ChatWorkspaceCatalog, ChatWorkspaceOption } from '@drone/assistant-chat';
import { useMesh } from '../mesh/MeshContext';
import {
  grantMobileCompanionCurrentWorkspaceRead,
  resolveMobileCompanionCurrentWorkspaceAccess,
  type MobileCompanionCurrentWorkspace,
} from './mobile-companion-current-workspace-model';

/** Quick read access for the drone open on the phone, saved on the Hub like desktop's "Allow Read". */
export function useMobileCompanionCurrentWorkspace(input: {
  deviceId: string;
  droneId: string;
  supported: boolean;
  active: boolean;
}) {
  const { deviceId, droneId, supported, active } = input;
  const { request } = useMesh();
  const [current, setCurrent] = React.useState<MobileCompanionCurrentWorkspace | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [retry, setRetry] = React.useState(0);
  const generation = React.useRef(0);
  const enabled = supported && active && Boolean(deviceId) && Boolean(droneId);

  React.useEffect(() => {
    const requestId = ++generation.current;
    setCurrent(null);
    setError('');
    if (!enabled) { setLoading(false); return; }
    setLoading(true);
    void (async () => {
      try {
        const catalog = await request(deviceId, COMPANION_CAPABILITY.id, 'workspaces.current', { droneId }) as
          ChatWorkspaceCatalog & { target?: ChatWorkspaceOption };
        if (!catalog?.target || !catalog.access) throw new Error('Invalid workspace response from the Hub.');
        if (generation.current === requestId) setCurrent({ ...catalog, target: catalog.target, droneId });
      } catch (caught) {
        if (generation.current === requestId) setError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        if (generation.current === requestId) setLoading(false);
      }
    })();
    return () => { generation.current++; };
  }, [deviceId, droneId, enabled, request, retry]);

  const reload = React.useCallback(() => setRetry((value) => value + 1), []);

  const grant = React.useCallback(async () => {
    if (!current || busy || current.droneId !== droneId) { reload(); return; }
    setBusy(true);
    setError('');
    try {
      await request(deviceId, COMPANION_CAPABILITY.id, 'workspaces.update', {
        access: grantMobileCompanionCurrentWorkspaceRead(current),
        revision: current.revision,
      });
      // Reload even after navigation: this save changed the shared access revision.
      reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }, [busy, current, deviceId, droneId, reload, request]);

  const access = resolveMobileCompanionCurrentWorkspaceAccess({ supported, droneId, loading, busy, error, current });
  return { ...access, current, loading, busy, error, grant, reload };
}
