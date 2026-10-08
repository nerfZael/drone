import React from 'react';
import { EmptyState } from '../chat';
import { useDesktopDevice } from './DesktopDeviceProvider';
import { IconSpinner } from './icons';
import { RemoteDeviceWorkspace } from './RemoteDeviceWorkspace';
import {
  openRemoteHub,
  RemoteHubOpenError,
  remoteHubRuntime,
  supportsFullRemoteHub,
} from './remote-hub';

type LaunchState =
  | { deviceId: string; status: 'opening' }
  | { deviceId: string; status: 'failed'; error: string; code: string };

/**
 * Opens a selected desktop Hub in full by moving this window to the local viewer origin.
 * Phones, offline devices and Hubs that have not granted full access keep the chat view.
 */
export function RemoteHubLauncher() {
  const { selectedDevice, selfDeviceId, remoteRouteAvailable, selectDevice } = useDesktopDevice();
  const [launch, setLaunch] = React.useState<LaunchState | null>(null);
  const [attempt, setAttempt] = React.useState(0);
  const deviceId = selectedDevice?.id ?? '';
  // A remote Hub page never opens further Hubs; devices are switched from home.
  const fullAccess = !remoteHubRuntime() && supportsFullRemoteHub(selectedDevice);
  const failedForDevice = launch?.deviceId === deviceId && launch.status === 'failed';

  React.useEffect(() => {
    if (!deviceId || !fullAccess || !remoteRouteAvailable || failedForDevice) return;
    const controller = new AbortController();
    setLaunch({ deviceId, status: 'opening' });
    openRemoteHub(deviceId, controller.signal).then(
      (url) => {
        if (!controller.signal.aborted) window.location.assign(url);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLaunch({
          deviceId,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          code: error instanceof RemoteHubOpenError ? error.code : 'HUB_REMOTE_UNAVAILABLE',
        });
      },
    );
    return () => controller.abort();
    // `failedForDevice` stops retry loops; `attempt` is the explicit retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, fullAccess, remoteRouteAvailable, attempt]);

  if (fullAccess && remoteRouteAvailable && !failedForDevice) {
    return (
      <div className="fixed inset-0 bg-[var(--chat-background)]">
        <EmptyState
          icon={<IconSpinner className="h-6 w-6 animate-spin text-[var(--accent)]" />}
          title={`Opening ${selectedDevice?.name ?? 'device'}`}
          description="Connecting to its Drone Hub."
          actions={
            <button
              type="button"
              className="rounded-[var(--radius-medium)] border border-[var(--border)] px-4 py-2 dh-type-control text-[var(--fg-secondary)] hover:bg-[var(--hover)]"
              onClick={() => selectDevice(selfDeviceId)}
            >
              Cancel
            </button>
          }
        />
      </div>
    );
  }

  const notice =
    fullAccess && failedForDevice && launch?.status === 'failed' ? (
      <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-[var(--border-subtle)] bg-[var(--surface-softest)] px-4 py-2 text-center text-10 text-[var(--muted)]">
        <span>
          {launch.code === 'HUB_REMOTE_NOT_GRANTED'
            ? launch.error
            : `Full access is unavailable: ${launch.error}`}{' '}
          Showing chats only.
        </span>
        <button
          type="button"
          className="dh-type-control-compact text-[var(--accent)] hover:underline"
          onClick={() => {
            setLaunch(null);
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </div>
    ) : null;
  return <RemoteDeviceWorkspace notice={notice} />;
}
