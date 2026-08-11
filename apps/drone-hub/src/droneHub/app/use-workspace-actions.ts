import React from 'react';
import type { DroneSummary, RepoSummary } from '../types';
import type { RepoOpErrorMeta } from './helpers';
import {
  dirtyDroneApplyRequestBody,
  reconcileDirtyDroneApplyModal,
  type DirtyDroneApplyModalState,
} from './dirty-drone-apply';
import { droneHomePath, isHostRuntimeDrone } from './helpers';
import { normalizeRepoTransferProbeStatus, type RepoTransferProbeStatus } from './repo-transfer-probe-status';
import { beginRepoApplyProgress } from './use-drone-hub-runtime-store';
import {
  isLocalCheckoutCancellation,
  useLocalCheckout,
  type LocalAutoUpdates,
} from './use-local-checkout';

export type { RepoTransferProbeStatus } from './repo-transfer-probe-status';

type LaunchHint =
  | {
      context: 'terminal' | 'code' | 'cursor';
      command?: string;
      launcher?: string;
      kind: 'copied';
    }
  | null;

type RepoOpState = null | { kind: 'pull' | 'push' | 'reseed' | 'pull-from-drone' | 'push-to-drone' };

export type RepoTransferActionResult = {
  ok: boolean;
  error?: string | null;
  meta?: RepoOpErrorMeta | null;
};

type RequestJson = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseWorkspaceActionsArgs = {
  currentDrone: DroneSummary | null;
  drones: DroneSummary[];
  selectedChat: string;
  terminalEmulator: string;
  activeRepoPath: string;
  setActiveRepoPath: React.Dispatch<React.SetStateAction<string>>;
  setNameSuggestToast: React.Dispatch<
    React.SetStateAction<{ id: string; title?: string; message: string; tone?: 'success' | 'error' } | null>
  >;
  requestJson: RequestJson;
};

function shortSha(raw: unknown): string | null {
  const sha = String(raw ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(sha)) return null;
  return sha.slice(0, 7);
}

function repoActionDroneLabel(currentDrone: DroneSummary | null): string {
  return String(currentDrone?.name ?? '').trim() || 'drone';
}

function peerDroneLabel(drone: Pick<DroneSummary, 'name'> | null | undefined, fallback = 'drone'): string {
  return String(drone?.name ?? '').trim() || fallback;
}

function formatRepoPushSuccessMessage(data: any, currentDrone: DroneSummary | null): { title: string; message: string } {
  const mode = String(data?.mode ?? '').trim().toLowerCase();
  const droneLabel = repoActionDroneLabel(currentDrone);
  const hostRef = String(data?.hostRef ?? '').trim();
  const mergeSha = shortSha(data?.mergeCommitSha);
  const mergeSubject = String(data?.mergeCommitSubject ?? '').trim();

  if (mode === 'host-noop') {
    return {
      title: 'Host repo already current',
      message: `Host runtime drone "${droneLabel}" already uses the host repo directly.`,
    };
  }

  if (mergeSha && mergeSubject) {
    return {
      title: 'Host changes pulled into drone',
      message: `Created merge commit ${mergeSha}: ${mergeSubject}`,
    };
  }

  if (mergeSha) {
    return {
      title: 'Host changes pulled into drone',
      message: `Created merge commit ${mergeSha}${hostRef ? ` from ${hostRef}` : ''} in "${droneLabel}".`,
    };
  }

  return {
    title: 'Host changes pulled into drone',
    message: hostRef ? `Pulled ${hostRef} into "${droneLabel}".` : `Pulled host changes into "${droneLabel}".`,
  };
}

function formatRepoPullSuccessMessage(data: any, currentDrone: DroneSummary | null): { title: string; message: string } {
  const mode = String(data?.mode ?? '').trim().toLowerCase();
  const droneLabel = repoActionDroneLabel(currentDrone);
  const hostRef = String(data?.fromRef ?? '').trim();
  const exportedHeadSha = shortSha(data?.exportedHeadSha);
  const autoCommitSha = shortSha(data?.droneAutoCommitSha);
  const dirtyFileCount = Number(data?.droneDirtyFileCount);
  const keptDirtyChanges = Number.isFinite(dirtyFileCount) && dirtyFileCount > 0 && !autoCommitSha;

  if (mode === 'no-changes' || data?.noChanges === true) {
    return {
      title: 'No drone changes to apply',
      message: exportedHeadSha
        ? `No new commits to apply from "${droneLabel}" (${exportedHeadSha}).${keptDirtyChanges ? ' Uncommitted drone edits remain only in the drone workspace.' : ''}`
        : `No new commits to apply from "${droneLabel}".${keptDirtyChanges ? ' Uncommitted drone edits remain only in the drone workspace.' : ''}`,
    };
  }

  const suffix: string[] = [];
  if (autoCommitSha) suffix.push(`Snapshot commit ${autoCommitSha} captured prior drone edits.`);
  if (keptDirtyChanges) suffix.push('Uncommitted drone edits remain in the drone workspace and were not applied.');
  suffix.push('Review the pending host merge and commit or abort when ready.');

  return {
    title: 'Drone changes applied to host',
    message: `${hostRef ? `Applied ${droneLabel} changes onto ${hostRef}.` : `Applied ${droneLabel} changes onto the host repo.`} ${suffix.join(' ')}`,
  };
}

function formatPeerRepoTransferSuccessMessage(data: any): { title: string; message: string } {
  const mode = String(data?.mode ?? '').trim().toLowerCase();
  const sourceName = String(data?.sourceDroneName ?? '').trim() || 'source drone';
  const targetName = String(data?.targetDroneName ?? '').trim() || 'target drone';
  const mergeSha = shortSha(data?.mergeCommitSha);
  const mergeSubject = String(data?.mergeCommitSubject ?? '').trim();

  if (mode === 'no-changes' || data?.noChanges === true) {
    return {
      title: 'No peer changes to apply',
      message: `No new commits to apply from "${sourceName}" into "${targetName}".`,
    };
  }

  if (mergeSha && mergeSubject) {
    return {
      title: 'Drone changes synced',
      message: `Merged "${sourceName}" into "${targetName}" as ${mergeSha}: ${mergeSubject}`,
    };
  }

  if (mergeSha) {
    return {
      title: 'Drone changes synced',
      message: `Merged "${sourceName}" into "${targetName}" as ${mergeSha}.`,
    };
  }

  return {
    title: 'Drone changes synced',
    message: `Merged "${sourceName}" into "${targetName}".`,
  };
}

export function useWorkspaceActions({
  currentDrone,
  drones,
  selectedChat,
  terminalEmulator,
  activeRepoPath,
  setActiveRepoPath,
  setNameSuggestToast,
  requestJson,
}: UseWorkspaceActionsArgs) {
  const [deletingRepos, setDeletingRepos] = React.useState<Record<string, boolean>>({});
  const [openingTerminal, setOpeningTerminal] = React.useState<{ mode: 'ssh' | 'agent' } | null>(null);
  const [openingEditor, setOpeningEditor] = React.useState<{ editor: 'code' | 'cursor' } | null>(null);
  const [launchHint, setLaunchHint] = React.useState<LaunchHint>(null);
  const [repoOp, setRepoOp] = React.useState<RepoOpState>(null);
  const [repoOpError, setRepoOpError] = React.useState<string | null>(null);
  const [repoOpErrorMeta, setRepoOpErrorMeta] = React.useState<RepoOpErrorMeta | null>(null);
  const [dirtyDroneApplyModal, setDirtyDroneApplyModal] = React.useState<DirtyDroneApplyModalState | null>(null);
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

  const showTransientToast = React.useCallback(
    (message: string, title: string, tone: 'success' | 'error' = 'error') => {
      const text = String(message ?? '').trim();
      if (!text) return;
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      setNameSuggestToast({ id, title, message: text, tone });
      window.setTimeout(() => {
        setNameSuggestToast((current) => (current?.id === id ? null : current));
      }, 5000);
    },
    [setNameSuggestToast],
  );

  const deleteRepo = React.useCallback(
    async (repoPath: string) => {
      const path = String(repoPath ?? '').trim();
      if (!path) return;
      const ok = window.confirm(`Remove repo "${path}" from the registry?`);
      if (!ok) return;
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
    [activeRepoPath, requestJson, setActiveRepoPath],
  );

  const openDroneTerminal = React.useCallback(
    async (mode: 'ssh' | 'agent') => {
      if (!currentDrone) return;
      setOpeningTerminal({ mode });
      try {
        const qs = new URLSearchParams();
        qs.set('mode', mode);
        qs.set('chat', selectedChat || 'default');
        const cwd = droneHomePath(currentDrone);
        if (cwd && !(isHostRuntimeDrone(currentDrone) && cwd === '/')) qs.set('cwd', cwd);
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
        const cwd = droneHomePath(currentDrone);
        if (cwd && !(isHostRuntimeDrone(currentDrone) && cwd === '/')) qs.set('cwd', cwd);
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

  const executePullRepoChanges = React.useCallback(async (body: Record<string, unknown> = {}) => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    clearRepoOperationError();
    setRepoOp({ kind: 'pull' });
    const endApplyProgress = beginRepoApplyProgress({
      droneId,
      droneLabel: repoActionDroneLabel(currentDrone),
    });
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
      let response = await postJson(url, body);
      const initialCode = String(response.data?.code ?? '').trim().toLowerCase();
      if (!response.ok && initialCode === 'drone_dirty') {
        setDirtyDroneApplyModal({
          droneLabel: repoActionDroneLabel(currentDrone),
          droneId,
          dirtyFileCount: Number(response.data?.dirtyFileCount) || 0,
          autoCommitMessage:
            String(response.data?.autoCommitMessage ?? '').trim() || 'chore(drone): snapshot working tree before apply changes',
        });
        return;
      }
      const canOfferConflictApply =
        !response.ok &&
        initialCode === 'patch_apply_conflict' &&
        response.data?.hostConflictState !== true &&
        response.data?.canApplyConflictsToHost === true &&
        (body as any)?.applyConflictsToHost !== true;
      if (canOfferConflictApply) {
        const conflictFiles = Array.isArray(response.data?.conflictFiles)
          ? response.data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
          : [];
        const preview: string[] = conflictFiles.slice(0, 8);
        const suffix = conflictFiles.length > preview.length ? `\n- and ${conflictFiles.length - preview.length} more` : '';
        const confirmed = window.confirm(
          [
            'Applying these drone changes would conflict with your host repo.',
            '',
            preview.length > 0 ? preview.map((file) => `- ${file}`).join('\n') + suffix : 'No individual files were reported.',
            '',
            'Apply the conflict set onto the host repo so you can resolve it there?',
          ].join('\n'),
        );
        if (confirmed) {
          response = await postJson(url, { ...body, applyConflictsToHost: true });
        }
      }
      if (!response.ok) throwRepoPullError(response.data, 'Repo pull failed.');
      const success = formatRepoPullSuccessMessage(response.data, currentDrone);
      showTransientToast(success.message, success.title, 'success');
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      endApplyProgress();
      setRepoOp(null);
    }
  }, [clearRepoOperationError, currentDrone, postJson, setRepoOperationError, showTransientToast]);

  const handleLocalAutoUpdateError = React.useCallback(
    (message: string) => setRepoOperationError(message),
    [setRepoOperationError],
  );
  const localCheckout = useLocalCheckout({
    drones,
    requestJson,
    onAutoUpdateError: handleLocalAutoUpdateError,
  });
  const handleLocalCheckoutActionError = React.useCallback(
    (error: unknown) => {
      if (isLocalCheckoutCancellation(error)) return;
      setRepoOperationError((error as any)?.message ?? String(error));
    },
    [setRepoOperationError],
  );

  const useRepoLocally = React.useCallback(async (mode?: LocalAutoUpdates) => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    clearRepoOperationError();
    try {
      const next = await localCheckout.useLocally(droneId, mode);
      const session = next.session;
      showTransientToast(
        session
          ? `"${session.droneName}" is now active in ${session.repoRoot}.`
          : 'The drone is now active locally.',
        'Using drone locally',
        'success',
      );
    } catch (error: any) {
      handleLocalCheckoutActionError(error);
    }
  }, [
    clearRepoOperationError,
    currentDrone,
    handleLocalCheckoutActionError,
    localCheckout,
    showTransientToast,
  ]);

  const updateRepoLocally = React.useCallback(async () => {
    clearRepoOperationError();
    try {
      const next = await localCheckout.update();
      const session = next.session;
      showTransientToast(
        next.changed
          ? `Updated the local checkout to ${String(session?.snapshotSha ?? '').slice(0, 7)}.`
          : 'The local checkout is already current.',
        next.changed ? 'Local checkout updated' : 'Already current',
        'success',
      );
    } catch (error: any) {
      handleLocalCheckoutActionError(error);
    }
  }, [clearRepoOperationError, handleLocalCheckoutActionError, localCheckout, showTransientToast]);

  const setLocalAutoUpdates = React.useCallback(
    async (mode: LocalAutoUpdates) => {
      clearRepoOperationError();
      try {
        await localCheckout.setAutoUpdates(mode);
      } catch (error: any) {
        handleLocalCheckoutActionError(error);
      }
    },
    [clearRepoOperationError, handleLocalCheckoutActionError, localCheckout],
  );

  const returnRepoLocalCheckout = React.useCallback(async () => {
    clearRepoOperationError();
    try {
      const returnRef = localCheckout.view?.session?.returnRef ?? 'the original branch';
      await localCheckout.returnToOriginal();
      showTransientToast(`Returned to ${returnRef}.`, 'Local checkout returned', 'success');
    } catch (error: any) {
      handleLocalCheckoutActionError(error);
    }
  }, [
    clearRepoOperationError,
    handleLocalCheckoutActionError,
    localCheckout,
    showTransientToast,
  ]);

  const applyRepoLocalCheckout = React.useCallback(async () => {
    if (!currentDrone) return;
    clearRepoOperationError();
    try {
      const prepared = await localCheckout.prepareApply(currentDrone.id);
      const expectedHeadSha = String(prepared.expectedHeadSha ?? '').trim();
      if (!expectedHeadSha) throw new Error('DroneHub did not return the tested snapshot SHA.');
      await executePullRepoChanges({ expectedHeadSha, allowDirty: true });
    } catch (error: any) {
      handleLocalCheckoutActionError(error);
    }
  }, [
    clearRepoOperationError,
    currentDrone,
    executePullRepoChanges,
    handleLocalCheckoutActionError,
    localCheckout,
  ]);

  const pullRepoChanges = React.useCallback(async () => {
    await executePullRepoChanges();
  }, [executePullRepoChanges]);

  const closeDirtyDroneApplyModal = React.useCallback(() => {
    setDirtyDroneApplyModal(null);
  }, []);

  const continueDirtyDroneApply = React.useCallback(
    async (choice: 'commit' | 'keep') => {
      if (!dirtyDroneApplyModal) return;
      const requestBody = dirtyDroneApplyRequestBody(choice, dirtyDroneApplyModal.autoCommitMessage);
      setDirtyDroneApplyModal(null);
      await executePullRepoChanges(requestBody);
    },
    [dirtyDroneApplyModal, executePullRepoChanges],
  );

  React.useEffect(() => {
    setDirtyDroneApplyModal((current) => reconcileDirtyDroneApplyModal(current, currentDrone?.id));
  }, [currentDrone]);

  const pushRepoChanges = React.useCallback(async () => {
    if (!currentDrone) return;
    const droneId = String(currentDrone.id ?? '').trim();
    if (!droneId) return;
    if (!isHostRuntimeDrone(currentDrone)) {
      const confirmed = window.confirm(
        'Pull current host branch changes into this drone branch? A clean merge creates a merge commit in the drone repo.',
      );
      if (!confirmed) return;
    }
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
      const success = formatRepoPushSuccessMessage(response.data, currentDrone);
      showTransientToast(success.message, success.title, 'success');
    } catch (e: any) {
      setRepoOperationError(e?.message ?? String(e));
    } finally {
      setRepoOp(null);
    }
  }, [clearRepoOperationError, currentDrone, postJson, setRepoOperationError, showTransientToast]);

  const transferRepoChangesFromDrone = React.useCallback(
    async (
      sourceDroneIdRaw: string,
      targetDroneIdRaw: string,
      busyKind: 'pull-from-drone' | 'push-to-drone',
    ): Promise<RepoTransferActionResult> => {
      const sourceDroneId = String(sourceDroneIdRaw ?? '').trim();
      const targetDroneId = String(targetDroneIdRaw ?? '').trim();
      if (!sourceDroneId || !targetDroneId) {
        return { ok: false, error: 'Missing source or target drone.', meta: null };
      }
      const sourceDrone = (Array.isArray(drones) ? drones : []).find((drone) => String(drone?.id ?? '').trim() === sourceDroneId) ?? null;
      const targetDrone = (Array.isArray(drones) ? drones : []).find((drone) => String(drone?.id ?? '').trim() === targetDroneId) ?? null;
      let lastErrorMeta: RepoOpErrorMeta | null = null;
      clearRepoOperationError();
      setRepoOp({ kind: busyKind });
      try {
        const url = `/api/drones/${encodeURIComponent(targetDroneId)}/repo/pull-from-drone`;
        const throwRepoTransferError = (data: any, fallback: string): never => {
          const message = String(data?.error ?? fallback);
          const code = String(data?.code ?? '').trim();
          const patchName = String(data?.patchName ?? '').trim();
          const conflictFiles = Array.isArray(data?.conflictFiles)
            ? data.conflictFiles.map((f: any) => String(f ?? '').trim()).filter(Boolean)
            : [];
          const meta = {
            code: code || null,
            patchName: patchName || null,
            conflictFiles,
          };
          lastErrorMeta = meta;
          setRepoOperationError(message, meta);
          throw new Error(message);
        };

        const defaultAutoCommitMessage = 'chore(drone): snapshot working tree before drone sync';
        let response = await postJson(url, { sourceDroneId });
        const initialCode = String(response.data?.code ?? '').trim().toLowerCase();
        if (!response.ok && initialCode === 'source_drone_dirty') {
          const dirtyFileCount = Number(response.data?.dirtyFileCount);
          const dirtyLabel =
            Number.isFinite(dirtyFileCount) && dirtyFileCount > 0
              ? `${Math.floor(dirtyFileCount)} file${dirtyFileCount === 1 ? '' : 's'}`
              : 'one or more files';
          const autoCommitMessage = String(response.data?.autoCommitMessage ?? '').trim() || defaultAutoCommitMessage;
          const sourceLabel = peerDroneLabel(sourceDrone, 'source drone');
          const confirmed = window.confirm(
            `"${sourceLabel}" has uncommitted changes (${dirtyLabel}).\n\nPress OK to stage everything, create a placeholder commit, and continue sync.\n\nPress Cancel to stop.`,
          );
          if (!confirmed) return { ok: false, error: '', meta: null };
          response = await postJson(url, { sourceDroneId, commitDirty: true, commitMessage: autoCommitMessage });
        }
        if (!response.ok) throwRepoTransferError(response.data, 'Peer repo transfer failed.');
        const success = formatPeerRepoTransferSuccessMessage({
          ...response.data,
          sourceDroneName: peerDroneLabel(sourceDrone, String(response.data?.sourceDroneName ?? '').trim() || 'source drone'),
          targetDroneName: peerDroneLabel(targetDrone, String(response.data?.targetDroneName ?? '').trim() || 'target drone'),
        });
        showTransientToast(success.message, success.title, 'success');
        return { ok: true, error: null, meta: null };
      } catch (e: any) {
        const message = e?.message ?? String(e);
        setRepoOperationError(message, lastErrorMeta);
        return { ok: false, error: message, meta: lastErrorMeta };
      } finally {
        setRepoOp(null);
      }
    },
    [clearRepoOperationError, drones, postJson, setRepoOperationError, showTransientToast],
  );

  const probeRepoChangesFromDrone = React.useCallback(
    async (sourceDroneIdRaw: string, targetDroneIdRaw: string): Promise<RepoTransferProbeStatus> => {
      const sourceDroneId = String(sourceDroneIdRaw ?? '').trim();
      const targetDroneId = String(targetDroneIdRaw ?? '').trim();
      if (!sourceDroneId || !targetDroneId) {
        return {
          kind: 'blocked',
          label: 'Sync unavailable',
          detail: 'Missing source or target drone.',
          syncAllowed: false,
          code: null,
        };
      }
      try {
        const response = await postJson(`/api/drones/${encodeURIComponent(targetDroneId)}/repo/pull-from-drone`, {
          sourceDroneId,
          probeOnly: true,
        });
        return normalizeRepoTransferProbeStatus(response);
      } catch (error: any) {
        return {
          kind: 'blocked',
          label: 'Sync unavailable',
          detail: String(error?.message ?? error ?? '').trim() || 'Failed to inspect sync state.',
          syncAllowed: false,
          code: null,
        };
      }
    },
    [postJson],
  );

  const syncRepoChangesIntoDrone = React.useCallback(
    async (sourceDroneId: string, targetDroneId: string) =>
      await transferRepoChangesFromDrone(sourceDroneId, targetDroneId, 'pull-from-drone'),
    [transferRepoChangesFromDrone],
  );

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
    dirtyDroneApplyModal,
    clearRepoOperationError,
    setRepoOperationError,
    closeDirtyDroneApplyModal,
    continueDirtyDroneApply,
    githubUrlForRepo,
    deleteRepo,
    openDroneTerminal,
    openDroneEditor,
    pullRepoChanges,
    pushRepoChanges,
    localCheckout: localCheckout.view,
    localCheckoutLoading: localCheckout.loading,
    localCheckoutBusy: localCheckout.busy,
    useRepoLocally,
    updateRepoLocally,
    setLocalAutoUpdates,
    returnRepoLocalCheckout,
    applyRepoLocalCheckout,
    probeRepoChangesFromDrone,
    syncRepoChangesIntoDrone,
    reseedRepo,
  };
}
