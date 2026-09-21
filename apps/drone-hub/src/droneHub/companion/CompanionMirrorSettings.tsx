import React from 'react';
import { useCompanionMirror } from './CompanionMirrorContext';

export function CompanionMirrorSettings() {
  const mirror = useCompanionMirror();
  if (!mirror) return null;
  return <section className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
    <label className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
      <input type="checkbox" checked={mirror.enabled} disabled={!mirror.connected || mirror.saving}
        onChange={(event) => void mirror.setEnabled(event.target.checked)} />
      Mirror remote Companion on this device
    </label>
    <p className="mt-1 text-xs text-[var(--muted)]">
      {mirror.saving ? 'Saving…' : !mirror.connected ? 'Connecting to Companion…'
        : 'Saved immediately for this Hub. Review a phone’s Live conversation, control its microphone and voice session, and manage proposals here. Audio stays on the phone. Hiding the panel keeps the conversation running.'}
    </p>
    {mirror.connected && mirror.enabled && mirror.sessions.length === 0
      ? <p className="mt-2 text-xs text-[var(--muted)]">Waiting for a remote Live session. The phone app must also support mirroring.</p> : null}
    {mirror.error ? <p role="alert" className="mt-2 text-xs text-[var(--red)]">{mirror.error}</p> : null}
  </section>;
}
