import React from 'react';
import { LanDiscoveryStatus } from './LanDiscoveryStatus';
import { mergeDiscoveredPhones, type DiscoveredPhone as Phone } from './phone-discovery-results';

export function PhoneDiscoveryPanel({
  requestJson,
}: {
  requestJson: <T>(url: string, init?: RequestInit) => Promise<T>;
}) {
  const [manualPhones, setManualPhones] = React.useState<Phone[]>([]);
  const [nearbyPhones, setNearbyPhones] = React.useState<Phone[]>([]);
  const [now, setNow] = React.useState(Date.now);
  const phones = mergeDiscoveredPhones(manualPhones, nearbyPhones, now);
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState('');
  const [error, setError] = React.useState('');
  const [confirmation, setConfirmation] = React.useState<{
    code: string;
    phoneName: string;
    expiresAt: string;
  } | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(timer);
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error: any) {
      if (alive.current) {
        setError(error?.message ?? String(error));
        setMessage('');
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const button = 'rounded border border-[var(--border)] px-3 py-2 disabled:opacity-50';
  return (
    <section className="rounded-lg border border-[var(--border-subtle)] p-4 space-y-3 text-[var(--text-11)]">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[var(--text-12)] font-medium">Phones</h3>
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void run(async () => {
              setManualPhones([]);
              setConfirmation(null);
              setMessage('Looking for discoverable phones…');
              const result = await requestJson<{ phones: Phone[] }>('/api/device-mesh/phones');
              if (!alive.current) return;
              setManualPhones(result.phones);
              setMessage(
                result.phones.length
                  ? ''
                  : 'No phones found. Open Add device on the phone and retry.',
              );
            })
          }
        >
          {busy ? 'Searching…' : 'Find phones'}
        </button>
      </div>
      <LanDiscoveryStatus requestJson={requestJson} onPhones={setNearbyPhones} />
      {message && (busy || phones.length === 0) && <p role="status">{message}</p>}
      {phones.map((phone) => (
        <div key={phone.deviceId} className="flex items-center justify-between gap-2">
          <span>{phone.name}</span>
          <button
            className={button}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                setMessage('');
                setConfirmation(null);
                const result = await requestJson<{
                  code: string;
                  phoneName: string;
                  expiresAt: string;
                }>('/api/device-mesh/phones', {
                  method: 'POST',
                  body: JSON.stringify({ deviceId: phone.deviceId }),
                });
                if (alive.current) setConfirmation(result);
              })
            }
          >
            Connect
          </button>
        </div>
      ))}
      {confirmation && Date.parse(confirmation.expiresAt) > now && (
        <div role="status">
          <p>
            Compare this code on {confirmation.phoneName}: <strong>{confirmation.code}</strong>
          </p>
          <p>Confirm only if the codes match. Then approve the phone’s request here.</p>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[var(--red)]">
          {error}
        </p>
      )}
    </section>
  );
}
