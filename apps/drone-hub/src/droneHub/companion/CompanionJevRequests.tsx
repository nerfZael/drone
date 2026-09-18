import React from 'react';
import { matchRule, type ReflexAnswer, type ReflexAnswers, type ReflexQuestion, type ReflexTable } from '@drone/reflex';
import { isActingEntry, type JevDebugEntry } from './jev-debug';

const fieldClass = 'mt-1 block w-full rounded border border-[var(--border)] bg-[var(--panel)] p-2 text-xs font-mono';

function summarize(answer: ReflexAnswer | undefined): string {
  if (!answer) return '—';
  if (answer.type === 'boolean') return `P(true) ${answer.probability.toFixed(2)}`;
  if (answer.type === 'choice') return `${answer.choice}${answer.probabilities ? ` (${Object.entries(answer.probabilities).map(([option, p]) => `${option} ${p.toFixed(2)}`).join(', ')})` : ''}`;
  return `score ${answer.score.toFixed(2)}`;
}

function rowLabel(entry: JevDebugEntry): string {
  const time = new Date(entry.startedAt).toLocaleTimeString();
  if (entry.kind === 'wake') return `${time} · Brain wake: ${entry.reason} · ${entry.disabled ? 'brain off' : entry.error ? 'failed' : `table v${entry.table?.version}`} · ${entry.durationMs} ms`;
  const outcome = entry.error ? 'Error' : entry.stale ? `${entry.action ?? 'none'} (stale)` : `${entry.action ?? 'none'}${entry.action && entry.action !== 'wait' && !entry.applied ? ' (not applied)' : ''}`;
  return `${time} · ${outcome}${entry.rule ? ` · rule ${entry.rule}` : ''}${entry.confidence !== undefined ? ` · confidence ${entry.confidence.toFixed(2)}` : ''} · Silence ${(entry.input.silenceMs / 1000).toFixed(2)} s · ${entry.durationMs} ms · table v${entry.tableVersion}`;
}

export function CompanionJevRequests({ requests, table }: { requests: JevDebugEntry[]; table?: ReflexTable | null }) {
  const [filter, setFilter] = React.useState('acting');
  const [selected, setSelected] = React.useState<JevDebugEntry | null>(null);
  const rows = requests.filter(entry => filter === 'all' || (filter === 'errors' ? entry.kind === 'decision' && entry.error : isActingEntry(entry)));
  const current = requests.find(entry => entry.id === selected?.id) ?? selected;
  return <div className="space-y-3 px-5 py-4 text-sm">
    <div className="flex flex-wrap items-center gap-3">
      <label>Show <select aria-label="Filter reflex decisions" value={filter} onChange={event => setFilter(event.target.value)} className="rounded border border-[var(--border)] bg-[var(--panel)] p-1">
        <option value="acting">Actions and brain wakes</option><option value="all">All decisions</option><option value="errors">Errors</option>
      </select></label>
      <span className="text-xs text-[var(--muted)]">{requests.length} retained entries</span>
    </div>
    {table ? <p className="text-xs text-[var(--muted)]">Reflex table v{table.version} ({table.source}){table.notes ? ` · ${table.notes}` : ''} · {Object.keys(table.questions).length} questions · {table.rules.length} rules</p> : null}
    <p className="text-xs text-[var(--muted)]">Recent decisions from this session only (up to 100, bounded by size). Replays use Gateway credits but never act, delegate, or change saved settings.</p>
    <div className="max-h-44 overflow-y-auto rounded border border-[var(--border)]">
      {rows.length ? rows.map(entry => <button key={entry.id} type="button" onClick={() => setSelected(entry)} aria-pressed={current?.id === entry.id}
        className="block w-full border-b border-[var(--border)] p-2 text-left text-xs hover:bg-[var(--hover)] aria-pressed:bg-[var(--accent-subtle)]">
        {rowLabel(entry)}
        {entry.kind === 'decision' ? <span className="mt-1 block truncate text-[var(--muted)]">{entry.input.transcript}</span> : null}
      </button>) : <p className="p-3 text-xs">No matching entries yet.</p>}
    </div>
    {!current ? <p className="text-xs">Select an entry to inspect or replay it.</p>
      : current.kind === 'wake' ? <WakeDetails entry={current} />
        : <JevReplayEditor key={current.id} entry={current} table={table ?? null} />}
  </div>;
}

function WakeDetails({ entry }: { entry: Extract<JevDebugEntry, { kind: 'wake' }> }) {
  return <section className="space-y-2" aria-label="Brain wake details">
    <p>Reason: <strong>{entry.reason}</strong> · {entry.durationMs} ms</p>
    {entry.error ? <p role="alert">{entry.error}</p> : null}
    {entry.table ? <>
      <p className="text-xs">Table v{entry.table.version} from the brain{entry.table.notes ? `: ${entry.table.notes}` : ''}</p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 text-xs">{JSON.stringify({ questions: entry.table.questions, expectations: entry.table.expectations, rules: entry.table.rules }, null, 2)}</pre>
    </> : null}
  </section>;
}

function JevReplayEditor({ entry, table }: { entry: Extract<JevDebugEntry, { kind: 'decision' }>; table: ReflexTable | null }) {
  const [stateDraft, setStateDraft] = React.useState(JSON.stringify(entry.request.state, null, 2));
  const [questionsDraft, setQuestionsDraft] = React.useState(JSON.stringify(entry.request.questions, null, 2));
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState('');
  const controller = React.useRef<AbortController | null>(null);
  React.useEffect(() => () => controller.current?.abort(), []);
  const replay = async () => {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setRunning(true); setResult('');
    try {
      let state: unknown; let questions: Record<string, ReflexQuestion>;
      try { state = JSON.parse(stateDraft); questions = JSON.parse(questionsDraft); }
      catch { throw new Error('State and questions must be valid JSON.'); }
      const response = await fetch('/api/reflex/evaluate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state, questions }),
        signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Replay failed.');
      const answers = value.answers as ReflexAnswers;
      const rule = table ? matchRule(table, answers) : undefined;
      if (!abort.signal.aborted) setResult([`Replay: ${value.durationMs} ms`, ...Object.entries(answers).map(([id, answer]) => `${id}: ${summarize(answer)}`),
        rule ? `Current table would run rule ${rule.id} → ${rule.do}.` : 'No rule of the current table matches.', 'Nothing was acted on.'].join('\n'));
    } catch (error) {
      if (!abort.signal.aborted) setResult(error instanceof Error ? error.message : 'Replay failed.');
    } finally {
      controller.current = null;
      if (!abort.signal.aborted) setRunning(false);
    }
  };
  return <section className="space-y-3" aria-label="Reflex decision details">
    <p>Original result: <strong>{entry.error ? 'Error' : entry.stale ? 'Stale' : entry.action ?? 'none'}</strong>{entry.rule ? ` · rule ${entry.rule}` : ''}{entry.action && entry.action !== 'wait' ? ` · ${entry.applied ? 'applied' : 'not applied (for example, superseded, paused, or not enough silence)'}` : ''}</p>
    {entry.answers ? <ul className="text-xs">{Object.entries(entry.answers).map(([id, answer]) => <li key={id}>{id}: {summarize(answer)}</li>)}</ul> : null}
    {entry.error ? <p role="alert">{entry.error}</p> : null}
    <p className="text-xs">Fields below start with the exact state and questions of the original request. Edits apply only to replay.</p>
    <label className="block text-xs">State (JSON; maximum 300000 characters)
      <textarea aria-label="Reflex replay state" rows={8} maxLength={300000} className={fieldClass} value={stateDraft} onChange={event => setStateDraft(event.target.value)} /></label>
    <label className="block text-xs">Questions (JSON)
      <textarea aria-label="Reflex replay questions" rows={10} className={fieldClass} value={questionsDraft} onChange={event => setQuestionsDraft(event.target.value)} /></label>
    <div className="flex gap-3">
      <button type="button" disabled={running} onClick={() => void replay()} className="rounded bg-[var(--accent)] px-3 py-2 text-xs disabled:opacity-50">{running ? 'Testing…' : 'Replay without acting'}</button>
      <button type="button" disabled={running} onClick={() => { setStateDraft(JSON.stringify(entry.request.state, null, 2)); setQuestionsDraft(JSON.stringify(entry.request.questions, null, 2)); setResult(''); }} className="text-xs underline">Restore original inputs</button>
    </div>
    {result ? <pre role="status" className="whitespace-pre-wrap break-words rounded border border-[var(--border)] p-3 text-xs">{result}</pre> : null}
  </section>;
}
