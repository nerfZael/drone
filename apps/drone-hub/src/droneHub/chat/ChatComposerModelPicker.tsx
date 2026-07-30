import React from 'react';
import { formatReasoningLabel } from '@drone/assistant-chat';

import { useDropdownDismiss } from '../../ui/dropdown';

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
  options: ChatComposerModelChoice[];
  disabled?: boolean;
  showReasoning?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  triggerLabel?: string;
  allowCustomModel?: boolean;
  statusMessage?: string;
  title?: string;
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

export function ChatComposerModelPicker({ config }: { config: ChatComposerModelPickerConfig }) {
  const {
    currentProvider,
    currentModel,
    currentThinkingLevel,
    options,
    disabled = false,
    showReasoning = true,
    searchable = true,
    searchPlaceholder = 'Search models',
    triggerLabel: triggerLabelOverride,
    allowCustomModel = false,
    statusMessage,
    title = showReasoning ? 'Choose model and reasoning' : 'Choose model',
    onSelect,
  } = config;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const [modelsOpen, setModelsOpen] = React.useState(!showReasoning);
  const [searchQuery, setSearchQuery] = React.useState('');
  useDropdownDismiss(rootRef, open, setOpen);

  React.useEffect(() => {
    if (!open) return;
    setModelsOpen(!showReasoning);
    setSearchQuery('');
  }, [currentModel, open, showReasoning]);

  const availableModels = uniqueModels(options);
  const exactCurrentModel = availableModels.find(
    (option) => option.provider === currentProvider && option.id === currentModel,
  );
  const selectedModel =
    exactCurrentModel ||
    availableModels.find((option) => option.id === currentModel) ||
    (!currentModel ? availableModels[0] : undefined);
  const selectedProvider = selectedModel?.provider || currentProvider;
  const selectedModelId = selectedModel?.id ?? currentModel;
  const selectedReasoning = currentThinkingLevel || selectedModel?.thinkingLevel || 'low';
  const currentName = selectedModel?.name || selectedModelId || 'Auto';
  const choices = options.some(
    (option) =>
      option.provider === selectedProvider &&
      option.id === selectedModelId &&
      (!option.thinkingLevel ||
        !currentThinkingLevel ||
        option.thinkingLevel === currentThinkingLevel),
  )
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
  const visibleReasoning = reasoningLevels.length > 0 ? reasoningLevels : DEFAULT_REASONING_LEVELS;
  const models = uniqueModels(choices);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleModels = normalizedQuery
    ? models.filter((choice) =>
        `${choice.name ?? ''} ${choice.id}`.toLowerCase().includes(normalizedQuery),
      )
    : models;
  const triggerLabel =
    triggerLabelOverride ??
    `${modelName(currentName)}${showReasoning ? ` (${formatReasoningLabel(selectedReasoning)})` : ''}`;
  const customModelId =
    allowCustomModel &&
    normalizedQuery &&
    normalizedQuery.length <= 160 &&
    !/[\r\n\t]/.test(normalizedQuery) &&
    !models.some((model) => model.id.toLowerCase() === normalizedQuery)
      ? searchQuery.trim()
      : '';

  const selectReasoning = (thinkingLevel: string) => {
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
    setOpen(false);
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
    if (showReasoning) setModelsOpen(false);
    else setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-shrink-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={title}
        className="inline-flex h-8 max-w-[14rem] items-center gap-1 px-2 text-[.6875rem] font-medium normal-case tracking-normal text-[var(--chat-composer-model-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="min-w-0 truncate">{triggerLabel}</span>
        <span className="text-[var(--accent)]"><ChevronIcon up={open} /></span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label={title}
          className="absolute bottom-full right-0 z-50 mb-[.375rem] flex max-h-[64vh] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-hidden rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] shadow-[var(--chat-composer-shadow)]"
        >
          <div className="flex min-h-9 flex-shrink-0 items-center px-3">
            <div className="text-[.8125rem] font-semibold text-[var(--fg-strong)]">
              {showReasoning && !modelsOpen ? 'Reasoning' : 'Model'}
            </div>
          </div>

          {showReasoning && !modelsOpen ? (
            <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
              {visibleReasoning.map((level) => {
                const active = level === selectedReasoning;
                return (
                  <button
                    key={level}
                    type="button"
                    disabled={disabled}
                    onClick={() => selectReasoning(level)}
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
          ) : null}

          <button
            type="button"
            onClick={() => setModelsOpen((value) => !value)}
            className="mx-2 mb-2 flex h-[2.375rem] flex-shrink-0 items-center justify-between gap-3 rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-left"
          >
            <span className="min-w-0 truncate text-[.75rem] font-medium text-[var(--chat-composer-fg)]">
              {currentName}
            </span>
            <span className="text-[var(--accent)]"><ChevronIcon up={modelsOpen} /></span>
          </button>

          {modelsOpen ? (
            <>
              {searchable ? (
                <div className="flex-shrink-0 px-2 pb-1.5">
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder={searchPlaceholder}
                    aria-label={searchPlaceholder}
                    className="h-8 w-full rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-[.75rem] font-normal text-[var(--chat-composer-fg)] placeholder:font-normal placeholder:text-[var(--chat-composer-placeholder)] focus:border-[var(--accent-border)] focus:outline-none"
                  />
                </div>
              ) : null}
              <div className="min-h-0 overflow-y-auto px-2 pb-2">
                <div className="flex flex-col gap-1">
                  {visibleModels.length > 0 ? (
                    visibleModels.map((choice) => {
                      const active =
                        choice.provider === selectedProvider && choice.id === selectedModelId;
                      return (
                        <button
                          key={`${choice.provider}:${choice.id}`}
                          type="button"
                          disabled={disabled}
                          onClick={() => selectModel(choice)}
                          title={choice.id || choice.name}
                          className={`flex min-h-9 items-center rounded-[.5rem] border px-2.5 text-left text-[.75rem] font-medium transition-colors disabled:opacity-40 ${
                            active
                              ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                              : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
                          }`}
                        >
                          <span className="min-w-0 flex-1 truncate">{choice.name || choice.id || 'Auto'}</span>
                          {active ? <span className="ml-2 text-[var(--accent)]"><CheckIcon /></span> : null}
                        </button>
                      );
                    })
                  ) : !customModelId ? (
                    <div className="flex min-h-12 items-center justify-center px-3 text-center text-[.6875rem] text-[var(--muted)]">
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
                      className="flex min-h-9 items-center rounded-[.5rem] border border-dashed border-[var(--border)] px-2.5 text-left text-[.75rem] font-medium text-[var(--muted)] transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--hover)] hover:text-[var(--fg)] disabled:opacity-40"
                    >
                      <span className="truncate">Use model ID “{customModelId}”</span>
                    </button>
                  ) : null}
                </div>
              </div>
            </>
          ) : null}
          {statusMessage ? (
            <div className="flex-shrink-0 border-t border-[var(--border-subtle)] px-3 py-2 text-[.625rem] leading-relaxed text-[var(--muted-dim)]">
              {statusMessage}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
