import React from 'react';
import type { WhiteboardSummary } from './whiteboard-types';
import { useWhiteboardState } from './use-whiteboard-state';
import { WhiteboardCanvas } from './WhiteboardCanvas';

function whiteboardLabel(item: WhiteboardSummary): string {
  const title = String(item.title ?? '').trim() || item.id;
  return item.id === 'main' ? `${title} - main` : title;
}

export function WhiteboardDock() {
  const {
    whiteboards,
    activeId,
    document,
    editorKey,
    loading,
    saving,
    dirty,
    error,
    notice,
    activeInitialData,
    loadDocument,
    handleChange,
    handleCreate,
  } = useWhiteboardState();

  return (
    <div className="w-full h-full min-h-0 bg-[var(--panel-alt)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 border-b border-[var(--border)] bg-[var(--surface-soft)] px-2.5 py-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--muted)]" style={{ fontFamily: 'var(--display)' }}>
            Whiteboard
          </div>
          <div className="mt-1 flex items-center gap-2">
            <select
              value={activeId}
              disabled={loading || whiteboards.length === 0}
              onChange={(event) => void loadDocument(event.target.value)}
              className="min-w-0 max-w-full flex-1 rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--panel)] px-2 py-1 text-[var(--text-12)] text-[var(--fg)] outline-none focus:border-[var(--accent-muted)]"
              aria-label="Select whiteboard"
            >
              {whiteboards.map((item) => (
                <option key={item.id} value={item.id}>
                  {whiteboardLabel(item)}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={loading}
              className="rounded-[var(--radius-medium)] border border-[var(--border-subtle)] bg-[var(--panel)] px-2.5 py-1 text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:opacity-50"
            >
              New
            </button>
          </div>
        </div>
        <div className="w-[82px] text-right text-[var(--text-10)] text-[var(--muted-dim)]" aria-live="polite">
          {saving ? 'Saving...' : dirty ? 'Unsaved' : loading ? 'Loading...' : `v${document?.version ?? 0}`}
        </div>
      </div>
      {error || notice ? (
        <div className={`flex-shrink-0 border-b px-3 py-2 text-[var(--text-11)] ${error ? 'border-[var(--red-border)] bg-[var(--red-subtle)] text-[var(--red)]' : 'border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted)]'}`}>
          {error ?? notice}
        </div>
      ) : null}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {loading && !document ? (
          <div className="absolute inset-0 flex items-center justify-center text-[var(--text-12)] text-[var(--muted)]">Loading whiteboard...</div>
        ) : document ? (
          <WhiteboardCanvas
            key={`${document.id}:${editorKey}`}
            initialData={activeInitialData}
            onChange={handleChange}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[var(--text-12)] text-[var(--muted)]">
            No whiteboard is available.
          </div>
        )}
      </div>
    </div>
  );
}
