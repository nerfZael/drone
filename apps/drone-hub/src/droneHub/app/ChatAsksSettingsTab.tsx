import React from 'react';

import { UiSegmentedControl, UiSwitch } from '../../ui/components';
import { ChatComposerModelPicker } from '../chat/ChatComposerModelPicker';
import { describeAskCost, formatAskCost, type AskModelSelection, type AskProvider, type ChatAsksSettings, type ChatAsksSettingsResponse } from '../chat/chat-asks';
import type { UseChatAsksSettingsDraftResult } from './use-chat-asks-settings';

const PROVIDER_LABELS: Record<AskProvider, string> = {
  openai: 'OpenAI',
  codex: 'Codex',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
};

const SECTION_CLASS = 'rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4';
const SECONDARY_BUTTON_CLASS = 'rounded border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40';

function selectionValid(models: ChatAsksSettingsResponse['models'], selection: AskModelSelection): boolean {
  return models.some((model) => model.provider === selection.provider && model.id === selection.model && model.thinkingLevel === selection.thinkingLevel);
}

function ModelSelection({ id, label, description, value, onChange, data, disabled }: {
  id: string;
  label: string;
  description: string;
  value: AskModelSelection;
  onChange: (next: AskModelSelection) => void;
  data: ChatAsksSettingsResponse;
  disabled: boolean;
}) {
  const providerModels = data.models.filter((model) => model.provider === value.provider);
  const setProvider = (provider: AskProvider) => {
    const keep = data.models.some((model) => model.provider === provider && model.id === value.model && model.thinkingLevel === value.thinkingLevel);
    onChange({ provider, model: keep ? value.model : '', thinkingLevel: keep ? value.thinkingLevel : '' });
  };
  return (
    <div className="mt-4 first:mt-3">
      <div className="text-xs font-medium text-[var(--fg-secondary)]">{label}</div>
      <p className="mt-0.5 text-xs text-[var(--muted)]">{description}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <UiSegmentedControl
          label={`${label} provider`}
          value={value.provider}
          options={(Object.keys(PROVIDER_LABELS) as AskProvider[]).map((provider) => ({ value: provider, label: PROVIDER_LABELS[provider] }))}
          onValueChange={setProvider}
          disabled={disabled}
        />
        <div className="inline-flex rounded border border-[var(--border-subtle)] bg-[var(--panel)]">
          <ChatComposerModelPicker config={{
            id,
            currentProvider: value.provider,
            currentModel: value.model,
            currentThinkingLevel: value.thinkingLevel,
            options: providerModels,
            disabled,
            showReasoning: true,
            searchable: true,
            requireExplicitModelSelection: true,
            title: `Choose the model and reasoning for ${label.toLowerCase()}`,
            menuPlacement: 'below',
            onSelect: (choice, kind) => onChange({
              ...value,
              model: choice.id,
              thinkingLevel: kind === 'reasoning'
                ? String(choice.thinkingLevel ?? value.thinkingLevel)
                : String(choice.thinkingLevel ?? providerModels.find((model) => model.id === choice.id)?.thinkingLevel ?? ''),
            }),
          }} />
        </div>
      </div>
      {!selectionValid(data.models, value) ? (
        <p className="mt-1.5 text-xs text-[var(--red)]">Choose a model and reasoning level for {PROVIDER_LABELS[value.provider]} before saving.</p>
      ) : !data.credentials[value.provider] ? (
        <p className="mt-1.5 text-xs text-[var(--red)]">{PROVIDER_LABELS[value.provider]} credentials are not configured. Add them in General settings.</p>
      ) : null}
    </div>
  );
}

const PROMPTS: Array<{ key: keyof ChatAsksSettings['prompts']; label: string; description: string }> = [
  { key: 'record', label: 'Recording asks', description: 'Runs on each message you send. Drone Hub adds the asks so far, the agent\'s previous reply, and your new message.' },
  { key: 'check', label: 'Checking asks', description: 'Runs when the agent finishes. Drone Hub adds the open asks, the agent\'s final reply, any error, and the files it changed.' },
  { key: 'backfill', label: 'Reading an existing chat', description: 'Runs once when you start tracking a chat that already has messages. Drone Hub adds the recent conversation.' },
];

export function ChatAsksSettingsTab({ settings }: { settings: UseChatAsksSettingsDraftResult }) {
  const { data, draft, setDraft, loading, loadError, saving, saveError, saved, dirty, save, reset } = settings;
  if (loading && !data) return <div className="py-8 text-sm text-[var(--muted)]">Loading Asks settings…</div>;
  if (!data || !draft) {
    return (
      <div role="alert" className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-sm text-[var(--red)]">
        {loadError || 'Asks settings are unavailable.'}{' '}
        <button type="button" className="underline" onClick={() => void reset()}>Retry</button>
      </div>
    );
  }
  const valid = selectionValid(data.models, draft.record) && selectionValid(data.models, draft.check);
  const total = data.totalCost;

  return (
    <div className="max-w-3xl space-y-5">
      <section className={SECTION_CLASS}>
        <UiSwitch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          disabled={saving}
          label="Keep a list of what you ask in each chat"
          description="Lists your requests, questions and standing rules in your own words, grouped by agent run, with whether each was done or answered. Turn it on per chat with Track asks in the composer's … menu. A small model does the work beside the agent, which never sees the list. Off by default."
        />
        <UiSwitch
          className="mt-4"
          checked={draft.autoTrack}
          onCheckedChange={(autoTrack) => setDraft({ ...draft, autoTrack })}
          disabled={saving || !draft.enabled}
          label="Track chats automatically"
          description="Starts tracking a chat the next time its agent runs, from that message on, unless you stopped tracking it there."
        />
      </section>

      <section className={SECTION_CLASS}>
        <h3 className="text-sm font-semibold text-[var(--fg)]">Cost</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {total.calls === 0
            ? 'Nothing yet. Each chat shows its own cost in its Asks list.'
            : <>All chats so far: <span className="font-mono text-[var(--fg-secondary)]">{formatAskCost(total)}</span>. {describeAskCost(total, 'across all chats')} Each chat shows its own cost in its Asks list, and Usage lists it under the purpose "asks".</>}
        </p>
      </section>

      <section className={SECTION_CLASS}>
        <h3 className="text-sm font-semibold text-[var(--fg)]">Models</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">About two short calls per agent turn: one when you send a message, one when the agent finishes.</p>
        <ModelSelection
          id="chat-asks-record-model"
          label="Recording asks"
          description="Splits each message you send into asks. Low reasoning is enough."
          value={draft.record}
          onChange={(record) => setDraft({ ...draft, record })}
          data={data}
          disabled={saving}
        />
        <ModelSelection
          id="chat-asks-check-model"
          label="Checking asks"
          description="Judges what each finished run did, and reads existing chats when you start tracking them. Medium reasoning judges more carefully."
          value={draft.check}
          onChange={(check) => setDraft({ ...draft, check })}
          data={data}
          disabled={saving}
        />
      </section>

      {PROMPTS.map((prompt) => (
        <section key={prompt.key} className={SECTION_CLASS}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[var(--fg)]">Instructions: {prompt.label.toLowerCase()}</h3>
              <p className="mt-1 text-xs text-[var(--muted)]">{prompt.description}</p>
            </div>
            <button
              type="button"
              disabled={saving || draft.prompts[prompt.key] === data.defaults.prompts[prompt.key]}
              onClick={() => setDraft({ ...draft, prompts: { ...draft.prompts, [prompt.key]: data.defaults.prompts[prompt.key] } })}
              className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
            >
              Restore default
            </button>
          </div>
          <textarea
            aria-label={`Instructions for ${prompt.label.toLowerCase()}`}
            value={draft.prompts[prompt.key]}
            disabled={saving}
            maxLength={data.limits.maxPromptChars}
            onChange={(event) => setDraft({ ...draft, prompts: { ...draft.prompts, [prompt.key]: event.target.value } })}
            className="mt-3 min-h-40 w-full resize-y rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-xs text-[var(--fg-secondary)] outline-none focus:border-[var(--accent-muted)]"
          />
          <div className="mt-1 text-right text-[10px] text-[var(--muted-dim)]">
            {draft.prompts[prompt.key].length} / {data.limits.maxPromptChars}
          </div>
        </section>
      ))}

      {saveError ? (
        <div role="alert" className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-xs text-[var(--red)]">{saveError}</div>
      ) : null}
      <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 shadow-lg">
        <span className="mr-auto text-xs text-[var(--muted)]">
          {saving ? 'Saving…' : saved && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}
        </span>
        <button
          type="button"
          disabled={!dirty || saving || !valid}
          onClick={() => void save()}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
