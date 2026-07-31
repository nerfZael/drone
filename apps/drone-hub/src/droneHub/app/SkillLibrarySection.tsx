import React from 'react';
import { SKILL_FILE_KIND_OPTIONS, type SkillFileDraft, type SkillFileKind } from './skill-library-model';
import { SkillSourceImportSection } from './SkillSourceImportSection';
import {
  SettingsDetail,
  SettingsEmptyState,
  SettingsList,
  SettingsListRow,
  SettingsSection,
  SettingsSplitView,
} from './SettingsSurface';
import { buttonClassName, inputClassName, textareaClassName } from './skill-library-ui';
import type { UseSkillLibraryResult } from './use-skill-library';

export function SkillLibrarySection({ skillLibrary }: { skillLibrary: UseSkillLibraryResult }) {
  const {
    skills,
    skillsSaving,
    skillsDeleting,
    skillsError,
    skillsNotice,
    selectedSkillId,
    draft,
    draftDirty,
    selectSkill,
    updateDraftField,
    appendDraftFile,
    updateDraftFile,
    removeDraftFile,
    startNewSkill,
    saveDraft,
    deleteSelectedSkill,
    resetDraft,
    clearSkillsError,
    clearSkillsNotice,
  } = skillLibrary;

  const fileCountLabel = `${draft.files.length} ${draft.files.length === 1 ? 'file' : 'files'}`;

  const handleSelectSkill = React.useCallback(
    (skillId: string) => {
      if (selectedSkillId === skillId) return;
      if (draftDirty) {
        const ok = window.confirm('Discard unsaved skill edits?');
        if (!ok) return;
      }
      selectSkill(skillId);
    },
    [draftDirty, selectSkill, selectedSkillId],
  );

  const handleCreateNew = React.useCallback(() => {
    if (draftDirty) {
      const ok = window.confirm('Discard unsaved skill edits and start a new skill?');
      if (!ok) return;
    }
    startNewSkill();
  }, [draftDirty, startNewSkill]);

  const handleReset = React.useCallback(() => {
    if (!draftDirty) return;
    const ok = window.confirm('Discard unsaved changes?');
    if (!ok) return;
    resetDraft();
  }, [draftDirty, resetDraft]);

  const handleDelete = React.useCallback(() => {
    if (!draft.id) return;
    const label = draft.name.trim() || draft.slug.trim() || 'this skill';
    const ok = window.confirm(`Delete ${label}?`);
    if (!ok) return;
    void deleteSelectedSkill();
  }, [deleteSelectedSkill, draft.id, draft.name, draft.slug]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      {(skillsError || skillsNotice) && (
        <div className="flex flex-col gap-2">
          {skillsError && (
            <div className="rounded border border-[var(--red-border)] bg-[var(--red-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--red)] flex items-center justify-between gap-3">
              <span>{skillsError}</span>
              <button type="button" onClick={clearSkillsError} className="text-[var(--text-10)] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
          {skillsNotice && (
            <div className="rounded border border-[var(--green-border)] bg-[var(--green-subtle)] px-3 py-2 text-[var(--text-12)] text-[var(--green)] flex items-center justify-between gap-3">
              <span>{skillsNotice}</span>
              <button type="button" onClick={clearSkillsNotice} className="text-[var(--text-10)] uppercase tracking-wide opacity-80 hover:opacity-100">
                Dismiss
              </button>
            </div>
          )}
        </div>
      )}

      <SkillSourceImportSection
        skillSources={skillLibrary.skillSources}
        filteredSourceSkills={skillLibrary.filteredSourceSkills}
        skillSourcesLoading={skillLibrary.skillSourcesLoading}
        sourceSkillsLoading={skillLibrary.sourceSkillsLoading}
        sourceSkillPreview={skillLibrary.sourceSkillPreview}
        sourceSkillPreviewLoading={skillLibrary.sourceSkillPreviewLoading}
        sourceSkillSearch={skillLibrary.sourceSkillSearch}
        selectedSourceId={skillLibrary.selectedSourceId}
        selectedSourcePreviewPath={skillLibrary.selectedSourcePreviewPath}
        selectedSourcePreviewFile={skillLibrary.selectedSourcePreviewFile}
        importingSourceSkillId={skillLibrary.importingSourceSkillId}
        skillsSaving={skillLibrary.skillsSaving}
        skillsDeleting={skillLibrary.skillsDeleting}
        draftDirty={draftDirty}
        selectSource={skillLibrary.selectSource}
        previewSourceSkill={skillLibrary.previewSourceSkill}
        selectSourcePreviewFile={skillLibrary.selectSourcePreviewFile}
        refreshSkillSources={skillLibrary.refreshSkillSources}
        setSourceSkillSearch={skillLibrary.setSourceSkillSearch}
        importSourceSkill={skillLibrary.importSourceSkill}
      />

      <SettingsSection
        title="Skills"
        actions={(
          <>
            <span className="mr-1 dh-type-menu-meta">{skills.length}</span>
            <button type="button" onClick={handleCreateNew} disabled={skillsSaving || skillsDeleting} className={buttonClassName('secondary', skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
              New skill
            </button>
            <button type="button" onClick={() => void saveDraft()} disabled={skillsSaving || skillsDeleting} className={buttonClassName('primary', skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
              {skillsSaving ? 'Saving…' : draft.id ? 'Save skill' : 'Create skill'}
            </button>
          </>
        )}
      >
        <SettingsSplitView>
          <SettingsList className="max-h-[70vh] overflow-y-auto">
            <div className="flex flex-col gap-0.5 pr-1">
              {skills.length === 0 ? (
                <SettingsEmptyState>No skills yet.</SettingsEmptyState>
              ) : (
                skills.map((skill) => {
                  const active = skill.id === selectedSkillId;
                  return (
                    <SettingsListRow
                      key={skill.id}
                      selected={active}
                      title={skill.name}
                      detail={skill.slug}
                      onClick={() => handleSelectSkill(skill.id)}
                    />
                  );
                })
              )}
            </div>
          </SettingsList>

        <SettingsDetail className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="text-[var(--text-13)] font-[var(--weight-semibold)] text-[var(--fg)] truncate">{draft.id ? draft.name || 'Untitled skill' : 'New skill draft'}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className={`text-[var(--text-10)] uppercase tracking-[0.08em] ${draftDirty ? 'text-[var(--accent)]' : 'text-[var(--muted-dim)]'}`}>
                {draftDirty ? 'Unsaved changes' : 'Saved'}
              </div>
              <button type="button" onClick={handleReset} disabled={!draftDirty || skillsSaving || skillsDeleting} className={buttonClassName('secondary', !draftDirty || skillsSaving || skillsDeleting)} style={{ fontFamily: 'var(--display)' }}>
                Revert
              </button>
              <button type="button" onClick={handleDelete} disabled={!draft.id || skillsDeleting || skillsSaving} className={buttonClassName('danger', !draft.id || skillsDeleting || skillsSaving)} style={{ fontFamily: 'var(--display)' }}>
                {skillsDeleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="dh-type-label">Name</span>
              <input value={draft.name} onChange={(e) => updateDraftField('name', e.target.value)} className={inputClassName()} placeholder="Repo Review" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="dh-type-label">Slug</span>
              <input value={draft.slug} onChange={(e) => updateDraftField('slug', e.target.value)} className={`${inputClassName()} font-mono`} placeholder="repo-review" />
            </label>
            <label className="md:col-span-2 flex flex-col gap-1">
              <span className="dh-type-label">Description</span>
              <input value={draft.description} onChange={(e) => updateDraftField('description', e.target.value)} className={inputClassName()} placeholder="Short description used for skill discovery." />
            </label>
            <label className="flex flex-col gap-1">
              <span className="dh-type-label">License</span>
              <input value={draft.license} onChange={(e) => updateDraftField('license', e.target.value)} className={inputClassName()} placeholder="MIT" />
            </label>
            <label className="flex flex-col gap-1">
              <span className="dh-type-label">Compatibility</span>
              <input value={draft.compatibility} onChange={(e) => updateDraftField('compatibility', e.target.value)} className={inputClassName()} placeholder="codex,claude,cursor,opencode,pi" />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="dh-type-label">Skill body</span>
            <textarea
              value={draft.markdownBody}
              onChange={(e) => updateDraftField('markdownBody', e.target.value)}
              className={`${textareaClassName()} min-h-[180px]`}
              placeholder="Write the Markdown body that will be stored under SKILL.md after the YAML frontmatter."
            />
          </label>

          <SettingsSection compact title="Package files" description="SKILL.md is generated automatically." actions={<span className="dh-type-menu-meta">{fileCountLabel}</span>}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {SKILL_FILE_KIND_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => appendDraftFile(option.value)}
                    className={buttonClassName('secondary')}
                    style={{ fontFamily: 'var(--display)' }}
                    title={`Add ${option.label.toLowerCase()} file`}
                  >
                    Add {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-3">
              {draft.files.length === 0 ? (
                <SettingsEmptyState className="text-left">No extra files.</SettingsEmptyState>
              ) : (
                draft.files.map((file: SkillFileDraft) => {
                  const option = SKILL_FILE_KIND_OPTIONS.find((entry) => entry.value === file.kind) ?? SKILL_FILE_KIND_OPTIONS[3];
                  return (
                    <div key={file.localId} className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-3 first:border-t-0 first:pt-0">
                      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_140px_auto] gap-2 items-end">
                        <label className="flex flex-col gap-1">
                          <span className="dh-type-label">Path</span>
                          <input
                            value={file.path}
                            onChange={(e) => updateDraftFile(file.localId, { path: e.target.value })}
                            className={`${inputClassName()} font-mono`}
                            placeholder={option.pathHint}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className="dh-type-label">Kind</span>
                          <select
                            value={file.kind}
                            onChange={(e) => updateDraftFile(file.localId, { kind: e.target.value as SkillFileKind })}
                            className={inputClassName()}
                          >
                            {SKILL_FILE_KIND_OPTIONS.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => removeDraftFile(file.localId)}
                          className={buttonClassName('danger')}
                          style={{ fontFamily: 'var(--display)' }}
                        >
                          Remove
                        </button>
                      </div>
                      <textarea
                        value={file.content}
                        onChange={(e) => updateDraftFile(file.localId, { content: e.target.value })}
                        className={`${textareaClassName()} min-h-[140px]`}
                        placeholder="File contents"
                      />
                    </div>
                  );
                })
              )}
            </div>
          </SettingsSection>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3 xl:divide-x xl:divide-[var(--border-subtle)]">
            <div className="flex flex-col gap-3 xl:pr-4">
              <div className="dh-type-label">Codex</div>
              <div className="dh-type-supporting">Optional `agents/openai.yaml` overlay.</div>
              <textarea
                value={draft.codexOpenaiYaml}
                onChange={(e) => updateDraftField('codexOpenaiYaml', e.target.value)}
                className={`${textareaClassName()} min-h-[180px]`}
                placeholder={'tools:\n  - bash'}
              />
            </div>

            <div className="flex flex-col gap-3 xl:px-4">
              <div className="dh-type-label">Claude</div>
              <div className="grid grid-cols-1 gap-2">
                <input value={draft.claudeArgumentHint} onChange={(e) => updateDraftField('claudeArgumentHint', e.target.value)} className={inputClassName()} placeholder="Argument hint" />
                <input value={draft.claudeAllowedTools} onChange={(e) => updateDraftField('claudeAllowedTools', e.target.value)} className={inputClassName()} placeholder="Allowed tools (comma-separated)" />
                <input value={draft.claudeModel} onChange={(e) => updateDraftField('claudeModel', e.target.value)} className={inputClassName()} placeholder="Model" />
                <input value={draft.claudeContext} onChange={(e) => updateDraftField('claudeContext', e.target.value)} className={inputClassName()} placeholder="Context" />
                <input value={draft.claudeAgent} onChange={(e) => updateDraftField('claudeAgent', e.target.value)} className={inputClassName()} placeholder="Agent" />
                <label className="inline-flex items-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                  <input type="checkbox" checked={draft.claudeUserInvocable} onChange={(e) => updateDraftField('claudeUserInvocable', e.target.checked)} />
                  User invocable
                </label>
                <label className="inline-flex items-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                  <input type="checkbox" checked={draft.claudeDisableModelInvocation} onChange={(e) => updateDraftField('claudeDisableModelInvocation', e.target.checked)} />
                  Disable model invocation
                </label>
                <textarea
                  value={draft.claudeHooksJson}
                  onChange={(e) => updateDraftField('claudeHooksJson', e.target.value)}
                  className={`${textareaClassName()} min-h-[140px]`}
                  placeholder='Hooks JSON, for example {"preToolUse": {"Bash": [{"matcher": ".*"}]}}'
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:pl-4">
              <div className="dh-type-label">Cursor + advanced</div>
              <label className="inline-flex items-center gap-2 text-[var(--text-11)] text-[var(--muted)]">
                <input type="checkbox" checked={draft.cursorDisableModelInvocation} onChange={(e) => updateDraftField('cursorDisableModelInvocation', e.target.checked)} />
                Disable model invocation
              </label>
              <div className="dh-type-supporting">Optional portable metadata object.</div>
              <textarea
                value={draft.metadataJson}
                onChange={(e) => updateDraftField('metadataJson', e.target.value)}
                className={`${textareaClassName()} min-h-[220px]`}
                placeholder='{"owner":"platform","tags":"review"}'
              />
            </div>
          </div>
        </SettingsDetail>
        </SettingsSplitView>
      </SettingsSection>
    </div>
  );
}
