import React from 'react';

import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { UiAlert, UiButton, UiDialog, UiSpinner } from '../../ui/components';
import { SkillTextEditor } from '../app/SkillTextEditor';
import type { SkillRecord } from '../app/skill-library-model';
import { settingsQueryKey } from '../app/settings-query';
import { requestJson } from '../http';
import { droneHubQueryClient } from '../query-client';
import {
  createSkillPillEdit,
  findSkillForPill,
  NEW_SKILL_MARKDOWN,
  saveSkillPillEdit,
  skillMarkdownForRecord,
} from './skill-pill-editor-model';

type SkillsListResponse = {
  ok: true;
  skills: SkillRecord[];
};

const SKILLS_QUERY_KEY = settingsQueryKey('skills');
const SKILLS_STALE_TIME_MS = 60_000;

function fetchSkills(signal?: AbortSignal): Promise<SkillsListResponse> {
  return requestJson<SkillsListResponse>('/api/skills', signal ? { signal } : undefined);
}

export function prefetchSkillPillEditorData(): Promise<void> {
  return droneHubQueryClient.prefetchQuery({
    queryKey: SKILLS_QUERY_KEY,
    queryFn: ({ signal }) => fetchSkills(signal),
    staleTime: SKILLS_STALE_TIME_MS,
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function updatedSkills(
  skills: SkillRecord[],
  oldSkill: SkillRecord | null,
  savedSkill: SkillRecord,
): SkillRecord[] {
  return [
    ...skills.filter((entry) => entry.id !== oldSkill?.id && entry.id !== savedSkill.id),
    savedSkill,
  ].sort((left, right) => left.slug.localeCompare(right.slug));
}

export function SkillPillEditorDialog({
  skillName,
  onClose,
}: {
  skillName: string | null;
  onClose: () => void;
}) {
  const confirm = useAppConfirmDialog();
  const [skills, setSkills] = React.useState<SkillRecord[]>([]);
  const [skill, setSkill] = React.useState<SkillRecord | null>(null);
  const [creatingNew, setCreatingNew] = React.useState(false);
  const [markdown, setMarkdown] = React.useState('');
  const [baselineMarkdown, setBaselineMarkdown] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const dirty = markdown !== baselineMarkdown;

  const applyExistingSkill = React.useCallback((nextSkill: SkillRecord) => {
    const nextMarkdown = skillMarkdownForRecord(nextSkill);
    setSkill(nextSkill);
    setCreatingNew(false);
    setMarkdown(nextMarkdown);
    setBaselineMarkdown(nextMarkdown);
    setError(null);
  }, []);

  const applyNewSkill = React.useCallback(() => {
    setSkill(null);
    setCreatingNew(true);
    setMarkdown(NEW_SKILL_MARKDOWN);
    setBaselineMarkdown(NEW_SKILL_MARKDOWN);
    setError(null);
  }, []);

  React.useEffect(() => {
    if (!skillName) return;
    let cancelled = false;
    setLoading(true);
    setSaving(false);
    setSkills([]);
    setError(null);
    setSkill(null);
    setCreatingNew(false);
    setMarkdown('');
    setBaselineMarkdown('');

    void droneHubQueryClient
      .fetchQuery({
        queryKey: SKILLS_QUERY_KEY,
        queryFn: ({ signal }) => fetchSkills(signal),
        staleTime: SKILLS_STALE_TIME_MS,
      })
      .then((data) => {
        if (cancelled) return;
        const availableSkills = Array.isArray(data.skills) ? data.skills : [];
        const nextSkill = findSkillForPill(availableSkills, skillName);
        setSkills(availableSkills);
        if (!nextSkill) {
          setError(`The ${skillName} skill is not available in DroneHub Skills settings.`);
          return;
        }
        applyExistingSkill(nextSkill);
      })
      .catch((loadError) => {
        if (!cancelled) setError(errorMessage(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [applyExistingSkill, skillName]);

  const confirmDiscardIfNeeded = React.useCallback(async (): Promise<boolean> => {
    if (!dirty) return true;
    return await confirm({
      title: 'Discard unsaved changes?',
      message: 'Your changes to the current skill will be lost.',
      confirmLabel: 'Discard changes',
      cancelLabel: 'Keep editing',
      destructive: true,
    });
  }, [confirm, dirty]);

  const selectExistingSkill = React.useCallback(
    async (nextSkill: SkillRecord) => {
      if (saving || (!creatingNew && nextSkill.id === skill?.id)) return;
      if (!(await confirmDiscardIfNeeded())) return;
      applyExistingSkill(nextSkill);
    },
    [applyExistingSkill, confirmDiscardIfNeeded, creatingNew, saving, skill?.id],
  );

  const startNewSkill = React.useCallback(async () => {
    if (saving || creatingNew) return;
    if (!(await confirmDiscardIfNeeded())) return;
    applyNewSkill();
  }, [applyNewSkill, confirmDiscardIfNeeded, creatingNew, saving]);

  const close = React.useCallback(() => {
    if (!saving) onClose();
  }, [onClose, saving]);

  const save = React.useCallback(async () => {
    if ((!skill && !creatingNew) || saving) return;
    setSaving(true);
    setError(null);
    try {
      let saved: SkillRecord | null;
      if (creatingNew) {
        saved = await createSkillPillEdit({ skillMarkdown: markdown, requestJson });
      } else if (skill) {
        saved = await saveSkillPillEdit({
          skill,
          skillMarkdown: markdown,
          requestJson,
          confirmRename: ({ oldName, newName }) =>
            confirm({
              title: `Replace ${oldName}?`,
              message: `Do you really want to delete the old “${oldName}” skill and replace it with “${newName}”? This creates a new skill instead of updating the existing one.`,
              confirmLabel: 'Replace skill',
              cancelLabel: 'Keep editing',
              destructive: true,
            }),
        });
      } else {
        return;
      }
      if (!saved) return;
      const nextSkills = updatedSkills(skills, skill, saved);
      setSkills(nextSkills);
      droneHubQueryClient.setQueryData<SkillsListResponse>(SKILLS_QUERY_KEY, (current) => ({
        ok: true,
        skills: updatedSkills(current?.skills ?? skills, skill, saved),
      }));
      void droneHubQueryClient.invalidateQueries({ queryKey: SKILLS_QUERY_KEY });
      onClose();
    } catch (saveError) {
      setError(errorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }, [confirm, creatingNew, markdown, onClose, saving, skill, skills]);

  const editorKey = creatingNew ? '__new__' : skill?.id;
  const editorSlug = creatingNew ? 'new-skill' : (skill?.slug ?? 'skill');

  return (
    <UiDialog
      open={skillName != null}
      onClose={close}
      title="Skills"
      size="large"
      dismissible={!dirty && !saving}
      showCloseButton={false}
      className="flex h-[min(82vh,52rem)] max-w-[min(72rem,calc(100vw-2rem))] flex-col"
      bodyClassName="flex min-h-0 flex-1 !p-0"
      footer={
        <>
          <UiButton onClick={close} disabled={saving}>
            Cancel
          </UiButton>
          <UiButton
            variant="primary"
            onClick={() => void save()}
            disabled={loading || (!skill && !creatingNew)}
            loading={saving}
          >
            Save
          </UiButton>
        </>
      }
    >
      <aside className="flex w-56 shrink-0 flex-col border-r border-[var(--border-subtle)] bg-[var(--surface-inset)]">
        <div className="border-b border-[var(--border-subtle)] p-2">
          <UiButton
            fullWidth
            size="small"
            variant="secondary"
            onClick={() => void startNewSkill()}
            disabled={loading || saving}
          >
            Add new skill
          </UiButton>
        </div>
        <nav aria-label="DroneHub skills" className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {skills.map((entry) => {
            const selected = !creatingNew && entry.id === skill?.id;
            return (
              <button
                key={entry.id}
                type="button"
                title={`${entry.name} — ${entry.description}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => void selectExistingSkill(entry)}
                disabled={saving}
                className={`mb-0.5 block h-8 w-full truncate rounded-[var(--radius-medium)] px-2.5 text-left dh-type-control transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)] ${
                  selected
                    ? 'bg-[var(--selected)] text-[var(--fg)]'
                    : 'text-[var(--fg-secondary)] hover:bg-[var(--hover)] hover:text-[var(--fg)]'
                }`}
              >
                {entry.name}
              </button>
            );
          })}
          {!loading && skills.length === 0 ? (
            <div className="px-2 py-3 text-center dh-type-supporting !text-[var(--muted)]">
              No skills yet.
            </div>
          ) : null}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {loading ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <UiSpinner label="Loading skills" />
          </div>
        ) : (
          <>
            <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-[var(--border-subtle)] px-3">
              <span className="min-w-0 truncate font-mono text-[var(--text-11)] text-[var(--fg-secondary)]">
                {creatingNew ? 'new-skill/SKILL.md' : skill ? `${skill.slug}/SKILL.md` : 'SKILL.md'}
              </span>
              {editorKey ? (
                <span
                  className={`shrink-0 dh-type-menu-meta ${dirty ? '!text-[var(--accent)]' : ''}`}
                >
                  {dirty ? 'Unsaved changes' : creatingNew ? 'New skill' : 'Saved'}
                </span>
              ) : null}
            </div>
            {error ? (
              <UiAlert tone="danger" className="m-3">
                {error}
              </UiAlert>
            ) : null}
            {editorKey ? (
              <div className="min-h-0 flex-1">
                <SkillTextEditor
                  key={editorKey}
                  skillKey={editorKey}
                  slug={editorSlug}
                  filePath="SKILL.md"
                  value={markdown}
                  saving={saving}
                  onChange={setMarkdown}
                  onSave={() => void save()}
                />
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-[var(--text-12)] text-[var(--muted)]">
                Select a skill or add a new one.
              </div>
            )}
          </>
        )}
      </div>
    </UiDialog>
  );
}
