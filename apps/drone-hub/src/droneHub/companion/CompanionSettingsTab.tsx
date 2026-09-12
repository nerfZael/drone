import React from 'react';
import { UiSegmentedControl } from '../../ui/components';
import { AssistantToolsPanel } from '../assistant/AssistantSettingsPanels';
import type { AssistantToolSummary } from '../assistant/assistant-types';
import { ChatComposerModelPicker } from '../chat/ChatComposerModelPicker';
import { useCompanion } from './CompanionContext';
import {
  changeCompanionProvider,
  isCompanionModelSelectionValid,
  useCompanionSettings,
} from './use-companion-settings';

const PROVIDER_LABELS = { openai: 'OpenAI', codex: 'Codex', gemini: 'Gemini', openrouter: 'OpenRouter' } as const;

export function CompanionSettingsTab({ settings }: {
  settings: ReturnType<typeof useCompanionSettings>;
}) {
  const companion = useCompanion();
  const live = companion?.live;
  const [livePromptDraft, setLivePromptDraft] = React.useState('');
  const [livePromptSaved, setLivePromptSaved] = React.useState(false);
  const { data, draft, setDraft, loading, saving, error, saved, dirty, save } = settings;
  React.useEffect(() => {
    if (!live || live.saving) return;
    setLivePromptDraft(live.systemPrompt);
    setLivePromptSaved(false);
  }, [live?.systemPrompt]);
  if (loading && !data) return <div className="py-8 text-sm text-[var(--muted)]">Loading Companion settings…</div>;
  if (!data || !draft) return <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-sm text-[var(--red)]">{error || 'Companion settings are unavailable.'}</div>;

  const tools = data.tools.map((tool): AssistantToolSummary => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    category: tool.category === 'chats' ? 'chats' : tool.category === 'actions' ? 'actions' : 'context',
  }));
  const providerModels = data.models.filter((model) => model.provider === draft.provider);
  const modelSelectionValid = isCompanionModelSelectionValid(data.models, draft);
  const setProvider = (provider: typeof draft.provider) =>
    setDraft(changeCompanionProvider(data.models, draft, provider));
  const setEnabledTools = (enabledTools: string[]) => setDraft({ ...draft, enabledTools });
  const toggleTools = (names: string[], enabled: boolean) => {
    const next = new Set(draft.enabledTools);
    for (const name of names) {
      if (enabled) {
        next.add(name);
        const dependency = data.tools.find((tool) => tool.name === name)?.requires;
        if (dependency) next.add(dependency);
      } else {
        next.delete(name);
        for (const tool of data.tools) {
          if (tool.requires === name) next.delete(tool.name);
        }
      }
    }
    setEnabledTools(data.tools.map((tool) => tool.name).filter((name) => next.has(name)));
  };
  const toggleTool = (name: string, enabled: boolean) => toggleTools([name], enabled);
  const providerHasCredentials = data.credentials[draft.provider];

  return (
    <div className="max-w-3xl space-y-5">
      {live ? <section className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
        <label className="flex items-center gap-2 text-sm font-semibold text-[var(--fg)]">
          <input type="checkbox" checked={live.enabled}
            disabled={live.loading || live.saving || (!live.enabled && ['starting', 'recording', 'transcribing'].includes(companion.status))}
            onChange={() => void live.toggleEnabled()} />
          Live voice
        </label>
        <p className="mt-1 text-xs text-[var(--muted)]">
          {live.loading ? 'Loading voice preference…' : live.saving ? 'Saving voice preference…'
            : 'Saved immediately for this Hub. Uses GPT-Live 1 for conversation and the Companion backend selected below for tasks. Start the microphone to begin.'}
          {' '}Requires an OpenAI API key; voice usage is billed separately. Finish or discard a recording before changing modes.
        </p>
        {live.settingsError ? <p role="alert" className="mt-2 text-xs text-[var(--red)]">
          {live.settingsError} <button type="button" className="underline" onClick={() => void live.load()}>Retry</button>
        </p> : null}
        <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-semibold text-[var(--fg)]">GPT-Live system prompt</h4>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Edit the complete GPT-Live system prompt, including personality, speaking style, and delegation behavior. Drone Hub sends this text as saved without appending instructions. It is separate from the delegated Companion backend system prompt below. Tool permissions remain enforced by Drone Hub.
              </p>
            </div>
            <button type="button" disabled={live.saving || livePromptDraft === live.defaultSystemPrompt}
              onClick={() => { setLivePromptDraft(live.defaultSystemPrompt); setLivePromptSaved(false); }}
              className="shrink-0 rounded border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40">
              Restore default
            </button>
          </div>
          <textarea aria-label="GPT-Live Companion system prompt" value={livePromptDraft}
            disabled={live.saving} maxLength={live.maxSystemPromptChars}
            onChange={(event) => { setLivePromptDraft(event.target.value); setLivePromptSaved(false); }}
            className="mt-3 min-h-36 w-full resize-y rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-xs text-[var(--fg-secondary)] outline-none focus:border-[var(--accent-muted)]" />
          <div className="mt-1 flex items-center justify-between gap-3">
            <span className="text-[10px] text-[var(--muted-dim)]">
              {livePromptSaved && livePromptDraft === live.systemPrompt ? 'Saved. Applies when the next Live session starts.'
                : livePromptDraft !== live.systemPrompt ? 'Unsaved changes · active sessions are unchanged.' : 'Applies to new Live sessions.'}
            </span>
            <span className="text-[10px] text-[var(--muted-dim)]">{livePromptDraft.length} / {live.maxSystemPromptChars}</span>
          </div>
          <div className="mt-2 flex justify-end">
            <button type="button" disabled={live.saving || livePromptDraft === live.systemPrompt}
              onClick={() => void live.saveSystemPrompt(livePromptDraft).then(setLivePromptSaved)}
              className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-40">
              {live.saving ? 'Saving…' : 'Save Live prompt'}
            </button>
          </div>
        </div>
      </section> : null}
      <section className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
        <h3 className="text-sm font-semibold text-[var(--fg)]">Provider and model</h3>
        <p className="mt-1 text-xs text-[var(--muted)]">
          Companion always uses the provider selected here. It does not fall back to another provider or model.
        </p>
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-[var(--fg-secondary)]">Provider</div>
          <UiSegmentedControl
            label="Companion provider"
            value={draft.provider}
            options={[
              { value: 'openai', label: 'OpenAI' },
              { value: 'codex', label: 'Codex' },
              { value: 'gemini', label: 'Gemini' },
              { value: 'openrouter', label: 'OpenRouter' },
            ]}
            onValueChange={setProvider}
            disabled={saving}
          />
        </div>
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-medium text-[var(--fg-secondary)]">Model and reasoning</div>
          <div className="inline-flex rounded border border-[var(--border-subtle)] bg-[var(--panel)]">
            <ChatComposerModelPicker config={{
              id: 'companion-settings-model',
              currentProvider: draft.provider,
              currentModel: draft.model,
              currentThinkingLevel: draft.thinkingLevel,
              options: providerModels,
              disabled: saving,
              showReasoning: true,
              searchable: true,
              requireExplicitModelSelection: true,
              title: 'Choose Companion model and reasoning',
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
          <div className="mt-2 text-xs text-[var(--red)]">
            Choose a model and reasoning level for {PROVIDER_LABELS[draft.provider]} before saving.
          </div>
        ) : null}
        {!providerHasCredentials ? <div className="mt-2 text-xs text-[var(--red)]">{PROVIDER_LABELS[draft.provider]} credentials are not configured. Runs will fail until they are added in General settings.</div> : null}
      </section>

      <section className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
        <h3 className="text-sm font-semibold text-[var(--fg)]">Follow-up delivery</h3>
        <div className="mt-3">
          <UiSegmentedControl
            label="Companion follow-up delivery"
            value={draft.promptDeliveryMode}
            options={[{ value: 'asap', label: 'ASAP (default)' }, { value: 'queue', label: 'Queue' }]}
            onValueChange={(promptDeliveryMode) => setDraft({ ...draft, promptDeliveryMode })}
            disabled={saving}
          />
        </div>
        <p className="mt-2 text-xs text-[var(--muted)]">
          ASAP steers the running backend at its next processing point. Queue waits for the current request to finish.
          {' '}Applies to both Live and record-and-transcribe mode, including the mobile backend. Save to apply to new backend runs; the current run keeps its setting.
        </p>
      </section>

      <section>
        <AssistantToolsPanel
          tools={tools}
          enabledTools={draft.enabledTools}
          disabled={saving}
          variant="settings"
          onToggleTool={toggleTool}
          onToggleTools={toggleTools}
          onEnableAll={() => setEnabledTools(data.tools.map((tool) => tool.name))}
          onDisableAll={() => setEnabledTools([])}
        />
      </section>

      <section className="rounded border border-[var(--border)] bg-[var(--surface-inset-faint)] p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[var(--fg)]">Delegated backend system prompt</h3>
            <p className="mt-1 text-xs text-[var(--muted)]">Customizes the task agent used by both text and voice requests. It is not sent to GPT-Live. Tool access and safety checks remain enforced by Drone Hub.</p>
          </div>
          <button type="button" disabled={saving || draft.systemPrompt === data.defaultSystemPrompt} onClick={() => setDraft({ ...draft, systemPrompt: data.defaultSystemPrompt })} className="rounded border border-[var(--border-subtle)] px-2.5 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-40">Restore default</button>
        </div>
        <textarea value={draft.systemPrompt} disabled={saving} maxLength={data.maxSystemPromptChars} onChange={(event) => setDraft({ ...draft, systemPrompt: event.target.value })} className="mt-3 min-h-48 w-full resize-y rounded border border-[var(--border)] bg-[var(--panel)] p-3 font-mono text-xs text-[var(--fg-secondary)] outline-none focus:border-[var(--accent-muted)]" />
        <div className="mt-1 text-right text-[10px] text-[var(--muted-dim)]">{draft.systemPrompt.length} / {data.maxSystemPromptChars}</div>
      </section>

      {error ? <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] p-3 text-xs text-[var(--red)]">{error}</div> : null}
      <div className="sticky bottom-3 flex items-center justify-end gap-3 rounded border border-[var(--border)] bg-[var(--panel)] px-3 py-2 shadow-lg">
        <span className="mr-auto text-xs text-[var(--muted)]">{saving ? 'Saving…' : saved && !dirty ? 'Saved' : dirty ? 'Unsaved changes' : 'Up to date'}</span>
        <button type="button" disabled={!dirty || saving || !modelSelectionValid} onClick={() => void save()} className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-contrast)] disabled:opacity-40">Save</button>
      </div>
    </div>
  );
}
