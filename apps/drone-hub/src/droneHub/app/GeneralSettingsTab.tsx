import React from 'react';
import { UiButton, UiMenuSelect, UiSegmentedControl, UiSlider, UiSwitch } from '../../ui/components';
import { bytesToMaxMiB, bytesToMinMiB, bytesToNearestMiB, miBToBytes } from './filesystem-size-utils';
import type { UseFilesystemSettingsResult } from './use-filesystem-settings';
import type { UseGithubSettingsResult } from './use-github-settings';
import type { UseLlmSettingsResult } from './use-llm-settings';
import type { UseSpeechSettingsResult } from './use-speech-settings';
import type { UseVoiceInputSettingsResult } from './use-voice-input-settings';
import type { UseResourceSubscriptionSettingsResult } from './use-resource-subscription-settings';
import type { LlmProviderId } from './settings-types';
import { CodexConnectControl } from './CodexConnectControl';
import { DESKTOP_THEMES } from '../../theme';
import { useDroneHubUiStore } from './use-drone-hub-ui-store';
import { ResourceSubscriptionSettingsSection } from './ResourceSubscriptionSettingsSection';

function llmProviderLabel(provider: LlmProviderId | null | undefined): string {
  if (provider === 'codex') return 'Codex';
  if (provider === 'gemini') return 'Gemini';
  return 'OpenAI';
}

function llmReasoningLabel(level: string): string {
  if (level === 'off') return 'None';
  if (level === 'xhigh') return 'X-high';
  return level ? level.charAt(0).toUpperCase() + level.slice(1) : 'Default';
}

type GeneralSettingsTabProps = {
  github: UseGithubSettingsResult;
  llm: UseLlmSettingsResult;
  filesystem: UseFilesystemSettingsResult;
  speech: UseSpeechSettingsResult;
  voiceInput: UseVoiceInputSettingsResult;
  subscriptions: UseResourceSubscriptionSettingsResult;
  onReplayOnboarding: () => void;
  onResetOnboarding: () => void;
};

type ApiKeySettingsCardProps = {
  title: string;
  hasKey: boolean;
  keyHint?: string | null;
  updatedAt?: string | null;
  emptyLabel: string;
  description?: string;
  draft: string;
  name: string;
  placeholder: string;
  showKey: boolean;
  revealing: boolean;
  saving: boolean;
  clearing: boolean;
  onDraftChange: (value: string) => void;
  onToggleVisibility: () => void;
  onSave: () => void;
  onClear: () => void;
};

function ApiKeySettingsCard({
  title,
  hasKey,
  keyHint,
  updatedAt,
  emptyLabel,
  description,
  draft,
  name,
  placeholder,
  showKey,
  revealing,
  saving,
  clearing,
  onDraftChange,
  onToggleVisibility,
  onSave,
  onClear,
}: ApiKeySettingsCardProps) {
  const busy = saving || clearing || revealing;
  return (
    <section className="dh-settings-section">
      <div className="dh-type-heading">{title}</div>
      <div className="dh-type-supporting">
        {hasKey
          ? `${keyHint ?? 'Hidden'}${updatedAt ? ` • Updated ${new Date(updatedAt).toLocaleString()}` : ''}`
          : emptyLabel}
      </div>
      {description ? <div className="dh-type-supporting !text-[var(--muted)]">{description}</div> : null}
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          type="text"
          autoComplete="off"
          name={name}
          spellCheck={false}
          style={({ WebkitTextSecurity: showKey ? 'none' : 'disc' } as React.CSSProperties)}
          className="h-9 min-w-0 flex-1 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 font-mono text-[var(--type-ui)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] transition-colors focus:border-[var(--accent-muted)] focus:outline-none"
          placeholder={placeholder}
          disabled={busy}
        />
        <UiButton onClick={onToggleVisibility} disabled={busy}>
          {revealing ? 'Loading…' : showKey ? 'Hide' : 'Show'}
        </UiButton>
      </div>
      <div className="flex items-center gap-2">
        <UiButton variant="primary" onClick={onSave} disabled={!draft.trim() || busy} loading={saving}>
          Save
        </UiButton>
        <UiButton variant="danger" onClick={onClear} disabled={!hasKey || busy} loading={clearing}>
          Clear
        </UiButton>
      </div>
    </section>
  );
}

export function GeneralSettingsTab({
  github,
  llm,
  filesystem,
  speech,
  voiceInput,
  subscriptions,
  onReplayOnboarding,
  onResetOnboarding,
}: GeneralSettingsTabProps) {
  const themeId = useDroneHubUiStore((state) => state.themeId);
  const setThemeId = useDroneHubUiStore((state) => state.setThemeId);
  const {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
    llmDefaultModelSettings,
    llmDefaultModelDraft,
    llmDefaultModelChoices,
    savingLlmProvider,
    showGeminiKey,
    revealingGeminiKey,
    geminiSettingsDraft,
    savingGeminiSettings,
    clearingGeminiSettings,
    openAiSettingsDraft,
    savingOpenAiSettings,
    clearingOpenAiSettings,
    showOpenAiKey,
    revealingOpenAiKey,
    groqSettingsDraft,
    savingGroqSettings,
    clearingGroqSettings,
    showGroqKey,
    revealingGroqKey,
    llmSettingsNotice,
    setLlmProviderDraft,
    setLlmDefaultModelDraft,
    setLlmDefaultReasoningDraft,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    updateGroqSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    toggleApiKeyVisibility,
    mutateApiKeySettings,
  } = llm;
  const {
    filesystemSettings,
    filesystemSettingsLoading,
    filesystemSettingsError,
    filesystemSettingsNotice,
    uploadMaxMiBDraft,
    savingFilesystemSettings,
    setUploadMaxMiBDraft,
    saveFilesystemSettings,
  } = filesystem;
  const currentUploadMaxBytes = filesystemSettings?.filesystem.uploadMaxBytes ?? null;
  const voiceInputDirty = Boolean(
    voiceInput.settings &&
      JSON.stringify(voiceInput.draft) !==
        JSON.stringify({
          endThoughtPreset: voiceInput.settings.voiceInput.endThoughtPreset,
          customSilenceMillis: voiceInput.settings.voiceInput.customSilenceMillis,
          noiseHandling: voiceInput.settings.voiceInput.noiseHandling,
          language: voiceInput.settings.voiceInput.language,
          quality: voiceInput.settings.voiceInput.quality,
          confirmationFeedback: voiceInput.settings.voiceInput.confirmationFeedback,
        }),
  );
  const {
    speechSettings,
    speechSettingsLoading,
    speechSettingsSaving,
    speechSettingsError,
    speechSettingsNotice,
    enabledDraft: speechEnabledDraft,
    mutedDraft: speechMutedDraft,
    volumeDraft: speechVolumeDraft,
    voiceDraft: speechVoiceDraft,
    setEnabledDraft: setSpeechEnabledDraft,
    setMutedDraft: setSpeechMutedDraft,
    setVolumeDraft: setSpeechVolumeDraft,
    setVoiceDraft: setSpeechVoiceDraft,
    saveSpeechSettings,
  } = speech;
  const currentDefaultModel = llmDefaultModelSettings?.defaultModel;
  const llmProviderDefaultsDirty =
    llmProviderDraft !== (llmSettings?.provider.selected ?? 'openai') ||
    llmDefaultModelDraft.provider !== currentDefaultModel?.provider ||
    llmDefaultModelDraft.model !== currentDefaultModel?.model ||
    llmDefaultModelDraft.thinkingLevel !== currentDefaultModel?.thinkingLevel;
  const selectedDefaultModel =
    llmDefaultModelChoices.find((choice) => choice.id === llmDefaultModelDraft.model) ?? null;
  const draftUploadMaxMiB = Number(uploadMaxMiBDraft);
  const draftUploadMaxBytes =
    Number.isFinite(draftUploadMaxMiB) && draftUploadMaxMiB > 0 ? miBToBytes(draftUploadMaxMiB) : null;
  const filesystemDirty =
    currentUploadMaxBytes != null && draftUploadMaxBytes != null && draftUploadMaxBytes !== currentUploadMaxBytes;
  const speechDirty = Boolean(
    speechSettings &&
      (speechEnabledDraft !== speechSettings.speech.enabled ||
        speechMutedDraft !== speechSettings.speech.muted ||
        speechVolumeDraft !== Math.round(speechSettings.speech.volume * 100) ||
        speechVoiceDraft !== speechSettings.speech.voice),
  );
  const filesystemMinMiB =
    filesystemSettings != null ? bytesToMinMiB(filesystemSettings.filesystem.minUploadMaxBytes) : 1;
  const filesystemMaxMiB =
    filesystemSettings != null ? bytesToMaxMiB(filesystemSettings.filesystem.maxUploadMaxBytes, filesystemMinMiB) : 8192;
  const filesystemDefaultMiB =
    filesystemSettings != null ? bytesToNearestMiB(filesystemSettings.filesystem.defaultUploadMaxBytes) : 2048;
  const githubStatus = github.githubSettings?.github ?? null;
  const githubAuthLabel =
    githubStatus?.authSource === 'environment'
      ? `Environment${githubStatus.authEnvKey ? ` (${githubStatus.authEnvKey})` : ''}`
      : githubStatus?.authSource === 'gh'
        ? 'Host gh auth'
        : 'Unavailable';
  const githubCliLabel = !githubStatus
    ? 'Checking…'
    : githubStatus.ghCliInstalled
      ? githubStatus.ghCliAuthenticated
        ? 'Installed and authenticated'
        : 'Installed'
      : 'Not installed';

  return (
    <>
      {github.githubSettingsError && (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
          {github.githubSettingsError}
        </div>
      )}
      {llmSettingsError && (
        <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
          {llmSettingsError}
        </div>
      )}
      {llmSettingsNotice && (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
          {llmSettingsNotice}
        </div>
      )}

      <div className="dh-settings-section">
        {github.githubSettingsLoading && !github.githubSettings ? (
          <div className="text-[var(--text-12)] text-[var(--muted-dim)]">Loading GitHub status…</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="dh-type-heading">GitHub pull requests</div>
              <div className="dh-type-supporting !text-[var(--muted)]">Hub PR actions use the GitHub API. Host `gh` is used only as an optional auth source.</div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div className="dh-settings-row px-3 py-3">
                <div className="dh-type-label">PR transport</div>
                <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                  {githubStatus?.pullRequestTransport === 'github-api' ? 'GitHub API' : 'Unknown'}
                </div>
                <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">List, inspect, merge, and close PRs without shelling out to container `gh`.</div>
              </div>
              <div className="dh-settings-row px-3 py-3">
                <div className="dh-type-label">Effective auth</div>
                <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">{githubAuthLabel}</div>
                <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">{githubStatus?.authDetail ?? 'Loading GitHub auth status…'}</div>
              </div>
              <div className="dh-settings-row px-3 py-3">
                <div className="dh-type-label">Host gh CLI</div>
                <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">{githubCliLabel}</div>
                <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                  {githubStatus?.ghCliVersion ?? (githubStatus?.ghCliInstalled ? 'Version unavailable' : 'Install gh if you want Hub to reuse host GitHub login state.')}
                </div>
                {githubStatus?.ghCliPath ? <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1 break-all">{githubStatus.ghCliPath}</div> : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <ResourceSubscriptionSettingsSection subscriptions={subscriptions} />

      <div className="dh-settings-section">
        {llmSettingsLoading && !llmSettings ? (
          <div className="text-[var(--text-12)] text-[var(--muted-dim)]">Loading settings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-3">
            <div className="dh-settings-row px-3 py-3">
              <div className="dh-type-label">Active provider</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                {llmProviderLabel(llmSettings?.provider.selected)}
              </div>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                {llmSettings?.provider.source === 'settings'
                  ? 'Selected in settings'
                  : llmSettings?.provider.source === 'environment'
                    ? 'Inherited from environment'
                    : 'Using default'}
              </div>
            </div>
            <div className="dh-settings-row px-3 py-3">
              <div className="dh-type-label">OpenAI key</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                {llmSettings?.openai.hasKey ? llmSettings.openai.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                {llmSettings?.openai.updatedAt ? `Updated ${new Date(llmSettings.openai.updatedAt).toLocaleString()}` : 'Stored only when set in Hub'}
              </div>
            </div>
            <div className="dh-settings-row px-3 py-3">
              <div className="dh-type-label">Gemini key</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                {llmSettings?.gemini.hasKey ? llmSettings.gemini.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                {llmSettings?.gemini.updatedAt ? `Updated ${new Date(llmSettings.gemini.updatedAt).toLocaleString()}` : 'Stored only when set in Hub'}
              </div>
            </div>
            <div className="dh-settings-row px-3 py-3">
              <div className="dh-type-label">Codex login</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                {llmSettings?.codex.hasKey ? llmSettings.codex.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                {llmSettings?.codex.updatedAt ? `Refreshed ${new Date(llmSettings.codex.updatedAt).toLocaleString()}` : 'Uses local Codex CLI auth'}
              </div>
            </div>
            <div className="dh-settings-row px-3 py-3">
              <div className="dh-type-label">GROQ key</div>
              <div className="mt-2 dh-type-control text-[var(--fg-secondary)]">
                {llmSettings?.groq.hasKey ? llmSettings.groq.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-1">
                {llmSettings?.groq.updatedAt ? `Updated ${new Date(llmSettings.groq.updatedAt).toLocaleString()}` : 'Required for transcription and speech'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="dh-settings-section">
        <div className="mb-2 dh-type-heading">
          Active provider
        </div>
        <UiSegmentedControl
          label="Active provider"
          value={llmProviderDraft}
          options={[
            { value: 'openai', label: 'OpenAI' },
            { value: 'gemini', label: 'Gemini' },
            { value: 'codex', label: 'Codex' },
          ]}
          onValueChange={setLlmProviderDraft}
          disabled={savingLlmProvider || llmSettingsLoading}
        />
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="dh-type-label">
              Default model
            </span>
            <UiMenuSelect
              value={llmDefaultModelDraft.model}
              onValueChange={setLlmDefaultModelDraft}
              disabled={savingLlmProvider || llmSettingsLoading || llmDefaultModelChoices.length === 0}
              entries={llmDefaultModelChoices.map((choice) => ({
                value: choice.id,
                label: choice.label,
                title: choice.id,
                searchText: `${choice.label} ${choice.id}`,
              }))}
              header={`${llmProviderLabel(llmProviderDraft)} model`}
              searchable
              searchPlaceholder="Search models"
              menuClassName="max-h-56 overflow-y-auto"
            />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <span className="dh-type-label">
              Default reasoning
            </span>
            <UiMenuSelect
              value={llmDefaultModelDraft.thinkingLevel}
              onValueChange={setLlmDefaultReasoningDraft}
              disabled={
                savingLlmProvider ||
                llmSettingsLoading ||
                !selectedDefaultModel ||
                selectedDefaultModel.reasoningLevels.length === 0
              }
              entries={(selectedDefaultModel?.reasoningLevels ?? []).map((level) => ({
                value: level,
                label: llmReasoningLabel(level),
              }))}
              header="Reasoning"
            />
          </div>
          <UiButton
            variant="primary"
            onClick={() => void saveLlmProviderSettings()}
            disabled={
              savingLlmProvider ||
              llmSettingsLoading ||
              !llmProviderDefaultsDirty ||
              !selectedDefaultModel
            }
            loading={savingLlmProvider}
          >
            Save defaults
          </UiButton>
        </div>
        <div className="mt-2 text-[var(--text-11)] leading-relaxed text-[var(--muted-dim)]">
          New Built-in chats use this model and reasoning whenever {llmProviderLabel(llmProviderDraft)} is the active provider.
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="dh-settings-section">
          <div className="dh-type-heading">
            Codex subscription auth
          </div>
          {llmSettings?.codex.hasKey ? (
            <div className="dh-type-supporting">
              {llmSettings.codex.keyHint ?? 'Codex CLI login found'}
              {llmSettings.codex.updatedAt ? ` • Refreshed ${new Date(llmSettings.codex.updatedAt).toLocaleString()}` : ''}
            </div>
          ) : (
            <div className="dh-type-supporting">No Codex CLI login found for the Hub process.</div>
          )}
          <div className="dh-type-supporting !text-[var(--fg-secondary)]">
            The Built-in agent uses the local file-based Codex login. Connecting here opens
            OpenAI and finishes automatically through a temporary localhost callback.
          </div>
          <CodexConnectControl
            connected={llmSettings ? Boolean(llmSettings.codex.hasKey) : undefined}
            onConnected={loadLlmSettings}
          />
          {llmSettings?.codex.hasKey ? (
            <div className="flex items-center gap-2">
              <UiButton
                onClick={() => void loadLlmSettings()}
                disabled={llmSettingsLoading}
                loading={llmSettingsLoading}
              >
                Refresh
              </UiButton>
            </div>
          ) : null}
        </div>

        <ApiKeySettingsCard
          title="OpenAI API key"
          hasKey={Boolean(llmSettings?.openai.hasKey)}
          keyHint={llmSettings?.openai.keyHint}
          updatedAt={llmSettings?.openai.updatedAt}
          emptyLabel="No OpenAI key configured."
          draft={openAiSettingsDraft}
          name="openai-api-key"
          placeholder="sk-..."
          showKey={showOpenAiKey}
          revealing={revealingOpenAiKey}
          saving={savingOpenAiSettings}
          clearing={clearingOpenAiSettings}
          onDraftChange={updateOpenAiSettingsDraft}
          onToggleVisibility={() => void toggleApiKeyVisibility('openai')}
          onSave={() => void mutateApiKeySettings('openai', 'save')}
          onClear={() => void mutateApiKeySettings('openai', 'clear')}
        />

        <ApiKeySettingsCard
          title="Gemini API key"
          hasKey={Boolean(llmSettings?.gemini.hasKey)}
          keyHint={llmSettings?.gemini.keyHint}
          updatedAt={llmSettings?.gemini.updatedAt}
          emptyLabel="No Gemini key configured."
          draft={geminiSettingsDraft}
          name="gemini-api-key"
          placeholder="AIza..."
          showKey={showGeminiKey}
          revealing={revealingGeminiKey}
          saving={savingGeminiSettings}
          clearing={clearingGeminiSettings}
          onDraftChange={updateGeminiSettingsDraft}
          onToggleVisibility={() => void toggleApiKeyVisibility('gemini')}
          onSave={() => void mutateApiKeySettings('gemini', 'save')}
          onClear={() => void mutateApiKeySettings('gemini', 'clear')}
        />

        <ApiKeySettingsCard
          title="GROQ API key"
          hasKey={Boolean(llmSettings?.groq.hasKey)}
          keyHint={llmSettings?.groq.keyHint}
          updatedAt={llmSettings?.groq.updatedAt}
          emptyLabel="No GROQ key configured."
          description="Used for voice transcription and the Drone Hub speak tool."
          draft={groqSettingsDraft}
          name="groq-api-key"
          placeholder="gsk_..."
          showKey={showGroqKey}
          revealing={revealingGroqKey}
          saving={savingGroqSettings}
          clearing={clearingGroqSettings}
          onDraftChange={updateGroqSettingsDraft}
          onToggleVisibility={() => void toggleApiKeyVisibility('groq')}
          onSave={() => void mutateApiKeySettings('groq', 'save')}
          onClear={() => void mutateApiKeySettings('groq', 'clear')}
        />
      </div>

      <div className="dh-settings-section">
        <div>
          <div className="dh-type-heading">Voice input</div>
          <div className="mt-1 dh-type-supporting">
            Configure how continuous voice steering and continuous dictation detect and transcribe a completed thought.
          </div>
        </div>
        {voiceInput.error ? (
          <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
            {voiceInput.error}
          </div>
        ) : null}
        {voiceInput.notice ? (
          <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
            {voiceInput.notice}
          </div>
        ) : null}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="dh-type-label">End thought after</span>
            <UiMenuSelect
              value={voiceInput.draft.endThoughtPreset}
              onValueChange={(value) =>
                voiceInput.setDraft((current) => ({
                  ...current,
                  endThoughtPreset: value as typeof current.endThoughtPreset,
                }))
              }
              disabled={voiceInput.loading || voiceInput.saving}
              entries={[
                { value: 'quick', label: 'Quick — 1.5 seconds' },
                { value: 'balanced', label: 'Balanced — 2.5 seconds' },
                { value: 'patient', label: 'Patient — 4 seconds' },
                { value: 'custom', label: 'Custom' },
              ]}
              header="End-thought pause"
            />
          </label>
          {voiceInput.draft.endThoughtPreset === 'custom' ? (
            <label className="flex flex-col gap-1.5">
              <span className="flex items-center justify-between gap-3 dh-type-label">
                <span>Custom pause</span>
                <span className="font-mono text-[var(--fg-secondary)]">
                  {(voiceInput.draft.customSilenceMillis / 1_000).toFixed(1)}s
                </span>
              </span>
              <UiSlider
                min={1_000}
                max={10_000}
                step={250}
                value={voiceInput.draft.customSilenceMillis}
                onChange={(event) =>
                  voiceInput.setDraft((current) => ({
                    ...current,
                    customSilenceMillis: Number(event.target.value),
                  }))
                }
                aria-label="Custom end-thought pause"
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="dh-type-label">Noise handling</span>
            <UiSegmentedControl
              label="Noise handling"
              value={voiceInput.draft.noiseHandling}
              onValueChange={(value) =>
                voiceInput.setDraft((current) => ({
                  ...current,
                  noiseHandling: value as typeof current.noiseHandling,
                }))
              }
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'quiet', label: 'Quiet' },
                { value: 'noisy', label: 'Noisy' },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="dh-type-label">Transcription quality</span>
            <UiSegmentedControl
              label="Transcription quality"
              value={voiceInput.draft.quality}
              onValueChange={(value) =>
                voiceInput.setDraft((current) => ({
                  ...current,
                  quality: value as typeof current.quality,
                }))
              }
              options={[
                { value: 'fast', label: 'Fast' },
                { value: 'accurate', label: 'Accurate' },
              ]}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="dh-type-label">Preferred language</span>
            <input
              value={voiceInput.draft.language ?? ''}
              onChange={(event) =>
                voiceInput.setDraft((current) => ({
                  ...current,
                  language: event.target.value.trim() || null,
                }))
              }
              placeholder="Auto (or en, hr-HR, …)"
              spellCheck={false}
              className="h-9 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--type-ui)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:outline-none"
            />
          </label>
          <UiSwitch
            checked={voiceInput.draft.confirmationFeedback}
            onCheckedChange={(value) =>
              voiceInput.setDraft((current) => ({ ...current, confirmationFeedback: value }))
            }
            label="Transcription confirmation sound"
            description="Play a short confirmation after a continuous voice transcription is accepted."
          />
        </div>
        <div className="flex items-center gap-2">
          <UiButton
            variant="primary"
            onClick={() => void voiceInput.save()}
            disabled={!voiceInputDirty || voiceInput.loading || voiceInput.saving}
            loading={voiceInput.saving}
          >
            Save voice input settings
          </UiButton>
        </div>
      </div>

      <div className="dh-settings-section">
        <div>
          <div className="dh-type-heading">Speech</div>
          <div className="mt-1 dh-type-supporting">
            Configure the GROQ voice used by speak. External MCP clients receive the tool automatically when enabled; Built-in chats still use their normal per-chat tool selection.
          </div>
        </div>
        {speechSettingsError ? (
          <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
            {speechSettingsError}
          </div>
        ) : null}
        {speechSettingsNotice ? (
          <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
            {speechSettingsNotice}
          </div>
        ) : null}
        {speechSettingsLoading && !speechSettings ? (
          <div className="text-[var(--text-12)] text-[var(--muted-dim)]">Loading speech settings…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-4">
              <UiSwitch
                checked={speechEnabledDraft}
                onCheckedChange={setSpeechEnabledDraft}
                disabled={speechSettingsLoading || speechSettingsSaving}
                label="Enable speak tool"
                description="Hide the tool from MCP catalogs and reject new speech calls when disabled."
              />
              <UiSwitch
                checked={speechMutedDraft}
                onCheckedChange={setSpeechMutedDraft}
                disabled={speechSettingsLoading || speechSettingsSaving}
                label="Mute speech"
                description="Keep the tool available, but skip synthesis and playback."
              />
            </div>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="dh-type-label">Default voice</span>
                <UiMenuSelect
                  value={speechVoiceDraft}
                  onValueChange={setSpeechVoiceDraft}
                  disabled={speechSettingsLoading || speechSettingsSaving}
                  entries={(speechSettings?.speech.voices ?? [speechVoiceDraft]).map((voice) => ({
                    value: voice,
                    label: voice.charAt(0).toUpperCase() + voice.slice(1),
                  }))}
                  header="GROQ voice"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between gap-3 dh-type-label">
                  <span>Volume</span>
                  <span className="font-mono text-[var(--fg-secondary)]">{speechVolumeDraft}%</span>
                </span>
                <UiSlider
                  min={0}
                  max={100}
                  step={1}
                  value={speechVolumeDraft}
                  onChange={(event) => setSpeechVolumeDraft(Number(event.target.value))}
                  disabled={speechSettingsLoading || speechSettingsSaving}
                  aria-label="Speech volume"
                />
              </label>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2">
          <UiButton
            variant="primary"
            onClick={() => void saveSpeechSettings()}
            disabled={!speechDirty || speechSettingsLoading || speechSettingsSaving}
            loading={speechSettingsSaving}
          >
            Save speech settings
          </UiButton>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="dh-settings-section">
          <div className="dh-type-heading">
            Filesystem uploads
          </div>
          <div className="dh-type-supporting">
            Configure the max size for a single uploaded file. Oversized uploads show an error and point users back to this setting.
          </div>
          {filesystemSettingsError && (
            <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
              {filesystemSettingsError}
            </div>
          )}
          {filesystemSettingsNotice && (
            <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
              {filesystemSettingsNotice}
            </div>
          )}
          {filesystemSettingsLoading && !filesystemSettings ? (
            <div className="text-[var(--text-12)] text-[var(--muted-dim)]">Loading filesystem settings…</div>
          ) : (
            <>
              <div className="text-[var(--text-11)] text-[var(--muted-dim)]">
                Current limit:{' '}
                <span className="text-[var(--fg-secondary)]">
                  {filesystemSettings ? `${bytesToNearestMiB(filesystemSettings.filesystem.uploadMaxBytes).toLocaleString()} MiB` : '-'}
                </span>{' '}
                ({filesystemSettings?.filesystem.uploadMaxBytesSource === 'settings' ? 'from settings' : 'default'})
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="dh-type-label">Max file size (MiB)</span>
                  <input
                    value={uploadMaxMiBDraft}
                    onChange={(e) => setUploadMaxMiBDraft(e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="h-9 w-40 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-13)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                    placeholder={String(filesystemDefaultMiB)}
                    disabled={filesystemSettingsLoading || savingFilesystemSettings}
                  />
                </label>
                <UiButton
                  onClick={() => setUploadMaxMiBDraft(String(filesystemDefaultMiB))}
                  disabled={filesystemSettingsLoading || savingFilesystemSettings}
                >
                  Use default
                </UiButton>
                <UiButton
                  variant="primary"
                  onClick={() => void saveFilesystemSettings()}
                  disabled={!filesystemDirty || filesystemSettingsLoading || savingFilesystemSettings}
                  loading={savingFilesystemSettings}
                >
                  Save upload limit
                </UiButton>
              </div>
              <div className="text-[var(--text-10)] text-[var(--muted-dim)]">
                Allowed range: {filesystemMinMiB.toLocaleString()} to {filesystemMaxMiB.toLocaleString()} MiB.
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className="dh-settings-section">
            <div>
              <div className="dh-type-heading">
                Appearance
              </div>
              <div className="mt-1 dh-type-supporting">
                Choose the desktop color theme. Both options are dark and the preference is saved for this profile.
              </div>
            </div>
            <div role="radiogroup" aria-label="Desktop color theme" className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {DESKTOP_THEMES.map((theme) => {
                const selected = theme.id === themeId;
                return (
                  <button
                    key={theme.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setThemeId(theme.id)}
                    className={`min-h-[104px] rounded-[var(--radius-medium)] border p-3 text-left transition-all ${
                      selected
                        ? 'border-[var(--accent)] bg-[var(--accent-subtle)] shadow-[var(--glow-accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-softest)] hover:border-[var(--border)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span>
                        <span className="block dh-type-control text-[var(--fg-strong)]">
                          {theme.label}
                        </span>
                        <span className="mt-1 block dh-type-supporting !text-[var(--muted)]">
                          {theme.description}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                          selected ? 'border-[var(--accent)]' : 'border-[var(--border)]'
                        }`}
                      >
                        {selected ? <span className="h-2 w-2 rounded-full bg-[var(--accent)]" /> : null}
                      </span>
                    </span>
                    <span aria-hidden="true" className="mt-3 flex h-5 overflow-hidden rounded border border-[var(--border-subtle)]">
                      {theme.swatches.map((color) => (
                        <span key={color} className="flex-1" style={{ backgroundColor: color }} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <div className="dh-settings-section">
            <div className="dh-type-heading">
              Onboarding
            </div>
            <div className="dh-type-supporting">
              Clear onboarding dismissal state and replay the guided tips from step 1.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <UiButton
                variant="primary"
                onClick={() => {
                  const ok = window.confirm('Replay onboarding from the beginning? This will clear onboarding dismissal state.');
                  if (!ok) return;
                  onReplayOnboarding();
                }}
                title="Reset onboarding and replay guided tips"
              >
                Replay onboarding
              </UiButton>
              <UiButton
                onClick={() => {
                  const ok = window.confirm('Clear onboarding state?');
                  if (!ok) return;
                  onResetOnboarding();
                }}
                title="Clear onboarding dismissals without opening tips"
              >
                Reset only
              </UiButton>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
