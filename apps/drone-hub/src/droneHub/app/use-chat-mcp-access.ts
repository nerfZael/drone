import type { NativeChatAccessScope } from '@drone/assistant-chat';
import React from 'react';

import { requestJson } from '../http';

type ChatMcpAccessPayload = {
  ok: true;
  available: boolean;
  accessScope: NativeChatAccessScope;
};

type ChatMcpAccessState = {
  identity: string;
  loaded: boolean;
  loading: boolean;
  saving: boolean;
  available: boolean;
  accessScope: NativeChatAccessScope;
  error: string | null;
};

function defaultAccessScope(droneId: string): NativeChatAccessScope {
  return {
    readMode: 'all',
    writeMode: 'selected',
    executeMode: 'selected',
    droneIds: droneId ? [droneId] : [],
    updatedAt: '',
  };
}

function emptyState(identity: string, droneId: string): ChatMcpAccessState {
  return {
    identity,
    loaded: false,
    loading: false,
    saving: false,
    available: false,
    accessScope: defaultAccessScope(droneId),
    error: null,
  };
}

export function withChatMcpScopeMode(
  accessScope: NativeChatAccessScope,
  kind: 'read' | 'write' | 'execute',
  mode: 'all' | 'selected',
): NativeChatAccessScope {
  return {
    ...accessScope,
    [`${kind}Mode`]: mode,
  };
}

export function withChatMcpSelectedDrones(
  accessScope: NativeChatAccessScope,
  droneIds: string[],
): NativeChatAccessScope {
  return {
    ...accessScope,
    readMode: 'selected',
    writeMode: 'selected',
    executeMode: 'selected',
    droneIds: Array.from(
      new Set(
        [...accessScope.droneIds, ...droneIds]
          .map((droneId) => String(droneId ?? '').trim())
          .filter(Boolean),
      ),
    ),
  };
}

export function useChatMcpAccess(droneIdRaw: string, chatNameRaw: string, enabled: boolean) {
  const droneId = String(droneIdRaw ?? '').trim();
  const chatName = String(chatNameRaw ?? '').trim() || 'default';
  const identity = `${droneId}\u0000${chatName}`;
  const requestVersionRef = React.useRef(0);
  const desiredAccessScopeRef = React.useRef<NativeChatAccessScope | null>(null);
  const persistedAccessScopeRef = React.useRef<NativeChatAccessScope>(
    defaultAccessScope(droneId),
  );
  const optimisticAccessScopeRef = React.useRef<NativeChatAccessScope>(
    defaultAccessScope(droneId),
  );
  const saveLoopRef = React.useRef<Promise<void> | null>(null);
  const [state, setState] = React.useState<ChatMcpAccessState>(() => ({
    ...emptyState(identity, droneId),
    loading: enabled && Boolean(droneId),
  }));

  React.useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
    desiredAccessScopeRef.current = null;
    saveLoopRef.current = null;
    persistedAccessScopeRef.current = defaultAccessScope(droneId);
    optimisticAccessScopeRef.current = defaultAccessScope(droneId);
    if (!enabled || !droneId) {
      setState(emptyState(identity, droneId));
      return;
    }
    const controller = new AbortController();
    setState({ ...emptyState(identity, droneId), loading: true });
    void requestJson<ChatMcpAccessPayload>(
      `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/mcp-access`,
      { signal: controller.signal },
    )
      .then((data) => {
        if (controller.signal.aborted || requestVersionRef.current !== requestVersion) return;
        persistedAccessScopeRef.current = data.accessScope;
        optimisticAccessScopeRef.current = data.accessScope;
        setState({
          identity,
          loaded: true,
          loading: false,
          saving: false,
          available: data.available === true,
          accessScope: data.accessScope,
          error: null,
        });
      })
      .catch((error: any) => {
        if (controller.signal.aborted || requestVersionRef.current !== requestVersion) return;
        setState({
          ...emptyState(identity, droneId),
          loaded: true,
          error: error?.message ?? String(error),
        });
      });
    return () => {
      controller.abort();
      if (requestVersionRef.current === requestVersion) requestVersionRef.current += 1;
    };
  }, [chatName, droneId, enabled, identity]);

  const flushAccessScopeSaves = React.useCallback((): Promise<void> => {
    if (saveLoopRef.current) return saveLoopRef.current;
    const requestVersion = requestVersionRef.current;
    const loop = (async () => {
      while (requestVersionRef.current === requestVersion) {
        const accessScope = desiredAccessScopeRef.current;
        if (!accessScope) break;
        desiredAccessScopeRef.current = null;
        try {
          const data = await requestJson<ChatMcpAccessPayload>(
            `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/mcp-access`,
            {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ accessScope }),
            },
          );
          if (requestVersionRef.current !== requestVersion) return;
          persistedAccessScopeRef.current = data.accessScope;
          const pendingAccessScope = desiredAccessScopeRef.current;
          if (!pendingAccessScope) optimisticAccessScopeRef.current = data.accessScope;
          setState((current) =>
            current.identity === identity
              ? {
                  ...current,
                  saving: pendingAccessScope !== null,
                  available: data.available === true,
                  accessScope: pendingAccessScope ?? data.accessScope,
                  error: null,
                }
              : current,
          );
        } catch (error: any) {
          if (requestVersionRef.current !== requestVersion) return;
          desiredAccessScopeRef.current = null;
          optimisticAccessScopeRef.current = persistedAccessScopeRef.current;
          setState((current) =>
            current.identity === identity
              ? {
                  ...current,
                  saving: false,
                  accessScope: persistedAccessScopeRef.current,
                  error: error?.message ?? String(error),
                }
              : current,
          );
          break;
        }
      }
    })().finally(() => {
      if (saveLoopRef.current === loop) saveLoopRef.current = null;
      if (
        desiredAccessScopeRef.current &&
        requestVersionRef.current === requestVersion
      ) {
        queueMicrotask(() => void flushAccessScopeSaves());
      } else if (requestVersionRef.current === requestVersion) {
        setState((current) =>
          current.identity === identity ? { ...current, saving: false } : current,
        );
      }
    });
    saveLoopRef.current = loop;
    return loop;
  }, [chatName, droneId, identity]);

  const updateAccessScope = React.useCallback(
    async (accessScope: NativeChatAccessScope) => {
      if (!enabled || !droneId) return;
      optimisticAccessScopeRef.current = accessScope;
      desiredAccessScopeRef.current = accessScope;
      setState((current) =>
        current.identity === identity
          ? {
              ...current,
              saving: true,
              accessScope,
              error: null,
            }
          : current,
      );
      await flushAccessScopeSaves();
    },
    [droneId, enabled, flushAccessScopeSaves, identity],
  );

  const setMode = React.useCallback(
    (kind: 'read' | 'write' | 'execute', mode: 'all' | 'selected') =>
      updateAccessScope(
        withChatMcpScopeMode(
          optimisticAccessScopeRef.current,
          kind,
          mode,
        ),
      ),
    [updateAccessScope],
  );

  const addSelectedDrones = React.useCallback(
    (droneIds: string[]) =>
      updateAccessScope(
        withChatMcpSelectedDrones(optimisticAccessScopeRef.current, droneIds),
      ),
    [updateAccessScope],
  );

  const removeSelectedDrone = React.useCallback(
    (selectedDroneId: string) =>
      updateAccessScope({
        ...optimisticAccessScopeRef.current,
        droneIds: optimisticAccessScopeRef.current.droneIds.filter(
          (candidateId) => candidateId !== selectedDroneId,
        ),
      }),
    [updateAccessScope],
  );

  const currentState =
    enabled && state.identity === identity
      ? { ...state, loading: state.loading || !state.loaded }
      : { ...emptyState(identity, droneId), loading: enabled && Boolean(droneId) };
  return {
    ...currentState,
    setMode,
    updateAccessScope,
    addSelectedDrones,
    removeSelectedDrone,
  };
}
