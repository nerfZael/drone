import React from 'react';

import type { AgentsMdFileSummary } from './settings-types';

type AgentsMdCreateSelectorProps = {
  runtime: 'container' | 'host';
  repoPath: string;
  files: AgentsMdFileSummary[];
  loading: boolean;
  error: string | null;
  selectedFileId: string;
  customOverrideEnabled: boolean;
  customOverride: string;
  onSelectedFileIdChange: (fileId: string) => void;
  onCustomOverrideEnabledChange: (enabled: boolean) => void;
  onCustomOverrideChange: (content: string) => void;
  disabled: boolean;
  scopeLabel: 'this drone' | 'these drones';
  className?: string;
};

export function AgentsMdCreateSelector({
  runtime,
  repoPath,
  files,
  loading,
  error,
  selectedFileId,
  customOverrideEnabled,
  customOverride,
  onSelectedFileIdChange,
  onCustomOverrideEnabledChange,
  onCustomOverrideChange,
  disabled,
  scopeLabel,
  className = '',
}: AgentsMdCreateSelectorProps) {
  if (!repoPath) return null;

  const selection = customOverrideEnabled
    ? 'custom'
    : selectedFileId
      ? `file:${selectedFileId}`
      : 'inherit';
  const selectedFile = files.find((file) => file.id === selectedFileId) ?? null;
  const unavailableSelection = Boolean(selectedFileId && !selectedFile);
  const controlsDisabled = disabled || runtime !== 'container';

  const handleSelectionChange = (value: string) => {
    if (value === 'custom') {
      onSelectedFileIdChange('');
      onCustomOverrideEnabledChange(true);
      return;
    }
    onCustomOverrideEnabledChange(false);
    onSelectedFileIdChange(value.startsWith('file:') ? value.slice('file:'.length) : '');
  };

  return (
    <section className={className}>
      <label className="block">
        <span className="mb-1 block text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
          AGENTS.md
        </span>
        <select
          value={selection}
          onChange={(event) => handleSelectionChange(event.target.value)}
          disabled={controlsDisabled}
          aria-label="AGENTS.md source"
          className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-11)] text-[var(--fg-secondary)] focus:border-[var(--accent-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="inherit">Use repository/default instructions</option>
          {files.length > 0 ? (
            <optgroup label="Saved files">
              {files.map((file) => (
                <option key={file.id} value={`file:${file.id}`}>
                  {file.name}
                </option>
              ))}
            </optgroup>
          ) : null}
          {unavailableSelection ? (
            <option value={`file:${selectedFileId}`}>Unavailable saved file</option>
          ) : null}
          <option value="custom">Custom override…</option>
        </select>
      </label>

      <p className="mt-1.5 text-[var(--text-10)] text-[var(--muted-dim)]">
        {runtime !== 'container'
          ? 'AGENTS.md selection is available for container drones only; host drones use the repository’s existing file.'
          : error
            ? `Saved AGENTS.md files could not be loaded: ${error}`
            : loading
              ? 'Loading saved AGENTS.md files…'
              : customOverrideEnabled
                ? `Uses a one-off override for ${scopeLabel}. Leave it empty to create an empty file. Maximum 2 MiB.`
                : selectedFile
                  ? `Uses the saved “${selectedFile.name}” file for ${scopeLabel}.`
                  : 'Uses the AGENTS.md configured for this repository, falling back to the default in Settings.'}
      </p>

      {runtime === 'container' && customOverrideEnabled ? (
        <textarea
          value={customOverride}
          onChange={(event) => onCustomOverrideChange(event.target.value)}
          disabled={disabled}
          className="mt-2 min-h-[8rem] w-full resize-y rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-2 font-mono text-[var(--text-11)] text-[var(--fg)] placeholder:text-[var(--muted-dim)] focus:border-[var(--accent-muted)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          placeholder={`# Instructions for ${scopeLabel}`}
          aria-label="AGENTS.md override content"
          spellCheck={false}
        />
      ) : null}
    </section>
  );
}
