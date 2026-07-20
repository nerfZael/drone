import React from 'react';

import { buttonClassName, importStatusClassName, inputClassName, textareaClassName } from './skill-library-ui';
import type { UseSkillLibraryResult } from './use-skill-library';

type SkillSourceImportSectionProps = Pick<
  UseSkillLibraryResult,
  | 'skillSources'
  | 'filteredSourceSkills'
  | 'skillSourcesLoading'
  | 'sourceSkillsLoading'
  | 'sourceSkillPreview'
  | 'sourceSkillPreviewLoading'
  | 'sourceSkillSearch'
  | 'selectedSourceId'
  | 'selectedSourcePreviewPath'
  | 'selectedSourcePreviewFile'
  | 'importingSourceSkillId'
  | 'skillsSaving'
  | 'skillsDeleting'
  | 'selectSource'
  | 'previewSourceSkill'
  | 'selectSourcePreviewFile'
  | 'refreshSkillSources'
  | 'setSourceSkillSearch'
  | 'importSourceSkill'
> & {
  draftDirty: boolean;
};

export function SkillSourceImportSection({
  skillSources,
  filteredSourceSkills,
  skillSourcesLoading,
  sourceSkillsLoading,
  sourceSkillPreview,
  sourceSkillPreviewLoading,
  sourceSkillSearch,
  selectedSourceId,
  selectedSourcePreviewPath,
  selectedSourcePreviewFile,
  importingSourceSkillId,
  skillsSaving,
  skillsDeleting,
  draftDirty,
  selectSource,
  previewSourceSkill,
  selectSourcePreviewFile,
  refreshSkillSources,
  setSourceSkillSearch,
  importSourceSkill,
}: SkillSourceImportSectionProps) {
  const handleImportCandidate = React.useCallback(
    (candidate: (typeof filteredSourceSkills)[number]) => {
      if (candidate.importStatus !== 'importable') return;
      if (draftDirty) {
        const ok = window.confirm('Discard unsaved skill edits and import this skill?');
        if (!ok) return;
      }
      void importSourceSkill(candidate);
    },
    [draftDirty, filteredSourceSkills, importSourceSkill],
  );

  const previewFileCount = sourceSkillPreview?.files.length ?? 0;

  return (
    <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold text-[var(--muted-dim)] tracking-[0.08em] uppercase" style={{ fontFamily: 'var(--display)' }}>
            Import from GitHub
          </div>
          <div className="text-[11px] text-[var(--muted-dim)] mt-1 leading-relaxed">
            Browse the curated allowlist, then import only skills the Hub can normalize into the portable library format.
          </div>
        </div>
        <button
          type="button"
          onClick={() => void refreshSkillSources()}
          disabled={skillSourcesLoading || sourceSkillsLoading}
          className={buttonClassName('secondary', skillSourcesLoading || sourceSkillsLoading)}
          style={{ fontFamily: 'var(--display)' }}
        >
          {skillSourcesLoading || sourceSkillsLoading ? 'Refreshing…' : 'Refresh sources'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Source repo</span>
          <select
            value={selectedSourceId ?? ''}
            onChange={(e) => selectSource(e.target.value || null)}
            className={inputClassName()}
            disabled={skillSourcesLoading || skillSources.length === 0}
          >
            {skillSources.length === 0 ? (
              <option value="">No sources</option>
            ) : (
              skillSources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Search candidates</span>
          <input
            value={sourceSkillSearch}
            onChange={(e) => setSourceSkillSearch(e.target.value)}
            className={inputClassName()}
            placeholder="Search by name, description, path, or plugin"
          />
        </label>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-3 min-w-0">
        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-2 flex flex-col gap-2 min-w-0">
          <div className="flex items-center justify-between gap-2 px-1">
            <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]" style={{ fontFamily: 'var(--display)' }}>
              Source skills
            </div>
            <div className="text-[10px] text-[var(--muted-dim)]">{filteredSourceSkills.length}</div>
          </div>
          <div className="flex flex-col gap-2 max-h-[420px] overflow-y-auto pr-1">
            {sourceSkillsLoading ? (
              <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                Loading source skills…
              </div>
            ) : filteredSourceSkills.length === 0 ? (
              <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-4 text-[11px] text-[var(--muted-dim)]">
                {skillSources.length === 0 ? 'No curated sources configured.' : 'No source skills match the current filters.'}
              </div>
            ) : (
              filteredSourceSkills.map((candidate) => {
                const active = selectedSourcePreviewPath === candidate.path;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    onClick={() => void previewSourceSkill(candidate)}
                    className={`w-full text-left rounded border px-3 py-3 flex flex-col gap-2 transition-colors ${
                      active
                        ? 'border-[var(--accent)] bg-[var(--surface-soft)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-faint)] hover:bg-[var(--hover)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-[12px] text-[var(--fg-secondary)] font-medium truncate">{candidate.name}</div>
                        <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-1 break-all">{candidate.path}</div>
                      </div>
                      <div className={`px-2 py-1 rounded border text-[10px] uppercase tracking-[0.08em] ${importStatusClassName(candidate.importStatus)}`}>
                        {candidate.importStatus === 'importable_with_loss' ? 'Lossy' : candidate.importStatus === 'not_importable' ? 'Blocked' : 'Importable'}
                      </div>
                    </div>
                    <div className="text-[11px] text-[var(--muted-dim)] leading-relaxed">{candidate.description}</div>
                    <div className="text-[10px] text-[var(--muted-dim)]">
                      {candidate.pluginName ? `${candidate.pluginName} • ` : ''}
                      {candidate.slug}
                      {candidate.license ? ` • ${candidate.license}` : ''}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] p-3 flex flex-col gap-3 min-w-0">
          {sourceSkillPreviewLoading ? (
            <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-6 text-[11px] text-[var(--muted-dim)]">
              Loading preview…
            </div>
          ) : !sourceSkillPreview ? (
            <div className="rounded border border-dashed border-[var(--border-subtle)] px-3 py-6 text-[11px] text-[var(--muted-dim)]">
              Select a source skill to inspect its package contents and normalized import preview before importing.
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-semibold text-[var(--fg)] truncate">{sourceSkillPreview.candidate.name}</div>
                  <div className="text-[10px] text-[var(--muted-dim)] font-mono mt-1 break-all">{sourceSkillPreview.candidate.path}</div>
                  <div className="text-[11px] text-[var(--muted-dim)] mt-2 leading-relaxed">{sourceSkillPreview.candidate.description}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`px-2 py-1 rounded border text-[10px] uppercase tracking-[0.08em] ${importStatusClassName(sourceSkillPreview.candidate.importStatus)}`}>
                    {sourceSkillPreview.candidate.importStatus === 'importable_with_loss'
                      ? 'Lossy'
                      : sourceSkillPreview.candidate.importStatus === 'not_importable'
                        ? 'Blocked'
                        : 'Importable'}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleImportCandidate(sourceSkillPreview.candidate)}
                    disabled={
                      sourceSkillPreview.candidate.importStatus !== 'importable' ||
                      importingSourceSkillId === sourceSkillPreview.candidate.id ||
                      skillsSaving ||
                      skillsDeleting
                    }
                    className={buttonClassName(
                      'primary',
                      sourceSkillPreview.candidate.importStatus !== 'importable' ||
                        importingSourceSkillId === sourceSkillPreview.candidate.id ||
                        skillsSaving ||
                        skillsDeleting,
                    )}
                    style={{ fontFamily: 'var(--display)' }}
                  >
                    {importingSourceSkillId === sourceSkillPreview.candidate.id ? 'Importing…' : 'Import skill'}
                  </button>
                </div>
              </div>

              {sourceSkillPreview.candidate.importReason && (
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-2 text-[11px] text-[var(--muted-dim)]">
                  {sourceSkillPreview.candidate.importReason}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Normalized import</div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Slug: <span className="font-mono text-[var(--fg-secondary)]">{sourceSkillPreview.normalized.slug}</span></div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Compatibility: {sourceSkillPreview.normalized.compatibility}</div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Files carried over: {sourceSkillPreview.normalized.files.length}</div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Metadata entries: {Object.keys(sourceSkillPreview.normalized.metadata ?? {}).length}</div>
                </div>
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] px-3 py-3 flex flex-col gap-2">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Source snapshot</div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Commit: <span className="font-mono text-[var(--fg-secondary)]">{sourceSkillPreview.sourceCommit}</span></div>
                  <div className="text-[11px] text-[var(--muted-dim)]">Package files available for review: {previewFileCount}</div>
                  <div className="text-[11px] text-[var(--muted-dim)]">
                    {sourceSkillPreview.candidate.pluginName ? `${sourceSkillPreview.candidate.pluginName} • ` : ''}
                    {sourceSkillPreview.candidate.license ?? 'No license field'}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[220px_minmax(0,1fr)] gap-3 min-w-0">
                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-2 flex flex-col gap-2 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)] px-1">Package files</div>
                  <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto pr-1">
                    {sourceSkillPreview.files.map((file) => {
                      const active = selectedSourcePreviewFile?.path === file.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => selectSourcePreviewFile(file.path)}
                          className={`w-full text-left rounded border px-3 py-2 transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--surface-soft)]'
                              : 'border-[var(--border-subtle)] bg-[var(--surface-faint)] hover:bg-[var(--hover)]'
                          }`}
                        >
                          <div className="text-[11px] text-[var(--fg-secondary)] font-mono break-all">{file.path}</div>
                          <div className="text-[10px] text-[var(--muted-dim)] mt-1 uppercase tracking-[0.08em]">{file.kind}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded border border-[var(--border-subtle)] bg-[var(--surface-softest)] p-3 flex flex-col gap-2 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-[10px] uppercase tracking-[0.08em] text-[var(--muted-dim)]">Selected file</div>
                    <div className="text-[10px] text-[var(--muted-dim)] font-mono break-all">{selectedSourcePreviewFile?.path ?? 'None'}</div>
                  </div>
                  <textarea
                    readOnly
                    value={selectedSourcePreviewFile?.content ?? ''}
                    className={`${textareaClassName()} min-h-[320px]`}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
