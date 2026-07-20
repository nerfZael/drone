import React from 'react';
import type { MeshDevice } from './use-device-mesh';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;
type Credential = 'openai' | 'codex' | 'groq';

export function ProviderCredentialTransferPanel({
  requestJson,
  devices,
  selfDeviceId,
}: {
  requestJson: RequestJson;
  devices: MeshDevice[];
  selfDeviceId: string;
}) {
  const sources = devices.filter(
    (device) => device.id !== selfDeviceId && !device.revokedAt && device.platform !== 'android',
  );
  const [sourceDeviceId, setSourceDeviceId] = React.useState('');
  const [busy, setBusy] = React.useState<Credential | null>(null);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const selectedSource =
    sources.find((device) => device.id === sourceDeviceId) ?? sources[0] ?? null;
  const selfIsAdministrator = devices.find((device) => device.id === selfDeviceId)?.administrator;

  React.useEffect(() => {
    if (!sources.some((device) => device.id === sourceDeviceId))
      setSourceDeviceId(sources[0]?.id ?? '');
  }, [sourceDeviceId, sources]);

  const importCredential = async (credential: Credential) => {
    if (!selectedSource) return;
    const label =
      credential === 'codex'
        ? 'Codex login'
        : credential === 'groq'
          ? 'GROQ API key'
          : 'OpenAI API key';
    const warning =
      credential === 'codex'
        ? `Replace this computer's file-based Codex login with the login from ${selectedSource.name}?`
        : `Copy the ${credential === 'groq' ? 'GROQ' : 'OpenAI'} API key from ${selectedSource.name} to this computer?`;
    if (!window.confirm(warning)) return;
    setBusy(credential);
    setError(null);
    setMessage(null);
    try {
      await requestJson('/api/device-mesh/provider-credentials/import', {
        method: 'POST',
        body: JSON.stringify({ sourceDeviceId: selectedSource.id, credential }),
      });
      setMessage(`${label} copied from ${selectedSource.name}.`);
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--accent)]">
        Provider credentials
      </div>
      <h2 className="mt-1 text-[15px] font-semibold text-[var(--fg)]">Copy from a trusted Hub</h2>
      <p className="mt-1 max-w-3xl text-[11px] leading-relaxed text-[var(--muted)]">
        The source must mark this device as an administrator and grant the exact export operation.
        The credential is encrypted for this one transfer before it crosses the mesh.
      </p>
      {selfIsAdministrator === false ? (
        <div className="mt-3 text-[11px] text-[var(--yellow)]">
          This device is not an administrator and cannot receive provider credentials.
        </div>
      ) : null}
      {sources.length === 0 ? (
        <div className="mt-3 text-[11px] text-[var(--muted)]">Pair another Hub first.</div>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <label className="grid min-w-56 flex-1 gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-dim)]">
              Source device
            </span>
            <select
              value={selectedSource?.id ?? ''}
              onChange={(event) => setSourceDeviceId(event.target.value)}
              disabled={busy !== null}
              className="h-9 rounded border border-[var(--border)] bg-[var(--panel)] px-3 text-[12px] text-[var(--fg)]"
            >
              {sources.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.name} · {device.platform}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!selectedSource || !selfIsAdministrator || busy !== null}
            onClick={() => void importCredential('openai')}
            className="h-9 rounded border border-[var(--accent-muted)] bg-[var(--accent-subtle)] px-3 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
          >
            {busy === 'openai' ? 'Copying…' : 'Copy OpenAI key'}
          </button>
          <button
            type="button"
            disabled={!selectedSource || !selfIsAdministrator || busy !== null}
            onClick={() => void importCredential('codex')}
            className="h-9 rounded border border-[var(--border-subtle)] px-3 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
          >
            {busy === 'codex' ? 'Copying…' : 'Copy Codex login'}
          </button>
          <button
            type="button"
            disabled={!selectedSource || !selfIsAdministrator || busy !== null}
            onClick={() => void importCredential('groq')}
            className="h-9 rounded border border-[var(--border-subtle)] px-3 text-[11px] font-semibold text-[var(--fg)] disabled:opacity-50"
          >
            {busy === 'groq' ? 'Copying…' : 'Copy GROQ key'}
          </button>
        </div>
      )}
      {message ? <div className="mt-3 text-[11px] text-[var(--green)]">{message}</div> : null}
      {error ? <div className="mt-3 text-[11px] text-[var(--red)]">{error}</div> : null}
    </section>
  );
}
