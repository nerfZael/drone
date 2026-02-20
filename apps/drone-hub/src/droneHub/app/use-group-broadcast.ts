import React from 'react';
import type { ChatSendPayload } from '../chat';
import type { DroneSummary } from '../types';
import { isDroneStartingOrSeeding, resolveChatNameForDrone } from './helpers';
import { SIDEBAR_VISIBLE_MULTI_CHAT_GROUP, type SidebarGroup } from './use-sidebar-view-model';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type UseGroupBroadcastArgs = {
  selectedGroupMultiChat: string | null;
  sidebarGroups: SidebarGroup[];
  sidebarVisibleDrones: DroneSummary[];
  selectedChat: string;
  requestJson: RequestJsonFn;
  setSelectedGroupMultiChat: React.Dispatch<React.SetStateAction<string | null>>;
  setGroupBroadcastExpanded: React.Dispatch<React.SetStateAction<boolean>>;
};

export function useGroupBroadcast({
  selectedGroupMultiChat,
  sidebarGroups,
  sidebarVisibleDrones,
  selectedChat,
  requestJson,
  setSelectedGroupMultiChat,
  setGroupBroadcastExpanded,
}: UseGroupBroadcastArgs) {
  const [groupBroadcastPromptError, setGroupBroadcastPromptError] = React.useState<
    string | null
  >(null);
  const [groupBroadcastSendingCount, setGroupBroadcastSendingCount] = React.useState(0);
  const groupBroadcastSending = groupBroadcastSendingCount > 0;

  const selectedGroupMultiChatData = React.useMemo(
    () => {
      if (!selectedGroupMultiChat) return null;
      if (selectedGroupMultiChat === SIDEBAR_VISIBLE_MULTI_CHAT_GROUP) {
        return {
          group: SIDEBAR_VISIBLE_MULTI_CHAT_GROUP,
          label: 'Visible in Sidebar',
          kind: 'group' as const,
          items: sidebarVisibleDrones,
        };
      }
      return sidebarGroups.find((g) => g.group === selectedGroupMultiChat) ?? null;
    },
    [selectedGroupMultiChat, sidebarGroups, sidebarVisibleDrones],
  );

  React.useEffect(() => {
    if (!selectedGroupMultiChat) return;
    if (selectedGroupMultiChatData) return;
    setSelectedGroupMultiChat(null);
  }, [selectedGroupMultiChat, selectedGroupMultiChatData, setSelectedGroupMultiChat]);

  React.useEffect(() => {
    setGroupBroadcastPromptError(null);
  }, [selectedGroupMultiChat]);

  React.useEffect(() => {
    setGroupBroadcastExpanded(false);
  }, [selectedGroupMultiChat, setGroupBroadcastExpanded]);

  const sendGroupBroadcastPrompt = React.useCallback(
    async (payload: ChatSendPayload): Promise<boolean> => {
      const prompt = String(payload?.prompt ?? '').trim();
      const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
      if (!prompt && attachments.length === 0) return false;
      const targets = selectedGroupMultiChatData?.items ?? [];
      if (targets.length === 0) {
        setGroupBroadcastPromptError('No drones available in this group.');
        return false;
      }

      setGroupBroadcastSendingCount((c) => c + 1);
      setGroupBroadcastPromptError(null);
      try {
        const preferredChat = selectedChat || 'default';
        const results = await Promise.allSettled(
          targets.map(async (d) => {
            if (isDroneStartingOrSeeding(d.hubPhase)) {
              throw new Error(`"${d.name}" is still starting.`);
            }
            const chatName = resolveChatNameForDrone(d, preferredChat);
            await requestJson<{ ok: true; accepted: true; promptId: string }>(
              `/api/drones/${encodeURIComponent(d.id)}/chats/${encodeURIComponent(chatName)}/prompt`,
              {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ prompt, attachments }),
              },
            );
            return d.name;
          }),
        );

        const failed: string[] = [];
        for (let i = 0; i < results.length; i += 1) {
          if (results[i].status === 'rejected') failed.push(targets[i].name);
        }
        if (failed.length === 0) return true;
        if (failed.length === targets.length) {
          setGroupBroadcastPromptError(`Failed to send to all ${targets.length} drones.`);
          return false;
        }
        const preview = failed.slice(0, 3).join(', ');
        const more = failed.length > 3 ? ` +${failed.length - 3} more` : '';
        setGroupBroadcastPromptError(
          `Sent to ${targets.length - failed.length}/${targets.length}. Failed: ${preview}${more}.`,
        );
        return true;
      } catch (err: any) {
        setGroupBroadcastPromptError(err?.message ?? String(err));
        return false;
      } finally {
        setGroupBroadcastSendingCount((c) => Math.max(0, c - 1));
      }
    },
    [requestJson, selectedChat, selectedGroupMultiChatData],
  );

  return {
    selectedGroupMultiChatData,
    groupBroadcastPromptError,
    groupBroadcastSending,
    sendGroupBroadcastPrompt,
  };
}
