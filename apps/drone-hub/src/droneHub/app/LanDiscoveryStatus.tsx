import React from 'react';
import type { DiscoveredPhone } from './phone-discovery-results';

type NearbyPhone = DiscoveredPhone;
export function LanDiscoveryStatus({
  requestJson,
  onPhones,
}: {
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
  onPhones(phones: NearbyPhone[]): void;
}) {
  const [enabled, setEnabled] = React.useState(true);
  const [message, setMessage] = React.useState('Starting nearby discovery…');
  React.useEffect(() => {
    const lease = crypto.randomUUID();
    let disposed = false;
    let revision = 0;
    let pending: Promise<unknown> = Promise.resolve();
    const send = (visible: boolean) => {
      const result = pending
        .catch(() => undefined)
        .then(() =>
          requestJson<{ active: boolean; error: string }>('/api/device-mesh/lan-discovery', {
            method: 'POST',
            body: JSON.stringify({ lease, enabled: visible }),
            signal: AbortSignal.timeout(5000),
          }),
        );
      pending = result;
      return result;
    };
    const update = async () => {
      const round = ++revision;
      const visible = enabled && document.visibilityState === 'visible';
      if (!visible) onPhones([]);
      try {
        const result = await send(visible);
        if (!disposed && round === revision)
          setMessage(
            !visible
              ? 'Nearby discovery paused.'
              : result.error || (result.active ? 'Visible on Wi-Fi' : 'Starting Wi-Fi discovery…'),
          );
        if (
          !disposed &&
          round === revision &&
          visible &&
          document.visibilityState === 'visible' &&
          result.active
        ) {
          const found = await requestJson<{ phones: NearbyPhone[] }>(
            '/api/device-mesh/phones?network=lan',
            { signal: AbortSignal.timeout(15000) },
          );
          if (!disposed && round === revision && document.visibilityState === 'visible')
            onPhones(found.phones);
        }
      } catch (error: any) {
        if (!disposed && round === revision)
          setMessage(error?.message ?? 'Nearby discovery unavailable.');
      }
    };
    void update();
    const timer = setInterval(() => void update(), 15000);
    document.addEventListener('visibilitychange', update);
    return () => {
      disposed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      void send(false).catch(() => undefined);
    };
  }, [requestJson, enabled, onPhones]);
  return (
    <div className="flex items-center justify-between gap-3 text-[var(--muted)]">
      <p role="status">{message}</p>
      <button
        className="shrink-0 rounded px-2 py-2 text-[var(--accent)] hover:bg-[var(--hover)]"
        aria-label={enabled ? 'Stop nearby discovery' : 'Start nearby discovery'}
        onClick={() => setEnabled((value) => !value)}
      >
        {enabled ? 'Stop' : 'Start'}
      </button>
    </div>
  );
}
