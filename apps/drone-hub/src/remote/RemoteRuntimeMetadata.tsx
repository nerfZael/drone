import React from 'react';
import type { ChatAgentConfig } from '../domain';
import { BUILTIN_AGENT_OPTIONS } from '../droneHub/app/app-config';
import type { ChatModelOption } from '../droneHub/app/app-types';
import { repoPathLabel } from '../droneHub/app/repo-path-label';
import {
  displayedChatModelTitle,
  resolveDisplayedChatModel,
} from '../droneHub/app/selected-drone-workspace-utils';

type RemoteRuntimeMetadataProps = {
  hasDrone: boolean;
  repoPath: string;
  agent: ChatAgentConfig | null;
  configuredModel: string | null;
  models: ChatModelOption[];
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
  models,
  loading,
  error,
  draft,
}: RemoteRuntimeMetadataProps) {
  const normalizedRepoPath = String(repoPath ?? '').trim();
  const runtimeUnavailable = Boolean(error && !agent);
  const agentLabel = remoteAgentLabel(agent);
  const displayedModel = resolveDisplayedChatModel(
    configuredModel,
    models,
    loading,
    agent?.kind === 'builtin',
  );

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
        loading ? (
          <span className="truncate font-mono">Detecting runtime…</span>
        ) : runtimeUnavailable ? (
          <span className="truncate font-mono">Runtime not reported</span>
        ) : (
          <>
            <span className="flex-shrink-0 uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>CLI</span>
            <span className="min-w-0 max-w-[100px] truncate font-mono" title={`Agent CLI: ${agentLabel}`}>{agentLabel}</span>
            <span className="opacity-45" aria-hidden="true">·</span>
            <span className="flex-shrink-0 uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>Model</span>
            <span className="min-w-0 max-w-[140px] truncate font-mono" title={displayedChatModelTitle(displayedModel)}>{displayedModel.label}</span>
          </>
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
