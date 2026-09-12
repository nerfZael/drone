import React from 'react';
import { ChatComposerModelPicker, type ChatComposerModelChoice } from '../chat/ChatComposerModelPicker';
import { requestJson } from '../http';
import { useCompanionSettings, type CompanionSettingsResponse } from './use-companion-settings';

const PROVIDER_LABELS = { openai: 'OpenAI', codex: 'Codex', gemini: 'Gemini', openrouter: 'OpenRouter' } as const;

export function CompanionModelPicker() {
  const { data, loading, error: loadError, load } = useCompanionSettings(requestJson);
  const [savedData, setSavedData] = React.useState<CompanionSettingsResponse | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const savingRef = React.useRef(false);
  React.useEffect(() => setSavedData(null), [data]);
  const current = savedData ?? data;
  const settings = current?.settings;
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
      setSavedData(response);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="max-w-full self-end rounded-lg border border-[var(--border)] bg-[var(--panel-raised)] px-2 py-1 shadow-[var(--shadow-dialog)]">
      <div className="flex items-center justify-end gap-1">
        <span className="text-[10px] text-[var(--muted)]">Backend</span>
        <ChatComposerModelPicker config={{
          id: 'companion-backend-model',
          currentProvider: settings?.provider ?? '',
          currentModel: settings?.model ?? '',
          currentThinkingLevel: settings?.thinkingLevel,
          options: (current?.models ?? []).map((model) => ({
            ...model,
            name: `${PROVIDER_LABELS[model.provider]} · ${model.name}`,
          })),
          disabled: loading || saving || !current || current.models.length === 0,
          triggerLabel: loading ? 'Loading models…' : saving ? 'Saving…' : !current ? 'Models unavailable' : undefined,
          requireExplicitModelSelection: true,
          title: 'Choose Companion backend model and reasoning',
          statusMessage: 'Saved immediately to Companion settings. Applies to new backend runs; the current run keeps its model.',
          onSelect: (choice) => void select(choice),
        }} />
      </div>
      {current && current.models.length === 0 ? <p className="text-xs text-[var(--muted)]">No backend models available.</p> : null}
      {settings && !current?.credentials[settings.provider] ? (
        <p className="max-w-xs text-xs text-[var(--red)]">{PROVIDER_LABELS[settings.provider]} credentials are missing. Add them in General settings before running Companion.</p>
      ) : null}
      {error ? <p role="alert" className="max-w-xs text-xs text-[var(--red)]">
        {error}{' '}
        {loadError ? <button type="button" disabled={loading || saving} className="underline" onClick={() => void load()}>Retry</button>
          : 'Choose the model again to retry.'}
      </p> : null}
    </div>
  );
}
