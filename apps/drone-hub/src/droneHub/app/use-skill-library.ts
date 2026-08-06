import React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  createDraftFileTemplate,
  createEmptyDraft,
  draftFromSkill,
  filterSkillSourceCandidates,
  payloadFromDraft,
  sanitizeDraftForComparison,
  sortSkills,
  type SkillDraft,
  type SkillDraftScalarKey,
  type SkillFileDraft,
  type SkillFileKind,
  type SkillRecord,
  type SkillSourceCandidate,
  type SkillSourceCandidatePreview,
  type SkillSourceRecord,
} from './skill-library-model';
import { settingsErrorMessage, settingsQueryError, settingsQueryKey, useSettingsQuery } from './settings-query';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type SkillsListResponse = {
  ok: true;
  skills: SkillRecord[];
};

type SkillMutationResponse = {
  ok: true;
  skill: SkillRecord;
};

type SkillSourceListResponse = {
  ok: true;
  sources: SkillSourceRecord[];
};

type SkillSourceCandidatesResponse = {
  ok: true;
  sourceId: string;
  skills: SkillSourceCandidate[];
};

type SkillSourcePreviewResponse = {
  ok: true;
  preview: SkillSourceCandidatePreview;
};

type SourceSkillLoadOptions = {
  refresh?: boolean;
};

function replaceSkill(skills: SkillRecord[], skill: SkillRecord): SkillRecord[] {
  const next = skills.filter((entry) => entry.id !== skill.id);
  next.push(skill);
  return sortSkills(next);
}

export type {
  SkillDraft,
  SkillDraftScalarKey,
  SkillFileDraft,
  SkillFileKind,
  SkillRecord,
  SkillSourceCandidate,
  SkillSourceCandidatePreview,
  SkillSourcePreviewFile,
  SkillSourceRecord,
} from './skill-library-model';

export type UseSkillLibraryResult = ReturnType<typeof useSkillLibrary>;

export function useSkillLibrary(requestJson: RequestJsonFn) {
  const queryClient = useQueryClient();
  const skillsQueryKey = settingsQueryKey('skills');
  const sourcesQueryKey = settingsQueryKey('skill-sources');
  const [skillsSaving, setSkillsSaving] = React.useState(false);
  const [skillsDeleting, setSkillsDeleting] = React.useState(false);
  const [skillsError, setSkillsError] = React.useState<string | null>(null);
  const [queryErrorDismissed, setQueryErrorDismissed] = React.useState(false);
  const [skillsNotice, setSkillsNotice] = React.useState<string | null>(null);
  const [selectedSkillId, setSelectedSkillId] = React.useState<string | null>(null);
  const [selectedSourceId, setSelectedSourceId] = React.useState<string | null>(null);
  const [selectedSourcePreviewPath, setSelectedSourcePreviewPath] = React.useState<string | null>(null);
  const [selectedSourcePreviewFilePath, setSelectedSourcePreviewFilePath] = React.useState<string | null>(null);
  const [sourceSkillSearch, setSourceSkillSearch] = React.useState('');
  const [importingSourceSkillId, setImportingSourceSkillId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<SkillDraft>(() => createEmptyDraft());
  const [baselineDraft, setBaselineDraft] = React.useState<SkillDraft>(() => createEmptyDraft());

  const skillsQuery = useSettingsQuery<SkillsListResponse>(requestJson, skillsQueryKey, '/api/skills');
  const sourcesQuery = useSettingsQuery<SkillSourceListResponse>(requestJson, sourcesQueryKey, '/api/skill-sources');
  const sourceSkillsQuery = useSettingsQuery<SkillSourceCandidatesResponse>(
    requestJson,
    settingsQueryKey('skill-source-candidates', selectedSourceId),
    `/api/skill-sources/${encodeURIComponent(selectedSourceId ?? '')}/skills`,
    Boolean(selectedSourceId),
  );
  const sourcePreviewQuery = useSettingsQuery<SkillSourcePreviewResponse>(
    requestJson,
    settingsQueryKey('skill-source-preview', selectedSourceId, selectedSourcePreviewPath),
    `/api/skill-sources/${encodeURIComponent(selectedSourceId ?? '')}/preview?${new URLSearchParams({ path: selectedSourcePreviewPath ?? '' }).toString()}`,
    Boolean(selectedSourceId && selectedSourcePreviewPath),
  );

  const skills = React.useMemo(() => sortSkills(skillsQuery.data?.skills ?? []), [skillsQuery.data]);
  const skillSources = React.useMemo(
    () => [...(sourcesQuery.data?.sources ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [sourcesQuery.data],
  );
  const sourceSkills = React.useMemo(
    () => [...(sourceSkillsQuery.data?.skills ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [sourceSkillsQuery.data],
  );
  const sourceSkillPreview = sourcePreviewQuery.data?.preview ?? null;

  const selectedSkill = React.useMemo(
    () => skills.find((skill: SkillRecord) => skill.id === selectedSkillId) ?? null,
    [selectedSkillId, skills],
  );

  const draftDirty = React.useMemo(
    () => sanitizeDraftForComparison(draft) !== sanitizeDraftForComparison(baselineDraft),
    [baselineDraft, draft],
  );

  const filteredSourceSkills = React.useMemo(
    () => filterSkillSourceCandidates(sourceSkills, sourceSkillSearch),
    [sourceSkillSearch, sourceSkills],
  );

  const selectedSourcePreviewFile = React.useMemo(
    () =>
      sourceSkillPreview?.files.find((file) => file.path === selectedSourcePreviewFilePath) ??
      sourceSkillPreview?.files[0] ??
      null,
    [selectedSourcePreviewFilePath, sourceSkillPreview],
  );

  const selectedSkillIdRef = React.useRef<string | null>(selectedSkillId);
  React.useEffect(() => {
    selectedSkillIdRef.current = selectedSkillId;
  }, [selectedSkillId]);

  const selectedSourceIdRef = React.useRef<string | null>(selectedSourceId);
  React.useEffect(() => {
    selectedSourceIdRef.current = selectedSourceId;
  }, [selectedSourceId]);
  const sourcePreviewPathRef = React.useRef<string | null>(selectedSourcePreviewPath);

  const clearSourcePreviewState = React.useCallback(() => {
    sourcePreviewPathRef.current = null;
    setSelectedSourcePreviewPath(null);
    setSelectedSourcePreviewFilePath(null);
  }, []);

  const applySelectedSource = React.useCallback((sourceId: string | null) => {
    if (sourceId !== selectedSourceIdRef.current) clearSourcePreviewState();
    selectedSourceIdRef.current = sourceId;
    setSelectedSourceId(sourceId);
  }, [clearSourcePreviewState]);

  const applySelectedSkill = React.useCallback((skill: SkillRecord | null) => {
    setSelectedSkillId(skill?.id ?? null);
    const nextDraft = skill ? draftFromSkill(skill) : createEmptyDraft();
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
  }, []);

  React.useEffect(() => {
    if (!skillsQuery.data) return;
    const nextSelected =
      skills.find((skill) => skill.id === selectedSkillIdRef.current) ?? skills[0] ?? null;
    applySelectedSkill(nextSelected);
  }, [applySelectedSkill, skills, skillsQuery.data]);

  React.useEffect(() => {
    if (!sourcesQuery.data) return;
    const current = selectedSourceIdRef.current;
    applySelectedSource(
      current && skillSources.some((source) => source.id === current)
        ? current
        : skillSources[0]?.id ?? null,
    );
  }, [applySelectedSource, skillSources, sourcesQuery.data]);

  React.useEffect(() => {
    if (!sourcePreviewQuery.data) return;
    setSelectedSourcePreviewFilePath(sourcePreviewQuery.data.preview.files[0]?.path ?? null);
  }, [sourcePreviewQuery.data]);

  const selectSkill = React.useCallback(
    (skillId: string | null) => {
      const next = skillId ? skills.find((skill: SkillRecord) => skill.id === skillId) ?? null : null;
      applySelectedSkill(next);
    },
    [applySelectedSkill, skills],
  );

  const updateDraftField = React.useCallback(<K extends SkillDraftScalarKey>(key: K, value: SkillDraft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const appendDraftFile = React.useCallback((kind: SkillFileKind) => {
    setDraft((prev) => ({
      ...prev,
      files: [...prev.files, createDraftFileTemplate(kind, prev.files.length)],
    }));
  }, []);

  const updateDraftFile = React.useCallback((localId: string, patch: Partial<SkillFileDraft>) => {
    setDraft((prev) => ({
      ...prev,
      files: prev.files.map((file) => (file.localId === localId ? { ...file, ...patch } : file)),
    }));
  }, []);

  const removeDraftFile = React.useCallback((localId: string) => {
    setDraft((prev) => ({
      ...prev,
      files: prev.files.filter((file) => file.localId !== localId),
    }));
  }, []);

  const loadSkills = React.useCallback(async () => {
    setQueryErrorDismissed(false);
    setSkillsError(null);
    const { data } = await skillsQuery.refetch();
    if (!data) return;
    const nextSkills = sortSkills(data.skills ?? []);
    const selected =
      nextSkills.find((skill) => skill.id === selectedSkillIdRef.current) ??
      nextSkills[0] ??
      null;
    applySelectedSkill(selected);
  }, [applySelectedSkill, skillsQuery.refetch]);

  const loadSkillSources = React.useCallback(async () => {
    setQueryErrorDismissed(false);
    setSkillsError(null);
    const { data, error } = await sourcesQuery.refetch();
    if (error) return null;
    const sources = data?.sources ?? [];
    const current = selectedSourceIdRef.current;
    const nextSourceId = current && sources.some((source) => source.id === current)
      ? current
      : sources[0]?.id ?? null;
    applySelectedSource(nextSourceId);
    return nextSourceId;
  }, [applySelectedSource, sourcesQuery.refetch]);

  const loadSourceSkills = React.useCallback(
    async (sourceIdInput?: string | null, opts?: SourceSkillLoadOptions) => {
      const sourceId = String(sourceIdInput ?? selectedSourceId ?? '').trim();
      if (!sourceId) {
        clearSourcePreviewState();
        return;
      }
      setQueryErrorDismissed(false);
      setSkillsError(null);
      clearSourcePreviewState();
      try {
        const suffix = opts?.refresh ? '?refresh=1' : '';
        await queryClient.fetchQuery({
          queryKey: settingsQueryKey('skill-source-candidates', sourceId),
          queryFn: ({ signal }) =>
            requestJson<SkillSourceCandidatesResponse>(
              `/api/skill-sources/${encodeURIComponent(sourceId)}/skills${suffix}`,
              { signal },
            ),
        });
      } catch (error) {
        setSkillsError(settingsErrorMessage(error));
      }
    },
    [clearSourcePreviewState, queryClient, requestJson, selectedSourceId],
  );

  const refreshSkillSources = React.useCallback(async () => {
    const sourceId = await loadSkillSources();
    if (!sourceId) return;
    await loadSourceSkills(sourceId, { refresh: true });
  }, [loadSkillSources, loadSourceSkills]);

  React.useEffect(() => {
    if (!selectedSourceId) {
      clearSourcePreviewState();
    }
  }, [clearSourcePreviewState, selectedSourceId]);

  const startNewSkill = React.useCallback(() => {
    applySelectedSkill(null);
    setSkillsError(null);
    setSkillsNotice('Creating a new skill draft.');
  }, [applySelectedSkill]);

  const resetDraft = React.useCallback(() => {
    const nextDraft = selectedSkill ? draftFromSkill(selectedSkill) : createEmptyDraft();
    setDraft(nextDraft);
    setBaselineDraft(nextDraft);
    setSkillsError(null);
    setSkillsNotice(selectedSkill ? `Reverted changes for ${selectedSkill.name}.` : 'Cleared draft.');
  }, [selectedSkill]);

  const saveDraft = React.useCallback(async () => {
    setSkillsSaving(true);
    setSkillsError(null);
    setSkillsNotice(null);
    try {
      const payload = payloadFromDraft(draft);
      const data = draft.id
        ? await requestJson<SkillMutationResponse>(`/api/skills/${encodeURIComponent(draft.id)}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await requestJson<SkillMutationResponse>('/api/skills', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
          });
      const saved = data.skill;
      queryClient.setQueryData<SkillsListResponse>(skillsQueryKey, (current) => ({
        ok: true,
        skills: replaceSkill(current?.skills ?? [], saved),
      }));
      applySelectedSkill(saved);
      setSkillsNotice(draft.id ? `Saved ${saved.name}.` : `Created ${saved.name}.`);
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
    } finally {
      setSkillsSaving(false);
    }
  }, [applySelectedSkill, draft, queryClient, requestJson, skillsQueryKey]);

  const importSourceSkill = React.useCallback(
    async (candidate: SkillSourceCandidate) => {
      setImportingSourceSkillId(candidate.id);
      setSkillsError(null);
      setSkillsNotice(null);
      try {
        const data = await requestJson<SkillMutationResponse>(`/api/skill-sources/${encodeURIComponent(candidate.sourceId)}/import`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ path: candidate.path }),
        });
        const saved = data.skill;
        queryClient.setQueryData<SkillsListResponse>(skillsQueryKey, (current) => ({
          ok: true,
          skills: replaceSkill(current?.skills ?? [], saved),
        }));
        applySelectedSkill(saved);
        setSkillsNotice(`Imported ${saved.name}.`);
      } catch (e: any) {
        setSkillsError(e?.message ?? String(e));
      } finally {
        setImportingSourceSkillId(null);
      }
    },
    [applySelectedSkill, queryClient, requestJson, skillsQueryKey],
  );

  const previewSourceSkill = React.useCallback(
    async (candidate: SkillSourceCandidate) => {
      sourcePreviewPathRef.current = candidate.path;
      setSelectedSourcePreviewPath(candidate.path);
      setSelectedSourcePreviewFilePath(null);
      setSkillsError(null);
      try {
        const qs = new URLSearchParams({ path: candidate.path });
        const data = await queryClient.fetchQuery({
          queryKey: settingsQueryKey('skill-source-preview', candidate.sourceId, candidate.path),
          queryFn: ({ signal }) => requestJson<SkillSourcePreviewResponse>(
            `/api/skill-sources/${encodeURIComponent(candidate.sourceId)}/preview?${qs.toString()}`,
            { signal },
          ),
        });
        if (sourcePreviewPathRef.current !== candidate.path) return;
        if (selectedSourceIdRef.current !== candidate.sourceId) return;
        setSelectedSourcePreviewFilePath(data.preview.files[0]?.path ?? null);
      } catch (error) {
        if (sourcePreviewPathRef.current !== candidate.path) return;
        setSelectedSourcePreviewFilePath(null);
        setSkillsError(settingsErrorMessage(error));
      }
    },
    [queryClient, requestJson],
  );

  const deleteSelectedSkill = React.useCallback(async () => {
    if (!selectedSkillId) return;
    setSkillsDeleting(true);
    setSkillsError(null);
    setSkillsNotice(null);
    try {
      await requestJson<{ ok: true; deleted: true; id: string }>(`/api/skills/${encodeURIComponent(selectedSkillId)}`, {
        method: 'DELETE',
      });
      const nextSkills = skills.filter((skill: SkillRecord) => skill.id !== selectedSkillId);
      queryClient.setQueryData<SkillsListResponse>(skillsQueryKey, { ok: true, skills: nextSkills });
      applySelectedSkill(nextSkills[0] ?? null);
      setSkillsNotice('Deleted skill.');
    } catch (e: any) {
      setSkillsError(e?.message ?? String(e));
    } finally {
      setSkillsDeleting(false);
    }
  }, [applySelectedSkill, queryClient, requestJson, selectedSkillId, skills, skillsQueryKey]);

  const clearSkillsNotice = React.useCallback(() => setSkillsNotice(null), []);
  const clearSkillsError = React.useCallback(() => {
    setSkillsError(null);
    setQueryErrorDismissed(true);
  }, []);
  const selectSource = React.useCallback((sourceId: string | null) => {
    setQueryErrorDismissed(false);
    applySelectedSource(sourceId);
  }, [applySelectedSource]);
  const selectSourcePreviewFile = React.useCallback((filePath: string | null) => {
    setSelectedSourcePreviewFilePath(filePath);
  }, []);

  return {
    skills,
    skillSources,
    sourceSkills,
    filteredSourceSkills,
    sourceSkillPreview,
    selectedSourcePreviewPath,
    selectedSourcePreviewFilePath,
    selectedSourcePreviewFile,
    skillsLoading: skillsQuery.isFetching,
    skillSourcesLoading: sourcesQuery.isFetching,
    sourceSkillsLoading: sourceSkillsQuery.isFetching,
    sourceSkillPreviewLoading: sourcePreviewQuery.isFetching,
    skillsSaving,
    skillsDeleting,
    sourceSkillSearch,
    skillsError: settingsQueryError(
      skillsError,
      queryErrorDismissed,
      skillsQuery,
      sourcesQuery,
      sourceSkillsQuery,
      sourcePreviewQuery,
    ),
    skillsNotice,
    selectedSkillId,
    selectedSourceId,
    importingSourceSkillId,
    selectedSkill,
    draft,
    draftDirty,
    selectSkill,
    selectSource,
    previewSourceSkill,
    selectSourcePreviewFile,
    updateDraftField,
    appendDraftFile,
    updateDraftFile,
    removeDraftFile,
    loadSkills,
    loadSkillSources,
    loadSourceSkills,
    refreshSkillSources,
    startNewSkill,
    setSourceSkillSearch,
    importSourceSkill,
    saveDraft,
    deleteSelectedSkill,
    resetDraft,
    clearSkillsNotice,
    clearSkillsError,
  };
}
