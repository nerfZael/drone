import React from 'react';
import { ChatComposerModelPicker, type ChatComposerModelChoice } from '../chat/ChatComposerModelPicker';
import { requestJson } from '../http';
import { useCompanionSettings, type CompanionProvider, type CompanionSettingsResponse } from './use-companion-settings';

const PROVIDER_LABELS = { openai: 'OpenAI', codex: 'Codex', gemini: 'Gemini', openrouter: 'OpenRouter' } as const;

export function CompanionModelPicker({ embedded = false }: { embedded?: boolean }) {
  const { data: current, loading, error: loadError, load, acceptSaved } = useCompanionSettings(requestJson);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const savingRef = React.useRef(false);
  const [providerDraft, setProviderDraft] = React.useState<CompanionProvider | null>(null);
  const settings = current?.settings;
  const provider = providerDraft ?? settings?.provider ?? 'openai';
  const providerModels = (current?.models ?? []).filter((model) => model.provider === provider);
  const sameProvider = provider === settings?.provider;
  const error = saveError || loadError;

  const select = async (choice: ChatComposerModelChoice) => {
    if (!current || savingRef.current) return;
    const model = current.models.find((option) =>
      option.provider === choice.provider && option.id === choice.id &&
      option.thinkingLevel === choice.thinkingLevel);
    if (!model) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      // Keep prompt and tool changes made elsewhere since this picker loaded.
      const latest = await requestJson<CompanionSettingsResponse>('/api/settings/companion');
      const response = await requestJson<CompanionSettingsResponse>('/api/settings/companion', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...latest.settings,
          provider: model.provider,
          model: model.id,
          thinkingLevel: model.thinkingLevel,
        }),
      });
      acceptSaved(response);
      setProviderDraft(null);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className={embedded ? "px-2 py-1" : "max-w-full self-end rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-2 py-1 shadow-[var(--shadow-dialog)]"}>
      <div className={embedded ? "flex flex-col items-stretch gap-1" : "flex items-center justify-end gap-1"}>
        <span className="text-[10px] text-[var(--muted)]">Provider, model and reasoning</span>
        <label className="flex items-center gap-2 text-xs text-[var(--muted)]">
          Provider
          <select aria-label="Companion provider" value={provider} disabled={loading || saving || !current}
            onChange={(event) => setProviderDraft(event.target.value as CompanionProvider)}
            className="min-w-0 rounded border border-[var(--border)] bg-[var(--panel)] p-1 text-[var(--fg)]">
            {Object.entries(PROVIDER_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        <ChatComposerModelPicker config={{
          id: 'companion-backend-model',
          menuPlacement: embedded ? 'inline' : 'above',
          currentProvider: provider,
          currentModel: sameProvider ? settings?.model ?? '' : '',
          currentThinkingLevel: sameProvider ? settings?.thinkingLevel : undefined,
          options: providerModels,
          disabled: loading || saving || !current || providerModels.length === 0,
          triggerLabel: loading ? 'Loading models…' : saving ? 'Saving…' : !current ? 'Models unavailable' : undefined,
          requireExplicitModelSelection: true,
          title: 'Choose Companion backend model and reasoning',
          statusMessage: 'Saved immediately to Companion settings. Applies to new backend runs; the current run keeps its model.',
          onSelect: (choice) => void select(choice),
        }} />
      </div>
      {!sameProvider ? <p className="text-xs text-[var(--muted)]">Choose a model to save the provider change.</p> : null}
      {current && providerModels.length === 0 ? <p className="text-xs text-[var(--muted)]">No backend models available.</p> : null}
      {current && !current.credentials[provider] ? (
        <p className="max-w-xs text-xs text-[var(--red)]">{PROVIDER_LABELS[provider]} credentials are missing. Add them in General settings before running Companion.</p>
      ) : null}
      {error ? <p role="alert" className="max-w-xs text-xs text-[var(--red)]">
        {error}{' '}
        {loadError ? <button type="button" disabled={loading || saving} className="underline" onClick={() => void load()}>Retry</button>
          : 'Choose the model again to retry.'}
      </p> : null}
    </div>
  );
}
