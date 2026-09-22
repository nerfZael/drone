import React from 'react';
import { ChatComposerModelPicker } from './ChatComposerModelPicker';
import type { ChatModelOverrides } from './selected-chat-model-overrides';
import type { CanvasChatTarget } from '../canvas/canvas-messaging';
import type { DroneSummary } from '../types';
import { fetchDroneChatStateCached } from '../app/chat-api';
import { requestJson } from '../http';
import { normalizeAgentModelCatalog, type AgentModelCatalogOption } from '../app/use-agent-model-catalog';

const UNCHANGED = '__unchanged__';

export function SelectedChatsModelOverrides({ targets, droneById, draftAgentKey, value, onChange, disabled }: {
  targets: CanvasChatTarget[];
  droneById: Record<string, DroneSummary>;
  draftAgentKey?: string;
  value: ChatModelOverrides;
  onChange: (value: ChatModelOverrides) => void;
  disabled: boolean;
}) {
  const [models, setModels] = React.useState<AgentModelCatalogOption[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const targetKey = JSON.stringify(targets.map(target => ({ ...target, runtime: droneById[target.droneId]?.runtime ?? 'container' })));
  React.useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setModels([]);
    void (async () => {
      const sources = new Map<string, { agent: string; runtime: string }>();
      if (draftAgentKey?.startsWith('builtin:')) sources.set(`${draftAgentKey}:container`, { agent: draftAgentKey.slice(8), runtime: 'container' });
      const selected = JSON.parse(targetKey) as Array<CanvasChatTarget & { runtime: string }>;
      const configs = await Promise.allSettled(selected.map(async target => {
        const data = await fetchDroneChatStateCached({ ...target, includeConfig: true, includeTranscript: false, signal: controller.signal });
        if (!data.notModified && data.chatInfo?.agent.kind === 'builtin') {
          const agent = data.chatInfo.agent.id;
          sources.set(`${agent}:${target.runtime}`, { agent, runtime: target.runtime });
        }
      }));
      const catalogs = await Promise.allSettled([...sources.values()].map(async source => {
        const data = await requestJson(`/api/model-catalog?${new URLSearchParams(source)}`, { signal: controller.signal });
        return normalizeAgentModelCatalog(data);
      }));
      if (controller.signal.aborted) return;
      const byId = new Map<string, AgentModelCatalogOption>();
      for (const result of catalogs) if (result.status === 'fulfilled') for (const model of result.value) byId.set(model.id, model);
      setModels([...byId.values()]);
      if ([...configs, ...catalogs].some(result => result.status === 'rejected')) {
        setError('Some model choices could not be loaded. Unchanged still keeps each chat’s settings.');
      }
    })().catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)); });
    return () => controller.abort();
  }, [targetKey, draftAgentKey]);
  const levels = [...new Set(['off', 'low', 'medium', 'high', 'xhigh', ...models.flatMap(model => model.reasoningLevels ?? [])])];
  return <div className="flex flex-shrink-0 items-center gap-1" data-selected-chats-model-overrides="true">
    <ChatComposerModelPicker config={{ id: 'selected-chats-model', currentProvider: 'external',
      currentModel: value.model === undefined ? UNCHANGED : value.model ?? '',
      triggerLabel: `Model: ${value.model === undefined ? 'Unchanged' : value.model ?? 'Agent default'}`,
      title: 'Model override for selected chats', showReasoning: false, allowCustomModel: true, disabled,
      statusMessage: error ?? undefined,
      options: [{ provider: 'external', id: UNCHANGED, name: 'Unchanged' }, { provider: 'external', id: '', name: 'Agent default (Auto)' },
        ...models.map(model => ({ provider: 'external', id: model.id, name: model.label }))],
      onSelect: choice => {
        const { model: _model, ...rest } = value;
        onChange(choice.id === UNCHANGED ? rest : { ...rest, model: choice.id || null });
      },
    }} />
    <label className="flex h-6 items-center gap-1 text-11 font-medium text-[var(--chat-composer-model-fg)]">Reasoning:
      <select aria-label="Reasoning override for selected chats" disabled={disabled}
        className="max-w-28 cursor-pointer bg-transparent text-11 font-medium text-[var(--chat-composer-model-fg)] outline-none hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
        value={value.reasoning === undefined ? UNCHANGED : value.reasoning ?? ''}
        onChange={event => {
          const { reasoning: _reasoning, ...rest } = value;
          onChange(event.target.value === UNCHANGED ? rest : { ...rest, reasoning: event.target.value || null });
        }}>
        <option value={UNCHANGED}>Unchanged</option>
        <option value="">Agent default (Auto)</option>
        {levels.map(level => <option key={level} value={level}>{level.charAt(0).toUpperCase() + level.slice(1)}</option>)}
      </select>
    </label>
  </div>;
}
