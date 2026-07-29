import React from 'react';
import { AppState } from 'react-native';
import {
  extractGithubPullRequestLinksFromMessages,
  type AssistantMessage,
  type GithubPullRequestsResult,
} from '@drone/assistant-chat';
import { isGranted } from '@drone/device-protocol';
import { useMesh } from '../mesh/MeshContext';
import {
  mobilePullRequestActionGuardError,
  mobilePullRequestActionUnavailableReason,
  mobilePullRequestMergeFailureMessage,
  normalizeMobilePullRequestMergeMethod,
  performMobilePullRequestMerge,
  type MobilePullRequestAction,
  type MobilePullRequestMergeMethod,
} from './linked-pull-request-model';
import {
  loadMobilePullRequestMergeMethod,
  saveMobilePullRequestMergeMethod,
} from './linked-pull-request-preferences';

export type { MobilePullRequestAction, MobilePullRequestMergeMethod };

export type MobileLinkedPullRequestContext = {
  data: GithubPullRequestsResult | null;
  loading: boolean;
  error: string | null;
  busyAction: MobilePullRequestAction | null;
  canMerge: boolean;
  canClose: boolean;
  mergeUnavailableReason: string | null;
  closeUnavailableReason: string | null;
  mergeMethod: MobilePullRequestMergeMethod;
  setMergeMethod(method: MobilePullRequestMergeMethod): void;
  refresh(): Promise<void>;
  merge(pullNumber: number, method?: MobilePullRequestMergeMethod): Promise<string>;
  close(pullNumber: number): Promise<string>;
};

const PENDING_CHECKS_REFRESH_MS = 30_000;
const OPEN_PULL_REQUEST_REFRESH_MS = 60_000;

function resultError(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Pull request request failed');
}

export function useDroneLinkedPullRequests({
  targetDeviceId,
  droneId,
  messages,
}: {
  targetDeviceId: string;
  droneId: string;
  messages: AssistantMessage[];
}): MobileLinkedPullRequestContext {
  const mesh = useMesh();
  const links = React.useMemo(
    () => extractGithubPullRequestLinksFromMessages(messages),
    [messages],
  );
  const linksKey = links.map((link) => `${link.owner}/${link.repo}#${link.pullNumber}`).join('|');
  const [data, setData] = React.useState<GithubPullRequestsResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busyAction, setBusyAction] = React.useState<MobilePullRequestAction | null>(null);
  const [mergeMethod, setMergeMethodState] =
    React.useState<MobilePullRequestMergeMethod>('merge');
  const [appIsActive, setAppIsActive] = React.useState(AppState.currentState === 'active');
  const requestVersion = React.useRef(0);
  const loadAbort = React.useRef<AbortController | null>(null);
  const busyActionRef = React.useRef<MobilePullRequestAction | null>(null);
  const mergeMethodVersion = React.useRef(0);
  const targetCapability = mesh.profile?.capabilitiesByDevice[targetDeviceId]?.find(
    (capability) => capability.id === 'drone-control' && capability.version === 1,
  );
  const selfDevice = mesh.devices.find((device) => device.id === mesh.identity?.id);
  const supportsOperation = (operation: string) =>
    Boolean(targetCapability?.operations.includes(operation));
  const grantsOperation = (operation: string) =>
    Boolean(selfDevice && isGranted(selfDevice.grants, 'drone-control', 1, operation));
  const supportsRead = supportsOperation('repo.pull-requests.read');
  const canRead = supportsRead && grantsOperation('repo.pull-requests.read');
  const supportsMerge = supportsOperation('repo.pull-requests.merge');
  const grantsMerge = grantsOperation('repo.pull-requests.merge');
  const supportsClose = supportsOperation('repo.pull-requests.close');
  const grantsClose = grantsOperation('repo.pull-requests.close');
  const mergeUnavailableReason = mobilePullRequestActionUnavailableReason({
    action: 'merge',
    supported: supportsMerge,
    granted: grantsMerge,
  });
  const closeUnavailableReason = mobilePullRequestActionUnavailableReason({
    action: 'close',
    supported: supportsClose,
    granted: grantsClose,
  });
  const canMerge = !mergeUnavailableReason;
  const canClose = !closeUnavailableReason;
  const hasLinkedRequests = Boolean(targetDeviceId && droneId && links.length > 0);
  const readUnavailableError = !hasLinkedRequests
    ? null
    : !supportsRead
      ? 'The selected Hub must be updated to load pull request status.'
      : !canRead
        ? 'This phone has not been granted pull request read access.'
        : null;
  const enabled = hasLinkedRequests && !readUnavailableError;
  const actionScope = `${targetDeviceId}\u0000${droneId}`;
  const currentActionScope = React.useRef(actionScope);
  const currentActionUnavailableReasons = React.useRef({
    merge: mergeUnavailableReason,
    close: closeUnavailableReason,
  });
  currentActionScope.current = actionScope;
  currentActionUnavailableReasons.current = {
    merge: mergeUnavailableReason,
    close: closeUnavailableReason,
  };

  React.useEffect(() => {
    let active = true;
    const version = mergeMethodVersion.current;
    void loadMobilePullRequestMergeMethod().then((storedMethod) => {
      if (active && version === mergeMethodVersion.current) {
        setMergeMethodState(storedMethod);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const setMergeMethod = React.useCallback((nextMethod: MobilePullRequestMergeMethod) => {
    const normalized = normalizeMobilePullRequestMergeMethod(nextMethod);
    mergeMethodVersion.current += 1;
    setMergeMethodState(normalized);
    void saveMobilePullRequestMergeMethod(normalized).catch(() => undefined);
  }, []);

  const load = React.useCallback(
    async (quiet = false, bypassAvailability = false) => {
      const version = ++requestVersion.current;
      loadAbort.current?.abort();
      loadAbort.current = null;
      if (!hasLinkedRequests) {
        setData(null);
        setError(null);
        setLoading(false);
        return;
      }
      if (readUnavailableError && !bypassAvailability) {
        setData(null);
        setError(readUnavailableError);
        setLoading(false);
        return;
      }
      const controller = new AbortController();
      loadAbort.current = controller;
      if (!quiet) setLoading(true);
      try {
        const result = await mesh.request(
          targetDeviceId,
          'drone-control',
          'repo.pull-requests.read',
          { droneId, state: 'all' },
          controller.signal,
        );
        if (requestVersion.current !== version) return;
        if (result?.ok !== true || !result?.github || !Array.isArray(result?.pullRequests))
          throw new Error(String(result?.error ?? 'The Hub returned invalid pull request data'));
        setData({ github: result.github, pullRequests: result.pullRequests });
        setError(null);
        if (bypassAvailability) void mesh.refreshDevices().catch(() => undefined);
      } catch (nextError) {
        if (requestVersion.current !== version) return;
        // A background refresh failure should not erase status we already loaded.
        if (!quiet) setData(null);
        setError(resultError(nextError));
      } finally {
        if (loadAbort.current === controller) loadAbort.current = null;
        if (requestVersion.current === version) setLoading(false);
      }
    },
    [droneId, hasLinkedRequests, mesh.refreshDevices, mesh.request, readUnavailableError, targetDeviceId],
  );

  React.useEffect(() => {
    setData(null);
    setError(readUnavailableError);
    busyActionRef.current = null;
    setBusyAction(null);
    void load();
    return () => {
      requestVersion.current += 1;
      loadAbort.current?.abort();
      loadAbort.current = null;
    };
  }, [droneId, linksKey, load, readUnavailableError, targetDeviceId]);

  React.useEffect(() => {
    if (!enabled) return;
    setAppIsActive(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setAppIsActive(active);
      if (active) void load(true);
    });
    return () => subscription.remove();
  }, [enabled, load]);

  const linkedNumbers = React.useMemo(
    () =>
      new Set(
        links
          .filter(
            (link) =>
              link.owner === String(data?.github.owner ?? '').toLowerCase() &&
              link.repo === String(data?.github.repo ?? '').toLowerCase(),
          )
          .map((link) => link.pullNumber),
      ),
    [data?.github.owner, data?.github.repo, links],
  );
  const hasPendingChecks = Boolean(
    data?.pullRequests.some(
      (pullRequest) =>
        linkedNumbers.has(pullRequest.number) &&
        String(pullRequest.state).toLowerCase() === 'open' &&
        pullRequest.checksState === 'pending',
    ),
  );
  const hasOpenPullRequests = Boolean(
    data?.pullRequests.some(
      (pullRequest) =>
        linkedNumbers.has(pullRequest.number) &&
        String(pullRequest.state).toLowerCase() === 'open',
    ),
  );
  const refreshDelay = hasPendingChecks
    ? PENDING_CHECKS_REFRESH_MS
    : hasOpenPullRequests
      ? OPEN_PULL_REQUEST_REFRESH_MS
      : null;
  React.useEffect(() => {
    if (!appIsActive || refreshDelay == null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await load(true);
      if (!cancelled) timer = setTimeout(refresh, refreshDelay);
    };
    timer = setTimeout(refresh, refreshDelay);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appIsActive, load, refreshDelay]);

  const beginAction = React.useCallback(
    (action: MobilePullRequestAction) => {
      const guardError = mobilePullRequestActionGuardError({
        expectedScope: actionScope,
        currentScope: currentActionScope.current,
        unavailableReason: currentActionUnavailableReasons.current[action.action],
        busyAction: busyActionRef.current,
      });
      if (guardError) throw new Error(guardError);
      busyActionRef.current = action;
      setBusyAction(action);
      return action;
    },
    [actionScope],
  );

  const finishAction = React.useCallback((action: MobilePullRequestAction) => {
    if (busyActionRef.current !== action) return;
    busyActionRef.current = null;
    setBusyAction(null);
  }, []);

  const merge = React.useCallback(
    async (pullNumber: number, method: MobilePullRequestMergeMethod = 'merge') => {
      const normalizedMethod = normalizeMobilePullRequestMergeMethod(method);
      let action: MobilePullRequestAction;
      try {
        action = beginAction({ pullNumber, action: 'merge' });
      } catch (actionError) {
        throw new Error(
          mobilePullRequestMergeFailureMessage({
            pullNumber,
            method: normalizedMethod,
            error: actionError,
          }),
        );
      }
      try {
        const notice = await performMobilePullRequestMerge({
          request: mesh.request,
          targetDeviceId,
          droneId,
          pullNumber,
          method: normalizedMethod,
        });
        if (currentActionScope.current === actionScope) await load(true);
        return notice;
      } finally {
        finishAction(action);
      }
    },
    [actionScope, beginAction, droneId, finishAction, load, mesh.request, targetDeviceId],
  );

  const close = React.useCallback(
    async (pullNumber: number) => {
      const action = beginAction({ pullNumber, action: 'close' });
      try {
        const result = await mesh.request(
          targetDeviceId,
          'drone-control',
          'repo.pull-requests.close',
          { droneId, pullNumber },
        );
        if (result?.ok !== true || String(result?.state ?? '').toLowerCase() !== 'closed')
          throw new Error(String(result?.error ?? `GitHub did not close PR #${pullNumber}`));
        if (currentActionScope.current === actionScope) await load(true);
        return `Closed PR #${pullNumber}`;
      } finally {
        finishAction(action);
      }
    },
    [actionScope, beginAction, droneId, finishAction, load, mesh.request, targetDeviceId],
  );

  return {
    data,
    loading,
    error,
    busyAction,
    canMerge,
    canClose,
    mergeUnavailableReason,
    closeUnavailableReason,
    mergeMethod,
    setMergeMethod,
    // Retry is also an explicit probe in case cached capability or grant data is stale.
    refresh: () => load(false, true),
    merge,
    close,
  };
}
