import React from 'react';
import type { HubLogsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type CopyTextFn = (text: string) => Promise<void>;

export type UseHubLogsResult = {
  hubLogs: HubLogsResponse | null;
  hubLogsLoading: boolean;
  hubLogsError: string | null;
  hubLogsNotice: string | null;
  hubLogsExpanded: boolean;
  hubLogsTextareaRef: React.RefObject<HTMLTextAreaElement>;
  setHubLogsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  loadHubLogs: () => Promise<void>;
  copyHubLogs: () => Promise<void>;
  handleHubLogsScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
};

export function useHubLogs(opts: {
  appView: 'workspace' | 'settings';
  requestJson: RequestJsonFn;
  copyText: CopyTextFn;
  tailLines: number;
  maxBytes: number;
}): UseHubLogsResult {
  const { appView, requestJson, copyText, tailLines, maxBytes } = opts;
  const [hubLogs, setHubLogs] = React.useState<HubLogsResponse | null>(null);
  const [hubLogsLoading, setHubLogsLoading] = React.useState(false);
  const [hubLogsError, setHubLogsError] = React.useState<string | null>(null);
  const [hubLogsNotice, setHubLogsNotice] = React.useState<string | null>(null);
  const [hubLogsExpanded, setHubLogsExpanded] = React.useState(false);
  const [hubLogsPinnedToBottom, setHubLogsPinnedToBottom] = React.useState(true);
  const hubLogsTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);

  const loadHubLogs = React.useCallback(async () => {
    setHubLogsLoading(true);
    setHubLogsError(null);
    setHubLogsNotice(null);
    try {
      const data = await requestJson<HubLogsResponse>(`/api/settings/hub/logs?tail=${tailLines}&maxBytes=${maxBytes}`);
      setHubLogs(data);
    } catch (e: any) {
      setHubLogsError(e?.message ?? String(e));
    } finally {
      setHubLogsLoading(false);
    }
  }, [maxBytes, requestJson, tailLines]);

  React.useEffect(() => {
    if (appView !== 'settings') return;
    void loadHubLogs();
  }, [appView, loadHubLogs]);

  const copyHubLogs = React.useCallback(async () => {
    const text = String(hubLogs?.text ?? '');
    if (!text.trim()) return;
    await copyText(text);
    setHubLogsNotice('Copied hub logs.');
  }, [copyText, hubLogs?.text]);

  const handleHubLogsScroll = React.useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= 8;
    setHubLogsPinnedToBottom((prev) => (prev === pinned ? prev : pinned));
  }, []);

  React.useEffect(() => {
    if (!hubLogsExpanded) return;
    if (!hubLogsPinnedToBottom) return;
    const el = hubLogsTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [hubLogs?.text, hubLogsExpanded, hubLogsPinnedToBottom]);

  return {
    hubLogs,
    hubLogsLoading,
    hubLogsError,
    hubLogsNotice,
    hubLogsExpanded,
    hubLogsTextareaRef,
    setHubLogsExpanded,
    loadHubLogs,
    copyHubLogs,
    handleHubLogsScroll,
  };
}
