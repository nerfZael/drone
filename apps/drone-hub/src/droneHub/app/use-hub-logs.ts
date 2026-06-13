import React from 'react';
import type { HubLogsResponse } from './settings-types';

type RequestJsonFn = <T>(url: string, init?: RequestInit) => Promise<T>;

type CopyTextFn = (text: string) => Promise<boolean>;

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
  androidLogs: HubLogsResponse | null;
  androidLogsLoading: boolean;
  androidLogsError: string | null;
  androidLogsNotice: string | null;
  androidLogsExpanded: boolean;
  androidLogsTextareaRef: React.RefObject<HTMLTextAreaElement>;
  setAndroidLogsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  loadAndroidLogs: () => Promise<void>;
  copyAndroidLogs: () => Promise<void>;
  handleAndroidLogsScroll: (e: React.UIEvent<HTMLTextAreaElement>) => void;
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
  const [androidLogs, setAndroidLogs] = React.useState<HubLogsResponse | null>(null);
  const [androidLogsLoading, setAndroidLogsLoading] = React.useState(false);
  const [androidLogsError, setAndroidLogsError] = React.useState<string | null>(null);
  const [androidLogsNotice, setAndroidLogsNotice] = React.useState<string | null>(null);
  const [androidLogsExpanded, setAndroidLogsExpanded] = React.useState(false);
  const [androidLogsPinnedToBottom, setAndroidLogsPinnedToBottom] = React.useState(true);
  const androidLogsTextareaRef = React.useRef<HTMLTextAreaElement | null>(null);

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

  const loadAndroidLogs = React.useCallback(async () => {
    setAndroidLogsLoading(true);
    setAndroidLogsError(null);
    setAndroidLogsNotice(null);
    try {
      const data = await requestJson<HubLogsResponse>(`/api/settings/android/logs?tail=${tailLines}&maxBytes=${maxBytes}`);
      setAndroidLogs(data);
    } catch (e: any) {
      setAndroidLogsError(e?.message ?? String(e));
    } finally {
      setAndroidLogsLoading(false);
    }
  }, [maxBytes, requestJson, tailLines]);

  const copyAndroidLogs = React.useCallback(async () => {
    const text = String(androidLogs?.text ?? '');
    if (!text.trim()) return;
    await copyText(text);
    setAndroidLogsNotice('Copied Android logs.');
  }, [androidLogs?.text, copyText]);

  const handleAndroidLogsScroll = React.useCallback((e: React.UIEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const pinned = distanceFromBottom <= 8;
    setAndroidLogsPinnedToBottom((prev) => (prev === pinned ? prev : pinned));
  }, []);

  React.useEffect(() => {
    if (appView !== 'settings') return;
    void loadHubLogs();
    void loadAndroidLogs();
  }, [appView, loadAndroidLogs, loadHubLogs]);

  React.useEffect(() => {
    if (!hubLogsExpanded) return;
    if (!hubLogsPinnedToBottom) return;
    const el = hubLogsTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [hubLogs?.text, hubLogsExpanded, hubLogsPinnedToBottom]);

  React.useEffect(() => {
    if (!androidLogsExpanded) return;
    if (!androidLogsPinnedToBottom) return;
    const el = androidLogsTextareaRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [androidLogs?.text, androidLogsExpanded, androidLogsPinnedToBottom]);

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
    androidLogs,
    androidLogsLoading,
    androidLogsError,
    androidLogsNotice,
    androidLogsExpanded,
    androidLogsTextareaRef,
    setAndroidLogsExpanded,
    loadAndroidLogs,
    copyAndroidLogs,
    handleAndroidLogsScroll,
  };
}
