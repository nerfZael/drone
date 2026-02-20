import React from 'react';
import type { ChatAgentConfig } from '../../domain';
import { isValidDroneNameDashCase } from '../../domain';
import { requestJson } from '../http';
import type { DroneSummary, EditableJob } from '../types';
import { makeId } from './helpers';
import { droneNameHasWhitespace } from './name-helpers';

type DroneQueueSpec = {
  name: string;
  group?: string;
  repoPath?: string;
  build?: boolean;
  seedAgent?: ChatAgentConfig;
  seedModel?: string | null;
  seedChat?: string;
  seedPrompt?: string;
};

type JobsModalState = {
  turn: number;
  message: string;
  jobs: EditableJob[];
  group: string;
  prefix: string;
  agentKey: string;
  sourceRepoPath: string;
};

type UseJobsWorkflowArgs = {
  drones: DroneSummary[];
  selectedDrone: string | null;
  spawnAgentKey: string;
  setSpawnAgentKey: React.Dispatch<React.SetStateAction<string>>;
  spawnModelForSeed: string | null;
  resolveAgentKeyToConfig: (key: string) => ChatAgentConfig;
  queueDrones: (list: DroneQueueSpec[]) => Promise<{
    ok: true;
    accepted: Array<{ id: string; name: string; phase: 'starting' }>;
    rejected: Array<{ id?: string; name: string; error: string; status?: number }>;
    total: number;
  }>;
  rememberStartupSeed: (
    drones: Array<{ id: string; name: string }>,
    opts: {
      agent: ChatAgentConfig | null;
      model?: string | null;
      prompt: string;
      chatName?: string;
      group?: string | null;
      repoPath?: string | null;
    },
  ) => void;
};

export function useJobsWorkflow({
  drones,
  selectedDrone,
  spawnAgentKey,
  setSpawnAgentKey,
  spawnModelForSeed,
  resolveAgentKeyToConfig,
  queueDrones,
  rememberStartupSeed,
}: UseJobsWorkflowArgs) {
  const [parsingJobsByTurn, setParsingJobsByTurn] = React.useState<Record<number, boolean>>({});
  const [jobsModal, setJobsModal] = React.useState<JobsModalState | null>(null);
  const [jobsModalError, setJobsModalError] = React.useState<string | null>(null);
  const [spawningJobById, setSpawningJobById] = React.useState<Record<string, boolean>>({});
  const [spawnedJobById, setSpawnedJobById] = React.useState<Record<string, boolean>>({});
  const [spawnJobErrorById, setSpawnJobErrorById] = React.useState<Record<string, string>>({});
  const [spawningAllJobs, setSpawningAllJobs] = React.useState(false);
  const spawningAllJobsRef = React.useRef(false);
  const [detailsOpenByJobId, setDetailsOpenByJobId] = React.useState<Record<string, boolean>>({});

  const parseJobsFromAgentMessage = React.useCallback(
    async (opts: { turn: number; message: string }) => {
      const message = String(opts.message ?? '').trim();
      if (!message) return;
      setParsingJobsByTurn((prev) => ({ ...prev, [opts.turn]: true }));
      setJobsModalError(null);
      try {
        const data = await requestJson<{ ok: true; jobs: any[]; group?: any }>(`/api/jobs/from-message`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ message }),
        });
        const rawJobs = Array.isArray(data?.jobs) ? data.jobs : [];
        const group = String(data?.group ?? '').trim() || 'jobs';
        const jobs: EditableJob[] = rawJobs
          .map((j: any) => {
            const name = String(j?.name ?? '').trim();
            const title = String(j?.title ?? j?.description ?? '').trim();

            const detailsFromServer =
              typeof j?.details === 'string'
                ? j.details
                : Array.isArray(j?.details)
                  ? j.details.map((x: any) => String(x ?? '')).join('\n\n')
                  : '';
            let details = String(detailsFromServer || '').trim();

            if (!details) details = message;

            if (!name) return null;
            return { id: makeId(), name, title, details };
          })
          .filter(Boolean) as EditableJob[];
        if (jobs.length === 0) throw new Error('No jobs were produced from that message.');
        const src = drones.find((d) => d.id === selectedDrone) ?? null;
        const sourceRepoPath =
          src && (src.repoAttached ?? Boolean(String(src.repoPath ?? '').trim())) ? src.repoPath : '';
        setSpawnJobErrorById({});
        setSpawnedJobById({});
        setDetailsOpenByJobId({});
        setJobsModal({
          turn: opts.turn,
          message,
          jobs,
          group,
          prefix: '',
          agentKey: spawnAgentKey || 'builtin:cursor',
          sourceRepoPath,
        });
      } catch (e: any) {
        setJobsModalError(e?.message ?? String(e));
        setJobsModal(null);
      } finally {
        setParsingJobsByTurn((prev) => ({ ...prev, [opts.turn]: false }));
      }
    },
    [drones, selectedDrone, spawnAgentKey],
  );

  const spawnDroneForJob = React.useCallback(
    async (job: EditableJob, group: string, prefix: string, agentKey: string, repoPathOverride?: string): Promise<boolean> => {
      const nameRaw = String(job?.name ?? '');
      const name = nameRaw.trim();
      if (!name) return false;
      if (name.length > 80 || /[\r\n]/.test(name)) {
        setSpawnJobErrorById((prev) => ({
          ...prev,
          [job.id]: 'Invalid drone name. Must be 1-80 chars and cannot contain newlines.',
        }));
        return false;
      }
      setSpawningJobById((prev) => ({ ...prev, [job.id]: true }));
      setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: '' }));
      try {
        const groupName = String(group ?? '').trim();
        const title = String(job?.title ?? '').trim();
        const details = String(job?.details ?? '').trim();
        const prefixText = String(prefix ?? '').trim();
        const seedPrompt = [prefixText || null, `Job: ${name}`, title ? `Title: ${title}` : null, '', details ? details : null]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join('\n');

        const seedAgent = resolveAgentKeyToConfig(agentKey);
        const seedModel = seedAgent.kind === 'builtin' ? spawnModelForSeed : null;
        const repoPath = String(repoPathOverride ?? '').trim();

        const resp = await queueDrones([
          {
            name,
            build: false,
            ...(groupName ? { group: groupName } : {}),
            ...(repoPath ? { repoPath } : {}),
            seedAgent,
            ...(seedModel ? { seedModel } : {}),
            seedChat: 'default',
            ...(seedPrompt.trim() ? { seedPrompt } : {}),
          },
        ]);

        const acceptedEntry = (resp?.accepted ?? []).find((a) => String(a?.name ?? '').trim() === name) ?? null;
        const rejected = (resp?.rejected ?? []).find((r) => String(r?.name ?? '').trim() === name) ?? null;
        if (!acceptedEntry?.id) {
          const msg = String(rejected?.error ?? 'Failed to queue drone.');
          setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: msg }));
          return false;
        }

        rememberStartupSeed([{ id: String(acceptedEntry.id), name }], {
          agent: seedAgent,
          model: seedModel,
          prompt: seedPrompt,
          chatName: 'default',
          group: groupName || null,
          repoPath: repoPath || null,
        });
        setSpawnedJobById((prev) => ({ ...prev, [job.id]: true }));
        return true;
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        setSpawnJobErrorById((prev) => ({ ...prev, [job.id]: msg }));
        return false;
      } finally {
        setSpawningJobById((prev) => ({ ...prev, [job.id]: false }));
      }
    },
    [queueDrones, rememberStartupSeed, resolveAgentKeyToConfig, spawnModelForSeed],
  );

  const spawnAllDronesForJobs = React.useCallback(
    async (
      jobs: EditableJob[],
      group: string,
      prefix: string,
      agentKey: string,
      repoPathOverride?: string,
    ): Promise<{ accepted: number; rejected: number }> => {
      const alreadySpawned = new Set(Object.keys(spawnedJobById).filter((k) => spawnedJobById[k]));

      const nameToJobIds = new Map<string, string[]>();
      for (const j of jobs) {
        const name = String(j?.name ?? '').trim();
        if (!name) continue;
        const ids = nameToJobIds.get(name) ?? [];
        ids.push(j.id);
        nameToJobIds.set(name, ids);
      }

      const dupErrorsById: Record<string, string> = {};
      for (const [name, ids] of nameToJobIds.entries()) {
        if (ids.length <= 1) continue;
        for (const id of ids) dupErrorsById[id] = `Duplicate name "${name}" in list.`;
      }
      if (Object.keys(dupErrorsById).length > 0) {
        setSpawnJobErrorById((prev) => {
          const next = { ...prev };
          for (const [id, msg] of Object.entries(dupErrorsById)) {
            next[id] = next[id] || msg;
          }
          return next;
        });
      }

      const groupName = String(group ?? '').trim();
      const prefixText = String(prefix ?? '').trim();
      const seedAgent = resolveAgentKeyToConfig(agentKey);
      const seedModel = seedAgent.kind === 'builtin' ? spawnModelForSeed : null;
      const repoPath = String(repoPathOverride ?? '').trim();

      const specs: DroneQueueSpec[] = [];
      const nameToJobId = new Map<string, string>();
      const nameToSeedPrompt = new Map<string, string>();
      for (const j of jobs) {
        const nameRaw = String(j?.name ?? '');
        const name = nameRaw.trim();
        if (!name) continue;
        const ids = nameToJobIds.get(name) ?? [];
        if (ids.length > 1) continue;
        if (alreadySpawned.has(j.id)) continue;
        if (droneNameHasWhitespace(nameRaw) || !isValidDroneNameDashCase(name)) {
          setSpawnJobErrorById((prev) => ({
            ...prev,
            [j.id]:
              'Invalid drone name. Use dash-case (letters/numbers and single hyphens), no spaces, max 48 chars.',
          }));
          continue;
        }
        nameToJobId.set(name, j.id);
        const title = String(j?.title ?? '').trim();
        const details = String(j?.details ?? '').trim();
        const seedPrompt = [prefixText || null, `Job: ${name}`, title ? `Title: ${title}` : null, '', details ? details : null]
          .filter((x) => typeof x === 'string' && x.trim().length > 0)
          .join('\n');
        nameToSeedPrompt.set(name, seedPrompt);

        specs.push({
          name,
          build: false,
          ...(groupName ? { group: groupName } : {}),
          ...(repoPath ? { repoPath } : {}),
          seedAgent,
          ...(seedModel ? { seedModel } : {}),
          seedChat: 'default',
          ...(seedPrompt.trim() ? { seedPrompt } : {}),
        });
      }

      if (specs.length === 0) return { accepted: 0, rejected: 0 };

      const resp = await queueDrones(specs);
      const acceptedNames = new Set((resp?.accepted ?? []).map((a) => String(a?.name ?? '').trim()).filter(Boolean));
      const rejected = Array.isArray(resp?.rejected) ? resp.rejected : [];

      for (const name of acceptedNames) {
        const jobId = nameToJobId.get(name);
        if (jobId) setSpawnedJobById((prev) => ({ ...prev, [jobId]: true }));
      }
      for (const r of rejected) {
        const name = String((r as any)?.name ?? '').trim();
        const msg = String((r as any)?.error ?? 'Failed to queue drone.');
        if (!name) continue;
        const jobId = nameToJobId.get(name);
        if (jobId) setSpawnJobErrorById((prev) => ({ ...prev, [jobId]: msg }));
      }

      if (acceptedNames.size > 0) {
        const acceptedList = Array.isArray(resp?.accepted) ? resp.accepted : [];
        const idByName = new Map<string, string>();
        for (const a of acceptedList) {
          const id = String((a as any)?.id ?? '').trim();
          const name = String((a as any)?.name ?? '').trim();
          if (id && name) idByName.set(name, id);
        }
        for (const name of acceptedNames) {
          const id = idByName.get(name) ?? '';
          if (!id) continue;
          rememberStartupSeed([{ id, name }], {
            agent: seedAgent,
            model: seedModel,
            prompt: nameToSeedPrompt.get(name) || '',
            chatName: 'default',
            group: groupName || null,
            repoPath: repoPath || null,
          });
        }
      }
      return { accepted: acceptedNames.size, rejected: rejected.length };
    },
    [queueDrones, rememberStartupSeed, resolveAgentKeyToConfig, spawnedJobById, spawnModelForSeed],
  );

  const spawnOneFromJobsModal = React.useCallback(
    (jobId: string) => {
      const cur = jobsModal;
      if (!cur) return;
      const job = cur.jobs.find((j) => j.id === jobId);
      if (!job) return;

      const name = String(job?.name ?? '').trim();
      if (!name) return;

      const dup = cur.jobs.filter((x) => String((x as any)?.name ?? '').trim() === name).length > 1;
      if (dup) {
        setSpawnJobErrorById((prev) => ({ ...prev, [jobId]: 'Duplicate name in list.' }));
        return;
      }

      void spawnDroneForJob(job, cur.group, cur.prefix, cur.agentKey, cur.sourceRepoPath);
    },
    [jobsModal, spawnDroneForJob],
  );

  const spawnAllFromJobsModal = React.useCallback(() => {
    const cur = jobsModal;
    if (!cur) return;
    if (spawningAllJobsRef.current) return;
    spawningAllJobsRef.current = true;
    void (async () => {
      setSpawningAllJobs(true);
      try {
        const r = await spawnAllDronesForJobs(cur.jobs, cur.group, cur.prefix, cur.agentKey, cur.sourceRepoPath);
        if (r.accepted > 0 && r.rejected === 0) setJobsModal(null);
      } finally {
        setSpawningAllJobs(false);
        spawningAllJobsRef.current = false;
      }
    })();
  }, [jobsModal, spawnAllDronesForJobs]);

  const closeJobsModal = React.useCallback(() => {
    setJobsModal(null);
  }, []);

  const spawnJobFromModal = React.useCallback(
    (job: EditableJob, group: string, prefix: string, agentKey: string) => {
      void spawnDroneForJob(job, group, prefix, agentKey, jobsModal?.sourceRepoPath);
    },
    [jobsModal?.sourceRepoPath, spawnDroneForJob],
  );

  const onChangeJobsGroup = React.useCallback((value: string) => {
    setJobsModal((cur) => (cur ? { ...cur, group: value } : cur));
  }, []);

  const onClearJobsGroup = React.useCallback(() => {
    setJobsModal((cur) => (cur ? { ...cur, group: '' } : cur));
  }, []);

  const onChangeJobsAgentKey = React.useCallback(
    (value: string) => {
      setSpawnAgentKey(value);
      setJobsModal((cur) => (cur ? { ...cur, agentKey: value } : cur));
    },
    [setSpawnAgentKey],
  );

  const onChangeJobsPrefix = React.useCallback((value: string) => {
    setJobsModal((cur) => (cur ? { ...cur, prefix: value } : cur));
  }, []);

  const onClearJobsPrefix = React.useCallback(() => {
    setJobsModal((cur) => (cur ? { ...cur, prefix: '' } : cur));
  }, []);

  const onUpdateJobsModalJob = React.useCallback(
    (jobId: string, patch: Partial<Pick<EditableJob, 'name' | 'title' | 'details'>>) => {
      setJobsModal((cur) =>
        !cur
          ? cur
          : {
              ...cur,
              jobs: cur.jobs.map((x) => (x.id === jobId ? { ...x, ...patch } : x)),
            },
      );
    },
    [],
  );

  const onToggleJobsModalDetails = React.useCallback((jobId: string) => {
    setDetailsOpenByJobId((prev) => ({
      ...prev,
      [jobId]: !Boolean(prev[jobId]),
    }));
  }, []);

  return {
    parsingJobsByTurn,
    jobsModal,
    jobsModalError,
    spawningAllJobs,
    spawningJobById,
    spawnedJobById,
    spawnJobErrorById,
    detailsOpenByJobId,
    parseJobsFromAgentMessage,
    spawnOneFromJobsModal,
    spawnAllFromJobsModal,
    spawnJobFromModal,
    closeJobsModal,
    onChangeJobsGroup,
    onClearJobsGroup,
    onChangeJobsAgentKey,
    onChangeJobsPrefix,
    onClearJobsPrefix,
    onUpdateJobsModalJob,
    onToggleJobsModalDetails,
  };
}
