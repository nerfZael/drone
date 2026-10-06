import React from 'react';

import { requestJson } from '../http';
import { useDropdownDismiss } from '../../ui/dropdown';
import { BackgroundTaskIcon } from '../chat/BackgroundTaskMessage';

export type ChatBackgroundTask = {
  id: string;
  type: string;
  description: string;
  startedAt: string;
};

// Most chats have no background work; check them rarely and watch active ones closely.
const IDLE_REFRESH_MS = 15_000;
const ACTIVE_REFRESH_MS = 5_000;

function normalizeTasks(raw: unknown): ChatBackgroundTask[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((task: any) => {
    const id = String(task?.id ?? '').trim();
    if (!id) return [];
    return [
      {
        id,
        type: String(task?.type ?? ''),
        description: String(task?.description ?? '').trim(),
        startedAt: String(task?.startedAt ?? ''),
      },
    ];
  });
}

function taskTypeLabel(type: string): string {
  if (type === 'local_bash') return 'Command or watch';
  if (type === 'local_agent') return 'Subagent';
  if (type === 'remote_agent') return 'Remote agent';
  return type.replace(/_/g, ' ');
}

function startedLabel(startedAt: string, now: number): string {
  const ms = Date.parse(startedAt);
  if (!Number.isFinite(ms)) return '';
  const minutes = Math.max(0, Math.floor((now - ms) / 60_000));
  if (minutes < 1) return 'Started just now';
  if (minutes < 60) return `Started ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `Started ${hours}h ago` : `Started ${Math.floor(hours / 24)}d ago`;
}

export function useChatBackgroundTasks(droneIdRaw: unknown, chatNameRaw: unknown) {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim();
  const key = droneId && chatName ? `${droneId}\u0000${chatName}` : '';
  const [snapshot, setSnapshot] = React.useState<{ key: string; tasks: ChatBackgroundTask[] }>({
    key,
    tasks: [],
  });
  const reloadRef = React.useRef<() => void>(() => {});

  React.useEffect(() => {
    let mounted = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = false;

    const schedule = () => {
      if (!mounted) return;
      if (timer) clearTimeout(timer);
      timer = null;
      // A hidden window checks again when it is shown.
      if (document.visibilityState === 'hidden') return;
      timer = setTimeout(() => void load(), active ? ACTIVE_REFRESH_MS : IDLE_REFRESH_MS);
    };
    const load = async () => {
      if (!key || busy) return;
      busy = true;
      try {
        const response = await requestJson<any>(
          `/api/claude-background-tasks?droneId=${encodeURIComponent(droneId)}&chatName=${encodeURIComponent(chatName)}`,
        );
        if (!mounted) return;
        const tasks = normalizeTasks(response?.tasks);
        active = tasks.length > 0;
        setSnapshot((current) =>
          current.key === key && JSON.stringify(current.tasks) === JSON.stringify(tasks)
            ? current
            : { key, tasks },
        );
      } catch {
        // Keep the last known list across transient Hub or daemon failures.
      } finally {
        busy = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void load();
    };
    reloadRef.current = () => void load();

    setSnapshot({ key, tasks: [] });
    void load();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [chatName, droneId, key]);

  return {
    tasks: snapshot.key === key ? snapshot.tasks : [],
    reload: () => reloadRef.current(),
  };
}

/**
 * Work a Claude chat left running in the background. When it reports, Claude
 * starts a turn on its own, so the chat can come back to life unprompted.
 */
export function ChatBackgroundTaskIndicator({
  droneId,
  chatName,
  tasks,
  reload,
}: {
  droneId: string;
  chatName: string;
  tasks: ChatBackgroundTask[];
  reload: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmStop, setConfirmStop] = React.useState(false);
  const [stopping, setStopping] = React.useState(false);
  const [stopError, setStopError] = React.useState<string | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  useDropdownDismiss(rootRef, open, setOpen);

  React.useEffect(() => {
    if (tasks.length === 0) setOpen(false);
  }, [tasks.length]);
  React.useEffect(() => {
    if (!open) {
      setConfirmStop(false);
      setStopError(null);
    }
  }, [open]);

  if (tasks.length === 0) return null;
  const summary = `Watching ${tasks.length} background task${tasks.length === 1 ? '' : 's'}`;
  const now = Date.now();

  const stopAll = async () => {
    setStopping(true);
    setStopError(null);
    try {
      await requestJson('/api/claude-background-tasks/stop', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ droneId, chatName }),
      });
      setOpen(false);
      reload();
    } catch (error: any) {
      setStopError(error?.message ?? String(error));
    } finally {
      setStopping(false);
      setConfirmStop(false);
    }
  };

  return (
    <div ref={rootRef} className="relative min-w-0 shrink">
      <button
        type="button"
        data-chat-background-task-indicator="true"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((current) => !current)}
        title={tasks.map((task) => task.description || taskTypeLabel(task.type)).join('\n')}
        className="inline-flex min-h-7 max-w-full items-center gap-1.5 rounded px-1.5 text-[.6875rem] font-medium text-[var(--muted-dim)] transition-colors hover:bg-[var(--hover)] hover:text-[var(--chat-composer-control-fg)]"
      >
        <span className="text-[var(--accent)]">
          <BackgroundTaskIcon className="h-3.5 w-3.5" />
        </span>
        <span className="truncate">{summary}</span>
      </button>
      {open ? (
        <div
          role="dialog"
          aria-label="Background tasks"
          className="absolute bottom-full left-0 z-50 mb-2 w-[min(24rem,calc(100vw-2rem))] overflow-hidden rounded-[var(--radius-large)] border border-[var(--border)] bg-[var(--panel-alt)] shadow-[0_18px_55px_var(--shadow-color)]"
        >
          <div className="border-b border-[var(--border-subtle)] px-3 py-2.5">
            <div className="text-11 font-[var(--weight-semibold)] text-[var(--fg)]">
              Background tasks
            </div>
            <div className="mt-0.5 text-10 text-[var(--muted-dim)]">
              Claude left these running. When one reports, this chat starts a turn on its own.
            </div>
          </div>
          <div className="max-h-[min(20rem,55vh)] overflow-y-auto p-1.5">
            {tasks.map((task) => (
              <div
                key={task.id}
                className="rounded-[var(--radius-medium)] px-2.5 py-2 hover:bg-[var(--surface-soft)]"
              >
                <div className="break-words font-mono text-11 text-[var(--fg-secondary)]">
                  {task.description || task.id}
                </div>
                <div className="mt-1 text-10 text-[var(--muted-dim)]">
                  {[taskTypeLabel(task.type), startedLabel(task.startedAt, now)]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-3 py-2">
            <div className="min-w-0 text-10 text-[var(--muted-dim)]">
              {stopError ? (
                <span role="alert" className="text-[var(--red)]">
                  {stopError}
                </span>
              ) : confirmStop ? (
                'Stops every task and ends this Claude session.'
              ) : null}
            </div>
            <button
              type="button"
              data-chat-background-task-stop="true"
              disabled={stopping}
              onClick={() => (confirmStop ? void stopAll() : setConfirmStop(true))}
              className="shrink-0 rounded px-2 py-1 text-11 font-[var(--weight-semibold)] text-[var(--red)] transition-colors hover:bg-[var(--hover)] disabled:opacity-60"
            >
              {stopping ? 'Stopping…' : confirmStop ? 'Confirm stop' : 'Stop all'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
