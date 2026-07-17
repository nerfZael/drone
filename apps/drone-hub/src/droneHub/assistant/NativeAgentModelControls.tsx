import React from 'react';

import { UiMenuSelect, type UiMenuSelectEntry } from '../../ui/menuSelect';
import { CodexConnectControl } from '../app/CodexConnectControl';
import type {
  AssistantModelOption,
  AssistantProviderId,
  AssistantThread,
} from './assistant-types';

const PROVIDERS: Array<{ id: AssistantProviderId; label: string; title: string }> = [
  { id: 'codex', label: 'Codex', title: 'Use Codex models.' },
  { id: 'openai', label: 'OpenAI', title: 'Use OpenAI models.' },
  { id: 'gemini', label: 'Gemini', title: 'Use Gemini models.' },
];

type AgentPatch = Partial<
  Pick<AssistantThread, 'provider' | 'model' | 'thinkingLevel' | 'promptDeliveryMode'>
>;

function reasoningLabel(level: string): string {
  if (level === 'off') return 'None';
  if (level === 'xhigh') return 'X-high';
  return level.charAt(0).toUpperCase() + level.slice(1);
}

function uniqueModels(options: AssistantModelOption[]): AssistantModelOption[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.provider}:${option.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function DefaultModelStar({ selected }: { selected: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="h-3.5 w-3.5"
      fill={selected ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m12 3.2 2.65 5.37 5.93.86-4.29 4.18 1.01 5.91L12 16.73l-5.3 2.79 1.01-5.91-4.29-4.18 5.93-.86L12 3.2Z"
      />
    </svg>
  );
}

export function NativeAgentModelControls({
  thread,
  models,
  defaultModel,
  busy,
  onUpdate,
  onSetDefault,
}: {
  thread: AssistantThread | null;
  models: AssistantModelOption[];
  defaultModel: Pick<AssistantThread, 'provider' | 'model' | 'thinkingLevel'> | undefined;
  busy: boolean;
  onUpdate(patch: AgentPatch): void;
  onSetDefault(): void;
}) {
  const activeProvider = thread?.provider ?? models[0]?.provider ?? 'openai';
  const providerOptions = React.useMemo(
    () =>
      PROVIDERS.map((provider) => ({
        ...provider,
        models: uniqueModels(models.filter((model) => model.provider === provider.id)),
      })),
    [models],
  );
  const activeProviderModels =
    providerOptions.find((provider) => provider.id === activeProvider)?.models ?? [];
  const displayedModels = React.useMemo(() => {
    if (!thread) return activeProviderModels;
    const selected = `${thread.provider}:${thread.model}`;
    if (activeProviderModels.some((model) => `${model.provider}:${model.id}` === selected)) {
      return activeProviderModels;
    }
    return [
      {
        provider: thread.provider,
        id: thread.model,
        name: thread.model,
        reasoning: thread.thinkingLevel !== 'off',
        thinkingLevel: thread.thinkingLevel,
      },
      ...activeProviderModels,
    ];
  }, [activeProviderModels, thread]);
  const modelEntries = React.useMemo<UiMenuSelectEntry[]>(
    () =>
      displayedModels.map((model) => ({
        value: `${model.provider}:${model.id}`,
        label: model.name,
        title: model.id,
        searchText: `${model.name} ${model.id}`,
      })),
    [displayedModels],
  );
  const reasoningEntries = React.useMemo<UiMenuSelectEntry[]>(() => {
    if (!thread) return [];
    const levels = new Set(
      models
        .filter((option) => option.provider === thread.provider && option.id === thread.model)
        .map((option) => option.thinkingLevel),
    );
    if (levels.size === 0) levels.add(thread.thinkingLevel);
    return [...levels].map((level) => ({ value: level, label: reasoningLabel(level) }));
  }, [models, thread]);
  const selectedModelLabel =
    models.find((option) => option.provider === thread?.provider && option.id === thread.model)
      ?.name ?? thread?.model ?? '';
  const providerMeta =
    providerOptions.find((provider) => provider.id === activeProvider) ?? PROVIDERS[0];
  const isDefault = Boolean(
    thread &&
      defaultModel?.provider === thread.provider &&
      defaultModel.model === thread.model &&
      defaultModel.thinkingLevel === thread.thinkingLevel,
  );

  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5">
      <UiMenuSelect
        value={activeProvider}
        disabled={!thread || busy}
        onValueChange={(value) => {
          const provider = providerOptions.find((option) => option.id === value);
          if (!provider) return;
          onUpdate({
            provider: provider.id,
            ...(provider.models[0] ? { model: provider.models[0].id } : {}),
          });
        }}
        entries={providerOptions.map((provider) => ({
          value: provider.id,
          label: provider.label,
          title: provider.title,
          searchText: provider.label,
          disabled: provider.models.length === 0,
        }))}
        variant="toolbar"
        role="listbox"
        itemRole="option"
        title="Built-in agent provider"
        triggerLabel={providerMeta.label}
        triggerClassName="h-7 w-[88px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
        triggerLabelClassName="font-semibold"
        panelClassName="bottom-full mb-1.5 w-[140px]"
        header="Provider"
      />
      {activeProvider === 'codex' ? <CodexConnectControl compact /> : null}
      <UiMenuSelect
        value={thread ? `${thread.provider}:${thread.model}` : ''}
        disabled={!thread || busy}
        onValueChange={(value) => {
          const [provider, model] = value.split(':');
          onUpdate({ provider: provider as AssistantProviderId, model });
        }}
        entries={modelEntries}
        variant="toolbar"
        role="listbox"
        itemRole="option"
        title="Built-in agent model"
        triggerLabel={selectedModelLabel.replace(/^GPT-/, '').replace(/\bMedium\b/, 'Med')}
        triggerClassName="h-7 w-[112px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
        triggerLabelClassName="font-semibold"
        panelClassName="bottom-full mb-1.5 w-[190px]"
        menuClassName="max-h-56 overflow-y-auto"
        header="Model"
        searchable
        searchPlaceholder="Search models"
      />
      <UiMenuSelect
        value={thread?.thinkingLevel ?? ''}
        disabled={!thread || busy || reasoningEntries.length === 0}
        onValueChange={(thinkingLevel) =>
          onUpdate({ thinkingLevel: thinkingLevel as AssistantThread['thinkingLevel'] })
        }
        entries={reasoningEntries}
        variant="toolbar"
        role="listbox"
        itemRole="option"
        title={`Reasoning: ${reasoningLabel(thread?.thinkingLevel ?? 'off')}`}
        triggerLabel={reasoningLabel(thread?.thinkingLevel ?? 'off')}
        triggerClassName="h-7 w-[82px] justify-between border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-2 text-[10px] uppercase tracking-wide text-[var(--muted)] hover:text-[var(--fg-secondary)]"
        triggerLabelClassName="font-semibold"
        panelClassName="bottom-full mb-1.5 w-[140px]"
        menuClassName="max-h-56 overflow-y-auto"
        header="Reasoning"
      />
      <button
        type="button"
        disabled={!thread || busy}
        aria-pressed={isDefault}
        aria-label={isDefault ? 'Current default model and reasoning' : 'Set current model and reasoning as default'}
        title={isDefault ? 'Default model and reasoning for new chats' : 'Make this model and reasoning the default for new chats'}
        onClick={onSetDefault}
        className={`inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
          isDefault
            ? 'bg-[rgba(250,204,21,.10)] text-[var(--yellow)]'
            : 'bg-[rgba(255,255,255,.02)] text-[var(--muted-dim)] hover:text-[var(--yellow)]'
        }`}
      >
        <DefaultModelStar selected={isDefault} />
      </button>
      <div
        className="grid h-7 flex-shrink-0 grid-cols-2 overflow-hidden rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)]"
        role="group"
        aria-label="Built-in agent message delivery"
      >
        {(['queue', 'asap'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            disabled={!thread}
            onClick={() => onUpdate({ promptDeliveryMode: mode })}
            aria-pressed={(thread?.promptDeliveryMode ?? 'queue') === mode}
            title={mode === 'queue' ? 'Queue after the agent finishes' : 'Inject after the current turn before the next agent response'}
            className={`min-w-[42px] px-2 text-[10px] font-semibold uppercase tracking-wide disabled:opacity-40 ${
              (thread?.promptDeliveryMode ?? 'queue') === mode
                ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                : 'text-[var(--muted)] hover:bg-[rgba(255,255,255,.025)] hover:text-[var(--fg-secondary)]'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {mode === 'queue' ? 'Queue' : 'ASAP'}
          </button>
        ))}
      </div>
    </div>
  );
}
