import React from 'react';
import { useUsageData } from './useUsageData';
import { usageCost, usageNumber, usagePartialReason } from './usage-format';

export function ChatUsageSummary({ droneId, chatName }: { droneId: string; chatName: string }) {
  const { data, error, refresh } = useUsageData(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/usage`);
  const totals = data?.totals;
  return <details className="shrink-0 border-b border-[var(--border-subtle)] px-4 py-1.5 text-xs text-[var(--fg-secondary)]">
    <summary className="cursor-pointer" aria-label="Chat token usage">
      Usage · {!totals ? error ? 'Unavailable' : 'Loading…' : totals.executions === 0 ? 'No usage yet' :
        `${usageNumber(totals.total)} tokens · ${usageCost(totals.estimatedCost)}`}
      {totals && (totals.partial > 0 || totals.missing > 0) ? ' · Partial' : ''}
      {totals && totals.unpriced > 0 ? ' · Some usage unpriced' : ''}
      {totals && totals.recovering > 0 ? ' · Recovering usage' : ''}
      {totals && totals.interrupted > 0 ? ' · Interrupted' : ''}
      {totals?.running ? ' · Updating' : ''}
    </summary>
    {error ? <p role="alert" className="mt-2">{error} <button type="button" className="underline" onClick={refresh}>Retry</button></p> : null}
    {totals ? <div className="space-y-1 py-2">
      <p>Uncached input: {usageNumber(totals.input)} · Output: {usageNumber(totals.output)}</p>
      <p>Cache read: {usageNumber(totals.cacheRead)} · Cache write: {usageNumber(totals.cacheWrite)}</p>
      <p>Of output, reasoning: {usageNumber(totals.reasoning)}</p>
      <p>Estimated token cost: {usageCost(totals.estimatedCost)}. This is not a subscription charge.</p>
      {totals.reportedCost !== null ? <p>Agent-reported estimate: {usageCost(totals.reportedCost)}</p> : null}
      {totals.interrupted > 0 ? <p>{totals.interrupted} executions were interrupted by a Hub restart. Recorded tokens are retained; final usage may be missing.</p> : null}
      {totals.recovering > 0 ? <p>Reconnecting to the daemon for {totals.recovering} executions. Their last recorded totals are shown.</p> : null}
      {totals.missing > 0 ? <p>{totals.missing} executions have no usage report.</p> : null}
      {totals.partial > 0 ? <p>{totals.partial} executions have incomplete coverage.</p> : null}
      {totals.partialReasons?.map((reason) => <p key={reason}>{usagePartialReason(reason)}</p>)}
      {totals.unpriced > 0 ? <p>{totals.unpriced} usage records are not priced.</p> : null}
      <p>Recorded since {new Date(data!.trackingSince).toLocaleString()}. Copied history is excluded. Includes hidden work when the agent reports it.</p>
    </div> : null}
  </details>;
}
