import React from 'react';
import { IconChevron, IconCopy } from './icons';
import type { UseHubLogsResult } from './use-hub-logs';
import type { UseLlmSettingsResult } from './use-llm-settings';

type SettingsViewProps = {
  llm: UseLlmSettingsResult;
  hubLogsState: UseHubLogsResult;
  hubLogsTailLines: number;
  hubLogsMaxBytes: number;
  onBackToWorkspace: () => void;
  onReplayOnboarding: () => void;
  onResetOnboarding: () => void;
};

export function SettingsView({
  llm,
  hubLogsState,
  hubLogsTailLines,
  hubLogsMaxBytes,
  onBackToWorkspace,
  onReplayOnboarding,
  onResetOnboarding,
}: SettingsViewProps) {
  const {
    llmSettings,
    llmSettingsLoading,
    llmSettingsError,
    llmProviderDraft,
    savingLlmProvider,
    showGeminiKey,
    geminiSettingsDraft,
    savingGeminiSettings,
    clearingGeminiSettings,
    openAiSettingsDraft,
    savingOpenAiSettings,
    clearingOpenAiSettings,
    showOpenAiKey,
    llmSettingsNotice,
    setLlmProviderDraft,
    setShowGeminiKey,
    setShowOpenAiKey,
    updateOpenAiSettingsDraft,
    updateGeminiSettingsDraft,
    loadLlmSettings,
    saveLlmProviderSettings,
    mutateApiKeySettings,
  } = llm;

  const {
    hubLogs,
    hubLogsLoading,
    hubLogsError,
    hubLogsNotice,
    hubLogsExpanded,
    hubLogsTextareaRef,
    setHubLogsExpanded,
    loadHubLogs,
    copyHubLogs,
    handleHubLogsScroll,
  } = hubLogsState;

  const settingsBusy =
    hubLogsLoading ||
    llmSettingsLoading ||
    savingOpenAiSettings ||
    clearingOpenAiSettings ||
    savingGeminiSettings ||
    clearingGeminiSettings ||
    savingLlmProvider;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[820px] mx-auto px-5 py-6 sm:py-8">
        <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--panel-alt)] overflow-hidden">
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted-dim)] font-semibold" style={{ fontFamily: 'var(--display)' }}>
                Settings
              </div>
              <h1 className="text-[18px] font-semibold text-[var(--fg)] mt-1" style={{ fontFamily: 'var(--display)' }}>
                LLM providers
              </h1>
              <p className="text-[12px] text-[var(--muted)] mt-1">
                Configure OpenAI and Gemini API keys, then choose which provider powers job parsing and drone-name suggestions.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void loadLlmSettings();
                void loadHubLogs();
              }}
              disabled={settingsBusy}
              className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                settingsBusy
                  ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                  : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
              }`}
              style={{ fontFamily: 'var(--display)' }}
              title="Refresh settings and logs"
            >
              Refresh
            </button>
          </div>

          <div className="px-5 py-4 flex flex-col gap-4">
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
              {llmSettingsLoading && !llmSettings ? (
                <div className="text-[12px] text-[var(--muted-dim)]">Loading settings…</div>
              ) : (
                <div className="flex flex-col gap-1">
                  <div className="text-[12px] text-[var(--fg-secondary)]">
                    Active provider: {llmSettings?.provider.selected === 'gemini' ? 'Gemini' : 'OpenAI'}
                  </div>
                  <div className="text-[11px] text-[var(--muted-dim)]">
                    Provider source:{' '}
                    {llmSettings?.provider.source === 'settings'
                      ? 'Settings'
                      : llmSettings?.provider.source === 'environment'
                        ? 'Environment variable'
                        : 'Default'}
                  </div>
                  <div className="text-[11px] text-[var(--muted-dim)]">
                    OpenAI: {llmSettings?.openai.hasKey ? `configured (${llmSettings.openai.keyHint ?? 'hidden'})` : 'not configured'} • Gemini:{' '}
                    {llmSettings?.gemini.hasKey ? `configured (${llmSettings.gemini.keyHint ?? 'hidden'})` : 'not configured'}
                  </div>
                </div>
              )}
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase mb-2" style={{ fontFamily: 'var(--display)' }}>
                Active provider
              </div>
              <div className="flex items-center gap-2">
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    style={(showOpenAiKey ? {} : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties))}
                    className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
                    placeholder="sk-..."
                    disabled={savingOpenAiSettings || clearingOpenAiSettings}
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenAiKey((v) => !v)}
                    disabled={savingOpenAiSettings || clearingOpenAiSettings}
                    className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      savingOpenAiSettings || clearingOpenAiSettings
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {showOpenAiKey ? 'Hide' : 'Show'}
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
                    style={(showGeminiKey ? {} : ({ WebkitTextSecurity: 'disc' } as React.CSSProperties))}
                    className="flex-1 h-9 rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.15)] px-3 text-[13px] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:outline-none focus:border-[var(--accent-muted)] transition-colors font-mono"
                    placeholder="AIza..."
                    disabled={savingGeminiSettings || clearingGeminiSettings}
                  />
                  <button
                    type="button"
                    onClick={() => setShowGeminiKey((v) => !v)}
                    disabled={savingGeminiSettings || clearingGeminiSettings}
                    className={`h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      savingGeminiSettings || clearingGeminiSettings
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {showGeminiKey ? 'Hide' : 'Show'}
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

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
              <div
                role="button"
                tabIndex={0}
                onClick={() => setHubLogsExpanded((v) => !v)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setHubLogsExpanded((v) => !v);
                  }
                }}
                className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-[var(--hover)] transition-colors cursor-pointer"
                aria-expanded={hubLogsExpanded}
                aria-label={hubLogsExpanded ? 'Collapse hub logs' : 'Expand hub logs'}
              >
                <div className="inline-flex items-center gap-2 min-w-0">
                  <IconChevron down={hubLogsExpanded} className="text-[var(--muted-dim)] opacity-80" />
                  <div>
                    <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                      Hub logs
                    </div>
                    <div className="text-[11px] text-[var(--muted-dim)] mt-1">Recent output from the Drone Hub process log.</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void loadHubLogs();
                    }}
                    disabled={hubLogsLoading}
                    className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all ${
                      hubLogsLoading
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Refresh hub logs"
                  >
                    {hubLogsLoading ? 'Refreshing…' : 'Refresh'}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyHubLogs();
                    }}
                    disabled={hubLogsLoading || !String(hubLogs?.text ?? '').trim()}
                    className={`h-8 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all inline-flex items-center gap-1.5 ${
                      hubLogsLoading || !String(hubLogs?.text ?? '').trim()
                        ? 'opacity-40 cursor-not-allowed bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted-dim)]'
                        : 'bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]'
                    }`}
                    style={{ fontFamily: 'var(--display)' }}
                    title="Copy hub logs"
                  >
                    <IconCopy className="opacity-80" />
                    Copy
                  </button>
                </div>
              </div>

              {hubLogsExpanded && (
                <>
                  {hubLogsError && (
                    <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
                      {hubLogsError}
                    </div>
                  )}
                  {hubLogsNotice && (
                    <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
                      {hubLogsNotice}
                    </div>
                  )}

                  <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
                    {hubLogs?.logPath ? (
                      <>
                        <span className="font-mono text-[var(--fg-secondary)]">{hubLogs.logPath}</span>
                        {hubLogs.updatedAt ? ` • Updated ${new Date(hubLogs.updatedAt).toLocaleString()}` : ''}
                        {hubLogs.truncated ? ' • Tail view (truncated)' : ''}
                      </>
                    ) : (
                      'No hub log file found yet.'
                    )}
                  </div>

                  <textarea
                    ref={hubLogsTextareaRef}
                    readOnly
                    value={hubLogs?.text ?? ''}
                    onScroll={handleHubLogsScroll}
                    placeholder={hubLogsLoading ? 'Loading logs…' : 'No hub logs available yet.'}
                    className="w-full min-h-[220px] max-h-[55vh] rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.2)] px-3 py-2 text-[12px] leading-relaxed text-[var(--fg-secondary)] font-mono resize-y focus:outline-none"
                  />
                  <div className="text-[10px] text-[var(--muted-dim)]">
                    Showing up to {(hubLogs?.tailLines ?? hubLogsTailLines).toLocaleString()} lines and {(hubLogs?.maxBytes ?? hubLogsMaxBytes).toLocaleString()} bytes.
                  </div>
                </>
              )}
            </div>

            <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-3 py-3 flex flex-col gap-3">
              <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
                Onboarding
              </div>
              <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">
                Clear onboarding dismissal state and replay the guided tips from step 1.
              </div>
              <div className="flex items-center gap-2">
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

            <div className="flex items-center">
              <button
                type="button"
                onClick={onBackToWorkspace}
                className="ml-auto h-9 px-3 rounded text-[11px] font-semibold tracking-wide uppercase border transition-all bg-[rgba(255,255,255,.02)] border-[var(--border-subtle)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
                style={{ fontFamily: 'var(--display)' }}
              >
                Back to drones
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
