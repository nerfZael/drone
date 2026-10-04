import React from 'react';
import { Popover } from 'radix-ui';

import type { UiMenuSelectEntry } from '../../ui/components';
import {
  ChatComposerModelMenuSections,
  resolveChatComposerModelSelection,
  type ChatComposerModelPickerConfig,
} from './ChatComposerModelPicker';

export type ChatComposerRuntimeAgentConfig = {
  value: string;
  label: string;
  entries: UiMenuSelectEntry[];
  onChange: (value: string) => void;
  disabled?: boolean;
  /** Entries that run an action, such as opening a dialog, instead of choosing an agent. */
  actionValues?: string[];
};

export type ChatComposerRuntimeChoiceGroup = {
  id: string;
  title: string;
  value: string;
  options: Array<{ value: string; label: string; title?: string; disabled?: boolean }>;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

/** One picker for the chat's agent, model, reasoning, and access settings. */
export type ChatComposerRuntimePickerConfig = {
  agent?: ChatComposerRuntimeAgentConfig;
  model?: Omit<ChatComposerModelPickerConfig, 'id' | 'menuPlacement'>;
  /** Settings such as access and approvals; leave out the ones the agent does not support. */
  choiceGroups?: ChatComposerRuntimeChoiceGroup[];
};

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m5 12 4 4L19 6" />
    </svg>
  );
}

function ChevronIcon({ up }: { up: boolean }) {
  return (
    <svg className="h-[1.0625rem] w-[1.0625rem] flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={up ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} />
    </svg>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-9 flex-shrink-0 items-center px-3">
      <div className="text-[.8125rem] font-semibold text-[var(--fg-strong)]">{children}</div>
    </div>
  );
}

function entrySearchText(entry: UiMenuSelectEntry): string {
  if (entry.kind === 'separator') return '';
  return `${entry.searchText ?? ''} ${typeof entry.label === 'string' ? entry.label : ''} ${entry.value}`.toLowerCase();
}

function AgentSection({
  agent,
  onDone,
}: {
  agent: ChatComposerRuntimeAgentConfig;
  onDone: () => void;
}) {
  const [listOpen, setListOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const entries = normalizedQuery
    ? agent.entries.filter(
        (entry) => entry.kind !== 'separator' && entrySearchText(entry).includes(normalizedQuery),
      )
    : agent.entries;

  return (
    <>
      <SectionTitle>Agent</SectionTitle>
      <button
        type="button"
        disabled={agent.disabled}
        onClick={() => {
          setListOpen((value) => !value);
          setQuery('');
        }}
        aria-expanded={listOpen}
        title={agent.disabled ? 'The agent cannot be changed for this chat.' : undefined}
        className="mx-2 mb-2 flex h-[2.375rem] flex-shrink-0 items-center justify-between gap-3 rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span className="min-w-0 truncate text-[.75rem] font-medium text-[var(--chat-composer-fg)]">
          {agent.label}
        </span>
        {agent.disabled ? null : <span className="text-[var(--accent)]"><ChevronIcon up={listOpen} /></span>}
      </button>
      {listOpen && !agent.disabled ? (
        <>
          <div className="flex-shrink-0 px-2 pb-1.5">
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search agents"
              aria-label="Search agents"
              className="h-8 w-full rounded-[.5rem] border border-[var(--chat-composer-control-border)] bg-[var(--chat-composer-surface)] px-2.5 text-[.75rem] font-normal text-[var(--chat-composer-fg)] placeholder:font-normal placeholder:text-[var(--chat-composer-placeholder)] focus:border-[var(--accent-border)] focus:outline-none"
            />
          </div>
          <div className="max-h-[15rem] min-h-0 flex-shrink-0 overflow-y-auto px-2 pb-2">
            <div className="flex flex-col gap-1">
              {entries.length === 0 ? (
                <div className="flex min-h-12 items-center justify-center px-3 text-center text-[.6875rem] text-[var(--muted)]">
                  No matching agents.
                </div>
              ) : null}
              {entries.map((entry, index) => {
                if (entry.kind === 'separator') {
                  return (
                    <div
                      key={entry.key ?? `separator-${index}`}
                      className="mx-1 my-0.5 h-px flex-shrink-0 bg-[var(--border-subtle)]"
                      aria-hidden="true"
                    />
                  );
                }
                const active = entry.value === agent.value;
                return (
                  <button
                    key={entry.value}
                    type="button"
                    disabled={entry.disabled}
                    title={entry.title}
                    onClick={() => {
                      setListOpen(false);
                      setQuery('');
                      // An action leads elsewhere, so the picker gets out of its way.
                      if (agent.actionValues?.includes(entry.value)) onDone();
                      if (!active) agent.onChange(entry.value);
                    }}
                    className={`flex min-h-9 items-center rounded-[.5rem] border px-2.5 text-left text-[.75rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                      active
                        ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                        : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                    {active ? <span className="ml-2 text-[var(--accent)]"><CheckIcon /></span> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function ChoiceGroupSection({ group }: { group: ChatComposerRuntimeChoiceGroup }) {
  return (
    <>
      <SectionTitle>{group.title}</SectionTitle>
      <div role="group" aria-label={group.title} className="flex flex-wrap items-center gap-1 px-2 pb-2">
        {group.options.map((option) => {
          const active = option.value === group.value;
          return (
            <button
              key={option.value}
              type="button"
              disabled={group.disabled || option.disabled}
              onClick={() => {
                if (!active) group.onValueChange(option.value);
              }}
              aria-pressed={active}
              title={option.title}
              className={`inline-flex h-8 items-center justify-center gap-1 rounded-[.5rem] border px-2.5 text-[.75rem] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active
                  ? 'border-[var(--accent-border)] bg-[var(--accent-subtle)] text-[var(--accent-muted)]'
                  : 'border-transparent text-[var(--muted)] hover:bg-[var(--hover)]'
              }`}
            >
              {option.label}
              {active ? <span className="text-[var(--accent)]"><CheckIcon /></span> : null}
            </button>
          );
        })}
      </div>
    </>
  );
}

export function chatComposerRuntimeTriggerLabel(config: ChatComposerRuntimePickerConfig): string {
  const parts = [
    config.agent?.label,
    config.model ? resolveChatComposerModelSelection(config.model).triggerLabel : undefined,
  ].filter((part): part is string => Boolean(part));
  return parts.join(' · ');
}

export function ChatComposerRuntimePanel({
  config,
  onDone,
}: {
  config: ChatComposerRuntimePickerConfig;
  onDone: () => void;
}) {
  return (
    <>
      {config.agent ? <AgentSection agent={config.agent} onDone={onDone} /> : null}
      {config.model ? (
        <ChatComposerModelMenuSections config={config.model} layout="sections" onDone={onDone} />
      ) : null}
      {(config.choiceGroups ?? []).map((group) => (
        <ChoiceGroupSection key={group.id} group={group} />
      ))}
    </>
  );
}

export function ChatComposerRuntimePicker({ config }: { config: ChatComposerRuntimePickerConfig }) {
  const { agent, model, choiceGroups = [] } = config;
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const triggerLabel = chatComposerRuntimeTriggerLabel(config);
  const modelLabel = model ? resolveChatComposerModelSelection(model).triggerLabel : '';
  if (!agent && !model && choiceGroups.length === 0) return null;

  const groupSummary = choiceGroups
    .map((group) => {
      const option = group.options.find((candidate) => candidate.value === group.value);
      return option ? `${group.title}: ${option.label}` : null;
    })
    .filter(Boolean)
    .join(', ');
  const title = [
    'Choose agent, model, and access',
    triggerLabel,
    groupSummary,
  ].filter(Boolean).join('\n');
  // Nothing here is changeable, so the trigger only shows the current settings.
  const disabled =
    (!agent || agent.disabled) &&
    (!model || model.disabled) &&
    choiceGroups.every((group) => group.disabled);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <div
        ref={rootRef}
        data-chat-composer-runtime-picker="true"
        className="relative min-w-0 flex-shrink"
      >
        <Popover.Trigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Choose agent, model, and access"
            aria-haspopup="dialog"
            aria-expanded={open}
            title={title}
            className="inline-flex h-8 max-w-[min(20rem,100%)] items-center gap-1 px-2 text-[.6875rem] font-medium normal-case tracking-normal text-[var(--chat-composer-model-fg)] transition-opacity hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <span className="min-w-0 truncate">
              {modelLabel ? (
                <>
                  {/* Narrow composers drop the agent name and keep the model. */}
                  {agent ? <span data-chat-composer-runtime-agent-label="true">{agent.label} · </span> : null}
                  {modelLabel}
                </>
              ) : (
                triggerLabel || 'Agent settings'
              )}
            </span>
            <span className="text-[var(--accent)]"><ChevronIcon up={open} /></span>
          </button>
        </Popover.Trigger>
        <Popover.Portal container={rootRef.current?.ownerDocument.body}>
          <Popover.Content
            aria-label="Agent, model, and access"
            side="top"
            align="start"
            sideOffset={6}
            collisionPadding={10}
            className="z-50 flex max-h-[min(72vh,var(--radix-popover-content-available-height))] w-[min(20rem,calc(100vw-1.25rem))] flex-col overflow-y-auto rounded-[.75rem] border border-[var(--border)] bg-[var(--panel)] pt-0.5 shadow-[var(--chat-composer-shadow)]"
          >
            <ChatComposerRuntimePanel config={config} onDone={() => setOpen(false)} />
          </Popover.Content>
        </Popover.Portal>
      </div>
    </Popover.Root>
  );
}
