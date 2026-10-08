import React from 'react';
import type { SpeechClip, SpeechClipStatus } from '@drone/hub-model';
import { UiBadge, UiButton, UiSegmentedControl } from '../../ui/components';
import type { UiBadgeTone } from '../../ui/components/Badge';
import { confirmDeleteDialog } from '../../ui/AppConfirmDialog';
import { requestJson } from '../http';
import { SettingsSection } from './SettingsSurface';

type Filter = 'all' | SpeechClipStatus;

const PAGE_SIZE = 50;

const FILTERS: ReadonlyArray<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'transcribed', label: 'Transcribed' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
];

const STATUS: Record<SpeechClipStatus, { label: string; tone: UiBadgeTone }> = {
  transcribing: { label: 'Transcribing', tone: 'info' },
  transcribed: { label: 'Transcribed', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
  canceled: { label: 'Canceled', tone: 'neutral' },
};

const SURFACES: Record<string, string> = {
  'voice-message': 'Chat voice message',
  'continuous-steering': 'Continuous voice',
  'continuous-dictation': 'Continuous dictation',
  'file-dictation': 'File dictation',
  companion: 'Companion',
  'global-dictation': 'Dictation',
  'mobile-dictation': 'Dictation',
  'mobile-single-shot': 'Chat voice message',
  'mobile-companion': 'Companion',
  'mobile-continuous': 'Continuous voice',
};

/** Every recording this Hub transcribed or received, with its audio and transcript. */
export function RecordingsSettingsTab() {
  const [clips, setClips] = React.useState<SpeechClip[] | null>(null);
  const [counts, setCounts] = React.useState<{ total: number; matching: number; bytes: number } | null>(null);
  const [filter, setFilter] = React.useState<Filter>('all');
  const [limit, setLimit] = React.useState(PAGE_SIZE);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState<ReadonlySet<string>>(new Set());
  const requestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const query = new URLSearchParams({ limit: String(limit), ...(filter === 'all' ? {} : { status: filter }) });
      const data = await requestJson<{ clips: SpeechClip[]; total: number; matching: number; totalBytes: number }>(`/api/speech-clips?${query}`);
      // A slower reply for a previous filter must not replace the current one.
      if (request !== requestRef.current) return;
      setClips(data.clips);
      setCounts({ total: data.total, matching: data.matching, bytes: data.totalBytes });
    } catch (cause) { if (request === requestRef.current) setError(errorText(cause)); }
  }, [filter, limit]);

  const transcribing = clips?.some((clip) => clip.status === 'transcribing') ?? false;
  React.useEffect(() => {
    void refresh();
    // Poll quickly only while a transcript is on its way.
    const timer = window.setInterval(() => void refresh(), transcribing ? 2_000 : 15_000);
    return () => window.clearInterval(timer);
  }, [refresh, transcribing]);

  const changeFilter = (next: Filter) => {
    setFilter(next);
    setLimit(PAGE_SIZE);
  };

  const act = async (id: string, action: () => Promise<void>) => {
    setBusy((current) => new Set(current).add(id));
    setError('');
    try { await action(); }
    catch (cause) { setError(errorText(cause)); }
    finally {
      setBusy((current) => { const next = new Set(current); next.delete(id); return next; });
    }
  };

  const retranscribe = (clip: SpeechClip) => act(clip.id, async () => {
    setClips((current) => current?.map((item) => item.id === clip.id ? { ...item, status: 'transcribing', error: null } : item) ?? null);
    try {
      const result = await requestJson<{ clip: SpeechClip }>(`/api/speech-clips/${encodeURIComponent(clip.id)}/retranscribe`, { method: 'POST' });
      setClips((current) => current?.map((item) => item.id === clip.id ? result.clip : item) ?? null);
    } finally { void refresh(); }
  });

  const remove = (clip: SpeechClip) => act(clip.id, async () => {
    if (!await confirmDeleteDialog('Delete this recording?', 'Its audio and transcript will be removed.')) return;
    await requestJson(`/api/speech-clips/${encodeURIComponent(clip.id)}`, { method: 'DELETE' });
    setClips((current) => current?.filter((item) => item.id !== clip.id) ?? null);
    void refresh();
  });

  return (
    <SettingsSection
      title="Speech-to-text recordings"
      description="Every voice recording sent for transcription is kept with its transcript, including ones you discarded and ones dictated from your phone or another desktop. Recordings are stored in this profile's speech-clips folder."
      actions={<UiSegmentedControl label="Show recordings" value={filter} options={FILTERS} onValueChange={changeFilter} />}
    >
      {counts ? (
        <p className="text-sm text-[var(--muted)]" data-speech-clip-storage>
          {counts.total} recording{counts.total === 1 ? '' : 's'} · {formatBytes(counts.bytes)} on disk
        </p>
      ) : null}
      {error ? <p role="alert" className="text-sm text-[var(--red)]">{error}</p> : null}
      {clips === null ? <p role="status" className="text-sm text-[var(--muted)]">Loading recordings…</p>
        : clips.length === 0 ? <p className="text-sm text-[var(--muted)]">{counts?.total ? 'No recordings match this filter.' : 'No recordings yet.'}</p>
        : (
          <ul className="flex flex-col divide-y divide-[var(--border-subtle)]">
            {clips.map((clip) => (
              <RecordingRow
                key={clip.id}
                clip={clip}
                busy={busy.has(clip.id) || clip.status === 'transcribing'}
                onRetranscribe={() => void retranscribe(clip)}
                onDelete={() => void remove(clip)}
              />
            ))}
          </ul>
        )}
      {clips && counts && counts.matching > clips.length ? (
        <div>
          <UiButton size="small" variant="ghost" onClick={() => setLimit((current) => current + PAGE_SIZE)}>
            Show more ({counts.matching - clips.length} older)
          </UiButton>
        </div>
      ) : null}
    </SettingsSection>
  );
}

function RecordingRow({ clip, busy, onRetranscribe, onDelete }: {
  clip: SpeechClip;
  busy: boolean;
  onRetranscribe(): void;
  onDelete(): void;
}) {
  const [copied, setCopied] = React.useState(false);
  const status = STATUS[clip.status];
  const origin = [
    SURFACES[clip.surface] ?? clip.surface,
    clip.sourceDevice ? `from ${clip.sourceDevice}` : null,
    clip.target ? `to ${clip.target}` : null,
  ].filter(Boolean).join(' · ');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(clip.text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch { /* Clipboard permission denied; the text stays selectable. */ }
  };
  return (
    <li className="flex flex-col gap-2 py-3" data-speech-clip={clip.id}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <UiBadge tone={status.tone} dot>{status.label}</UiBadge>
        <time dateTime={clip.createdAt} className="text-[var(--fg)]">{formatTime(clip.createdAt)}</time>
        {clip.durationMs !== null ? <span className="tabular-nums text-[var(--muted)]">{formatDuration(clip.durationMs)}</span> : null}
        <span className="tabular-nums text-[var(--muted)]">{formatBytes(clip.audioBytes)}</span>
        <span className="min-w-0 truncate text-[var(--muted)]">{origin}</span>
      </div>
      {clip.text ? <p className="whitespace-pre-wrap text-sm text-[var(--fg-secondary)] select-text">{clip.text}</p> : null}
      {clip.status === 'failed' && clip.error ? <p className="text-sm text-[var(--red)]">{clip.error}</p> : null}
      {clip.status === 'transcribed' && !clip.text ? <p className="text-sm text-[var(--muted)]">No speech was detected.</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <audio
          controls
          preload="none"
          src={`/api/speech-clips/${encodeURIComponent(clip.id)}/audio`}
          className="h-8 min-w-0 max-w-full flex-1 basis-64"
          aria-label={`Play recording from ${formatTime(clip.createdAt)}`}
        />
        <UiButton size="small" onClick={onRetranscribe} disabled={busy} loading={clip.status === 'transcribing'}>
          {clip.status === 'transcribed' ? 'Transcribe again' : 'Transcribe'}
        </UiButton>
        {clip.text ? <UiButton size="small" variant="ghost" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy text'}</UiButton> : null}
        <UiButton size="small" variant="ghost" onClick={onDelete} disabled={busy}>Delete</UiButton>
      </div>
    </li>
  );
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  const sameDay = date.toDateString() === new Date().toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
