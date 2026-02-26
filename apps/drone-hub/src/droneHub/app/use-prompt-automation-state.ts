import React from 'react';
import type { ChatInputAutomationAction } from '../chat';
import { requestJson } from '../http';
import { AUTOMATION_RUNS_MAX, AUTOMATION_RUNS_MIN, type AutomationConfig } from './automation-config';
import { beginRecordBusyKey, removeRecordKey } from './keyed-record-state';

const PROMPT_AUTOMATION_STATUS_POLL_MS = 1200;

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
  enqueuedAt: string;
};

export type PromptAutomationJobSnapshot = {
  status: PromptAutomationJobStatus;
  running: boolean;
  automationId: string | null;
  automationLabel: string | null;
  runsTotal: number;
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

function queuedItemsFromJob(job: PromptAutomationJobSnapshot | null): PromptAutomationQueuedSnapshot[] {
  return Array.isArray(job?.queued) ? job.queued : [];
}

function queuedCountFromJob(job: PromptAutomationJobSnapshot | null): number {
  return Math.max(0, Number(job?.queuedCount ?? queuedItemsFromJob(job).length) || 0);
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
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/automations/status`,
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
    (automation: AutomationConfig) => {
      if (promptAutomationBusy) return;
      setPromptAutomationBusy(true);
      setPromptAutomationError(null);
      setPromptAutomationStatusError(null);
      if (chatUiMode !== 'transcript') {
        setPromptAutomationBusy(false);
        setPromptAutomationError('Automation is only available in transcript mode (builtin agents).');
        return;
      }
      const automationId = String(automation.id ?? '').trim();
      const automationLabel = String(automation.label ?? '').trim() || 'Automation';
      const prompt = String(automation.prompt ?? '').trim();
      const onFailurePrompt = String(automation.onFailurePrompt ?? '').trim();
      if (!prompt) {
        setPromptAutomationBusy(false);
        setPromptAutomationError(`"${automationLabel}" prompt is empty. Update it in Settings > Automation.`);
        return;
      }
      const runs = clampPromptAutomationRuns(automation.runs);
      void (async () => {
        try {
          const data = await requestJson<PromptAutomationStatusResponse>(
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/automations/start`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ automationId, automationLabel, prompt, onFailurePrompt, runs }),
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
        const data = await requestJson<PromptAutomationStatusResponse>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/automations/stop`,
          { method: 'POST' },
        );
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
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/automations/queued/${encodeURIComponent(queueId)}`,
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
    const actions = automations.map((automation, idx) => {
      const configLabel = String(automation.label ?? '').trim() || `Automation ${idx + 1}`;
      const configPrompt = String(automation.prompt ?? '').trim();
      const configOnFailurePrompt = String(automation.onFailurePrompt ?? '').trim();
      const configRuns = clampPromptAutomationRuns(automation.runs);
      const active = running && runningAutomationId === automation.id;
      const queuedForAction = queuedByAutomationId.get(String(automation.id ?? '').trim()) ?? 0;
      return {
        id: `automation:${automation.id}`,
        label: active ? `Stop ${configLabel}` : laneBusy ? `Queue ${configLabel}` : `Run ${configLabel}`,
        onSelect: () => {
          if (active) stopPromptAutomation();
          else startPromptAutomation(automation);
        },
        title: active
          ? `Stop "${configLabel}".`
          : !supportedMode
            ? 'Switch to a builtin agent (transcript mode) to run automations.'
            : configPrompt
                ? configOnFailurePrompt
                  ? laneBusy
                    ? `Queue "${configLabel}" (${configRuns} runs). It will run after ${queueAfterText}.`
                    : `Run "${configLabel}" for ${configRuns} iterations, then send the final message if at least one run succeeds.`
                  : laneBusy
                    ? `Queue "${configLabel}" (${configRuns} runs). It will run after ${queueAfterText}.`
                    : `Run "${configLabel}" for ${configRuns} iterations, waiting for each response.`
                : `Set a prompt for "${configLabel}" in Settings > Automation first.`,
        disabled: promptAutomationBusy || (!active && (!supportedMode || configPrompt.length === 0)),
        active,
        statusText: active
          ? `${completedRuns}/${totalRuns}`
          : queuedForAction > 0
            ? `${queuedForAction} queued`
            : laneBusy
              ? `queue (${configRuns} runs)`
              : `${configRuns} runs`,
      } satisfies ChatInputAutomationAction;
    });

    const hasActiveAction = actions.some((action) => action.active);
    if (!hasActiveAction && laneBusy) {
      actions.push({
        id: 'automation:active',
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
      const msg = promptAutomationError.replace(/\s+/g, ' ').trim();
      return `Automation error: ${msg.length > 120 ? `${msg.slice(0, 117)}...` : msg}`;
    }
    if (!promptAutomationJob) {
      if (!promptAutomationStatusError) return '';
      const msg = promptAutomationStatusError.replace(/\s+/g, ' ').trim();
      return `Automation status unavailable: ${msg.length > 96 ? `${msg.slice(0, 93)}...` : msg}`;
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
      const msg = promptAutomationJob.error.replace(/\s+/g, ' ').trim();
      return `${label} failed: ${msg.length > 120 ? `${msg.slice(0, 117)}...` : msg}`;
    }
    if (promptAutomationJob.status === 'stopped') return `${label} stopped.`;
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
