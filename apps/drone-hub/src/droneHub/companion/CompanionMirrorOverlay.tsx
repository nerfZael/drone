import React from 'react';
import type { CompanionMirrorCommand, CompanionMirrorSession } from '@drone/assistant-chat';
import { ChatMessageBody } from '../chat/ChatMessageBody';
import { CompanionProposalCard } from './CompanionProposalCard';
import { useCompanionMirror } from './CompanionMirrorContext';
import { useCompanionAutoApprove } from './use-companion-auto-approve';

export function CompanionMirrorOverlay() {
  const mirror = useCompanionMirror();
  if (!mirror?.enabled || !mirror.sessions.length) return null;
  return <div className="pointer-events-none fixed left-4 top-16 z-[90] flex max-h-[calc(100vh-5rem)] w-[min(34rem,calc(100vw-2rem))] flex-col gap-3 overflow-y-auto" data-companion-surface="true">
    {mirror.sessions.map((session) => <RemoteSession key={`${session.deviceId}:${session.sessionId}`} session={session} />)}
  </div>;
}

function RemoteSession({ session }: { session: CompanionMirrorSession }) {
  const mirror = useCompanionMirror()!;
  const autoApprove = useCompanionAutoApprove();
  const [hidden, setHidden] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState('');
  const sendingRef = React.useRef(false);
  const connected = mirror.connected && session.connected;
  const disabled = !connected || sending || session.pending;
  const act = async (action: CompanionMirrorCommand['action'], targetId?: string) => {
    if (disabled || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setError('');
    try { await mirror.command(session, action, targetId); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { sendingRef.current = false; setSending(false); }
  };
  const label = `${session.liveStatus === 'listening' ? 'Live' : session.liveStatus === 'paused' ? 'Paused' : 'Companion'} on ${session.deviceName}`;
  if (hidden) return <button type="button" className="pointer-events-auto self-start rounded-lg border border-[var(--border)] bg-[var(--panel)] px-3 py-2 text-xs text-[var(--fg)] shadow-lg"
    onClick={() => setHidden(false)}>Show {label}{!connected ? ' · Disconnected' : session.proposal ? ' · Proposal waiting' : ''}</button>;
  return <aside aria-label={label} className="pointer-events-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] text-[var(--fg)] shadow-[var(--shadow-dialog)]">
    <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3 py-2">
      <div><div className="text-sm font-semibold">{label}</div><div className="text-xs text-[var(--muted)]">Voice stays on your phone</div></div>
      <button type="button" title="Hide mirror; keep phone conversation running" aria-label="Hide Companion mirror" className="rounded px-2 py-1 text-xs hover:bg-[var(--hover)]" onClick={() => setHidden(true)}>Hide</button>
    </div>
    <div className="space-y-3 p-3">
      {!connected ? <p role="status" className="text-xs text-[var(--muted)]">Phone disconnected. Controls will return when it reconnects.</p> : null}
      {session.liveStatus === 'connecting' ? <p role="status" className="text-xs text-[var(--muted)]">Connecting voice…</p> : null}
      {session.voiceControls ? <div className="flex flex-wrap gap-2" aria-label="Phone voice controls">
        <button type="button" disabled={disabled || session.liveStatus !== 'listening'} onClick={() => void act(session.muted ? 'unmute' : 'mute')} className="rounded border px-2 py-1 text-xs disabled:opacity-40">{session.muted ? 'Unmute microphone' : 'Mute microphone'}</button>
        <button type="button" disabled={disabled || !['paused', 'listening', 'connecting'].includes(session.liveStatus)} onClick={() => void act(session.liveStatus === 'paused' ? 'resume' : 'pause')} className="rounded border px-2 py-1 text-xs disabled:opacity-40">{session.liveStatus === 'paused' ? 'Resume voice' : 'Pause voice'}</button>
        <button type="button" disabled={disabled || session.liveStatus === 'idle'} onClick={() => void act('end_voice')} className="rounded border px-2 py-1 text-xs disabled:opacity-40">End voice</button>
        <button type="button" disabled={disabled || session.status !== 'working'} onClick={() => void act('stop_turn')} className="rounded border px-2 py-1 text-xs disabled:opacity-40">Stop Companion turn</button>
        <p className="w-full text-xs text-[var(--muted)]">Pause releases the microphone; resume starts a new voice connection. End voice leaves backend work running. Stop Companion turn ends voice and cancels backend work.</p>
      </div> : null}
      {!session.voiceControls && ['starting', 'recording', 'transcribing'].includes(session.status) ? <p role="status" className="text-xs text-[var(--muted)]">
        {session.status === 'starting' ? 'Starting recording on phone…' : session.status === 'transcribing' ? 'Transcribing recording…' : session.recordingPaused ? 'Recording paused on phone' : 'Recording on phone…'}
      </p> : null}
      {session.status === 'working' ? <p role="status" className="text-xs text-[var(--muted)]">Companion is working…</p> : null}
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={autoApprove.enabled} disabled={!connected || autoApprove.loading || autoApprove.saving}
          onChange={() => void autoApprove.toggle()} /> Auto-approve proposals
      </label>
      <p className="text-xs text-[var(--muted)]">Shared by Companion sessions on this Hub. Applies when Companion requests proposal execution.</p>
      {error || mirror.error || autoApprove.error || session.error ? <p role="alert" className="text-xs text-[var(--red)]">{error || mirror.error || autoApprove.error || session.error}</p> : null}
      {session.reviewNotice ? <p role="status" className="text-xs text-[var(--muted)]">{session.reviewNotice}</p> : null}
      {session.screenMarkdown ? <section aria-label="Companion display" className="max-h-80 overflow-y-auto rounded border border-[var(--border-subtle)] p-2"><ChatMessageBody role="assistant" text={session.screenMarkdown} autoExpand /></section> : null}
      {session.subscriptions ? <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Subscriptions ({session.subscriptions.length})</summary>
        {session.subscriptions.length ? <ul className="space-y-1 text-xs">{session.subscriptions.map(item => <li key={item.id}>{item.label} · {item.status}<p>{item.intent}</p></li>)}</ul> : <p className="text-xs text-[var(--muted)]">No active subscriptions.</p>}
      </details> : null}
      {session.activity?.length ? <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Activity ({session.activity.length})</summary><ul className="space-y-1 text-xs">{session.activity.map(item => <li key={item.callId}>{item.label} · {item.status}{item.error ? ` · ${item.error}` : ''}</li>)}</ul></details> : null}
      {session.captions ? <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Voice transcript</summary><div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap text-xs">{session.captions}</div></details> : null}
      {session.reply ? <div className="max-h-60 overflow-y-auto"><ChatMessageBody role="assistant" text={session.reply} autoExpand /></div> : null}
      {session.proposals?.length ? <nav aria-label="Pending proposals" className="flex flex-col gap-1">{session.proposals.map(item =>
        <button key={item.targetId} type="button" aria-pressed={item.targetId === session.selectedProposalId}
          disabled={disabled || session.proposalExecuting || item.targetId === session.selectedProposalId}
          onClick={() => void act('select_proposal', item.targetId)} className="rounded border border-[var(--border-subtle)] px-2 py-1 text-left text-xs disabled:opacity-60">
          {item.title} · {item.status}{item.targetId === session.selectedProposalId ? ' · Selected' : ''}
        </button>)}</nav> : null}
      {session.proposal ? <CompanionProposalCard proposal={session.proposal} defaultRepoPath={session.proposalDefaultRepoPath}
        execution={session.proposalExecution} executing={session.proposalExecuting} controlsDisabled={disabled}
        companionStatus={session.status} onExecute={() => void act('approve')} onDiscard={() => void act('discard')} />
        : <p className="text-xs text-[var(--muted)]">No proposal waiting for approval.</p>}
      {session.history?.length ? <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Execution history ({session.history.length})</summary>
        <div className="space-y-3">{session.history.map((item, index) => <CompanionProposalCard key={index}
          proposal={item.proposal} execution={item.execution} defaultRepoPath={item.defaultRepoPath}
          executing={false} controlsDisabled companionStatus="completed" />)}</div>
      </details> : session.lastExecution ? <details><summary className="cursor-pointer text-xs text-[var(--muted)]">Latest execution · {session.lastExecution.execution.ok ? 'Applied' : 'Failed'}</summary>
        <CompanionProposalCard proposal={session.lastExecution.proposal} execution={session.lastExecution.execution}
          defaultRepoPath={session.lastExecution.defaultRepoPath} executing={false} controlsDisabled companionStatus="completed" />
      </details> : null}
    </div>
  </aside>;
}
