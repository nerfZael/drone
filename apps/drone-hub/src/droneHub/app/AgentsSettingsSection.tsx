import React from 'react';
import type { UseAgentsSettingsResult } from './use-agents-settings';

export function AgentsSettingsSection({ agents }: { agents: UseAgentsSettingsResult }) {
  const {
    agentsSettings,
    agentsSettingsLoading,
    agentsSettingsError,
    agentsSettingsNotice,
    agentsContentDraft,
    savingAgentsSettings,
    setAgentsContentDraft,
    saveAgentsSettings,
  } = agents;

  return (
    <>
      {agentsSettingsError ? (
        <div className="rounded border border-[rgba(255,90,90,.2)] bg-[var(--red-subtle)] px-3 py-2 text-[12px] text-[var(--red)]">
          {agentsSettingsError}
        </div>
      ) : null}
      {agentsSettingsNotice ? (
        <div className="rounded border border-[rgba(52,211,153,.2)] bg-[rgba(16,185,129,.08)] px-3 py-2 text-[12px] text-[#34d399]">
          {agentsSettingsNotice}
        </div>
      ) : null}

      <div className="rounded border border-[var(--border-subtle)] bg-[rgba(0,0,0,.12)] px-4 py-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--muted-dim)]">Default AGENTS.md</div>
            <div className="text-[12px] text-[var(--muted)] mt-1">
              Repo-attached container drones copy this into the repo root as `AGENTS.md`. Leave it blank to keep current behavior and inject nothing.
            </div>
            {agentsSettings?.agents.updatedAt ? (
              <div className="text-[11px] text-[var(--muted-dim)] mt-2">Updated {new Date(agentsSettings.agents.updatedAt).toLocaleString()}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void saveAgentsSettings()}
            disabled={savingAgentsSettings || agentsSettingsLoading}
            className={`h-9 rounded border px-4 text-[10px] font-semibold tracking-wide uppercase ${
              savingAgentsSettings || agentsSettingsLoading
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] text-[var(--muted-dim)]'
                : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {savingAgentsSettings ? 'Saving…' : 'Save'}
          </button>
        </div>

        {agentsSettingsLoading && !agentsSettings ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.03)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
            Loading AGENTS.md settings…
          </div>
        ) : null}

        <textarea
          value={agentsContentDraft}
          onChange={(event) => setAgentsContentDraft(event.target.value)}
          disabled={savingAgentsSettings}
          spellCheck={false}
          className="min-h-[320px] w-full rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-3 font-mono text-[12px] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
          placeholder={'# Repo agent instructions\n\nDescribe project-specific expectations, commands, and guardrails.'}
        />

        <div className="rounded border border-[var(--border-subtle)] bg-[rgba(255,255,255,.02)] px-3 py-3 text-[11px] text-[var(--muted-dim)]">
          Per-repo overrides live in the Repository modal, where each repo can inherit this default, replace it, or disable injection.
        </div>
      </div>
    </>
  );
}
