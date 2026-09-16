import React from 'react';
import { formatReasoningLabel } from '@drone/assistant-chat';
import { requestJson } from '../http';
import { useCompanionSettings, type CompanionModelOption, type CompanionProvider, type CompanionSettingsResponse } from './use-companion-settings';

const PROVIDER_LABELS = { openai: 'OpenAI', codex: 'Codex', gemini: 'Gemini', openrouter: 'OpenRouter', cerebras: 'Cerebras' } as const;

const SELECT_CLASS = 'min-w-0 max-w-[11rem] cursor-pointer truncate rounded-[5px] border border-transparent bg-transparent py-0.5 pl-1.5 pr-1 text-right text-xs text-[var(--fg)] hover:border-[var(--border-subtle)] hover:bg-[var(--hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-40';

function MenuSelectRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-h-8 items-center gap-2 px-2.5 py-1 dh-type-menu-item text-[var(--fg-secondary)]">
      <span className="w-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 flex-1">{label}</span>
      {children}
    </label>
  );
}

/** Provider, model and reasoning as three menu rows; every change saves straight to Companion settings. */
export function CompanionModelPicker() {
  const { data: current, loading, error: loadError, load, acceptSaved } = useCompanionSettings(requestJson);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState('');
  const savingRef = React.useRef(false);
  const [providerDraft, setProviderDraft] = React.useState<CompanionProvider | null>(null);
  const settings = current?.settings;
  const provider = providerDraft ?? settings?.provider ?? 'openai';
  const providerModels = (current?.models ?? []).filter((model) => model.provider === provider);
  const sameProvider = provider === settings?.provider;
  const modelId = sameProvider ? settings?.model ?? '' : '';
  const thinkingLevel = sameProvider ? settings?.thinkingLevel ?? '' : '';
  const modelIds = [...new Set(providerModels.map((model) => model.id))];
  const modelLabel = (id: string) => providerModels.find((model) => model.id === id)?.name || id;
  const reasoningLevels = providerModels.filter((model) => model.id === modelId).map((model) => model.thinkingLevel).filter(Boolean);
  const busy = loading || saving || !current;
  const error = saveError || loadError;

  const save = async (model: CompanionModelOption) => {
    if (!current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError('');
    try {
      // Keep prompt and tool changes made elsewhere since this picker loaded.
      const latest = await requestJson<CompanionSettingsResponse>('/api/settings/companion');
      const response = await requestJson<CompanionSettingsResponse>('/api/settings/companion', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...latest.settings, provider: model.provider, model: model.id, thinkingLevel: model.thinkingLevel }),
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
  const selectModel = (id: string) => {
    // Keep the current reasoning level when the new model offers it; otherwise take the model's first level.
    const candidates = providerModels.filter((model) => model.id === id);
    const match = candidates.find((model) => model.thinkingLevel === thinkingLevel) ?? candidates[0];
    if (match) void save(match);
  };
  const selectReasoning = (level: string) => {
    const match = providerModels.find((model) => model.id === modelId && model.thinkingLevel === level);
    if (match) void save(match);
  };

  return (
    <div>
      <MenuSelectRow label="Provider">
        <select aria-label="Companion provider" value={provider} disabled={busy} className={SELECT_CLASS}
          onChange={(event) => setProviderDraft(event.target.value as CompanionProvider)}>
          {Object.entries(PROVIDER_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </MenuSelectRow>
      <MenuSelectRow label="Model">
        <select aria-label="Companion model" value={modelId} disabled={busy || modelIds.length === 0} className={SELECT_CLASS}
          onChange={(event) => selectModel(event.target.value)}>
          {modelId ? null : <option value="">{loading ? 'Loading…' : saving ? 'Saving…' : modelIds.length === 0 ? 'None available' : 'Choose a model'}</option>}
          {modelIds.map((id) => {
            const reason = providerModels.find((model) => model.id === id)?.unavailableReason;
            return <option key={id} value={id} disabled={Boolean(reason)}>{modelLabel(id)}{reason ? ` — ${reason}` : ''}</option>;
          })}
        </select>
      </MenuSelectRow>
      {reasoningLevels.length > 0 ? (
        <MenuSelectRow label="Reasoning">
          <select aria-label="Companion reasoning" value={thinkingLevel} disabled={busy} className={SELECT_CLASS}
            onChange={(event) => selectReasoning(event.target.value)}>
            {reasoningLevels.map((level) => <option key={level} value={level}>{formatReasoningLabel(level)}</option>)}
          </select>
        </MenuSelectRow>
      ) : null}
      {saving ? <p role="status" className="dh-type-menu-meta px-2.5 py-1">Checking conversation fit. Compaction may take a moment.</p> : null}
      {!sameProvider ? <p className="dh-type-menu-meta px-2.5 py-1">Choose a model to save the provider change.</p> : null}
      {current && !current.credentials[provider] ? (
        <p className="px-2.5 py-1 text-xs text-[var(--red)]">{PROVIDER_LABELS[provider]} credentials are missing. Add them in General settings before running Companion.</p>
      ) : null}
      {error ? <p role="alert" className="px-2.5 py-1 text-xs text-[var(--red)]">
        {error}{' '}
        {loadError ? <button type="button" disabled={loading || saving} className="underline" onClick={() => void load()}>Retry</button>
          : 'Choose the model again to retry.'}
      </p> : null}
    </div>
  );
}
