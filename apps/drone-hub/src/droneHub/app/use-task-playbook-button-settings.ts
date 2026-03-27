import React from 'react';
import type { TaskPlaybookButton } from '../types';
import type { TaskPlaybookButtonSettingsResponse } from './settings-types';

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseTaskPlaybookButtonSettingsArgs = {
  enabled: boolean;
  requestJson: RequestJson;
};

export type UseTaskPlaybookButtonSettingsResult = {
  taskPlaybookButtons: TaskPlaybookButton[];
  taskPlaybookButtonsLoading: boolean;
  taskPlaybookButtonsSaving: boolean;
  taskPlaybookButtonsError: string | null;
  taskPlaybookButtonsUpdatedAt: string | null;
  reloadTaskPlaybookButtons: () => Promise<void>;
  onTaskPlaybookButtonsChange: React.Dispatch<React.SetStateAction<TaskPlaybookButton[]>>;
};

const REFRESH_INTERVAL_MS = 5_000;

export function useTaskPlaybookButtonSettings({
  enabled,
  requestJson,
}: UseTaskPlaybookButtonSettingsArgs): UseTaskPlaybookButtonSettingsResult {
  const [taskPlaybookButtons, setTaskPlaybookButtons] = React.useState<TaskPlaybookButton[]>([]);
  const [taskPlaybookButtonsLoading, setTaskPlaybookButtonsLoading] = React.useState(false);
  const [taskPlaybookButtonsSaving, setTaskPlaybookButtonsSaving] = React.useState(false);
  const [taskPlaybookButtonsError, setTaskPlaybookButtonsError] = React.useState<string | null>(null);
  const [taskPlaybookButtonsUpdatedAt, setTaskPlaybookButtonsUpdatedAt] = React.useState<string | null>(null);
  const loadingRef = React.useRef(false);
  const savingRef = React.useRef(false);
  const queuedButtonsRef = React.useRef<TaskPlaybookButton[] | null>(null);
  const loadedOnceRef = React.useRef(false);

  const applyServerButtons = React.useCallback((data: TaskPlaybookButtonSettingsResponse) => {
    setTaskPlaybookButtons(Array.isArray(data.taskPlaybookButtons) ? data.taskPlaybookButtons : []);
    setTaskPlaybookButtonsUpdatedAt(data.updatedAt);
    loadedOnceRef.current = true;
  }, []);

  const reloadTaskPlaybookButtons = React.useCallback(async (opts?: { silent?: boolean }) => {
    if (!enabled) return;
    const silent = opts?.silent === true;
    loadingRef.current = true;
    if (!silent) setTaskPlaybookButtonsLoading(true);
    try {
      const data = await requestJson<TaskPlaybookButtonSettingsResponse>('/api/settings/task-playbook-buttons');
      applyServerButtons(data);
      setTaskPlaybookButtonsError(null);
    } catch (err: any) {
      setTaskPlaybookButtonsError(err?.message ?? String(err));
    } finally {
      loadingRef.current = false;
      if (!silent) setTaskPlaybookButtonsLoading(false);
    }
  }, [applyServerButtons, enabled, requestJson]);

  const flushQueuedButtons = React.useCallback(async () => {
    if (savingRef.current) return;
    const nextQueued = queuedButtonsRef.current;
    if (!nextQueued) return;
    savingRef.current = true;
    setTaskPlaybookButtonsSaving(true);
    try {
      while (queuedButtonsRef.current) {
        const nextButtons = queuedButtonsRef.current;
        queuedButtonsRef.current = null;
        try {
          const data = await requestJson<TaskPlaybookButtonSettingsResponse>('/api/settings/task-playbook-buttons', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ taskPlaybookButtons: nextButtons }),
          });
          applyServerButtons(data);
          setTaskPlaybookButtonsError(null);
        } catch (err: any) {
          await reloadTaskPlaybookButtons({ silent: true });
          setTaskPlaybookButtonsError(err?.message ?? String(err));
          break;
        }
      }
    } finally {
      savingRef.current = false;
      setTaskPlaybookButtonsSaving(false);
    }
  }, [applyServerButtons, reloadTaskPlaybookButtons, requestJson]);

  const onTaskPlaybookButtonsChange = React.useCallback<React.Dispatch<React.SetStateAction<TaskPlaybookButton[]>>>((next) => {
    setTaskPlaybookButtons((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      queuedButtonsRef.current = resolved;
      queueMicrotask(() => {
        void flushQueuedButtons();
      });
      return resolved;
    });
  }, [flushQueuedButtons]);

  React.useEffect(() => {
    if (!enabled) return;
    void reloadTaskPlaybookButtons();
  }, [enabled, reloadTaskPlaybookButtons]);

  React.useEffect(() => {
    if (!enabled) return;
    const interval = window.setInterval(() => {
      if (loadingRef.current || savingRef.current || queuedButtonsRef.current) return;
      void reloadTaskPlaybookButtons({ silent: true });
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [enabled, reloadTaskPlaybookButtons]);

  React.useEffect(() => {
    if (enabled || !loadedOnceRef.current) return;
    setTaskPlaybookButtonsError(null);
    setTaskPlaybookButtonsLoading(false);
    setTaskPlaybookButtonsSaving(false);
  }, [enabled]);

  return {
    taskPlaybookButtons,
    taskPlaybookButtonsLoading,
    taskPlaybookButtonsSaving,
    taskPlaybookButtonsError,
    taskPlaybookButtonsUpdatedAt,
    reloadTaskPlaybookButtons,
    onTaskPlaybookButtonsChange,
  };
}
