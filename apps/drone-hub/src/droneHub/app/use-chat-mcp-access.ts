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
  const [state, setState] = React.useState<ChatMcpAccessState>(() => ({
    ...emptyState(identity, droneId),
    loading: enabled && Boolean(droneId),
  }));

  React.useEffect(() => {
    const requestVersion = ++requestVersionRef.current;
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

  const updateAccessScope = React.useCallback(
    async (accessScope: NativeChatAccessScope) => {
      if (!enabled || !droneId || state.identity !== identity || state.saving) return;
      const requestVersion = requestVersionRef.current;
      setState((current) =>
        current.identity === identity ? { ...current, saving: true, error: null } : current,
      );
      try {
        const data = await requestJson<ChatMcpAccessPayload>(
          `/api/drones/${encodeURIComponent(droneId)}/chats/${encodeURIComponent(chatName)}/mcp-access`,
          {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ accessScope }),
          },
        );
        setState((current) =>
          requestVersionRef.current === requestVersion && current.identity === identity
            ? {
                identity,
                loaded: true,
                loading: false,
                saving: false,
                available: data.available === true,
                accessScope: data.accessScope,
                error: null,
              }
            : current,
        );
      } catch (error: any) {
        setState((current) =>
          requestVersionRef.current === requestVersion && current.identity === identity
            ? { ...current, saving: false, error: error?.message ?? String(error) }
            : current,
        );
      }
    },
    [chatName, droneId, enabled, identity, state.identity, state.saving],
  );

  const setMode = React.useCallback(
    (kind: 'read' | 'write' | 'execute', mode: 'all' | 'selected') =>
      updateAccessScope(withChatMcpScopeMode(state.accessScope, kind, mode)),
    [state.accessScope, updateAccessScope],
  );

  const currentState =
    enabled && state.identity === identity
      ? { ...state, loading: state.loading || !state.loaded }
      : { ...emptyState(identity, droneId), loading: enabled && Boolean(droneId) };
  return { ...currentState, setMode, updateAccessScope };
}
