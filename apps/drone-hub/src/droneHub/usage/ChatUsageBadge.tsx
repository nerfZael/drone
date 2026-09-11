import React from 'react';
import { useUsageData } from './useUsageData';
import { usageCost, usageNumber, usagePartialReason } from './usage-format';

/**
 * Estimated chat cost in parentheses, for display next to the chat name.
 * Hovering shows the full usage breakdown.
 */
export function ChatUsageBadge({ droneId, chatName, className = '' }: { droneId: string; chatName: string; className?: string }) {
  const { data, error } = useUsageData(`/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/usage`);
  const totals = data?.totals;
  const baseClass = `dh-chat-usage-badge shrink-0 font-normal text-[var(--muted-dim)] ${className}`;
  if (!totals) {
    return error ? <span className={baseClass} title={`Usage unavailable: ${error}`} aria-label="Chat usage unavailable">(usage unavailable)</span> : null;
  }
  const summary = [
    totals.executions === 0 ? 'No usage yet' : `${usageNumber(totals.total)} tokens · ${usageCost(totals.estimatedCost)}`,
    totals.partial > 0 || totals.missing > 0 ? 'Partial' : '',
    totals.unpriced > 0 ? 'Some usage unpriced' : '',
    totals.recovering > 0 ? 'Recovering usage' : '',
    totals.interrupted > 0 ? 'Interrupted' : '',
    totals.running ? 'Updating' : '',
  ].filter(Boolean).join(' · ');
  const details = [
    `Usage · ${summary}`,
    `Uncached input: ${usageNumber(totals.input)} · Output: ${usageNumber(totals.output)}`,
    `Cache read: ${usageNumber(totals.cacheRead)} · Cache write: ${usageNumber(totals.cacheWrite)}`,
    `Of output, reasoning: ${usageNumber(totals.reasoning)}`,
    `Estimated token cost: ${usageCost(totals.estimatedCost)}. This is not a subscription charge.`,
    totals.reportedCost !== null ? `Agent-reported estimate: ${usageCost(totals.reportedCost)}` : '',
    totals.interrupted > 0 ? `${totals.interrupted} executions were interrupted by a Hub restart. Recorded tokens are retained; final usage may be missing.` : '',
    totals.recovering > 0 ? `Reconnecting to the daemon for ${totals.recovering} executions. Their last recorded totals are shown.` : '',
    totals.missing > 0 ? `${totals.missing} executions have no usage report.` : '',
    totals.partial > 0 ? `${totals.partial} executions have incomplete coverage.` : '',
    ...(totals.partialReasons ?? []).map(usagePartialReason),
    totals.unpriced > 0 ? `${totals.unpriced} usage records are not priced.` : '',
    `Recorded since ${new Date(data!.trackingSince).toLocaleString()}. Copied history is excluded. Includes hidden work when the agent reports it.`,
  ].filter(Boolean).join('\n');
  const cost = totals.estimatedCost === null && totals.executions > 0 ? 'unpriced' : usageCost(totals.estimatedCost ?? 0);
  return <span className={baseClass} title={details} aria-label={`Chat usage: ${summary}`}>({cost})</span>;
}
