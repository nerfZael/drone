import React from 'react';
import type { DroneSummary, RepoSummary } from '../types';
import type { RepoOpErrorMeta } from './helpers';
import { droneHomePath } from './helpers';

type LaunchHint =
  | {
      context: 'terminal' | 'code' | 'cursor';
      command?: string;
      launcher?: string;
      kind: 'copied';
    }
  | null;

type RepoOpState = null | { kind: 'pull' | 'push' | 'reseed' };

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseWorkspaceActionsArgs = {
  autoDelete: boolean;
  currentDrone: DroneSummary | null;
  selectedChat: string;
  terminalEmulator: string;
  activeRepoPath: string;
  setActiveRepoPath: React.Dispatch<React.SetStateAction<string>>;
  requestJson: RequestJson;
};

export function useWorkspaceActions({
  autoDelete,
  currentDrone,
  selectedChat,
  terminalEmulator,
  activeRepoPath,
  setActiveRepoPath,
  requestJson,
}: UseWorkspaceActionsArgs) {
  const [deletingRepos, setDeletingRepos] = React.useState<Record<string, boolean>>({});
  const [openingTerminal, setOpeningTerminal] = React.useState<{ mode: 'ssh' | 'agent' } | null>(null);
  const [openingEditor, setOpeningEditor] = React.useState<{ editor: 'code' | 'cursor' } | null>(null);
  const [launchHint, setLaunchHint] = React.useState<LaunchHint>(null);
  const [repoOp, setRepoOp] = React.useState<RepoOpState>(null);
  const [repoOpError, setRepoOpError] = React.useState<string | null>(null);
  const [repoOpErrorMeta, setRepoOpErrorMeta] = React.useState<RepoOpErrorMeta | null>(null);

  const shouldConfirmDelete = React.useCallback((): boolean => !autoDelete, [autoDelete]);

  const githubUrlForRepo = React.useCallback((repo: RepoSummary): string | null => {
    if (repo.github && repo.github.owner && repo.github.repo) {
      return `https://github.com/${repo.github.owner}/${repo.github.repo}`;
    }
    return null;
  }, []);

  const clearRepoOperationError = React.useCallback(() => {
    setRepoOpError(null);
    setRepoOpErrorMeta(null);
  }, []);

  const setRepoOperationError = React.useCallback((message: string, meta?: RepoOpErrorMeta | null) => {
    setRepoOpError(message);
    setRepoOpErrorMeta(meta ?? null);
  }, []);

  const deleteRepo = React.useCallback(
    async (repoPath: string) => {
      const path = String(repoPath ?? '').trim();
      if (!path) return;
      if (shouldConfirmDelete()) {
        const ok = window.confirm(`Remove repo "${path}" from the registry?`);
        if (!ok) return;
      }
      setDeletingRepos((prev) => ({ ...prev, [path]: true }));
      try {
        await requestJson(`/api/repos?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
        if (activeRepoPath === path) setActiveRepoPath('');
      } catch (e: any) {
        console.error('[DroneHub] delete repo failed', { path, error: e });
      } finally {
        setDeletingRepos((prev) => {
          if (!prev[path]) return prev;
          const next = { ...prev };
          delete next[path];
          return next;
        });
      }
    },
    [activeRepoPath, requestJson, setActiveRepoPath, shouldConfirmDelete],
  );

  const openDroneTerminal = React.useCallback(
    async (mode: 'ssh' | 'agent') => {
      if (!currentDrone) return;
      setOpeningTerminal({ mode });
      try {
        const qs = new URLSearchParams();
        qs.set('mode', mode);
        qs.set('chat', selectedChat || 'default');
        qs.set('cwd', droneHomePath(currentDrone));
        if (terminalEmulator && terminalEmulator !== 'auto') qs.set('terminal', terminalEmulator);
        const url = `/api/drones/${encodeURIComponent(currentDrone.id)}/open-terminal?${qs.toString()}`;
        const r = await fetch(url, { method: 'POST' });
        const text = await r.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // ignore malformed json
        }

        const cmd = String(data?.manualCommand ?? data?.command ?? '');
        const launcher = typeof data?.launcher === 'string' ? data.launcher : undefined;
        if (!r.ok) {
          const msg = data?.error ?? `${r.status} ${r.statusText}`;
          if (cmd) {
            try {
              await navigator.clipboard.writeText(cmd);
              setLaunchHint({ context: 'terminal', command: cmd, launcher, kind: 'copied' });
              setTimeout(() => setLaunchHint(null), 12_000);
            } catch {
              // ignore clipboard issues
            }
          }
          console.error('[DroneHub] open terminal failed', {
            mode,
            drone: currentDrone.name,
            terminal: terminalEmulator,
            status: r.status,
            statusText: r.statusText,
            msg,
            command: cmd || null,
            launcher: launcher || null,
          });
          return;
        }
      } catch (e: any) {
        console.error('[DroneHub] open terminal request errored', {
          mode,
          drone: currentDrone?.name ?? null,
          terminal: terminalEmulator,
          error: e,
        });
      } finally {
        setOpeningTerminal(null);
      }
    },
    [currentDrone, selectedChat, terminalEmulator],
  );

  const openDroneEditor = React.useCallback(
    async (editor: 'code' | 'cursor') => {
      if (!currentDrone) return;
      setOpeningEditor({ editor });
      try {
        const qs = new URLSearchParams();
        qs.set('editor', editor);
        qs.set('cwd', droneHomePath(currentDrone));
        const url = `/api/drones/${encodeURIComponent(currentDrone.id)}/open-editor?${qs.toString()}`;
        const r = await fetch(url, { method: 'POST' });
        const text = await r.text();
        let data: any = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          // ignore malformed json
        }

        const cmd = String(data?.manualCommand ?? data?.command ?? '');
        const launcher = typeof data?.launcher === 'string' ? data.launcher : undefined;
        if (!r.ok) {
          const msg = data?.error ?? `${r.status} ${r.statusText}`;
          if (cmd) {
            try {
              await navigator.clipboard.writeText(cmd);
              setLaunchHint({ context: editor, command: cmd, launcher, kind: 'copied' });
              setTimeout(() => setLaunchHint(null), 12_000);
            } catch {
              // ignore clipboard issues
            }
          }
          console.error('[DroneHub] open editor failed', {
            editor,
            drone: currentDrone.name,
            status: r.status,
            statusText: r.statusText,
            msg,
            command: cmd || null,
            launcher: launcher || null,
          });
          return;
        }
      } catch (e: any) {
        console.error('[DroneHub] open editor request errored', {
          editor,
          drone: currentDrone?.name ?? null,
          error: e,
        });
      } finally {
        setOpeningEditor(null);
      }
    },
    [currentDrone],
  );

  const postJson = React.useCallback(async (url: string, body: any): Promise<{ ok: boolean; status: number; data: any }> => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
    const text = await r.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { ok: r.ok, status: r.status, data };
  }, []);

  const pullRepoChanges = React.useCallback(async () => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    clearRepoOperationError();
    setRepoOp({ kind: 'pull' });
    try {
      const url = `/api/drones/${encodeURIComponent(droneId)}/repo/pull`;
      const throwRepoPullError = (data: any, fallback: string): never => {
        const message = String(data?.error ?? fallback);
        const code = String(data?.code ?? '').trim();
        const patchName = String(data?.patchName ?? '').trim();
        const conflictFiles = Array.isArray(data?.conflictFiles)
          ? data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
          : [];
        setRepoOperationError(message, {
          code: code || null,
          patchName: patchName || null,
          conflictFiles,
        });
        throw new Error(message);
      };
      const response = await postJson(url, {});
      if (!response.ok) throwRepoPullError(response.data, 'Repo pull failed.');
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }, [clearRepoOperationError, currentDrone, postJson, setRepoOperationError]);

  const pushRepoChanges = React.useCallback(async () => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    const confirmed = window.confirm(
      'Pull current host branch changes into this drone branch? A clean merge creates a merge commit in the drone repo.',
    );
    if (!confirmed) return;
    clearRepoOperationError();
    setRepoOp({ kind: 'push' });
    try {
      const url = `/api/drones/${encodeURIComponent(droneId)}/repo/push`;
      const throwRepoPushError = (data: any, fallback: string): never => {
        const message = String(data?.error ?? fallback);
        const code = String(data?.code ?? '').trim();
        const patchName = String(data?.patchName ?? '').trim();
        const conflictFiles = Array.isArray(data?.conflictFiles)
          ? data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
          : [];
        setRepoOperationError(message, {
          code: code || null,
          patchName: patchName || null,
          conflictFiles,
        });
        throw new Error(message);
      };
      const response = await postJson(url, {});
      if (!response.ok) throwRepoPushError(response.data, 'Repo push failed.');
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }, [clearRepoOperationError, currentDrone, postJson, setRepoOperationError]);

  const reseedRepo = React.useCallback(async () => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    clearRepoOperationError();
    setRepoOp({ kind: 'reseed' });
    try {
      const url = `/api/drones/${encodeURIComponent(droneId)}/repo/reseed`;
      const response = await postJson(url, {});
      if (!response.ok) throw new Error(String(response.data?.error ?? 'Repo reseed failed.'));
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }, [clearRepoOperationError, currentDrone, postJson, setRepoOperationError]);

  return {
    deletingRepos,
    openingTerminal,
    openingEditor,
    launchHint,
    repoOp,
    repoOpError,
    repoOpErrorMeta,
    clearRepoOperationError,
    setRepoOperationError,
    githubUrlForRepo,
    deleteRepo,
    openDroneTerminal,
    openDroneEditor,
    pullRepoChanges,
    pushRepoChanges,
    reseedRepo,
  };
}
