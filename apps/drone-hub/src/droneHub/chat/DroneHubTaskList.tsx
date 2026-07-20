import React from 'react';
import { IconChevron, IconSpinner } from './icons';
import type { DroneHubTask } from './drone-hub-task-parser';
import type { DroneHubTaskSpawnMode } from './drone-hub-task-spawn';

type SpawnTaskResult = {
  ok: boolean;
  error?: string | null;
};

type DroneHubTaskListProps = {
  tasks: DroneHubTask[];
  onSpawnTask: (mode: DroneHubTaskSpawnMode, task: DroneHubTask) => Promise<SpawnTaskResult>;
};

export function DroneHubTaskList({ tasks, onSpawnTask }: DroneHubTaskListProps) {
  const taskKeys = React.useMemo(
    () => tasks.map((task, index) => `${index}:${task.name}:${task.description}`),
    [tasks],
  );
  const taskEntries = React.useMemo(
    () => tasks.map((task, index) => ({ task, taskKey: taskKeys[index] ?? `${index}` })),
    [taskKeys, tasks],
  );
  const [expandedByKey, setExpandedByKey] = React.useState<Record<string, boolean>>({});
  const [spawningByKey, setSpawningByKey] = React.useState<Record<string, boolean>>({});
  const [spawnedByKey, setSpawnedByKey] = React.useState<Record<string, boolean>>({});
  const [errorByKey, setErrorByKey] = React.useState<Record<string, string>>({});
  const [spawningAllMode, setSpawningAllMode] = React.useState<DroneHubTaskSpawnMode | null>(null);

  React.useEffect(() => {
    const activeKeys = new Set(taskKeys);
    setExpandedByKey((prev) => {
      const next: Record<string, boolean> = {};
      let changed = false;
      for (const key of taskKeys) {
        if (Object.prototype.hasOwnProperty.call(prev, key)) {
          next[key] = Boolean(prev[key]);
        } else if (taskKeys.length === 1) {
          next[key] = true;
          changed = true;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) return prev;
      return next;
    });
    setSpawningByKey((prev) => pruneTaskState(prev, activeKeys));
    setSpawnedByKey((prev) => pruneTaskState(prev, activeKeys));
    setErrorByKey((prev) => pruneTaskState(prev, activeKeys));
  }, [taskKeys]);

  const toggleExpanded = React.useCallback((taskKey: string) => {
    setExpandedByKey((prev) => ({
      ...prev,
      [taskKey]: !Boolean(prev[taskKey]),
    }));
  }, []);

  const runTaskAction = React.useCallback(
    async (taskKey: string, mode: DroneHubTaskSpawnMode, task: DroneHubTask) => {
      const actionKey = `${taskKey}:${mode}`;
      if (spawningByKey[actionKey]) return;
      setSpawningByKey((prev) => ({ ...prev, [actionKey]: true }));
      setErrorByKey((prev) => ({ ...prev, [actionKey]: '' }));
      try {
        const result = await onSpawnTask(mode, task);
        if (!result?.ok) {
          setSpawnedByKey((prev) => ({ ...prev, [actionKey]: false }));
          setErrorByKey((prev) => ({
            ...prev,
            [actionKey]: String(result?.error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.',
          }));
          return;
        }
        setSpawnedByKey((prev) => ({ ...prev, [actionKey]: true }));
      } catch (error: any) {
        setSpawnedByKey((prev) => ({ ...prev, [actionKey]: false }));
        setErrorByKey((prev) => ({
          ...prev,
          [actionKey]: String(error?.message ?? error ?? 'Failed to queue drone.').trim() || 'Failed to queue drone.',
        }));
      } finally {
        setSpawningByKey((prev) => ({ ...prev, [actionKey]: false }));
      }
    },
    [onSpawnTask, spawningByKey],
  );
  const spawnTask = React.useCallback(
    async (taskKey: string, mode: DroneHubTaskSpawnMode, task: DroneHubTask) => {
      await runTaskAction(taskKey, mode, task);
    },
    [runTaskAction],
  );
  const spawnAllTasks = React.useCallback(
    async (mode: DroneHubTaskSpawnMode) => {
      if (spawningAllMode) return;
      setSpawningAllMode(mode);
      try {
        for (const entry of taskEntries) {
          const actionKey = `${entry.taskKey}:${mode}`;
          if (spawningByKey[actionKey] || spawnedByKey[actionKey]) continue;
          await runTaskAction(entry.taskKey, mode, entry.task);
        }
      } finally {
        setSpawningAllMode((current) => (current === mode ? null : current));
      }
    },
    [runTaskAction, spawnedByKey, spawningAllMode, spawningByKey, taskEntries],
  );

  if (tasks.length === 0) return null;

  const spawnAllBusy = spawningAllMode === 'spawn';
  const cloneAllBusy = spawningAllMode === 'clone';
  const canSpawnAny = taskEntries.some((entry) => {
    const actionKey = `${entry.taskKey}:spawn`;
    return !spawningByKey[actionKey] && !spawnedByKey[actionKey];
  });
  const canCloneAny = taskEntries.some((entry) => {
    const actionKey = `${entry.taskKey}:clone`;
    return !spawningByKey[actionKey] && !spawnedByKey[actionKey];
  });

  return (
    <div className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-inset)] overflow-hidden">
      <div className="px-3 py-2 border-b border-[var(--border-subtle)] flex items-center justify-between gap-2">
        <div
          className="text-[10px] font-semibold tracking-[0.08em] uppercase text-[var(--muted-dim)]"
          style={{ fontFamily: 'var(--display)' }}
        >
          Drone tasks
        </div>
        {tasks.length > 1 ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                void spawnAllTasks('spawn');
              }}
              disabled={!canSpawnAny || Boolean(spawningAllMode)}
              className="inline-flex items-center justify-center h-6 px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)] disabled:opacity-45 disabled:cursor-default"
              style={{ fontFamily: 'var(--display)' }}
              title="Spawn all tasks as fresh drones"
            >
              {spawnAllBusy ? 'Queuing…' : 'Spawn all'}
            </button>
            <button
              type="button"
              onClick={() => {
                void spawnAllTasks('clone');
              }}
              disabled={!canCloneAny || Boolean(spawningAllMode)}
              className="inline-flex items-center justify-center h-6 px-2 rounded border border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[9px] font-semibold uppercase tracking-wide text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)] disabled:opacity-45 disabled:cursor-default"
              style={{ fontFamily: 'var(--display)' }}
              title="Spawn all tasks as full clones"
            >
              {cloneAllBusy ? 'Queuing…' : 'Clone all'}
            </button>
          </div>
        ) : null}
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {taskEntries.map(({ task, taskKey }) => {
          const expanded = Boolean(expandedByKey[taskKey]);
          const spawnKey = `${taskKey}:spawn`;
          const cloneKey = `${taskKey}:clone`;
          const spawning = Boolean(spawningByKey[spawnKey]);
          const spawned = Boolean(spawnedByKey[spawnKey]);
          const cloneSpawning = Boolean(spawningByKey[cloneKey]);
          const cloneSpawned = Boolean(spawnedByKey[cloneKey]);
          const error = String(errorByKey[spawnKey] ?? '').trim();
          const cloneError = String(errorByKey[cloneKey] ?? '').trim();
          return (
            <div key={taskKey} className="group/task">
              <div className="flex items-start gap-2 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => toggleExpanded(taskKey)}
                  className="min-w-0 flex-1 text-left"
                  aria-expanded={expanded}
                  title={expanded ? 'Collapse task details' : 'Expand task details'}
                >
                  <div className="flex items-center gap-2">
                    <IconChevron down={expanded} className="w-3 h-3 text-[var(--muted)]" />
                    <span className="truncate text-[13px] font-medium text-[var(--fg)]">{task.name}</span>
                  </div>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void spawnTask(taskKey, 'spawn', task);
                    }}
                    disabled={spawning || spawned || Boolean(spawningAllMode)}
                    className={`inline-flex items-center justify-center h-7 px-2.5 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                      spawning || spawned || cloneSpawning || cloneSpawned
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100'
                    } ${
                      spawned
                        ? 'border-[var(--accent-muted)] bg-[var(--surface-inset-strong)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
                    } ${spawning ? 'cursor-wait' : ''}`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={spawned ? 'Drone queued' : 'Spawn a fresh drone for this task using repo defaults'}
                  >
                    {spawning ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IconSpinner className="w-3 h-3 text-[var(--accent)]" />
                        Queuing
                      </span>
                    ) : spawned ? (
                      'Queued'
                    ) : (
                      'Spawn'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      void spawnTask(taskKey, 'clone', task);
                    }}
                    disabled={cloneSpawning || cloneSpawned || Boolean(spawningAllMode)}
                    className={`inline-flex items-center justify-center h-7 px-2.5 rounded border text-[10px] font-semibold tracking-wide uppercase transition-all ${
                      spawning || spawned || cloneSpawning || cloneSpawned
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/task:opacity-100 focus-visible:opacity-100'
                    } ${
                      cloneSpawned
                        ? 'border-[var(--accent-muted)] bg-[var(--surface-inset-strong)] text-[var(--accent)]'
                        : 'border-[var(--border-subtle)] bg-[var(--surface-inset)] text-[var(--muted)] hover:border-[var(--accent-muted)] hover:text-[var(--accent)]'
                    } ${cloneSpawning ? 'cursor-wait' : ''}`}
                    style={{ fontFamily: 'var(--display)' }}
                    title={cloneSpawned ? 'Clone queued' : 'Spawn a full clone from this drone for this task'}
                  >
                    {cloneSpawning ? (
                      <span className="inline-flex items-center gap-1.5">
                        <IconSpinner className="w-3 h-3 text-[var(--accent)]" />
                        Queuing
                      </span>
                    ) : cloneSpawned ? (
                      'Queued'
                    ) : (
                      'Spawn clone'
                    )}
                  </button>
                </div>
              </div>
              {expanded ? (
                <div className="px-3 pb-3">
                  <div className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-soft)] px-3 py-2 text-[12px] leading-5 text-[var(--fg-secondary)] whitespace-pre-wrap">
                    {task.description}
                  </div>
                </div>
              ) : null}
              {error ? <div className="px-3 pb-3 text-[11px] text-[var(--red)]">{error}</div> : null}
              {cloneError ? <div className="px-3 pb-3 text-[11px] text-[var(--red)]">{cloneError}</div> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function pruneTaskState<T>(state: Record<string, T>, activeKeys: Set<string>): Record<string, T> {
  let changed = false;
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!activeKeys.has(key)) {
      changed = true;
      continue;
    }
    next[key] = value;
  }
  return changed ? next : state;
}
