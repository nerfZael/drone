import type React from 'react';
import type {
  AgentApprovalPolicy,
  AgentPermissionMode,
  ChatAgentConfig,
} from '../../domain';
import type { StartupSeedState } from './app-types';
import { makeId } from './helpers';

export type StartupSeedMap = Record<string, StartupSeedState>;

export type OptimisticStartupSeed = {
  id: string;
  name: string;
  at: string;
};

export type StartupSeedMutationOptions = {
  runtime?: 'container' | 'host';
  agent: ChatAgentConfig | null;
  model?: string | null;
  reasoning?: string | null;
  agentPermissionMode?: AgentPermissionMode;
  approvalPolicy?: AgentApprovalPolicy;
  prompt: string;
  chatName?: string;
  group?: string | null;
  repoPath?: string | null;
};

function normalizeStartupSeedOptions(opts: StartupSeedMutationOptions) {
  const agentPermissionMode: AgentPermissionMode =
    opts.agentPermissionMode === 'read' ||
    opts.agentPermissionMode === 'write'
      ? opts.agentPermissionMode
      : 'execute';
  const approvalPolicy: AgentApprovalPolicy =
    opts.approvalPolicy === 'auto' || opts.approvalPolicy === 'none'
      ? opts.approvalPolicy
      : 'ask';
  return {
    runtime: (opts.runtime === 'host' ? 'host' : 'container') as 'container' | 'host',
    chatName: String(opts.chatName ?? 'default').trim() || 'default',
    agent: opts.agent ?? null,
    model: String(opts.model ?? '').trim() || null,
    reasoning: String(opts.reasoning ?? '').trim().toLowerCase() || null,
    agentPermissionMode,
    approvalPolicy,
    prompt: String(opts.prompt ?? '').trim(),
    group: String(opts.group ?? '').trim() || null,
    repoPath: String(opts.repoPath ?? '').trim() || null,
  };
}

export function addOptimisticStartupSeeds(
  setStartupSeedByDrone: React.Dispatch<React.SetStateAction<StartupSeedMap>>,
  namesRaw: string[],
  opts: StartupSeedMutationOptions,
): OptimisticStartupSeed[] {
  const names = namesRaw.map((raw) => String(raw ?? '').trim()).filter(Boolean);
  if (names.length === 0) return [];
  const nowMs = Date.now();
  const optimisticSeeds = names.map((name, index) => ({
    id: `optimistic:${makeId()}`,
    name,
    at: new Date(nowMs - index).toISOString(),
  }));
  const normalized = normalizeStartupSeedOptions(opts);
  setStartupSeedByDrone((prev) => {
    const next = { ...prev };
    for (const seed of optimisticSeeds) {
      next[seed.id] = {
        droneName: seed.name,
        runtime: normalized.runtime,
        chatName: normalized.chatName,
        agent: normalized.agent,
        model: normalized.model,
        reasoning: normalized.reasoning,
        agentPermissionMode: normalized.agentPermissionMode,
        approvalPolicy: normalized.approvalPolicy,
        prompt: normalized.prompt,
        group: normalized.group,
        repoPath: normalized.repoPath,
        at: seed.at,
      };
    }
    return next;
  });
  return optimisticSeeds;
}

export function clearOptimisticStartupSeeds(
  setStartupSeedByDrone: React.Dispatch<React.SetStateAction<StartupSeedMap>>,
  optimisticSeeds: OptimisticStartupSeed[],
) {
  if (optimisticSeeds.length === 0) return;
  const optimisticIds = new Set(optimisticSeeds.map((seed) => seed.id));
  setStartupSeedByDrone((prev) => {
    let changed = false;
    const next = { ...prev };
    for (const id of optimisticIds) {
      if (!next[id]) continue;
      delete next[id];
      changed = true;
    }
    return changed ? next : prev;
  });
}

export function replaceOptimisticStartupSeeds(
  setStartupSeedByDrone: React.Dispatch<React.SetStateAction<StartupSeedMap>>,
  optimisticSeeds: OptimisticStartupSeed[],
  acceptedRaw: Array<{ id: string; name: string }>,
  opts: StartupSeedMutationOptions,
) {
  const accepted = acceptedRaw
    .map((entry) => ({
      id: String(entry?.id ?? '').trim(),
      name: String(entry?.name ?? '').trim(),
    }))
    .filter((entry) => entry.id);
  if (optimisticSeeds.length === 0 && accepted.length === 0) return;
  const normalized = normalizeStartupSeedOptions(opts);
  const optimisticQueue = optimisticSeeds.slice();
  const optimisticByName = new Map(optimisticSeeds.map((seed) => [seed.name, seed] as const));
  setStartupSeedByDrone((prev) => {
    const next = { ...prev };
    for (const seed of optimisticSeeds) {
      delete next[seed.id];
    }
    for (const entry of accepted) {
      const matchedByName = optimisticByName.get(entry.name) ?? null;
      if (matchedByName) {
        const matchedIndex = optimisticQueue.findIndex((seed) => seed.id === matchedByName.id);
        if (matchedIndex >= 0) optimisticQueue.splice(matchedIndex, 1);
      }
      const matched = matchedByName ?? optimisticQueue.shift() ?? null;
      next[entry.id] = {
        droneName: entry.name || matched?.name || entry.id,
        runtime: normalized.runtime,
        chatName: normalized.chatName,
        agent: normalized.agent,
        model: normalized.model,
        reasoning: normalized.reasoning,
        agentPermissionMode: normalized.agentPermissionMode,
        approvalPolicy: normalized.approvalPolicy,
        prompt: normalized.prompt,
        group: normalized.group,
        repoPath: normalized.repoPath,
        at: matched?.at ?? new Date().toISOString(),
      };
    }
    return next;
  });
}
