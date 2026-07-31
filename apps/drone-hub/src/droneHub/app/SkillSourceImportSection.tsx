import React from 'react';

import {
  SettingsDetail,
  SettingsEmptyState,
  SettingsList,
  SettingsListRow,
  SettingsSection,
  SettingsSplitView,
} from './SettingsSurface';
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
    <SettingsSection
      compact
      title="Import from GitHub"
      actions={(
        <button
          type="button"
          onClick={() => void refreshSkillSources()}
          disabled={skillSourcesLoading || sourceSkillsLoading}
          className={buttonClassName('secondary', skillSourcesLoading || sourceSkillsLoading)}
          style={{ fontFamily: 'var(--display)' }}
        >
          {skillSourcesLoading || sourceSkillsLoading ? 'Refreshing…' : 'Refresh sources'}
        </button>
      )}
    >

      <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-3">
        <label className="flex flex-col gap-1">
          <span className="dh-type-label">Source repo</span>
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
          <span className="dh-type-label">Search candidates</span>
          <input
            value={sourceSkillSearch}
            onChange={(e) => setSourceSkillSearch(e.target.value)}
            className={inputClassName()}
            placeholder="Search by name, description, path, or plugin"
          />
        </label>
      </div>

      <SettingsSplitView className="xl:grid-cols-[300px_minmax(0,1fr)]">
        <SettingsList className="max-h-[420px] overflow-y-auto">
          <div className="mb-1 flex items-center justify-between gap-2 px-2">
            <span className="dh-type-label">Source skills</span>
            <span className="dh-type-menu-meta">{filteredSourceSkills.length}</span>
          </div>
          <div className="flex flex-col gap-0.5 pr-1">
            {sourceSkillsLoading ? (
              <SettingsEmptyState>Loading source skills…</SettingsEmptyState>
            ) : filteredSourceSkills.length === 0 ? (
              <SettingsEmptyState>
                {skillSources.length === 0 ? 'No curated sources configured.' : 'No source skills match the current filters.'}
              </SettingsEmptyState>
            ) : (
              filteredSourceSkills.map((candidate) => {
                const active = selectedSourcePreviewPath === candidate.path;
                return (
                  <SettingsListRow
                    key={candidate.id}
                    selected={active}
                    title={candidate.name}
                    detail={candidate.path}
                    meta={(
                      <span className={`rounded px-1.5 py-0.5 dh-type-badge ${importStatusClassName(candidate.importStatus)}`}>
                        {candidate.importStatus === 'importable_with_loss' ? 'Lossy' : candidate.importStatus === 'not_importable' ? 'Blocked' : 'Ready'}
                      </span>
                    )}
                    onClick={() => void previewSourceSkill(candidate)}
                  />
                );
              })
            )}
          </div>
        </SettingsList>

        <SettingsDetail className="flex flex-col gap-4">
          {sourceSkillPreviewLoading ? (
            <SettingsEmptyState>Loading preview…</SettingsEmptyState>
          ) : !sourceSkillPreview ? (
            <SettingsEmptyState>Select a source skill to preview it.</SettingsEmptyState>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)] truncate">{sourceSkillPreview.candidate.name}</div>
                  <div className="mt-1 break-all font-mono dh-type-supporting">{sourceSkillPreview.candidate.path}</div>
                  <div className="mt-2 dh-type-supporting">{sourceSkillPreview.candidate.description}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className={`px-2 py-1 rounded border text-[var(--text-10)] uppercase tracking-[0.08em] ${importStatusClassName(sourceSkillPreview.candidate.importStatus)}`}>
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
                <div className="border-l-2 border-[var(--yellow-border)] py-1 pl-3 dh-type-supporting !text-[var(--muted)]">
                  {sourceSkillPreview.candidate.importReason}
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:divide-x md:divide-[var(--border-subtle)]">
                <div className="flex flex-col gap-2 md:pr-4">
                  <div className="dh-type-label">Normalized import</div>
                  <div className="dh-type-supporting">Slug: <span className="font-mono text-[var(--fg-secondary)]">{sourceSkillPreview.normalized.slug}</span></div>
                  <div className="dh-type-supporting">Compatibility: {sourceSkillPreview.normalized.compatibility}</div>
                  <div className="dh-type-supporting">Files carried over: {sourceSkillPreview.normalized.files.length}</div>
                  <div className="dh-type-supporting">Metadata entries: {Object.keys(sourceSkillPreview.normalized.metadata ?? {}).length}</div>
                </div>
                <div className="flex flex-col gap-2 md:pl-4">
                  <div className="dh-type-label">Source snapshot</div>
                  <div className="dh-type-supporting">Commit: <span className="font-mono text-[var(--fg-secondary)]">{sourceSkillPreview.sourceCommit}</span></div>
                  <div className="dh-type-supporting">Package files available for review: {previewFileCount}</div>
                  <div className="dh-type-supporting">
                    {sourceSkillPreview.candidate.pluginName ? `${sourceSkillPreview.candidate.pluginName} • ` : ''}
                    {sourceSkillPreview.candidate.license ?? 'No license field'}
                  </div>
                </div>
              </div>

              <SettingsSplitView className="border-t border-[var(--border-subtle)] pt-4 xl:grid-cols-[220px_minmax(0,1fr)]">
                <SettingsList>
                  <div className="px-1 dh-type-label">Package files</div>
                  <div className="flex flex-col gap-1 max-h-[320px] overflow-y-auto pr-1">
                    {sourceSkillPreview.files.map((file) => {
                      const active = selectedSourcePreviewFile?.path === file.path;
                      return (
                        <button
                          key={file.path}
                          type="button"
                          onClick={() => selectSourcePreviewFile(file.path)}
                          className={`w-full text-left rounded-[var(--radius-medium)] border-l-2 px-2.5 py-2 transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--selected)]'
                              : 'border-transparent hover:bg-[var(--hover)]'
                          }`}
                        >
                          <div className="text-[var(--text-11)] text-[var(--fg-secondary)] font-mono break-all">{file.path}</div>
                          <div className="text-[var(--text-10)] text-[var(--muted-dim)] mt-1 uppercase tracking-[0.08em]">{file.kind}</div>
                        </button>
                      );
                    })}
                  </div>
                </SettingsList>

                <SettingsDetail className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="dh-type-label">Selected file</div>
                    <div className="text-[var(--text-10)] text-[var(--muted-dim)] font-mono break-all">{selectedSourcePreviewFile?.path ?? 'None'}</div>
                  </div>
                  <textarea
                    readOnly
                    value={selectedSourcePreviewFile?.content ?? ''}
                    className={`${textareaClassName()} min-h-[320px]`}
                  />
                </SettingsDetail>
              </SettingsSplitView>
            </>
          )}
        </SettingsDetail>
      </SettingsSplitView>
    </SettingsSection>
  );
}
