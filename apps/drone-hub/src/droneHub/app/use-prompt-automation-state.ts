import React from 'react';
import type { ChatInputAutomationAction } from '../chat';
import { requestJson } from '../http';
import {
  AUTOMATION_RUNS_MAX,
  AUTOMATION_RUNS_MIN,
  automationSleepSecondsFromConfig,
  formatAutomationSleepInterval,
  type AutomationConfig,
} from './automation-config';
import { beginRecordBusyKey, removeRecordKey } from './keyed-record-state';

const PROMPT_AUTOMATION_STATUS_POLL_MS = 1200;
const PROMPT_AUTOMATION_ERROR_HINT_MAX_CHARS = 120;
const PROMPT_AUTOMATION_STATUS_HINT_MAX_CHARS = 96;

function clampPromptAutomationRuns(value: unknown): number {
  const num = Number(value);
  if (!Number.isFinite(num)) return AUTOMATION_RUNS_MIN;
  return Math.min(AUTOMATION_RUNS_MAX, Math.max(AUTOMATION_RUNS_MIN, Math.round(num)));
}

type PromptAutomationJobStatus = 'idle' | 'running' | 'completed' | 'failed' | 'stopped';

export type PromptAutomationQueuedSnapshot = {
  queueId: string;
  automationId: string;
  automationLabel: string;
  runsTotal: number;
  sleepBetweenRunsSeconds?: number;
  stopPhrase?: string;
  stopPhraseCaseSensitive?: boolean;
  enqueuedAt: string;
};

export type PromptAutomationJobSnapshot = {
  status: PromptAutomationJobStatus;
  running: boolean;
  automationId: string | null;
  automationLabel: string | null;
  runsTotal: number;
  sleepBetweenRunsSeconds?: number;
  stopPhrase?: string;
  stopPhraseCaseSensitive?: boolean;
  finishedEarly?: boolean;
  finishedEarlyReason?: string | null;
  finishedEarlyRunIndex?: number | null;
  runsCompleted: number;
  startedAt: string | null;
  updatedAt: string | null;
  lastPromptId: string | null;
  error: string | null;
  queuedCount?: number;
  queued?: PromptAutomationQueuedSnapshot[];
};

export type PromptAutomationStatusResponse = {
  ok: true;
  automation: 'prompt-loop';
  id: string;
  name: string;
  chat: string;
  job: PromptAutomationJobSnapshot;
};

type PromptAutomationQueuedCancelResponse = PromptAutomationStatusResponse & {
  queueId: string;
  cancelled: boolean;
  alreadySubmitted: boolean;
};

type UsePromptAutomationStateArgs = {
  droneId: string;
  chatName: string;
  chatUiMode: 'transcript' | 'cli';
  automations: AutomationConfig[];
};

type PromptAutomationRuntimeConfig = {
  automationId: string;
  automationLabel: string;
  prompt: string;
  onFailurePrompt: string;
  runs: number;
  sleepBetweenRunsSeconds: number;
  sleepBetweenRunsLabel: string;
  sleepSuffix: string;
  stopPhrase: string;
  stopPhraseCaseSensitive: boolean;
  stopPhraseSuffix: string;
};

function queuedItemsFromJob(job: PromptAutomationJobSnapshot | null): PromptAutomationQueuedSnapshot[] {
  return Array.isArray(job?.queued) ? job.queued : [];
}

function queuedCountFromJob(job: PromptAutomationJobSnapshot | null): number {
  return Math.max(0, Number(job?.queuedCount ?? queuedItemsFromJob(job).length) || 0);
}

function automationActionTitle(opts: {
  active: boolean;
  configLabel: string;
  configRuns: number;
  configPrompt: string;
  configOnFailurePrompt: string;
  laneBusy: boolean;
  queueAfterText: string;
  sleepSuffix: string;
  stopPhraseSuffix: string;
  supportedMode: boolean;
}): string {
  const {
    active,
    configLabel,
    configRuns,
    configPrompt,
    configOnFailurePrompt,
    laneBusy,
    queueAfterText,
    sleepSuffix,
    stopPhraseSuffix,
    supportedMode,
  } = opts;

  if (active) return `Stop "${configLabel}".`;
  if (!supportedMode) return 'Switch to a builtin agent (transcript mode) to run automations.';
  if (!configPrompt) return `Set a prompt for "${configLabel}" in Settings > Automation first.`;
  if (laneBusy) return `Queue "${configLabel}" (${configRuns} runs${sleepSuffix}). It will run after ${queueAfterText}.`;
  if (configOnFailurePrompt) {
    return `Run "${configLabel}" for ${configRuns} iterations${sleepSuffix}${stopPhraseSuffix}, then send the final message if at least one run succeeds.`;
  }
  return `Run "${configLabel}" for ${configRuns} iterations${sleepSuffix}${stopPhraseSuffix}, waiting for each response.`;
}

function automationActionStatusText(opts: {
  active: boolean;
  completedRuns: number;
  totalRuns: number;
  queuedForAction: number;
  laneBusy: boolean;
  configRuns: number;
}): string {
  const { active, completedRuns, totalRuns, queuedForAction, laneBusy, configRuns } = opts;
  if (active) return `${completedRuns}/${totalRuns}`;
  if (queuedForAction > 0) return `${queuedForAction} queued`;
  if (laneBusy) return `queue (${configRuns} runs)`;
  return `${configRuns} runs`;
}

function promptAutomationApiPath(droneId: string, chatName: string, suffix: string): string {
  return `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/automations/${suffix}`;
}

function normalizeHintMessage(message: unknown, maxChars: number): string {
  const normalized = String(message ?? '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizePromptAutomationRuntimeConfig(
  automation: AutomationConfig,
  opts?: { fallbackLabel?: string },
): PromptAutomationRuntimeConfig {
  const fallbackLabel = String(opts?.fallbackLabel ?? '').trim() || 'Automation';
  const automationId = String(automation.id ?? '').trim();
  const automationLabel = String(automation.label ?? '').trim() || fallbackLabel;
  const prompt = String(automation.prompt ?? '').trim();
  const onFailurePrompt = String(automation.onFailurePrompt ?? '').trim();
  const runs = clampPromptAutomationRuns(automation.runs);
  const sleepBetweenRunsSeconds = automationSleepSecondsFromConfig(automation);
  const sleepBetweenRunsLabel = formatAutomationSleepInterval(automation);
  const sleepSuffix = sleepBetweenRunsSeconds > 0 ? ` with ${sleepBetweenRunsLabel.toLowerCase()} between runs` : '';
  const stopPhrase = String(automation.stopPhrase ?? '').trim();
  const stopPhraseCaseSensitive = Boolean(automation.stopPhraseCaseSensitive);
  const stopPhraseSuffix = stopPhrase
    ? `; stop early when output contains "${stopPhrase}"${stopPhraseCaseSensitive ? ' (case-sensitive)' : ''}`
    : '';

  return {
    automationId,
    automationLabel,
    prompt,
    onFailurePrompt,
    runs,
    sleepBetweenRunsSeconds,
    sleepBetweenRunsLabel,
    sleepSuffix,
    stopPhrase,
    stopPhraseCaseSensitive,
    stopPhraseSuffix,
  };
}

export function usePromptAutomationState({
  droneId,
  chatName,
  chatUiMode,
  automations,
}: UsePromptAutomationStateArgs) {
  const [promptAutomationJob, setPromptAutomationJob] = React.useState<PromptAutomationJobSnapshot | null>(null);
  const [promptAutomationBusy, setPromptAutomationBusy] = React.useState(false);
  const [promptAutomationError, setPromptAutomationError] = React.useState<string | null>(null);
  const [promptAutomationStatusError, setPromptAutomationStatusError] = React.useState<string | null>(null);
  const [cancellingQueuedAutomationById, setCancellingQueuedAutomationById] = React.useState<Record<string, true>>({});
  const [cancelQueuedAutomationErrorById, setCancelQueuedAutomationErrorById] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    setCancellingQueuedAutomationById({});
    setCancelQueuedAutomationErrorById({});
  }, [chatName, droneId]);

  React.useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      try {
        const data = await requestJson<PromptAutomationStatusResponse>(
          promptAutomationApiPath(droneId, chatName, 'status'),
        );
        if (!mounted) return;
        setPromptAutomationJob(data.job);
        setPromptAutomationStatusError(null);
      } catch (e: any) {
        if (!mounted) return;
        setPromptAutomationStatusError(e?.message ?? String(e));
      }
    };
    void load();
    timer = setInterval(() => {
      void load();
    }, PROMPT_AUTOMATION_STATUS_POLL_MS);
    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, [chatName, droneId]);

  const startPromptAutomation = React.useCallback(
    (automation: AutomationConfig, opts?: { runs?: unknown }) => {
      if (promptAutomationBusy) return;
      setPromptAutomationBusy(true);
      setPromptAutomationError(null);
      setPromptAutomationStatusError(null);
      if (chatUiMode !== 'transcript') {
        setPromptAutomationBusy(false);
        setPromptAutomationError('Automation is only available in transcript mode (builtin agents).');
        return;
      }
      const config = normalizePromptAutomationRuntimeConfig(automation);
      if (!config.prompt) {
        setPromptAutomationBusy(false);
        setPromptAutomationError(`"${config.automationLabel}" prompt is empty. Update it in Settings > Automation.`);
        return;
      }
      const runs = clampPromptAutomationRuns(opts?.runs ?? config.runs);
      void (async () => {
        try {
          const data = await requestJson<PromptAutomationStatusResponse>(
            promptAutomationApiPath(droneId, chatName, 'start'),
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                automationId: config.automationId,
                automationLabel: config.automationLabel,
                prompt: config.prompt,
                onFailurePrompt: config.onFailurePrompt,
                runs,
                sleepBetweenRunsSeconds: config.sleepBetweenRunsSeconds,
                stopPhrase: config.stopPhrase,
                stopPhraseCaseSensitive: config.stopPhraseCaseSensitive,
              }),
            },
          );
          setPromptAutomationJob(data.job);
          setPromptAutomationStatusError(null);
        } catch (e: any) {
          setPromptAutomationError(e?.message ?? String(e));
        } finally {
          setPromptAutomationBusy(false);
        }
      })();
    },
    [chatName, chatUiMode, droneId, promptAutomationBusy],
  );

  const stopPromptAutomation = React.useCallback(() => {
    if (promptAutomationBusy) return;
    setPromptAutomationBusy(true);
    setPromptAutomationError(null);
    setPromptAutomationStatusError(null);
    void (async () => {
      try {
        const data = await requestJson<PromptAutomationStatusResponse>(promptAutomationApiPath(droneId, chatName, 'stop'), { method: 'POST' });
        setPromptAutomationJob(data.job);
      } catch (e: any) {
        setPromptAutomationError(e?.message ?? String(e));
      } finally {
        setPromptAutomationBusy(false);
      }
    })();
  }, [chatName, droneId, promptAutomationBusy]);

  const cancelQueuedPromptAutomation = React.useCallback(
    (queueIdRaw: string) => {
      const queueId = String(queueIdRaw ?? '').trim();
      if (!queueId) return;

      if (!beginRecordBusyKey(setCancellingQueuedAutomationById, queueId)) return;
      setCancelQueuedAutomationErrorById((prev) => {
        return removeRecordKey(prev, queueId);
      });

      void (async () => {
        try {
          const data = await requestJson<PromptAutomationQueuedCancelResponse>(
            promptAutomationApiPath(droneId, chatName, `queued/${encodeURIComponent(queueId)}`),
            { method: 'DELETE' },
          );
          setPromptAutomationJob(data.job);
          setPromptAutomationStatusError(null);
          if (data.alreadySubmitted) {
            setPromptAutomationError('Queued automation was already submitted to the agent.');
          } else {
            setPromptAutomationError(null);
          }
        } catch (e: any) {
          setCancelQueuedAutomationErrorById((prev) => ({ ...prev, [queueId]: e?.message ?? String(e) }));
        } finally {
          setCancellingQueuedAutomationById((prev) => {
            return removeRecordKey(prev, queueId);
          });
        }
      })();
    },
    [chatName, droneId],
  );

  const chatAutomationActions = React.useMemo<ChatInputAutomationAction[]>(() => {
    const running = Boolean(promptAutomationJob?.running);
    const runningAutomationId = String(promptAutomationJob?.automationId ?? '').trim();
    const runningAutomationLabel = String(promptAutomationJob?.automationLabel ?? '').trim() || 'Automation';
    const completedRuns = promptAutomationJob?.runsCompleted ?? 0;
    const totalRuns = promptAutomationJob?.runsTotal ?? 0;
    const queuedItems = queuedItemsFromJob(promptAutomationJob);
    const queuedTotal = queuedCountFromJob(promptAutomationJob);
    const laneBusy = running || queuedTotal > 0;
    const queueAfterText = running
      ? `${runningAutomationLabel} and any already queued automations`
      : 'already queued automations';
    const queuedByAutomationId = new Map<string, number>();
    for (const item of queuedItems) {
      const id = String(item?.automationId ?? '').trim();
      if (!id) continue;
      queuedByAutomationId.set(id, (queuedByAutomationId.get(id) ?? 0) + 1);
    }
    const supportedMode = chatUiMode === 'transcript';
    const actions: ChatInputAutomationAction[] = automations.map((automation, idx) => {
      const config = normalizePromptAutomationRuntimeConfig(automation, { fallbackLabel: `Automation ${idx + 1}` });
      const active = running && runningAutomationId === config.automationId;
      const queuedForAction = queuedByAutomationId.get(config.automationId) ?? 0;
      return {
        id: `automation:${config.automationId}`,
        kind: 'automation',
        label: active ? `Stop ${config.automationLabel}` : laneBusy ? `Queue ${config.automationLabel}` : `Run ${config.automationLabel}`,
        onSelect: () => {
          if (active) stopPromptAutomation();
          else startPromptAutomation(automation);
        },
        onSelectWithRuns: active
          ? undefined
          : (runs) => {
              startPromptAutomation(automation, { runs });
            },
        title: automationActionTitle({
          active,
          configLabel: config.automationLabel,
          configRuns: config.runs,
          configPrompt: config.prompt,
          configOnFailurePrompt: config.onFailurePrompt,
          laneBusy,
          queueAfterText,
          sleepSuffix: config.sleepSuffix,
          stopPhraseSuffix: config.stopPhraseSuffix,
          supportedMode,
        }),
        disabled: promptAutomationBusy || (!active && (!supportedMode || config.prompt.length === 0)),
        active,
        defaultRuns: config.runs,
        minRuns: AUTOMATION_RUNS_MIN,
        maxRuns: AUTOMATION_RUNS_MAX,
        sleepBetweenRunsLabel: config.sleepBetweenRunsLabel,
        statusText: automationActionStatusText({
          active,
          completedRuns,
          totalRuns,
          queuedForAction,
          laneBusy,
          configRuns: config.runs,
        }),
      } satisfies ChatInputAutomationAction;
    });

    const hasActiveAction = actions.some((action) => action.active);
    if (!hasActiveAction && laneBusy) {
      actions.push({
        id: 'automation-control:active',
        kind: 'control',
        label: running ? `Stop ${runningAutomationLabel}` : 'Clear automation queue',
        onSelect: () => stopPromptAutomation(),
        title: running
          ? `Stop "${runningAutomationLabel}" and clear queued automations.`
          : 'Clear queued automations.',
        disabled: promptAutomationBusy,
        active: true,
        statusText: running ? `${completedRuns}/${totalRuns}` : `${queuedTotal} queued`,
      });
    }
    return actions;
  }, [automations, chatUiMode, promptAutomationBusy, promptAutomationJob, startPromptAutomation, stopPromptAutomation]);

  const automationModeHint = React.useMemo(() => {
    if (promptAutomationError) {
      return `Automation error: ${normalizeHintMessage(promptAutomationError, PROMPT_AUTOMATION_ERROR_HINT_MAX_CHARS)}`;
    }
    if (!promptAutomationJob) {
      if (!promptAutomationStatusError) return '';
      return `Automation status unavailable: ${normalizeHintMessage(promptAutomationStatusError, PROMPT_AUTOMATION_STATUS_HINT_MAX_CHARS)}`;
    }
    const queuedCount = queuedCountFromJob(promptAutomationJob);
    const label = String(promptAutomationJob.automationLabel ?? '').trim() || 'Automation';
    if (promptAutomationJob.running) {
      return `${label} running ${promptAutomationJob.runsCompleted}/${promptAutomationJob.runsTotal}${
        queuedCount > 0 ? ` (${queuedCount} queued)` : ''
      }`;
    }
    if (queuedCount > 0) {
      return `Automation queue: ${queuedCount} waiting.`;
    }
    if (promptAutomationJob.status === 'failed' && promptAutomationJob.error) {
      return `${label} failed: ${normalizeHintMessage(promptAutomationJob.error, PROMPT_AUTOMATION_ERROR_HINT_MAX_CHARS)}`;
    }
    if (promptAutomationJob.status === 'stopped') return `${label} stopped.`;
    if (promptAutomationJob.finishedEarly) {
      const run = Number(promptAutomationJob.finishedEarlyRunIndex ?? promptAutomationJob.runsCompleted) || promptAutomationJob.runsCompleted;
      const stopPhrase = String(promptAutomationJob.stopPhrase ?? '').trim();
      if (stopPhrase) {
        return `${label} finished early at run ${run}/${promptAutomationJob.runsTotal} (matched stop phrase).`;
      }
      return `${label} finished early at run ${run}/${promptAutomationJob.runsTotal}.`;
    }
    if (promptAutomationJob.status === 'completed' && promptAutomationJob.runsTotal > 0) {
      return `${label} complete ${promptAutomationJob.runsCompleted}/${promptAutomationJob.runsTotal}`;
    }
    return '';
  }, [promptAutomationError, promptAutomationJob, promptAutomationStatusError]);

  const queuedAutomationItems = React.useMemo(
    () => queuedItemsFromJob(promptAutomationJob),
    [promptAutomationJob],
  );

  return {
    automationModeHint,
    cancelQueuedAutomationErrorById,
    cancellingQueuedAutomationById,
    cancelQueuedPromptAutomation,
    chatAutomationActions,
    queuedAutomationItems,
  };
}
