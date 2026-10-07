import React from 'react';
import { Popover } from 'radix-ui';
import { formatReasoningLabel } from '@drone/assistant-chat';

import { useDropdownDismiss } from '../../ui/dropdown';
import { useDroneHubUiStore } from '../app/use-drone-hub-ui-store';

export type ChatComposerModelChoice = {
  provider: string;
  id: string;
  name?: string;
  thinkingLevel?: string;
};

export type ChatComposerModelPickerConfig = {
  id: string;
  currentProvider: string;
  currentModel: string;
  currentThinkingLevel?: string;
  /** With no level set, the agent uses its own, so no level shows as selected. */
  agentChoosesDefaultReasoning?: boolean;
  options: ChatComposerModelChoice[];
  disabled?: boolean;
  showReasoning?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  triggerLabel?: string;
  /** The agent named before the model on the button, as the agent picker does, unless the setting hides it. */
  agentLabel?: string;
  /** For chats whose agent is fixed: the agent, named but not changeable at the top of the menu. */
  agentName?: string;
  allowCustomModel?: boolean;
  requireExplicitModelSelection?: boolean;
  statusMessage?: string;
  title?: string;
  menuPlacement?: 'above' | 'below' | 'inline';
  onSelect: (choice: ChatComposerModelChoice, selection: 'model' | 'reasoning') => void;
};

const DEFAULT_REASONING_LEVELS = ['off', 'low', 'medium', 'high'];

function uniqueModels(options: ChatComposerModelChoice[]): ChatComposerModelChoice[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    const key = `${option.provider}:${option.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function modelName(value: string): string {
  const name = value.trim();
  if (!/^gpt(?:[-_\s]|$)/i.test(name)) return name.replace(/[-_]+/g, ' ');
  const parts = name
    .replace(/^gpt[-_\s]*/i, '')
    .replace(/[-_]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  return parts
    .map((part, index) =>
      index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1).toLowerCase()}`,
    )
    .join(' ');
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ChevronIcon({ up = false }: { up?: boolean }) {
  return (
    <svg className="h-[1.0625rem] w-[1.0625rem] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

type ModelPickerSettings = Omit<ChatComposerModelPickerConfig, 'id' | 'menuPlacement'>;

export type ChatComposerModelSelection = ReturnType<typeof resolveChatComposerModelSelection>;

/** Derives what the picker shows as selected from the chat's settings and catalog. */
export function resolveChatComposerModelSelection(config: ModelPickerSettings) {
  const {
    currentProvider,
    currentModel,
    currentThinkingLevel,
    agentChoosesDefaultReasoning = false,
    options,
    showReasoning = true,
    triggerLabel: triggerLabelOverride,
    requireExplicitModelSelection = false,
  } = config;
  const availableModels = uniqueModels(options);
  const exactCurrentModel = availableModels.find(
    (option) => option.provider === currentProvider && option.id === currentModel,
  );
  const selectedModel =
    exactCurrentModel ||
    (!requireExplicitModelSelection
      ? availableModels.find((option) => option.id === currentModel) ||
        (!currentModel ? availableModels[0] : undefined)
      : undefined);
  const selectedProvider = selectedModel?.provider || currentProvider;
  const selectedModelId = selectedModel?.id ?? currentModel;
  const selectedReasoning = agentChoosesDefaultReasoning
    ? currentThinkingLevel || ''
    : currentThinkingLevel || selectedModel?.thinkingLevel ||
      (requireExplicitModelSelection ? '' : 'low');
  const currentName =
    selectedModel?.name || selectedModelId ||
    (requireExplicitModelSelection ? 'Choose model' : 'Auto');
  const hasSupportedCurrentSelection = options.some(
    (option) =>
      option.provider === selectedProvider &&
      option.id === selectedModelId &&
      (!option.thinkingLevel ||
        !currentThinkingLevel ||
        option.thinkingLevel === currentThinkingLevel),
  );
  const choices = !selectedModelId || hasSupportedCurrentSelection
    ? options
    : [
        {
          provider: selectedProvider,
          id: selectedModelId,
          name: currentName,
          thinkingLevel: currentThinkingLevel,
        },
        ...options,
      ];
  const reasoningLevels = [
    ...new Set(
      choices
        .filter(
          (option) => option.provider === selectedProvider && option.id === selectedModelId,
        )
        .map((option) => option.thinkingLevel)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const visibleReasoning = reasoningLevels.length > 0
    ? reasoningLevels
    : requireExplicitModelSelection && !selectedModelId
      ? []
      : DEFAULT_REASONING_LEVELS;
  const triggerLabel =
    triggerLabelOverride ??
    `${modelName(currentName)}${showReasoning && selectedReasoning ? ` (${formatReasoningLabel(selectedReasoning)})` : ''}`;
  return {
    choices,
    models: uniqueModels(choices),
    selectedProvider,
    selectedModelId,
    selectedReasoning,
    currentName,
    visibleReasoning,
    triggerLabel,
  };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 flex-shrink-0 items-center px-3">
      <div className="text-[.8125rem] font-semibold text-[var(--fg-strong)]">{children}</div>
    </div>
  );
}

/** Up to this many models show at once; more get a search box and scroll. */
const FEW_MODELS = 8;

/**
 * The models and reasoning levels, all in sight, so each is one click: a model keeps the menu open for its reasoning,
 * and reasoning, chosen last, closes it. `standalone` is the model picker's own menu; `sections` sits among the agent
 * and access settings, which come after the model there, so a model never closes it.
 */
export function ChatComposerModelMenuSections({
  config,
  layout = 'standalone',
  onDone,
}: {
  config: ModelPickerSettings;
  layout?: 'standalone' | 'sections';
  /** Called after a choice that finishes the picker's job. */
  onDone: () => void;
}) {
  const {
    disabled = false,
    showReasoning = true,
    searchable = true,
    searchPlaceholder = 'Search models',
    allowCustomModel = false,
    statusMessage,
    onSelect,
  } = config;
  const {
    choices,
    models,
    selectedProvider,
    selectedModelId,
    selectedReasoning,
    currentName,
    visibleReasoning,
  } = resolveChatComposerModelSelection(config);
  const [searchQuery, setSearchQuery] = React.useState('');
  const manyModels = models.length > FEW_MODELS;
  // A custom model ID is typed into the search box, so it shows for that too.
  const showSearch = searchable && (manyModels || allowCustomModel);

  const normalizedQuery = showSearch ? searchQuery.trim().toLowerCase() : '';
  const visibleModels = normalizedQuery
    ? models.filter((choice) =>
        `${choice.name ?? ''} ${choice.id}`.toLowerCase().includes(normalizedQuery),
      )
    : models;
  const customModelId =
    allowCustomModel &&
    normalizedQuery &&
    normalizedQuery.length <= 160 &&
    !/[\r\n\t]/.test(normalizedQuery) &&
    !models.some((model) => model.id.toLowerCase() === normalizedQuery)
      ? searchQuery.trim()
      : '';

  const selectReasoning = (thinkingLevel: string) => {
    if (!selectedModelId) return;
    const exact = choices.find(
      (choice) =>
        choice.provider === selectedProvider &&
        choice.id === selectedModelId &&
        choice.thinkingLevel === thinkingLevel,
    );
    onSelect(
      exact ?? {
        provider: selectedProvider,
        id: selectedModelId,
        name: currentName,
        thinkingLevel,
      },
      'reasoning',
    );
    // Reasoning is the last thing chosen, after the agent and the model: choosing it closes the picker.
    onDone();
  };

  const selectModel = (model: ChatComposerModelChoice) => {
    const exact = choices.find(
      (choice) =>
        choice.provider === model.provider &&
        choice.id === model.id &&
        choice.thinkingLevel === selectedReasoning,
    );
    onSelect(
      exact ?? model,
      'model',
    );
    setSearchQuery('');
    if (!showReasoning && layout === 'standalone') onDone();
  };

  const chipClass = (active: boolean) =>
    `flex min-h-8 min-w-0 items-center rounded-[.5rem] border px-2.5 text-left text-[.75rem] font-medium transition-colors disabled:opacity-40 ${
      active
        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
        : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
    }`;

  const reasoningChips = showReasoning && selectedModelId ? (
    <div role="group" aria-label="Reasoning" className="flex flex-shrink-0 flex-wrap items-center gap-1 px-2 pb-2">
      {visibleReasoning.map((level) => {
        const active = level === selectedReasoning;
        return (
          <button
            key={level}
            type="button"
            disabled={disabled}
            onClick={() => selectReasoning(level)}
            aria-pressed={active}
            className={`inline-flex h-8 items-center justify-center gap-1 rounded-[.5rem] border px-2.5 text-[.75rem] font-medium transition-colors disabled:opacity-40 ${
              active
                ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
            }`}
          >
            {formatReasoningLabel(level)}
            {active ? <span className="text-[var(--accent)]"><CheckIcon /></span> : null}
          </button>
        );
      })}
    </div>
  ) : null;

  const modelGrid = (
    <>
      {showSearch ? (
        <div className="flex-shrink-0 px-2 pb-1.5">
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-8 w-full rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-[.75rem] font-normal text-[var(--chat-composer-fg)] placeholder:font-normal placeholder:text-[var(--chat-composer-placeholder)] focus:border-[var(--accent-border)] focus:outline-none"
          />
        </div>
      ) : null}
      {/* Many models scroll in a box about four rows tall, so reasoning stays in sight below them. */}
      <div className={`min-h-0 flex-shrink-0 px-2 pb-2 ${manyModels ? 'max-h-[9.5rem] overflow-y-auto' : ''}`}>
        <div role="group" aria-label="Model" className="grid grid-cols-2 gap-1">
          {visibleModels.length > 0 ? (
            visibleModels.map((choice) => {
              const active =
                choice.provider === selectedProvider && choice.id === selectedModelId;
              return (
                <button
                  key={`${choice.provider}:${choice.id}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (!active) selectModel(choice);
                    else if (!showReasoning && layout === 'standalone') onDone();
                  }}
                  aria-pressed={active}
                  title={choice.id || choice.name}
                  className={chipClass(active)}
                >
                  <span className="min-w-0 flex-1 truncate">{choice.name || choice.id || 'Auto'}</span>
                  {active ? <span className="ml-1 flex-shrink-0 text-[var(--accent)]"><CheckIcon /></span> : null}
                </button>
              );
            })
          ) : !customModelId ? (
            <div className="col-span-2 flex min-h-12 items-center justify-center px-3 text-center text-[.6875rem] text-[var(--muted)]">
              No matching models.
            </div>
          ) : null}
          {customModelId ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                selectModel({
                  provider: selectedProvider,
                  id: customModelId,
                  name: customModelId,
                })
              }
              className="col-span-2 flex min-h-8 items-center rounded-[.5rem] border border-dashed border-[var(--border)] px-2.5 text-left text-[.75rem] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40"
            >
              <span className="truncate">Use model ID “{customModelId}”</span>
            </button>
          ) : null}
        </div>
      </div>
    </>
  );

  return (
    <>
      {config.agentName ? (
        <>
          <SectionTitle>Agent</SectionTitle>
          <div
            data-chat-composer-model-picker-agent="true"
            title="A chat keeps its agent once it has started."
            className="flex-shrink-0 truncate px-3 pb-2 text-[.75rem] font-medium text-[var(--chat-composer-fg)]"
          >
            {config.agentName}
          </div>
        </>
      ) : null}
      <SectionTitle>Model</SectionTitle>
      {modelGrid}
      {reasoningChips ? (
        <>
          <SectionTitle>Reasoning</SectionTitle>
          {reasoningChips}
        </>
      ) : null}
      {statusMessage ? (
        <div
          className={layout === 'sections'
            ? 'flex-shrink-0 px-3 pb-2 text-[.625rem] leading-relaxed text-[var(--muted-dim)]'
            : 'flex-shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-[.625rem] leading-relaxed text-[var(--muted-dim)]'}
        >
          {statusMessage}
        </div>
      ) : null}
    </>
  );
}

export function ChatComposerModelPicker({ config }: { config: ChatComposerModelPickerConfig }) {
  const {
    disabled = false,
    showReasoning = true,
    title = showReasoning ? 'Choose model and reasoning' : 'Choose model',
    menuPlacement = 'above',
  } = config;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  useDropdownDismiss(rootRef, open && menuPlacement === 'inline', setOpen);
  const { triggerLabel } = resolveChatComposerModelSelection(config);
  const hideAgentName = useDroneHubUiStore((state) => state.composerHidesAgentName);
  const agentLabel = hideAgentName ? undefined : config.agentLabel;
  const menuContent = (
    <ChatComposerModelMenuSections config={config} onDone={() => setOpen(false)} />
  );

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        ref={rootRef}
        data-chat-composer-model-picker="true"
        className="relative min-w-0 flex-shrink-0"
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={title}
            aria-haspopup="dialog"
            aria-expanded={open}
            className={`inline-flex h-8 ${agentLabel ? 'max-w-[min(20rem,100%)]' : 'max-w-[14rem]'} items-center gap-1 px-2 text-[.6875rem] font-medium normal-case tracking-normal text-[var(--chat-composer-model-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40`}
          >
            <span className="min-w-0 truncate">
              {agentLabel ? <span data-chat-composer-runtime-agent-label="true">{agentLabel} · </span> : null}
              {triggerLabel}
            </span>
            <span className="text-[var(--accent)]"><ChevronIcon up={open} /></span>
          </button>
        </Popover.Trigger>

        {menuPlacement === 'inline' ? (
          open ? (
            <div
              role="dialog"
              aria-label={title}
              className="relative my-1 flex max-h-[40vh] w-full flex-col overflow-hidden rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--chat-composer-shadow)]"
            >
              {menuContent}
            </div>
          ) : null
        ) : (
          <Popover.Portal container={rootRef.current?.ownerDocument.body}>
            <Popover.Content
              aria-label={title}
              side={menuPlacement === 'below' ? 'bottom' : 'top'}
              align="start"
              sideOffset={6}
              collisionPadding={10}
              className="z-50 flex max-h-[min(64vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--chat-composer-shadow)]"
            >
              {menuContent}
            </Popover.Content>
          </Popover.Portal>
        )}
      </div>
    </Popover.Root>
  );
}
