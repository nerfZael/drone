import type { ChatComposerControlsConfig } from '../chat';
import type {
  AssistantModelOption,
  AssistantProviderId,
  AssistantThread,
} from './assistant-types';

type AgentPatch = Partial<
  Pick<AssistantThread, 'provider' | 'model' | 'thinkingLevel'>
>;

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
  const isDefault = Boolean(
    thread &&
      defaultModel &&
      defaultModel.provider === thread.provider &&
      defaultModel.model === thread.model &&
      defaultModel.thinkingLevel === thread.thinkingLevel,
  );

  return {
    controls: [
      {
        kind: 'model-picker',
        id: 'native-model',
        currentProvider: thread?.provider ?? 'codex',
        currentModel: thread?.model ?? '',
        currentThinkingLevel: thread?.thinkingLevel ?? 'off',
        options: models,
        title: 'Choose model and reasoning',
        disabled: !thread || busy,
        searchable: true,
        searchPlaceholder: 'Search models',
        onSelect: (choice, selection) => {
          if (selection === 'reasoning') {
            onUpdate({
              thinkingLevel: (choice.thinkingLevel ?? 'off') as AssistantThread['thinkingLevel'],
            });
            return;
          }
          onUpdate({
            provider: choice.provider as AssistantProviderId,
            model: choice.id,
            ...(choice.thinkingLevel
              ? { thinkingLevel: choice.thinkingLevel as AssistantThread['thinkingLevel'] }
              : {}),
          });
        },
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
    ],
  };
}
