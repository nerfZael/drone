import React from 'react';

import { UiSegmentedControl, UiSwitch } from '../../ui/components';
import { ChatComposerModelPicker } from '../chat/ChatComposerModelPicker';
import { describeNextActionsCost, formatNextActionsCost, type NextAction, type NextActionsProvider } from '../chat/next-actions';
import type { UseNextActionsSettingsDraftResult } from './use-next-actions-settings';

const PROVIDER_LABELS: Record<NextActionsProvider, string> = {
  openai: 'OpenAI',
  codex: 'Codex',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
  cerebras: 'Cerebras',
};

const SECTION_CLASS = 'rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4';
const SECONDARY_BUTTON_CLASS = 'rounded border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40';

export function NextActionsSettingsTab({ settings }: { settings: UseNextActionsSettingsDraftResult }) {
  const { data, draft, setDraft, loading, loadError, saving, saveError, saved, dirty, save, reset } = settings;
  const nameInputs = React.useRef<Array<HTMLInputElement | null>>([]);
  const textInputs = React.useRef<Array<HTMLTextAreaElement | null>>([]);
  const focusActionIndex = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (focusActionIndex.current === null) return;
    nameInputs.current[focusActionIndex.current]?.focus();
    focusActionIndex.current = null;
  });

  if (loading && !data) return <div className="py-8 text-sm text-[var(--muted)]">Loading Next actions settings…</div>;
  if (!data || !draft) {
    return (
      <div role="alert" className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-sm text-[var(--red)]">
        {loadError || 'Next actions settings are unavailable.'}{' '}
        <button type="button" className="underline" onClick={() => void reset()}>Retry</button>
      </div>
    );
  }

  const providerModels = data.models.filter((model) => model.provider === draft.provider);
  const modelSelectionValid = providerModels.some(
    (model) => model.id === draft.model && model.thinkingLevel === draft.thinkingLevel,
  );
  const setProvider = (provider: NextActionsProvider) => {
    const keep = data.models.some(
      (model) => model.provider === provider && model.id === draft.model && model.thinkingLevel === draft.thinkingLevel,
    );
    setDraft({ ...draft, provider, ...(keep ? {} : { model: '', thinkingLevel: '' }) });
  };
  const setAction = (index: number, patch: Partial<NextAction>) =>
    setDraft({ ...draft, actions: draft.actions.map((action, current) => (current === index ? { ...action, ...patch } : action)) });
  const removeAction = (index: number) =>
    setDraft({ ...draft, actions: draft.actions.filter((_, current) => current !== index) });
  const canAddAction = draft.actions.length < data.limits.maxActions;
  const addAction = (index = draft.actions.length) => {
    if (!canAddAction) return;
    focusActionIndex.current = index;
    setDraft({ ...draft, actions: [...draft.actions.slice(0, index), { name: '', text: '' }, ...draft.actions.slice(index)] });
  };
  const filledActions = draft.actions.filter((action) => action.name.trim() || action.text.trim()).length;
  const fieldClass = 'rounded border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-xs text-[var(--fg)] outline-none placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)]';
  const actionsMatchDefaults = JSON.stringify(draft.actions) === JSON.stringify(data.defaults.actions);

  return (
    <div className="max-w-3xl space-y-5">
      <section className={SECTION_CLASS}>
        <UiSwitch
          checked={draft.enabled}
          onCheckedChange={(enabled) => setDraft({ ...draft, enabled })}
          disabled={saving}
          label="Suggest next actions after agent replies"
          description="When an agent finishes a reply, Drone Hub sends the recent conversation to the model below. The model picks which of your actions fit, and they appear as buttons under the reply. Clicking a button sends that action as your next message. Off by default."
        />
      </section>

      <section className={SECTION_CLASS}>
        <h3 className="text-sm font-semibold text-[var(--fg)]">Provider and model</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Runs one short request per finished reply. A small, fast model with low reasoning is usually enough.
        </p>
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-[var(--fg-secondary)]">Provider</div>
          <UiSegmentedControl
            label="Next actions provider"
            value={draft.provider}
            options={(Object.keys(PROVIDER_LABELS) as NextActionsProvider[]).map((value) => ({ value, label: PROVIDER_LABELS[value] }))}
            onValueChange={setProvider}
            disabled={saving}
          />
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-[var(--fg-secondary)]">Model and reasoning</div>
          <div className="inline-flex rounded border border-[var(--border-subtle)] bg-[var(--panel)]">
            <ChatComposerModelPicker config={{
              id: 'next-actions-settings-model',
              currentProvider: draft.provider,
              currentModel: draft.model,
              currentThinkingLevel: draft.thinkingLevel,
              options: providerModels,
              disabled: saving,
              showReasoning: true,
              searchable: true,
              requireExplicitModelSelection: true,
              title: 'Choose the Next actions model and reasoning',
              menuPlacement: 'below',
              onSelect: (choice, selection) => setDraft({
                ...draft,
                model: choice.id,
                thinkingLevel: selection === 'reasoning'
                  ? String(choice.thinkingLevel ?? draft.thinkingLevel)
                  : String(choice.thinkingLevel ?? providerModels.find((model) => model.id === choice.id)?.thinkingLevel ?? ''),
              }),
            }} />
          </div>
        </div>
        {!modelSelectionValid ? (
          <p className="mt-2 text-xs text-[var(--red)]">Choose a model and reasoning level for {PROVIDER_LABELS[draft.provider]} before saving.</p>
        ) : null}
        {!data.credentials[draft.provider] ? (
          <p className="mt-2 text-xs text-[var(--red)]">
            {PROVIDER_LABELS[draft.provider]} credentials are not configured. Suggestions will fail until you add them in General settings.
          </p>
        ) : null}
      </section>

      <section className={SECTION_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg)]">Actions</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              The name is the button's label; the text is the message it sends, exactly as written. The model only picks from this list and may pick none.
            </p>
          </div>
          <button
            type="button"
            disabled={saving || actionsMatchDefaults}
            onClick={() => setDraft({ ...draft, actions: data.defaults.actions.map((action) => ({ ...action })) })}
            className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
          >
            Restore defaults
          </button>
        </div>
        <div className="mt-3 hidden gap-1.5 px-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--muted-dim)] sm:flex">
          <span className="w-40 shrink-0">Button</span>
          <span className="flex-1">Sends</span>
          <span className="w-7 shrink-0" />
        </div>
        <ul className="mt-1.5 space-y-1.5">
          {draft.actions.map((action, index) => (
            <li key={index} className="flex flex-wrap items-start gap-1.5 sm:flex-nowrap">
              <input
                ref={(node) => { nameInputs.current[index] = node; }}
                type="text"
                aria-label={`Action ${index + 1} button name`}
                value={action.name}
                maxLength={data.limits.maxActionNameChars}
                disabled={saving}
                placeholder="Commit"
                onChange={(event) => setAction(index, { name: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    textInputs.current[index]?.focus();
                  } else if (event.key === 'Backspace' && !action.name && !action.text && draft.actions.length > 1) {
                    event.preventDefault();
                    focusActionIndex.current = Math.max(0, index - 1);
                    removeAction(index);
                  }
                }}
                className={`min-w-0 flex-1 sm:w-40 sm:flex-none ${fieldClass}`}
              />
              <textarea
                ref={(node) => { textInputs.current[index] = node; }}
                aria-label={`Action ${index + 1} message`}
                value={action.text}
                maxLength={data.limits.maxActionChars}
                disabled={saving}
                rows={Math.min(4, Math.max(1, action.text.split('\n').length))}
                placeholder="Commit the changes"
                onChange={(event) => setAction(index, { text: event.target.value })}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    addAction(index + 1);
                  }
                }}
                title="Ctrl/Cmd+Enter adds another action"
                className={`order-last min-w-0 basis-full resize-y sm:order-none sm:basis-auto sm:flex-1 ${fieldClass}`}
              />
              <button
                type="button"
                disabled={saving}
                onClick={() => removeAction(index)}
                aria-label={`Remove action ${index + 1}`}
                title="Remove action"
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--red)] disabled:opacity-40"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex items-center justify-between gap-3">
          <button type="button" disabled={saving || !canAddAction} onClick={() => addAction()} className={SECONDARY_BUTTON_CLASS}>
            Add action
          </button>
          <span className="text-[10px] text-[var(--muted-dim)]">{filledActions} / {data.limits.maxActions}</span>
        </div>
        {draft.enabled && filledActions === 0 ? (
          <p className="mt-2 text-xs text-[var(--red)]">Add at least one action; with none, nothing is suggested.</p>
        ) : null}
      </section>

      <section className={SECTION_CLASS}>
        <h3 className="text-sm font-semibold text-[var(--fg)]">Cost</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {data.totalCost.calls === 0
            ? 'Nothing yet.'
            : <>All chats so far: <span className="font-mono text-[var(--fg-secondary)]">{formatNextActionsCost(data.totalCost)}</span>. {describeNextActionsCost(data.totalCost, 'across all chats')}</>}
          {' '}Usage lists it under the purpose "next-actions", and each chat shows its own cost when you hover its suggestions.
        </p>
        {data.costByChat.length ? (
          <table className="mt-3 w-full text-xs">
            <caption className="sr-only">Next actions cost by chat</caption>
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted-dim)]">
                <th className="pb-1 font-medium">Chat</th>
                <th className="pb-1 text-right font-medium">Calls</th>
                <th className="pb-1 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody>
              {data.costByChat.map((row) => (
                <tr key={`${row.droneId}\n${row.chatName}`} className="border-t border-[var(--border-subtle)]">
                  <td className="max-w-0 truncate py-1 pr-3 text-[var(--fg-secondary)]" title={`${row.droneName ?? row.droneId} / ${row.chatName}`}>
                    {row.droneName ?? row.droneId} <span className="text-[var(--muted-dim)]">/</span> {row.chatName}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono text-[var(--muted)]">{row.calls}</td>
                  <td className="py-1 text-right font-mono text-[var(--fg-secondary)]" title={describeNextActionsCost(row, 'in this chat')}>
                    {formatNextActionsCost(row)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      <section className={SECTION_CLASS}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg)]">Instructions</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">
              The model's system prompt. Drone Hub adds the numbered action list and the last {data.limits.maxTurns} exchanges of the chat as the request, so you don't need to include them.
            </p>
          </div>
          <button
            type="button"
            disabled={saving || draft.instructions === data.defaults.instructions}
            onClick={() => setDraft({ ...draft, instructions: data.defaults.instructions })}
            className={`shrink-0 ${SECONDARY_BUTTON_CLASS}`}
          >
            Restore default
          </button>
        </div>
        <textarea
          aria-label="Next actions instructions"
          value={draft.instructions}
          disabled={saving}
          maxLength={data.limits.maxInstructionsChars}
          onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          className="mt-3 min-h-48 w-full resize-y rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-xs text-[var(--fg-secondary)] outline-none focus:border-[var(--accent-muted)]"
        />
        <div className="mt-1 text-right text-[10px] text-[var(--muted-dim)]">
          {draft.instructions.length} / {data.limits.maxInstructionsChars}
        </div>
      </section>

      {saveError ? (
        <div role="alert" className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-xs text-[var(--red)]">{saveError}</div>
      ) : null}
      <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 shadow-lg">
        <span className="mr-auto text-xs text-[var(--muted)]">
          {saving ? 'Saving…' : saved && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}
        </span>
        <button
          type="button"
          disabled={!dirty || saving || !modelSelectionValid}
          onClick={() => void save()}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-40"
        >
          Save
        </button>
      </div>
    </div>
  );
}
