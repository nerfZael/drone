import React from 'react';
import type { ChatAgentConfig } from '../domain';
import { BUILTIN_AGENT_OPTIONS } from '../droneHub/app/app-config';
import type { TranscriptItem } from '../droneHub/types';
import { repoPathLabel } from '../droneHub/app/repo-path-label';
import {
  displayedChatModelTitle,
  formatAgentModelMetadata,
  latestTranscriptModel,
  resolveDisplayedChatModel,
} from '../droneHub/app/selected-drone-workspace-utils';

type RemoteRuntimeMetadataProps = {
  hasDrone: boolean;
  repoPath: string;
  agent: ChatAgentConfig | null;
  configuredModel: string | null;
  transcripts: TranscriptItem[];
  loading: boolean;
  error: string | null;
  draft: boolean;
};

function remoteAgentLabel(agent: ChatAgentConfig | null): string {
  if (!agent) return 'Not reported';
  if (agent.kind === 'custom') return `Custom: ${agent.label}`;
  return BUILTIN_AGENT_OPTIONS.find((option) => option.agent.id === agent.id)?.label ?? agent.id;
}

export function RemoteRuntimeMetadata({
  hasDrone,
  repoPath,
  agent,
  configuredModel,
  transcripts,
  loading,
  error,
  draft,
}: RemoteRuntimeMetadataProps) {
  const normalizedRepoPath = String(repoPath ?? '').trim();
  const runtimeUnavailable = Boolean(error && !agent);
  const agentLabel = remoteAgentLabel(agent);
  const displayedModel = resolveDisplayedChatModel(
    configuredModel,
    [],
    false,
    agent?.kind === 'builtin',
    latestTranscriptModel(transcripts),
  );
  const agentModelLabel = formatAgentModelMetadata(agentLabel, displayedModel);

  return (
    <div
      className="flex min-w-0 max-w-[min(62vw,520px)] items-center gap-1.5 overflow-hidden text-[10px] text-[var(--muted)]"
      title={runtimeUnavailable ? error ?? undefined : undefined}
    >
      {normalizedRepoPath ? (
        <span className="min-w-0 max-w-[120px] truncate font-mono" title={normalizedRepoPath}>
          {repoPathLabel(normalizedRepoPath)}
        </span>
      ) : null}
      {normalizedRepoPath && hasDrone ? <span className="opacity-45" aria-hidden="true">·</span> : null}
      {hasDrone ? (
        loading && !agent ? (
          <span className="truncate font-mono">Detecting runtime…</span>
        ) : runtimeUnavailable ? (
          <span className="truncate font-mono">Runtime not reported</span>
        ) : (
          <span
            className="min-w-0 max-w-[240px] truncate font-mono"
            title={`${agentLabel} · ${displayedChatModelTitle(displayedModel)}`}
          >
            {agentModelLabel}
          </span>
        )
      ) : (
        <span>Remote Drone Hub</span>
      )}
      {draft ? (
        <span className="rounded border border-[var(--accent-muted)] px-1 py-0.5 text-[8px] uppercase tracking-wide text-[var(--accent)]">Draft</span>
      ) : null}
    </div>
  );
}
