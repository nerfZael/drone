import React from 'react';
import { bytesToMaxMiB, bytesToMinMiB, bytesToNearestMiB, miBToBytes } from './filesystem-size-utils';
import type { UseFilesystemSettingsResult } from './use-filesystem-settings';
import type { UseGithubSettingsResult } from './use-github-settings';
import type { UseLlmSettingsResult } from './use-llm-settings';

type GeneralSettingsTabProps = {
  github: UseGithubSettingsResult;
  llm: UseLlmSettingsResult;
  filesystem: UseFilesystemSettingsResult;
  transcriptInlineImages: boolean;
  setTranscriptInlineImages: (value: boolean) => void;
  onReplayOnboarding: () => void;
  onResetOnboarding: () => void;
};

export function GeneralSettingsTab({
  github,
  llm,
  filesystem,
  transcriptInlineImages,
  setTranscriptInlineImages,
  onReplayOnboarding,
  onResetOnboarding,
}: GeneralSettingsTabProps) {
  const {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
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
    llmSettingsNotice,
    setLlmProviderDraft,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
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
  const draftUploadMaxMiB = Number(uploadMaxMiBDraft);
  const draftUploadMaxBytes =
    Number.isFinite(draftUploadMaxMiB) && draftUploadMaxMiB > 0 ? miBToBytes(draftUploadMaxMiB) : null;
  const filesystemDirty =
    currentUploadMaxBytes != null && draftUploadMaxBytes != null && draftUploadMaxBytes !== currentUploadMaxBytes;
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
        <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {github.githubSettingsError}
        </div>
      )}
      {llmSettingsError && (
        <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {llmSettingsError}
        </div>
      )}
      {llmSettingsNotice && (
        <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
          {llmSettingsNotice}
        </div>
      )}

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
        {github.githubSettingsLoading && !github.githubSettings ? (
          <div className="text-[12px] text-[var(--muted-dim)]">Loading GitHub status…</div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">GitHub pull requests</div>
              <div className="text-[12px] text-[var(--muted)]">Hub PR actions use the GitHub API. Host `gh` is used only as an optional auth source.</div>
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">PR transport</div>
                <div className="text-[13px] text-[var(--fg-secondary)] mt-2">
                  {githubStatus?.pullRequestTransport === 'github-api' ? 'GitHub API' : 'Unknown'}
                </div>
                <div className="text-[11px] text-[var(--muted-dim)] mt-1">List, inspect, merge, and close PRs without shelling out to container `gh`.</div>
              </div>
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Effective auth</div>
                <div className="text-[13px] text-[var(--fg-secondary)] mt-2">{githubAuthLabel}</div>
                <div className="text-[11px] text-[var(--muted-dim)] mt-1">{githubStatus?.authDetail ?? 'Loading GitHub auth status…'}</div>
              </div>
              <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Host gh CLI</div>
                <div className="text-[13px] text-[var(--fg-secondary)] mt-2">{githubCliLabel}</div>
                <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                  {githubStatus?.ghCliVersion ?? (githubStatus?.ghCliInstalled ? 'Version unavailable' : 'Install gh if you want Hub to reuse host GitHub login state.')}
                </div>
                {githubStatus?.ghCliPath ? <div className="text-[11px] text-[var(--muted-dim)] mt-1 break-all">{githubStatus.ghCliPath}</div> : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
        {llmSettingsLoading && !llmSettings ? (
          <div className="text-[12px] text-[var(--muted-dim)]">Loading settings…</div>
        ) : (
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Active provider</div>
              <div className="text-[13px] text-[var(--fg-secondary)] mt-2">
                {llmSettings?.provider.selected === 'gemini' ? 'Gemini' : 'OpenAI'}
              </div>
              <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                {llmSettings?.provider.source === 'settings'
                  ? 'Selected in settings'
                  : llmSettings?.provider.source === 'environment'
                    ? 'Inherited from environment'
                    : 'Using default'}
              </div>
            </div>
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">OpenAI key</div>
              <div className="text-[13px] text-[var(--fg-secondary)] mt-2">
                {llmSettings?.openai.hasKey ? llmSettings.openai.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                {llmSettings?.openai.updatedAt ? `Updated ${new Date(llmSettings.openai.updatedAt).toLocaleString()}` : 'Stored only when set in Hub'}
              </div>
            </div>
            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Gemini key</div>
              <div className="text-[13px] text-[var(--fg-secondary)] mt-2">
                {llmSettings?.gemini.hasKey ? llmSettings.gemini.keyHint ?? 'Configured' : 'Not configured'}
              </div>
              <div className="text-[11px] text-[var(--muted-dim)] mt-1">
                {llmSettings?.gemini.updatedAt ? `Updated ${new Date(llmSettings.gemini.updatedAt).toLocaleString()}` : 'Stored only when set in Hub'}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
        <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase mb-2" style={{ fontFamily: 'var(--display)' }}>
          Active provider
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setLlmProviderDraft('openai')}
            disabled={savingLlmProvider || llmSettingsLoading}
            className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
              llmProviderDraft === 'openai'
                ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            } ${savingLlmProvider || llmSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
            style={{ fontFamily: 'var(--display)' }}
          >
            OpenAI
          </button>
          <button
            type="button"
            onClick={() => setLlmProviderDraft('gemini')}
            disabled={savingLlmProvider || llmSettingsLoading}
            className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
              llmProviderDraft === 'gemini'
                ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
            } ${savingLlmProvider || llmSettingsLoading ? 'opacity-40 cursor-not-allowed' : ''}`}
            style={{ fontFamily: 'var(--display)' }}
          >
            Gemini
          </button>
          <button
            type="button"
            onClick={() => void saveLlmProviderSettings()}
            disabled={savingLlmProvider || llmSettingsLoading || llmProviderDraft === (llmSettings?.provider.selected ?? 'openai')}
            className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
              savingLlmProvider || llmSettingsLoading || llmProviderDraft === (llmSettings?.provider.selected ?? 'openai')
                ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {savingLlmProvider ? 'Saving…' : 'Save provider'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            OpenAI API key
          </div>
          {llmSettings?.openai.hasKey ? (
            <div className="text-[11px] text-[var(--muted-dim)]">
              {llmSettings.openai.keyHint ?? 'hidden'}
              {llmSettings.openai.updatedAt ? ` • Updated ${new Date(llmSettings.openai.updatedAt).toLocaleString()}` : ''}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--muted-dim)]">No OpenAI key configured.</div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={openAiSettingsDraft}
              onChange={(e) => updateOpenAiSettingsDraft(e.target.value)}
              type="text"
              autoComplete="off"
              name="openai-api-key"
              spellCheck={false}
              style={({ WebkitTextSecurity: showOpenAiKey ? 'none' : 'disc' } as React.CSSProperties)}
              className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
              placeholder="sk-..."
              disabled={savingOpenAiSettings || clearingOpenAiSettings || revealingOpenAiKey}
            />
            <button
              type="button"
              onClick={() => void toggleApiKeyVisibility('openai')}
              disabled={savingOpenAiSettings || clearingOpenAiSettings || revealingOpenAiKey}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                savingOpenAiSettings || clearingOpenAiSettings || revealingOpenAiKey
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {revealingOpenAiKey ? 'Loading…' : showOpenAiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void mutateApiKeySettings('openai', 'save')}
              disabled={!openAiSettingsDraft.trim() || savingOpenAiSettings || clearingOpenAiSettings}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                !openAiSettingsDraft.trim() || savingOpenAiSettings || clearingOpenAiSettings
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {savingOpenAiSettings ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => void mutateApiKeySettings('openai', 'clear')}
              disabled={clearingOpenAiSettings || savingOpenAiSettings || !llmSettings?.openai.hasKey}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                clearingOpenAiSettings || savingOpenAiSettings || !llmSettings?.openai.hasKey
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {clearingOpenAiSettings ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>

        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Gemini API key
          </div>
          {llmSettings?.gemini.hasKey ? (
            <div className="text-[11px] text-[var(--muted-dim)]">
              {llmSettings.gemini.keyHint ?? 'hidden'}
              {llmSettings.gemini.updatedAt ? ` • Updated ${new Date(llmSettings.gemini.updatedAt).toLocaleString()}` : ''}
            </div>
          ) : (
            <div className="text-[11px] text-[var(--muted-dim)]">No Gemini key configured.</div>
          )}
          <div className="flex items-center gap-2">
            <input
              value={geminiSettingsDraft}
              onChange={(e) => updateGeminiSettingsDraft(e.target.value)}
              type="text"
              autoComplete="off"
              name="gemini-api-key"
              spellCheck={false}
              style={({ WebkitTextSecurity: showGeminiKey ? 'none' : 'disc' } as React.CSSProperties)}
              className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
              placeholder="AIza..."
              disabled={savingGeminiSettings || clearingGeminiSettings || revealingGeminiKey}
            />
            <button
              type="button"
              onClick={() => void toggleApiKeyVisibility('gemini')}
              disabled={savingGeminiSettings || clearingGeminiSettings || revealingGeminiKey}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                savingGeminiSettings || clearingGeminiSettings || revealingGeminiKey
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {revealingGeminiKey ? 'Loading…' : showGeminiKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void mutateApiKeySettings('gemini', 'save')}
              disabled={!geminiSettingsDraft.trim() || savingGeminiSettings || clearingGeminiSettings}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                !geminiSettingsDraft.trim() || savingGeminiSettings || clearingGeminiSettings
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {savingGeminiSettings ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => void mutateApiKeySettings('gemini', 'clear')}
              disabled={clearingGeminiSettings || savingGeminiSettings || !llmSettings?.gemini.hasKey}
              className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                clearingGeminiSettings || savingGeminiSettings || !llmSettings?.gemini.hasKey
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[var(--red-subtle)] border-[rgba(255,90,90,.28)] text-[var(--red)] hover:bg-[rgba(255,90,90,.18)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
            >
              {clearingGeminiSettings ? 'Clearing…' : 'Clear'}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Filesystem uploads
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
            Configure the max size for a single uploaded file. Oversized uploads show an error and point users back to this setting.
          </div>
          {filesystemSettingsError && (
            <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
              {filesystemSettingsError}
            </div>
          )}
          {filesystemSettingsNotice && (
            <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
              {filesystemSettingsNotice}
            </div>
          )}
          {filesystemSettingsLoading && !filesystemSettings ? (
            <div className="text-[12px] text-[var(--muted-dim)]">Loading filesystem settings…</div>
          ) : (
            <>
              <div className="text-[11px] text-[var(--muted-dim)]">
                Current limit:{' '}
                <span className="text-[var(--fg-secondary)]">
                  {filesystemSettings ? `${bytesToNearestMiB(filesystemSettings.filesystem.uploadMaxBytes).toLocaleString()} MiB` : '-'}
                </span>{' '}
                ({filesystemSettings?.filesystem.uploadMaxBytesSource === 'settings' ? 'from settings' : 'default'})
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] font-semibold">Max file size (MiB)</span>
                  <input
                    value={uploadMaxMiBDraft}
                    onChange={(e) => setUploadMaxMiBDraft(e.target.value.replace(/[^\d]/g, ''))}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    className="h-9 w-40 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors"
                    placeholder={String(filesystemDefaultMiB)}
                    disabled={filesystemSettingsLoading || savingFilesystemSettings}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setUploadMaxMiBDraft(String(filesystemDefaultMiB))}
                  disabled={filesystemSettingsLoading || savingFilesystemSettings}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    filesystemSettingsLoading || savingFilesystemSettings
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  Use default
                </button>
                <button
                  type="button"
                  onClick={() => void saveFilesystemSettings()}
                  disabled={!filesystemDirty || filesystemSettingsLoading || savingFilesystemSettings}
                  className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                    !filesystemDirty || filesystemSettingsLoading || savingFilesystemSettings
                      ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                      : 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110'
                  }`}
                  style={{ fontFamily: 'var(--display)' }}
                >
                  {savingFilesystemSettings ? 'Saving…' : 'Save upload limit'}
                </button>
              </div>
              <div className="text-[10px] text-[var(--muted-dim)]">
                Allowed range: {filesystemMinMiB.toLocaleString()} to {filesystemMaxMiB.toLocaleString()} MiB.
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Transcript
          </div>
            <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
              Show image links inline inside agent messages by default.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setTranscriptInlineImages(true)}
                className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                  transcriptInlineImages
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                Inline on
              </button>
              <button
                type="button"
                onClick={() => setTranscriptInlineImages(false)}
                className={`h-8 px-3 rounded text-[10px] font-semibold tracking-wide uppercase border transition-all ${
                  !transcriptInlineImages
                    ? 'bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)]'
                    : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                }`}
                style={{ fontFamily: 'var(--display)' }}
              >
                Inline off (default)
              </button>
            </div>
          </div>

          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
            <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
              Onboarding
            </div>
            <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
              Clear onboarding dismissal state and replay the guided tips from step 1.
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm('Replay onboarding from the beginning? This will clear onboarding dismissal state.');
                  if (!ok) return;
                  onReplayOnboarding();
                }}
                className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] hover:shadow-[var(--glow-accent)] hover:brightness-110"
                style={{ fontFamily: 'var(--display)' }}
                title="Reset onboarding and replay guided tips"
              >
                Replay onboarding
              </button>
              <button
                type="button"
                onClick={() => {
                  const ok = window.confirm('Clear onboarding state?');
                  if (!ok) return;
                  onResetOnboarding();
                }}
                className="h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                style={{ fontFamily: 'var(--display)' }}
                title="Clear onboarding dismissals without opening tips"
              >
                Reset only
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
