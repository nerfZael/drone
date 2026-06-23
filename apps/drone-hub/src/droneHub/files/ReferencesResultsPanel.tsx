import React from 'react';
import {
  languageLocationName,
  openLanguageLocationInEditor,
  type OpenLanguageTarget,
} from './editor-language-commands';
import type { LanguageLocation } from './language-intelligence-api';

export type ReferencesResultsState = {
  open: boolean;
  loading: boolean;
  error: string | null;
  references: LanguageLocation[];
  truncated: boolean;
};

type ReferencesResultsPanelProps = {
  state: ReferencesResultsState;
  onOpenReference: OpenLanguageTarget;
  onClose: () => void;
};

function compactPathLabel(path: string): string {
  const normalized = String(path ?? '').replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 3) return normalized || 'File';
  return `.../${parts.slice(-3).join('/')}`;
}

export function ReferencesResultsPanel({
  state,
  onOpenReference,
  onClose,
}: ReferencesResultsPanelProps) {
  if (!state.open) return null;
  const count = state.references.length;
  return (
    <div className="border-t border-[var(--border-subtle)] bg-[rgba(0,0,0,.18)]">
      <div className="h-9 px-3 flex items-center justify-between gap-3 border-b border-[var(--border-subtle)]">
        <div className="min-w-0 text-[11px] font-semibold text-[var(--fg-secondary)]">
          {state.loading ? 'Finding references...' : `${count} reference${count === 1 ? '' : 's'}`}
          {state.truncated ? <span className="ml-1 text-[var(--muted)]">(limited)</span> : null}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="h-6 px-2 rounded border border-[var(--border-subtle)] text-[10px] font-semibold text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg-secondary)]"
        >
          Close
        </button>
      </div>
      {state.error ? (
        <div className="px-3 py-2 text-[11px] text-[var(--red)] bg-[var(--red-subtle)]">
          {state.error}
        </div>
      ) : state.loading ? (
        <div className="px-3 py-3 text-[11px] text-[var(--muted)]">Searching project...</div>
      ) : count === 0 ? (
        <div className="px-3 py-3 text-[11px] text-[var(--muted)]">No references found.</div>
      ) : (
        <div className="max-h-[220px] overflow-auto py-1">
          {state.references.map((reference, index) => (
            <button
              key={`${reference.path}:${reference.line}:${reference.column}:${index}`}
              type="button"
              onClick={() => openLanguageLocationInEditor(reference, onOpenReference)}
              className="w-full px-3 py-1.5 text-left hover:bg-[var(--hover)] focus:bg-[var(--hover)] focus:outline-none"
              title={`${reference.path}:${reference.line}:${reference.column}`}
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="shrink-0 text-[10px] font-mono text-[var(--accent)]">
                  {reference.line}:{reference.column}
                </span>
                <span className="min-w-0 truncate text-[11px] font-medium text-[var(--fg-secondary)]">
                  {compactPathLabel(reference.path)}
                </span>
                <span className="shrink-0 text-[10px] text-[var(--muted)]">
                  {languageLocationName(reference)}
                </span>
              </div>
              {reference.preview ? (
                <div className="mt-0.5 truncate pl-[46px] font-mono text-[10px] text-[var(--muted)]">
                  {reference.preview}
                </div>
              ) : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
