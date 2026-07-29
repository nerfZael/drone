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
    selectedAgentsFile,
    creatingAgentsFile,
    agentsFileDraftName,
    agentsFileDraftContent,
    agentsFileLoading,
    savingAgentsFile,
    deletingAgentsFile,
    importingAgentsFiles,
    agentsFileDraftDirty,
    setAgentsContentDraft,
    setAgentsFileDraftName,
    setAgentsFileDraftContent,
    saveAgentsSettings,
    selectAgentsFile,
    beginAgentsFile,
    closeAgentsFile,
    saveAgentsFile,
    deleteAgentsFile,
    importAgentsFiles,
  } = agents;
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const dragDepthRef = React.useRef(0);
  const [draggingFiles, setDraggingFiles] = React.useState(false);
  const files = agentsSettings?.files ?? [];
  const editorOpen = creatingAgentsFile || Boolean(selectedAgentsFile);
  const libraryBusy =
    agentsFileLoading || savingAgentsFile || deletingAgentsFile || importingAgentsFiles;

  const confirmDiscard = () =>
    !agentsFileDraftDirty || window.confirm('Discard unsaved changes to this AGENTS.md file?');

  const handleSelectFile = (fileId: string) => {
    if (selectedAgentsFile?.id === fileId || !confirmDiscard()) return;
    void selectAgentsFile(fileId);
  };

  const handleBeginFile = () => {
    if (!confirmDiscard()) return;
    beginAgentsFile();
  };

  const handleCloseFile = () => {
    if (!confirmDiscard()) return;
    closeAgentsFile();
  };

  const handleDeleteFile = () => {
    if (!selectedAgentsFile) return;
    if (!window.confirm(`Delete "${selectedAgentsFile.name}" from the AGENTS.md library?`)) return;
    void deleteAgentsFile();
  };

  const handleImportFiles = (incoming: FileList | File[]) => {
    const nextFiles = Array.from(incoming);
    if (nextFiles.length === 0 || !confirmDiscard()) return;
    void importAgentsFiles(nextFiles);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (libraryBusy || !Array.from(event.dataTransfer.types).includes('Files')) return;
    dragDepthRef.current += 1;
    setDraggingFiles(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDraggingFiles(false);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDraggingFiles(false);
    if (libraryBusy) return;
    handleImportFiles(event.dataTransfer.files);
  };

  return (
    <div className="flex flex-col gap-4">
      {agentsSettingsError ? (
        <div className="whitespace-pre-wrap rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)]">
          {agentsSettingsError}
        </div>
      ) : null}
      {agentsSettingsNotice ? (
        <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)]">
          {agentsSettingsNotice}
        </div>
      ) : null}

      <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-4 py-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Default AGENTS.md</div>
            <div className="text-[var(--text-12)] text-[var(--muted)] mt-1">
              Repo-attached container drones copy this into the repo root as `AGENTS.md`. Leave it blank to keep current behavior and inject nothing.
            </div>
            {agentsSettings?.agents.updatedAt ? (
              <div className="text-[var(--text-11)] text-[var(--muted-dim)] mt-2">Updated {new Date(agentsSettings.agents.updatedAt).toLocaleString()}</div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => void saveAgentsSettings()}
            disabled={savingAgentsSettings || agentsSettingsLoading}
            className={`h-9 rounded border px-4 text-[var(--text-10)] font-[var(--weight-semibold)] tracking-wide uppercase ${
              savingAgentsSettings || agentsSettingsLoading
                ? 'cursor-not-allowed border-[var(--border-subtle)] bg-[var(--surface-soft)] text-[var(--muted-dim)]'
                : 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-fg)] hover:brightness-110'
            }`}
            style={{ fontFamily: 'var(--display)' }}
          >
            {savingAgentsSettings ? 'Saving…' : 'Save'}
          </button>
        </div>

        {agentsSettingsLoading && !agentsSettings ? (
          <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-3 text-[var(--text-11)] text-[var(--muted-dim)]">
            Loading AGENTS.md settings…
          </div>
        ) : null}

        <textarea
          value={agentsContentDraft}
          onChange={(event) => setAgentsContentDraft(event.target.value)}
          disabled={savingAgentsSettings}
          spellCheck={false}
          className="min-h-[320px] w-full rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] px-3 py-3 font-mono text-[var(--text-12)] text-[var(--fg)] focus:outline-none focus:border-[var(--accent-muted)]"
          placeholder={'# Repo agent instructions\n\nDescribe project-specific expectations, commands, and guardrails.'}
        />

        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 text-[var(--text-11)] text-[var(--muted-dim)]">
          Per-repo overrides live in the Repository modal, where each repo can inherit this default, replace it, or disable injection.
        </div>
      </div>

      <div className="rounded border border-[var(--border-subtle)] bg-[var(--settings-section-bg)] px-4 py-4 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
              Saved AGENTS.md files
            </div>
            <div className="mt-1 text-[var(--text-12)] text-[var(--muted)]">
              Keep named instruction files here, then select one while creating a repo-attached
              container drone. Each file is limited to 2 MiB.
            </div>
          </div>
          <button
            type="button"
            onClick={handleBeginFile}
            disabled={libraryBusy}
            className="h-9 shrink-0 rounded border border-[var(--border)] bg-[var(--surface-soft)] px-4 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--fg-secondary)] hover:bg-[var(--hover)] disabled:cursor-not-allowed disabled:opacity-50"
            style={{ fontFamily: 'var(--display)' }}
          >
            New file
          </button>
        </div>

        <div
          role="button"
          tabIndex={libraryBusy ? -1 : 0}
          aria-label="Import AGENTS.md files"
          onClick={() => {
            if (!libraryBusy) fileInputRef.current?.click();
          }}
          onKeyDown={(event) => {
            if (!libraryBusy && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          onDragEnter={handleDragEnter}
          onDragOver={(event) => {
            event.preventDefault();
            if (!libraryBusy) event.dataTransfer.dropEffect = 'copy';
          }}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`rounded border border-dashed px-4 py-4 text-center transition-colors ${
            draggingFiles
              ? 'border-[var(--accent)] bg-[var(--accent-subtle)] text-[var(--accent)]'
              : 'border-[var(--border)] bg-[var(--surface-softest)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:bg-[var(--hover)]'
          } ${libraryBusy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            disabled={libraryBusy}
            className="hidden"
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              if (event.target.files) handleImportFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <div className="text-[var(--text-11)] font-[var(--weight-semibold)] text-[var(--fg-secondary)]">
            {importingAgentsFiles
              ? 'Importing AGENTS.md files…'
              : draggingFiles
                ? 'Drop files to import'
                : 'Drop Markdown or text files here'}
          </div>
          <div className="mt-1 text-[var(--text-10)] text-[var(--muted-dim)]">
            Or click to choose one or more .md, .markdown, or .txt files from your desktop.
          </div>
        </div>

        <div className="grid min-h-[360px] grid-cols-1 gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-2">
            {files.length > 0 ? (
              <div className="flex flex-col gap-1">
                {files.map((file) => {
                  const active = selectedAgentsFile?.id === file.id;
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => handleSelectFile(file.id)}
                      disabled={libraryBusy}
                      className={`rounded px-3 py-2 text-left transition-colors ${
                        active
                          ? 'bg-[var(--accent-subtle)] text-[var(--accent)]'
                          : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)]'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <span className="block truncate text-[var(--text-12)] font-[var(--weight-semibold)]">
                        {file.name}
                      </span>
                      <span className="mt-0.5 block text-[var(--text-10)] text-[var(--muted-dim)]">
                        {file.sizeBytes === 0
                          ? '0 bytes'
                          : `${Math.ceil(file.sizeBytes / 1024).toLocaleString()} KiB`}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-2 py-3 text-[var(--text-11)] text-[var(--muted-dim)]">
                No saved files yet.
              </div>
            )}
          </div>

          <div className="rounded border border-[var(--border-subtle)] bg-[var(--panel-raised)] p-3">
            {agentsFileLoading ? (
              <div className="text-[var(--text-11)] text-[var(--muted-dim)]">
                Loading AGENTS.md file…
              </div>
            ) : editorOpen ? (
              <div className="flex h-full flex-col gap-3">
                <div className="flex items-end gap-2">
                  <label className="min-w-0 flex-1">
                    <span className="mb-1 block text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-[0.08em] text-[var(--muted-dim)]">
                      Name
                    </span>
                    <input
                      value={agentsFileDraftName}
                      onChange={(event) => setAgentsFileDraftName(event.target.value)}
                      disabled={libraryBusy}
                      maxLength={80}
                      className="h-9 w-full rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 text-[var(--text-12)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
                      placeholder="Backend work"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleCloseFile}
                    disabled={libraryBusy}
                    className="h-9 rounded border border-[var(--border-subtle)] px-3 text-[var(--text-10)] uppercase tracking-wide text-[var(--muted)] hover:bg-[var(--hover)] disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
                <textarea
                  value={agentsFileDraftContent}
                  onChange={(event) => setAgentsFileDraftContent(event.target.value)}
                  disabled={libraryBusy}
                  spellCheck={false}
                  aria-label="Saved AGENTS.md content"
                  className="min-h-[260px] flex-1 resize-y rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] px-3 py-3 font-mono text-[var(--text-12)] text-[var(--fg)] focus:border-[var(--accent-muted)] focus:outline-none disabled:opacity-50"
                  placeholder="# Instructions for this kind of drone"
                />
                <div className="flex items-center justify-between gap-3">
                  <div>
                    {selectedAgentsFile ? (
                      <button
                        type="button"
                        onClick={handleDeleteFile}
                        disabled={libraryBusy}
                        className="h-9 rounded border border-[var(--red-border)] px-3 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--red)] hover:bg-[var(--red-subtle)] disabled:opacity-50"
                      >
                        {deletingAgentsFile ? 'Deleting…' : 'Delete'}
                      </button>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => void saveAgentsFile()}
                    disabled={libraryBusy || !agentsFileDraftName.trim()}
                    className="h-9 rounded border border-[var(--accent)] bg-[var(--accent)] px-4 text-[var(--text-10)] font-[var(--weight-semibold)] uppercase tracking-wide text-[var(--accent-fg)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {savingAgentsFile ? 'Saving…' : creatingAgentsFile ? 'Add file' : 'Save file'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex h-full min-h-[330px] items-center justify-center px-6 text-center text-[var(--text-12)] text-[var(--muted-dim)]">
                Select a saved file to edit it, or create a new one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
