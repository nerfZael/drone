import React from 'react';
import { ChatComposerModelPicker, type ChatComposerModelPickerConfig } from './ChatComposerModelPicker';
import type { ChatModelOverrides } from './selected-chat-model-overrides';
import type { CanvasChatTarget } from '../canvas/canvas-messaging';
import type { DroneSummary } from '../types';
import { fetchDroneChatStateCached } from '../app/chat-api';
import { requestJson } from '../http';
import { normalizeAgentModelCatalog, type AgentModelCatalogOption } from '../app/use-agent-model-catalog';
import { buildExternalAgentComposerControls } from '../app/external-agent-composer-controls';

const KEEP_EACH = '__keep-each-chat__';

type TargetSettings = { agentKey: string; model: string | null; reasoning: string | null };

/** The one value all targets share, or `mixed` when they differ. */
function shared<T>(values: T[]): { mixed: false; value: T | null } | { mixed: true } {
  if (values.length === 0) return { mixed: false, value: null };
  return values.every((value) => value === values[0]) ? { mixed: false, value: values[0] } : { mixed: true };
}

/**
 * One model and reasoning picker for every selected chat, like the agent chat's own. It shows what the
 * next message will use: the chosen override, else the settings the chats already share.
 */
export function SelectedChatsModelOverrides({ targets, droneById, draftAgentKey, value, onChange, disabled }: {
  targets: CanvasChatTarget[];
  droneById: Record<string, DroneSummary>;
  draftAgentKey?: string;
  value: ChatModelOverrides;
  onChange: (value: ChatModelOverrides) => void;
  disabled: boolean;
}) {
  const [models, setModels] = React.useState<AgentModelCatalogOption[]>([]);
  const [settings, setSettings] = React.useState<TargetSettings[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Sending with an override changes the chats' own settings: read them again.
  const [settingsVersion, setSettingsVersion] = React.useState(0);
  React.useEffect(() => {
    const onChanged = () => setSettingsVersion((version) => version + 1);
    window.addEventListener('drone-hub:chat-model-settings-changed', onChanged);
    return () => window.removeEventListener('drone-hub:chat-model-settings-changed', onChanged);
  }, []);
  const targetKey = JSON.stringify(targets.map(target => ({ ...target, runtime: droneById[target.droneId]?.runtime ?? 'container' })));
  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setLoading(true);
    void (async () => {
      const sources = new Map<string, { agent: string; runtime: string }>();
      if (draftAgentKey?.startsWith('builtin:')) sources.set(`${draftAgentKey}:container`, { agent: draftAgentKey.slice(8), runtime: 'container' });
      const selected = JSON.parse(targetKey) as Array<CanvasChatTarget & { runtime: string }>;
      const configs = await Promise.allSettled(selected.map(async target => {
        const data = await fetchDroneChatStateCached({ ...target, includeConfig: true, includeTranscript: false, signal: controller.signal });
        const info = data.notModified ? null : data.chatInfo;
        if (!info) return null;
        const agent = info.agent;
        if (agent.kind === 'builtin') sources.set(`${agent.id}:${target.runtime}`, { agent: agent.id, runtime: target.runtime });
        return { agentKey: agent.kind === 'builtin' ? `builtin:${agent.id}` : agent.kind, model: info.model, reasoning: info.reasoning };
      }));
      const catalogs = await Promise.allSettled([...sources.values()].map(async source => {
        const data = await requestJson(`/api/model-catalog?${new URLSearchParams(source)}`, { signal: controller.signal });
        return normalizeAgentModelCatalog(data);
      }));
      if (controller.signal.aborted) return;
      const byId = new Map<string, AgentModelCatalogOption>();
      for (const result of catalogs) if (result.status === 'fulfilled') for (const model of result.value) byId.set(model.id, model);
      setModels([...byId.values()]);
      setSettings(configs.flatMap(result => result.status === 'fulfilled' && result.value ? [result.value] : []));
      setLoading(false);
      if ([...configs, ...catalogs].some(result => result.status === 'rejected')) {
        setError('Some model settings could not be loaded. Chats keep their own settings unless you pick one.');
      }
    })().catch(error => {
      if (controller.signal.aborted) return;
      setLoading(false);
      setError(error instanceof Error ? error.message : String(error));
    });
    return () => controller.abort();
  }, [targetKey, draftAgentKey, settingsVersion]);

  const sharedAgent = shared(settings.map(item => item.agentKey));
  const sharedModel = value.model !== undefined ? { mixed: false as const, value: value.model } : shared(settings.map(item => item.model));
  const sharedReasoning = value.reasoning !== undefined ? { mixed: false as const, value: value.reasoning } : shared(settings.map(item => item.reasoning));
  const controls = buildExternalAgentComposerControls({
    hasChats: true,
    modelControlEnabled: true,
    currentAgentKey: sharedAgent.mixed ? '' : sharedAgent.value ?? draftAgentKey ?? '',
    models,
    currentModel: sharedModel.mixed ? null : sharedModel.value,
    currentReasoning: sharedReasoning.mixed ? null : sharedReasoning.value,
    modelDisabled: disabled,
    loading,
    error,
    stale: false,
    transcripts: null,
    onUpdate: (next) => {
      // A reasoning level picked here survives a later model pick when the new model has it.
      const levels = models.find(model => model.id === next.model)?.reasoningLevels ?? [];
      const keepReasoning = next.model && value.reasoning && levels.includes(value.reasoning);
      onChange({ ...value, ...next, ...(keepReasoning ? { reasoning: value.reasoning } : {}) });
    },
  })?.controls[0];
  if (controls?.kind !== 'model-picker') return null;
  const { kind: _kind, ...pickerConfig } = controls;
  const differing = targets.length > 1 && (sharedModel.mixed || sharedReasoning.mixed);
  const overridden = value.model !== undefined || value.reasoning !== undefined;
  const triggerLabel = sharedModel.mixed
    ? 'Mixed models'
    : sharedReasoning.mixed
      ? `${pickerConfig.triggerLabel?.replace(/\s*\([^)]*\)$/, '')} (mixed)`
      : pickerConfig.triggerLabel;
  // With several chats, one choice undoes a pick and leaves each chat on its own settings.
  const keepEach = targets.length > 1 && (differing || overridden)
    ? [{ provider: 'external', id: KEEP_EACH, name: 'Each chat’s own settings' }]
    : [];
  const config: ChatComposerModelPickerConfig = {
    ...pickerConfig,
    id: 'selected-chats-model',
    triggerLabel,
    title: differing ? 'The selected chats use different settings; a choice here applies to all of them' : pickerConfig.title,
    options: [...keepEach, ...pickerConfig.options],
    onSelect: (choice, selection) => {
      if (choice.id === KEEP_EACH) {
        onChange({});
        return;
      }
      pickerConfig.onSelect(choice, selection);
    },
  };
  return <div className="flex flex-shrink-0 items-center" data-selected-chats-model-overrides="true">
    <ChatComposerModelPicker config={config} />
  </div>;
}
