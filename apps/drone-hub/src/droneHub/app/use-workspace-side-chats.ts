import React from 'react';
import { useAppConfirmDialog } from '../../ui/AppConfirmDialog';
import { requestJson } from '../http';
import type { DroneSummary } from '../types';
import { OPEN_SIDE_CHAT_EVENT, consumePendingSideChat, type OpenSideChatDetail } from './side-chat-events';

export type WorkspaceSideChat = NonNullable<DroneSummary['sideChats']>[number];

export function useWorkspaceSideChats(drone: DroneSummary, mainChatName: string) {
  const confirm = useAppConfirmDialog();
  const [local, setLocal] = React.useState<{
    droneId: string;
    added: WorkspaceSideChat[];
    removed: string[];
  }>({ droneId: drone.id, added: [], removed: [] });
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState<{ droneId: string; chatName: string } | null>(null);
  const busyRef = React.useRef(false);
  // Identity, not just drone ID: an A → B → A navigation must not revive
  // requests from the first visit to A or let them clear a newer busy state.
  const workspace = React.useMemo(() => ({ active: true }), [drone.id]);
  React.useEffect(() => {
    workspace.active = true;
    setLocal({ droneId: drone.id, added: [], removed: [] });
    setStatus(null);
    setBusy(null);
    setFocusRequest(null);
    busyRef.current = false;
    return () => {
      workspace.active = false;
    };
  }, [drone.id, workspace]);
  React.useEffect(() => {
    const persisted = new Set((drone.sideChats ?? []).map((chat) => chat.name));
    setLocal((previous) =>
      previous.droneId !== drone.id || !previous.added.some((chat) => persisted.has(chat.name))
        ? previous
        : { ...previous, added: previous.added.filter((chat) => !persisted.has(chat.name)) },
    );
  }, [drone.id, drone.sideChats]);
  const sideChats = React.useMemo(() => {
    const added = local.droneId === drone.id ? local.added : [];
    const removed = new Set(local.droneId === drone.id ? local.removed : []);
    const byName = new Map([...added, ...(drone.sideChats ?? [])].map((chat) => [chat.name, chat]));
    return [...byName.values()].filter((chat) => !removed.has(chat.name));
  }, [drone.id, drone.sideChats, local]);

  React.useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<OpenSideChatDetail>).detail;
      if (detail?.droneId !== drone.id) return;
      event.preventDefault();
      if (busyRef.current) return;
      const activeSide = document.querySelector<HTMLElement>('[data-side-chat-active="true"]')
        ?.dataset.sideChatName;
      const source = sideChats.find((chat) => chat.name === activeSide);
      const sourceChatName = detail.target?.sourceChatName ?? source?.name ?? mainChatName;
      const sourceScope = source
        ? [...document.querySelectorAll<HTMLElement>('[data-side-chat-name]')].find(
            (element) =>
              element.dataset.sideChatName === source.name &&
              element.querySelector('[data-side-chat-checkpoint-id]'),
          )
        : document.querySelector('[data-main-workspace-chat]');
      // Explicit message actions never use the focused chat or the latest visible answer.
      const checkpointId = detail.target
        ? detail.target.checkpointId
        : sourceScope?.querySelector<HTMLElement>('[data-side-chat-checkpoint-id]')?.dataset
            .sideChatCheckpointId;
      if (!checkpointId) {
        setStatus(
          'No completed assistant answer available yet. Wait for the history to load or the first answer to finish.',
        );
        return;
      }
      // A unique name avoids retries that could accidentally move the checkpoint.
      const name = `side-${crypto.randomUUID().slice(0, 8)}`;
      busyRef.current = true;
      setBusy('create');
      // No in-flow progress banner: it shifted the main chat down and back
      // again. The fork buttons spin and the new window appears instead.
      setStatus(null);
      void requestJson<{
        sideChatOrigin: { sourceChatName: string; checkpointId: string };
        agent: WorkspaceSideChat['agent'];
      }>(`/api/drones/${encodeURIComponent(drone.id)}/chats`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          copyFrom: sourceChatName,
          mode: 'fork',
          sideChat: true,
          checkpointId,
        }),
      })
        .then((result) => {
          if (!workspace.active) return;
          const chat: WorkspaceSideChat = {
            name,
            ...result.sideChatOrigin,
            agent: result.agent,
          };
          setLocal((previous) => ({
            droneId: drone.id,
            added: [...(previous.droneId === drone.id ? previous.added : []), chat],
            removed: previous.droneId === drone.id ? previous.removed : [],
          }));
          setStatus(null);
          setFocusRequest({ droneId: drone.id, chatName: name });
        })
        .catch((error) => {
          if (workspace.active) setStatus(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          if (workspace.active) {
            busyRef.current = false;
            setBusy(null);
          }
        });
    };
    window.addEventListener(OPEN_SIDE_CHAT_EVENT, onOpen);
    const pending = consumePendingSideChat(drone.id);
    if (pending) onOpen(new CustomEvent(OPEN_SIDE_CHAT_EVENT, { detail: pending, cancelable: true }));
    return () => window.removeEventListener(OPEN_SIDE_CHAT_EVENT, onOpen);
  }, [drone.id, mainChatName, sideChats, workspace]);

  const finish = React.useCallback(
    async (chatName: string, keep: boolean) => {
      if (!workspace.active || busyRef.current) return;
      busyRef.current = true;
      setBusy(chatName);
      try {
        if (
          !keep &&
          !(await confirm({
            title: 'Delete side chat?',
            message: `Delete “${chatName}” and its conversation? The source chat will not be changed.`,
            confirmLabel: 'Delete chat',
            destructive: true,
          }))
        )
          return;
        if (!workspace.active) return;
        setStatus(null);
        await requestJson(
          `/api/drones/${encodeURIComponent(drone.id)}/chats/${encodeURIComponent(chatName)}${keep ? '/keep' : ''}`,
          { method: keep ? 'POST' : 'DELETE' },
        );
        if (!workspace.active) return;
        setLocal((previous) => ({
          droneId: drone.id,
          added: (previous.droneId === drone.id ? previous.added : []).filter(
            (chat) => chat.name !== chatName,
          ),
          removed: [...(previous.droneId === drone.id ? previous.removed : []), chatName],
        }));
        setStatus(keep ? 'Chat kept in the sidebar.' : null);
      } catch (error) {
        if (workspace.active) setStatus(error instanceof Error ? error.message : String(error));
      } finally {
        if (workspace.active) {
          busyRef.current = false;
          setBusy(null);
        }
      }
    },
    [confirm, drone.id, workspace],
  );

  return { sideChats, status, busy, focusRequest, dismissStatus: () => setStatus(null), finish };
}
