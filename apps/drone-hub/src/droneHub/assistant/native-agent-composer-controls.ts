import type { ChatComposerControlsConfig } from '../chat';
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

export function buildNativeAgentComposerControls({
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
  onUpdate: (patch: AgentPatch) => void;
  onSetDefault: () => void;
}): ChatComposerControlsConfig {
  const activeProvider = thread?.provider ?? models[0]?.provider ?? 'openai';
  const providerOptions = PROVIDERS.map((provider) => ({
    ...provider,
    models: uniqueModels(models.filter((model) => model.provider === provider.id)),
  }));
  const activeProviderModels =
    providerOptions.find((provider) => provider.id === activeProvider)?.models ?? [];
  const selectedModelKey = thread ? `${thread.provider}:${thread.model}` : '';
  const displayedModels =
    thread && !activeProviderModels.some((model) => `${model.provider}:${model.id}` === selectedModelKey)
      ? [
          {
            provider: thread.provider,
            id: thread.model,
            name: thread.model,
            reasoning: thread.thinkingLevel !== 'off',
            thinkingLevel: thread.thinkingLevel,
          },
          ...activeProviderModels,
        ]
      : activeProviderModels;
  const reasoningLevels = new Set(
    thread
      ? models
          .filter((option) => option.provider === thread.provider && option.id === thread.model)
          .map((option) => option.thinkingLevel)
      : [],
  );
  if (thread && reasoningLevels.size === 0) reasoningLevels.add(thread.thinkingLevel);
  const selectedModelLabel =
    models.find((option) => option.provider === thread?.provider && option.id === thread.model)?.name ??
    thread?.model ??
    'Model';
  const providerLabel =
    providerOptions.find((provider) => provider.id === activeProvider)?.label ?? 'Provider';
  const isDefault = Boolean(
    thread &&
      defaultModel?.provider === thread.provider &&
      defaultModel.model === thread.model &&
      defaultModel.thinkingLevel === thread.thinkingLevel,
  );

  return {
    controls: [
      {
        kind: 'select',
        id: 'native-provider',
        value: activeProvider,
        label: providerLabel,
        title: 'Built-in agent provider',
        disabled: !thread || busy,
        width: 'narrow',
        entries: providerOptions.map((provider) => ({
          value: provider.id,
          label: provider.label,
          title: provider.title,
          searchText: provider.label,
          disabled: provider.models.length === 0,
        })),
        onValueChange: (value) => {
          const provider = providerOptions.find((option) => option.id === value);
          if (!provider) return;
          onUpdate({
            provider: provider.id,
            ...(provider.models[0] ? { model: provider.models[0].id } : {}),
          });
        },
      },
      {
        kind: 'select',
        id: 'native-model',
        value: selectedModelKey,
        label: selectedModelLabel.replace(/^GPT-/, '').replace(/\bMedium\b/, 'Med'),
        title: 'Built-in agent model',
        disabled: !thread || busy,
        searchable: true,
        searchPlaceholder: 'Search models',
        entries: displayedModels.map((model) => ({
          value: `${model.provider}:${model.id}`,
          label: model.name,
          title: model.id,
          searchText: `${model.name} ${model.id}`,
        })),
        onValueChange: (value) => {
          const [provider, model] = value.split(':');
          onUpdate({ provider: provider as AssistantProviderId, model });
        },
      },
      {
        kind: 'select',
        id: 'native-reasoning',
        value: thread?.thinkingLevel ?? '',
        label: reasoningLabel(thread?.thinkingLevel ?? 'off'),
        title: 'Built-in agent reasoning',
        disabled: !thread || busy || reasoningLevels.size === 0,
        width: 'narrow',
        entries: [...reasoningLevels].map((level) => ({
          value: level,
          label: reasoningLabel(level),
        })),
        onValueChange: (thinkingLevel) =>
          onUpdate({ thinkingLevel: thinkingLevel as AssistantThread['thinkingLevel'] }),
      },
      {
        kind: 'button',
        id: 'native-default-model',
        label: 'Default',
        title: isDefault
          ? 'Default model and reasoning for new chats'
          : 'Make this model and reasoning the default for new chats',
        disabled: !thread || busy,
        active: isDefault,
        icon: 'star',
        onSelect: onSetDefault,
      },
      {
        kind: 'segmented',
        id: 'native-delivery',
        label: 'Built-in agent message delivery',
        value: thread?.promptDeliveryMode ?? 'queue',
        disabled: !thread,
        options: [
          { value: 'queue', label: 'Queue', title: 'Queue after the agent finishes' },
          {
            value: 'asap',
            label: 'ASAP',
            title: 'Inject after the current turn before the next agent response',
          },
        ],
        onValueChange: (promptDeliveryMode) =>
          onUpdate({ promptDeliveryMode: promptDeliveryMode as AssistantThread['promptDeliveryMode'] }),
      },
    ],
  };
}
