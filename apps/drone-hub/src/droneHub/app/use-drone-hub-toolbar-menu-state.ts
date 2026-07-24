import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { ChatModelOption } from './app-types';
import type { CustomAgentProfile } from '../types';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';
import { repoPathLabel } from './repo-path-label';

type BuiltinAgentOption = {
  key: string;
  label: string;
  agent: ChatAgentConfig;
};

type UseDroneHubToolbarMenuStateArgs = {
  chatModels: ChatModelOption[];
  currentModel: string | null;
  registeredRepoPaths: string[];
  customAgents: CustomAgentProfile[];
  allowCustomAgents?: boolean;
  builtinAgentOptions: BuiltinAgentOption[];
  currentAgent: ChatAgentConfig;
  currentCustomAgentMissing: boolean;
  currentAgentKey: string;
  agentLocked: boolean;
  setChatAgent: (agent: ChatAgentConfig) => Promise<void>;
  handleSetAgentFailure: (label: string, error: unknown) => void;
  setCustomAgentError: (next: string | null) => void;
  setNewCustomAgentLabel: (next: string) => void;
  setNewCustomAgentCommand: (next: string) => void;
  setCustomAgentModalOpen: (next: boolean) => void;
};

export function useDroneHubToolbarMenuState({
  chatModels,
  currentModel,
  registeredRepoPaths,
  customAgents,
  allowCustomAgents = true,
  builtinAgentOptions,
  currentAgent,
  currentCustomAgentMissing,
  currentAgentKey,
  agentLocked,
  setChatAgent,
  handleSetAgentFailure,
  setCustomAgentError,
  setNewCustomAgentLabel,
  setNewCustomAgentCommand,
  setCustomAgentModalOpen,
}: UseDroneHubToolbarMenuStateArgs) {
  const availableChatModels = React.useMemo(() => {
    const map = new Map<string, ChatModelOption>();
    for (const m of chatModels) {
      const id = String(m.id ?? '').trim();
      if (!id) continue;
      map.set(id, m);
    }
    if (currentModel && !map.has(currentModel)) {
      map.set(currentModel, { id: currentModel, label: `${currentModel} (custom)` });
    }
    return Array.from(map.values());
  }, [chatModels, currentModel]);

  const createRepoMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'No repo' },
      ...registeredRepoPaths.map((path) => ({ value: path, label: repoPathLabel(path), title: path, className: 'font-mono truncate' })),
    ],
    [registeredRepoPaths],
  );

  const spawnAgentMenuEntries = React.useMemo(
    () => [
      ...builtinAgentOptions.map((o) => ({ value: o.key, label: o.label })),
      ...(customAgents.length > 0
        ? [
            { kind: 'separator' as const },
            ...customAgents.map((a) => ({ value: `custom:${a.id}`, label: `Custom: ${a.label}` })),
          ]
        : []),
    ],
    [builtinAgentOptions, customAgents],
  );

  const toolbarAgentMenuEntries = React.useMemo(() => {
    const option = (value: string, label: string) => ({
      value,
      label,
      disabled: agentLocked && value !== currentAgentKey,
      ...(agentLocked && value !== currentAgentKey
        ? { title: 'Create a new chat to use a different agent.' }
        : {}),
    });
    if (!allowCustomAgents) {
      return builtinAgentOptions.map((o) => option(o.key, o.label));
    }
    const entries: UiMenuSelectEntry[] = [
      ...builtinAgentOptions.map((o) => option(o.key, o.label)),
    ];
    entries.push({ kind: 'separator' });
    if (currentCustomAgentMissing && currentAgent.kind === 'custom') {
      entries.push({
        value: `custom:${currentAgent.id}`,
        label: `Custom: ${currentAgent.label}`,
        disabled: agentLocked,
        title: agentLocked
          ? 'Create a new chat to use a different agent.'
          : 'This custom agent is configured on the drone but not saved locally.',
      });
    }
    for (const a of customAgents) {
      entries.push(option(`custom:${a.id}`, `Custom: ${a.label}`));
    }
    entries.push({ kind: 'separator' });
    entries.push({
      value: '__add_custom__',
      label: 'Add custom...',
      disabled: agentLocked,
      ...(agentLocked ? { title: 'Create a new chat to use a different agent.' } : {}),
      inactiveClassName: 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
    });
    return entries;
  }, [agentLocked, allowCustomAgents, builtinAgentOptions, currentAgent, currentAgentKey, currentCustomAgentMissing, customAgents]);

  const agentLabel = React.useMemo(() => {
    const builtin = builtinAgentOptions.find((o) => o.key === currentAgentKey);
    if (builtin) return builtin.label;
    if (currentAgent.kind === 'native') return 'Built-in';
    if (currentAgent.kind === 'custom') return `Custom: ${currentAgent.label}`;
    return currentAgentKey;
  }, [builtinAgentOptions, currentAgent, currentAgentKey]);

  const pickAgentValue = React.useCallback(
    (v: string) => {
      if (agentLocked) return;
      if (v === '__add_custom__') {
        setCustomAgentError(null);
        setNewCustomAgentLabel('');
        setNewCustomAgentCommand('');
        setCustomAgentModalOpen(true);
        return;
      }
      const builtin = builtinAgentOptions.find((o) => o.key === v);
      if (builtin) {
        void setChatAgent(builtin.agent).catch((error: unknown) => {
          handleSetAgentFailure('[DroneHub] set agent failed', error);
        });
        return;
      }
      if (!allowCustomAgents) return;
      if (!v.startsWith('custom:')) return;
      const id = v.slice('custom:'.length);
      const local = customAgents.find((a) => a.id === id) ?? null;
      const fallback = currentAgent?.kind === 'custom' && currentAgent.id === id ? currentAgent : null;
      const agent: ChatAgentConfig | null = local
        ? { kind: 'custom', id: local.id, label: local.label, command: local.command }
        : fallback
          ? fallback
          : null;
      if (agent) {
        void setChatAgent(agent).catch((error: unknown) => {
          handleSetAgentFailure('[DroneHub] set custom agent failed', error);
        });
      }
    },
    [
      allowCustomAgents,
      agentLocked,
      builtinAgentOptions,
      currentAgent,
      customAgents,
      handleSetAgentFailure,
      setChatAgent,
      setCustomAgentError,
      setCustomAgentModalOpen,
      setNewCustomAgentCommand,
      setNewCustomAgentLabel,
    ],
  );

  return {
    availableChatModels,
    createRepoMenuEntries: createRepoMenuEntries as UiMenuSelectEntry[],
    spawnAgentMenuEntries: spawnAgentMenuEntries as UiMenuSelectEntry[],
    toolbarAgentMenuEntries: toolbarAgentMenuEntries as UiMenuSelectEntry[],
    agentLabel,
    pickAgentValue,
  };
}
