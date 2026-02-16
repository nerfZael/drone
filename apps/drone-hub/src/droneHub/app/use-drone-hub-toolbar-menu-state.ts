import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import type { ChatModelOption } from './app-types';
import type { CustomAgentProfile } from '../types';
import type { UiMenuSelectEntry } from '../../ui/menuSelect';

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
  builtinAgentOptions: BuiltinAgentOption[];
  currentAgent: ChatAgentConfig;
  currentCustomAgentMissing: boolean;
  currentAgentKey: string;
  modelDisabled: boolean;
  manualChatModelInput: string;
  setChatModel: (model: string | null) => Promise<void>;
  setChatInfoError: React.Dispatch<React.SetStateAction<string | null>>;
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
  builtinAgentOptions,
  currentAgent,
  currentCustomAgentMissing,
  currentAgentKey,
  modelDisabled,
  manualChatModelInput,
  setChatModel,
  setChatInfoError,
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

  const modelMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'Default model' },
      ...availableChatModels.map((m) => ({
        value: m.id,
        label: `${m.label}${m.isDefault ? ' (default)' : ''}${m.isCurrent ? ' (current)' : ''}`,
      })),
    ],
    [availableChatModels],
  );

  const modelLabel = React.useMemo(() => {
    const active = modelMenuEntries.find((entry) => entry.value === (currentModel ?? ''));
    return String(active?.label ?? 'Default model');
  }, [currentModel, modelMenuEntries]);

  const createRepoMenuEntries = React.useMemo(
    () => [
      { value: '', label: 'No repo' },
      ...registeredRepoPaths.map((path) => ({ value: path, label: path, title: path, className: 'font-mono truncate' })),
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
    const entries: Array<
      | { value: string; label: string; title?: string; inactiveClassName?: string }
      | { kind: 'separator' }
    > = [...builtinAgentOptions.map((o) => ({ value: o.key, label: o.label }))];
    entries.push({ kind: 'separator' });
    if (currentCustomAgentMissing && currentAgent.kind === 'custom') {
      entries.push({
        value: `custom:${currentAgent.id}`,
        label: `Custom: ${currentAgent.label}`,
        title: 'This custom agent is configured on the drone but not saved locally.',
      });
    }
    for (const a of customAgents) {
      entries.push({ value: `custom:${a.id}`, label: `Custom: ${a.label}` });
    }
    entries.push({ kind: 'separator' });
    entries.push({
      value: '__add_custom__',
      label: 'Add custom...',
      inactiveClassName: 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]',
    });
    return entries;
  }, [builtinAgentOptions, currentAgent, currentCustomAgentMissing, customAgents]);

  const agentLabel = React.useMemo(() => {
    const builtin = builtinAgentOptions.find((o) => o.key === currentAgentKey);
    if (builtin) return builtin.label;
    if (currentAgent.kind === 'custom') return `Custom: ${currentAgent.label}`;
    return currentAgentKey;
  }, [builtinAgentOptions, currentAgent, currentAgentKey]);

  const pickAgentValue = React.useCallback(
    (v: string) => {
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

  const applyManualChatModel = React.useCallback(() => {
    if (modelDisabled) return;
    const next = String(manualChatModelInput ?? '').trim();
    void setChatModel(next || null).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      setChatInfoError(msg);
    });
  }, [manualChatModelInput, modelDisabled, setChatInfoError, setChatModel]);

  return {
    availableChatModels,
    modelMenuEntries: modelMenuEntries as UiMenuSelectEntry[],
    modelLabel,
    createRepoMenuEntries: createRepoMenuEntries as UiMenuSelectEntry[],
    spawnAgentMenuEntries: spawnAgentMenuEntries as UiMenuSelectEntry[],
    toolbarAgentMenuEntries: toolbarAgentMenuEntries as UiMenuSelectEntry[],
    agentLabel,
    pickAgentValue,
    applyManualChatModel,
  };
}
