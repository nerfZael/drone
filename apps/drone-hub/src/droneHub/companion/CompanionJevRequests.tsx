import React from 'react';
import type { JevDebugEntry } from './jev-debug';

const fieldClass = 'mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel)] p-2 text-xs font-mono';

export function CompanionJevRequests({ requests }: { requests: JevDebugEntry[] }) {
  const [filter, setFilter] = React.useState('send');
  const [selected, setSelected] = React.useState<JevDebugEntry | null>(null);
  const rows = requests.filter(entry => filter === 'all' || (filter === 'errors' ? entry.error : entry.decision === 'send'));
  const current = requests.find(entry => entry.id === selected?.id) ?? selected;
  return <div className="space-y-3 px-5 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <label>Show <select aria-label="Filter Jev requests" value={filter} onChange={event => setFilter(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--panel)] p-1">
        <option value="send">Send decisions</option><option value="all">All decisions</option><option value="errors">Errors</option>
      </select></label>
      <span className="text-xs text-[var(--muted)]">{requests.length} retained requests</span>
    </div>
    <p className="text-xs text-[var(--muted)]">Recent requests from this session only (up to 100, bounded by size). Older entries expire. Replays use Gateway credits but never delegate or change saved settings.</p>
    <div className="max-h-44 overflow-y-auto rounded border border-[var(--border)]">
      {rows.length ? rows.map(entry => <button key={entry.id} type="button" onClick={() => setSelected(entry)} aria-pressed={current?.id === entry.id}
        className="block w-full border-b border-[var(--border)] p-2 text-left text-xs hover:bg-[var(--hover)] aria-pressed:bg-[var(--accent-subtle)]">
        {new Date(entry.startedAt).toLocaleTimeString()} · {entry.error ? 'Error' : entry.decision} · Silence {(entry.input.silenceMs / 1000).toFixed(2)} s · {entry.durationMs} ms
        {entry.decision === 'send' ? ` · ${entry.delegated ? 'Delegated' : 'Not delegated'}` : ''}
        <span className="mt-1 block truncate text-[var(--muted)]">{entry.input.transcript}</span>
      </button>) : <p className="p-3 text-xs">No matching requests yet. Requests before this update are unavailable.</p>}
    </div>
    {current ? <JevReplayEditor key={current.id} entry={current} /> : <p className="text-xs">Select a request to inspect or replay it.</p>}
  </div>;
}

function JevReplayEditor({ entry }: { entry: JevDebugEntry }) {
  const [draft, setDraft] = React.useState(entry.request);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState('');
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  const replay = async () => {
    if (!draft || controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setResult('');
    try {
      const response = await fetch('/api/companion/jev/replay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Replay failed.');
      if (!abort.signal.aborted) setResult(`Replay: ${value.decision} · ${value.durationMs} ms\n${value.probabilities ? `Probabilities: ${JSON.stringify(value.probabilities)}\n` : ''}No backend request was sent.`);
    } catch (error) {
      if (!abort.signal.aborted) setResult(error instanceof Error ? error.message : 'Replay failed.');
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setRunning(false);
    }
  };
  return <section className="space-y-3" aria-label="Jev request details">
    <p>Original result: <strong>{entry.error ? 'Error' : entry.decision}</strong>{entry.decision === 'send' ? ` · ${entry.delegated ? 'Delegated to backend' : 'Not delegated (for example, superseded or paused)'}` : ''}</p>
    {entry.probabilities ? <p className="text-xs">Original probabilities: {JSON.stringify(entry.probabilities)}</p> : null}
    {entry.error ? <p role="alert">{entry.error}</p> : null}
    {!draft ? <><p className="text-xs">The server did not return a request snapshot for this failure; its exact prompt cannot be replayed.</p><pre className="whitespace-pre-wrap break-words text-xs">{JSON.stringify(entry.input, null, 2)}</pre></> : <>
      <p className="text-xs">Model: {draft.model}. Fields below start with the exact state, effective instructions, and choice criteria used by the original request. Edits apply only to replay.</p>
      <label className="block text-xs">State (transcript, earlier context, and silenceMs; maximum 300000 characters)
        <textarea aria-label="Jev replay state" rows={8} maxLength={300000} className={fieldClass} value={draft.state} onChange={event => setDraft({ ...draft, state: event.target.value })} /></label>
      <label className="block text-xs">Effective instructions (maximum 16000 characters)
        <textarea aria-label="Jev replay instructions" rows={8} maxLength={16000} className={fieldClass} value={draft.instructions} onChange={event => setDraft({ ...draft, instructions: event.target.value })} /></label>
      {(['send', 'wait'] as const).map(choice => <label key={choice} className="block text-xs">{choice} criterion (maximum 4000 characters)
        <textarea aria-label={`Jev replay ${choice} criterion`} rows={2} maxLength={4000} className={fieldClass} value={draft.criteria[choice]} onChange={event => setDraft({ ...draft, criteria: { ...draft.criteria, [choice]: event.target.value } })} /></label>)}
      <div className="flex gap-3">
        <button type="button" disabled={running} onClick={() => void replay()} className="rounded bg-[var(--accent)] px-3 py-2 text-xs disabled:opacity-50">{running ? 'Testing…' : 'Replay without delegating'}</button>
        <button type="button" disabled={running} onClick={() => { setDraft(entry.request); setResult(''); }} className="text-xs underline">Restore original inputs</button>
      </div>
    </>}
    {result ? <pre role="status" className="whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 text-xs">{result}</pre> : null}
  </section>;
}
