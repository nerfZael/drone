import React from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { latestThinkingText, type AssistantMessage } from '@drone/assistant-chat';
import { Card, ErrorBanner, textStyles } from '../components/Ui';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from '../local-assistant/AssistantThreadDrawer';
import { AssistantComposer } from '../local-assistant/AssistantComposer';
import { MobileAssistantTranscript } from '../local-assistant/LocalAssistantTranscript';
import {
  AssistantModelPicker,
  type AssistantModelChoice,
} from '../local-assistant/AssistantModelPicker';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { latestAssistantThread } from '../local-assistant/latest-assistant-thread';
import { nextAssistantThreadTitle } from '../local-assistant/next-assistant-thread-title';
import { useLatestMessageScroll } from '../local-assistant/use-latest-message-scroll';
import type { AssistantAppHeaderState } from './AssistantHomeScreen';

type Thread = {
  id: string;
  title: string;
  status: string;
  updatedAt?: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  error: string | null;
  messageCount: number;
  workspaceTarget: null | { targetDeviceId: string; rootId: string; read: boolean; write: boolean };
};

function assistantMessageIsRenderable(message: any): boolean {
  if (!message || message.role !== 'assistant') return false;
  if (typeof message.content === 'string' && message.content.trim()) return true;
  if (
    Array.isArray(message.content) &&
    message.content.some(
      (part: any) =>
        (part?.type === 'text' && typeof part.text === 'string' && part.text.trim()) ||
        part?.type === 'image' ||
        part?.type === 'image_url',
    )
  )
    return true;
  return Boolean(
    message.errorMessage ||
      (Array.isArray(message.attachments) && message.attachments.length > 0),
  );
}

function historyHasRenderableAssistantAfterLatestUser(entries: any[]): boolean {
  const messages = entries.map((entry) => ({
    ...(entry?.message ?? entry),
    attachments: entry?.attachments ?? entry?.message?.attachments,
  }));
  const lastUserIndex = messages.reduce(
    (latest, message, index) => (message?.role === 'user' ? index : latest),
    -1,
  );
  return messages.slice(lastUserIndex + 1).some(assistantMessageIsRenderable);
}

export function AssistantScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
  homeId,
  devicePickerItems,
  onDeviceChange,
  onHeaderChange,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
  homeId: string;
  devicePickerItems: DrawerDevicePickerItem[];
  onDeviceChange(deviceId: string): void;
  onHeaderChange(header: AssistantAppHeaderState | null): void;
}) {
  const mesh = useMesh();
  const homes = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'assistant-threads',
      ),
  );
  const homeSupportsAssistant = homes.some((device) => device.id === homeId);
  const homeConnected = mesh.connectedDeviceIds.includes(homeId);
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [models, setModels] = React.useState<AssistantModelChoice[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [entries, setEntries] = React.useState<any[]>([]);
  const [streamingMessages, setStreamingMessages] = React.useState<AssistantMessage[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [threadsLoaded, setThreadsLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const realtimeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const homeIdRef = React.useRef(homeId);
  const threadListVersion = React.useRef(0);
  const threadReadVersion = React.useRef(0);
  const runVersion = React.useRef(0);
  const busyVersion = React.useRef(0);
  const modelRequestVersion = React.useRef(0);
  homeIdRef.current = homeId;

  React.useEffect(() => {
    threadListVersion.current += 1;
    threadReadVersion.current += 1;
    runVersion.current += 1;
    busyVersion.current += 1;
    modelRequestVersion.current += 1;
    setThreads([]);
    setModels([]);
    setSelectedId('');
    setEntries([]);
    setStreamingMessages([]);
    setPrompt('');
    setBusy('');
    setThreadsLoaded(false);
    setError(null);
    setModelOpen(false);
    setModelBusy(false);
  }, [homeId]);

  const run = async (key: string, task: () => Promise<void>) => {
    const requestVersion = ++runVersion.current;
    const busyRequestVersion = ++busyVersion.current;
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (nextError: any) {
      if (runVersion.current === requestVersion)
        setError(nextError?.message ?? String(nextError));
    } finally {
      if (busyVersion.current === busyRequestVersion) setBusy('');
    }
  };

  const loadThreads = React.useCallback(
    async (quiet = false) => {
      if (!homeId || !homeSupportsAssistant || homeIdRef.current !== homeId) return;
      const destinationId = homeId;
      const requestVersion = ++threadListVersion.current;
      const busyRequestVersion = quiet ? 0 : ++busyVersion.current;
      if (!quiet) setBusy('threads');
      setError(null);
      try {
        const result = await mesh.request(destinationId, 'assistant-threads', 'threads.list');
        if (
          homeIdRef.current !== destinationId ||
          threadListVersion.current !== requestVersion
        )
          return;
        const nextThreads = Array.isArray(result?.threads) ? result.threads : [];
        setThreads(nextThreads);
        if (Array.isArray(result?.models)) setModels(result.models);
        setSelectedId((current) =>
          nextThreads.some((thread: Thread) => thread.id === current) ? current : '',
        );
      } catch (nextError: any) {
        if (
          homeIdRef.current === destinationId &&
          threadListVersion.current === requestVersion
        )
          setError(nextError?.message ?? String(nextError));
      } finally {
        if (
          homeIdRef.current === destinationId &&
          threadListVersion.current === requestVersion
        )
          setThreadsLoaded(true);
        if (
          !quiet &&
          homeIdRef.current === destinationId &&
          threadListVersion.current === requestVersion &&
          busyVersion.current === busyRequestVersion
        )
          setBusy('');
      }
    },
    [homeId, homeSupportsAssistant, mesh.request],
  );

  const openThread = React.useCallback(
    async (threadId: string, quiet = false) => {
      if (!homeId || !homeSupportsAssistant || homeIdRef.current !== homeId) return;
      const destinationId = homeId;
      const requestVersion = ++threadReadVersion.current;
      const busyRequestVersion = quiet ? 0 : ++busyVersion.current;
      if (!quiet) {
        setBusy('thread');
        setEntries([]);
        setStreamingMessages([]);
      }
      setError(null);
      setSelectedId(threadId);
      try {
        const result = await mesh.request(destinationId, 'assistant-threads', 'thread.get', {
          threadId,
        });
        if (
          homeIdRef.current !== destinationId ||
          threadReadVersion.current !== requestVersion
        )
          return;
        const nextEntries = Array.isArray(result?.history?.entries) ? result.history.entries : [];
        const nextStreaming = Array.isArray(result?.streamingMessages)
          ? result.streamingMessages
          : [];
        setEntries(nextEntries);
        setStreamingMessages((current) => {
          if (nextStreaming.length > 0) return nextStreaming;
          if (!historyHasRenderableAssistantAfterLatestUser(nextEntries))
            return current.filter((message) => message.role === 'assistant');
          return [];
        });
        if (result?.thread)
          setThreads((current) =>
            current.map((item) => (item.id === threadId ? result.thread : item)),
          );
      } catch (nextError: any) {
        if (
          homeIdRef.current === destinationId &&
          threadReadVersion.current === requestVersion
        )
          setError(nextError?.message ?? String(nextError));
      } finally {
        if (
          !quiet &&
          homeIdRef.current === destinationId &&
          threadReadVersion.current === requestVersion &&
          busyVersion.current === busyRequestVersion
        )
          setBusy('');
      }
    },
    [homeId, homeSupportsAssistant, mesh.request],
  );

  const createThread = () =>
    run('create', async () => {
      const destinationId = homeId;
      const result = await mesh.request(
        destinationId,
        'assistant-threads',
        'thread.create',
        { title: nextAssistantThreadTitle(threads) },
      );
      if (homeIdRef.current !== destinationId) return;
      await loadThreads(true);
      if (result?.thread?.id) await openThread(result.thread.id);
    });

  React.useEffect(() => {
    if (!homeId || !homeSupportsAssistant || !homeConnected) return;
    void loadThreads();
  }, [homeConnected, homeId, homeSupportsAssistant, loadThreads]);

  React.useEffect(() => {
    if (selectedId || threads.length === 0) return;
    const latest = latestAssistantThread(threads);
    if (latest) void openThread(latest.id);
  }, [openThread, selectedId, threads]);

  React.useEffect(() => {
    if (!homeId || !homeSupportsAssistant) return;
    const unsubscribe = mesh.subscribe('assistant-threads', 'threads.changed', (event) => {
      if (event.sourceDeviceId !== homeId) return;
      if (realtimeTimer.current) return;
      realtimeTimer.current = setTimeout(() => {
        realtimeTimer.current = null;
        void loadThreads(true);
        if (selectedId) void openThread(selectedId, true);
      }, 250);
    });
    return () => {
      unsubscribe();
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = null;
    };
  }, [homeId, homeSupportsAssistant, loadThreads, mesh.subscribe, openThread, selectedId]);

  const sendPrompt = () =>
    run('prompt', async () => {
      const destinationId = homeId;
      const threadId = selectedId;
      await mesh.request(destinationId, 'assistant-threads', 'thread.prompt', {
        threadId,
        prompt,
      });
      if (homeIdRef.current !== destinationId) return;
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId ? { ...thread, status: 'running' } : thread,
        ),
      );
      setPrompt('');
      setTimeout(() => {
        if (homeIdRef.current === destinationId) void openThread(threadId, true);
      }, 1500);
    });

  const selected = threads.find((thread) => thread.id === selectedId);
  const historyMessages = React.useMemo(
    () =>
      entries.map((entry) => {
        const message = entry?.message ?? entry;
        return {
          ...message,
          ...(message?.createdAt == null && message?.timestamp == null && entry?.timestamp
            ? { timestamp: entry.timestamp }
            : {}),
          ...(Array.isArray(entry?.attachments) ? { attachments: entry.attachments } : {}),
        };
      }),
    [entries],
  );
  const transcriptMessages = React.useMemo(
    () => [...historyMessages, ...streamingMessages],
    [historyMessages, streamingMessages],
  );
  const threadLoading = busy === 'thread';
  const latestMessageScroll = useLatestMessageScroll(selectedId, threadLoading);
  const streamingAssistant = streamingMessages.find((message) => message.role === 'assistant');
  const running = Boolean(
    streamingMessages.length > 0 ||
    selected?.status === 'running' ||
    selected?.status === 'waiting_for_approval' ||
    selected?.status === 'waiting_for_chats_idle',
  );
  const lastUserIndex = transcriptMessages.reduce(
    (latest, message, index) => (message.role === 'user' ? index : latest),
    -1,
  );
  const currentRunAssistant = [...transcriptMessages.slice(lastUserIndex + 1)]
    .reverse()
    .find((message) => message.role === 'assistant');
  const currentReasoning = running
    ? latestThinkingText(streamingAssistant ?? currentRunAssistant ?? { role: 'assistant' })
    : '';
  const selectedModelName =
    models.find((model) => model.provider === selected?.provider && model.id === selected?.model)
      ?.name ||
    selected?.model ||
    'Model';
  const activeHome = homes.find((home) => home.id === homeId);

  React.useEffect(() => {
    onHeaderChange(
      selected
        ? {
            title: selected.title,
            subtitle: `${selected.workspaceTarget ? `${selected.workspaceTarget.rootId} · ${selected.workspaceTarget.write ? 'read/write' : 'read-only'}` : 'Home device only'}${activeHome ? ` · ${activeHome.name}` : ''}`,
          }
        : null,
    );
  }, [
    activeHome?.name,
    homeId,
    onHeaderChange,
    selected?.id,
    selected?.title,
    selected?.workspaceTarget,
  ]);
  React.useEffect(() => () => onHeaderChange(null), [onHeaderChange]);

  return (
    <View style={styles.page}>
      {!homeSupportsAssistant ? (
        <Card style={styles.insetCard}>
          <Text style={textStyles.body}>
            {mesh.devices.find((device) => device.id === homeId)?.name ?? 'This device'} does not
            provide remote assistant threads. Choose this phone or a compatible Hub from the menu.
          </Text>
        </Card>
      ) : null}
      {error ? (
        <View style={styles.inset}>
          <ErrorBanner message={error} />
        </View>
      ) : null}
      <AssistantThreadDrawer
        open={drawerOpen}
        title={homes.find((home) => home.id === homeId)?.name ?? 'On devices'}
        threads={threads}
        activeThreadId={selectedId}
        creating={busy === 'create'}
        threadsLoading={
          homeSupportsAssistant && homeConnected && (!threadsLoaded || busy === 'threads')
        }
        canCreate={homeSupportsAssistant}
        offset={drawerOffset}
        openingGestureActive={openingGestureActive}
        navigationItems={navigationItems}
        devicePickerItems={devicePickerItems}
        activeDeviceId={homeId}
        onSelectDevice={(deviceId) => {
          setThreadsLoaded(false);
          onDeviceChange(deviceId);
        }}
        onClose={() => onDrawerOpenChange(false)}
        onSelect={(threadId) => {
          onDrawerOpenChange(false);
          void openThread(threadId);
        }}
        onCreate={() => {
          onDrawerOpenChange(false);
          if (homeId) void createThread();
        }}
      />
      {selected ? (
        <>
          <ScrollView
            ref={latestMessageScroll.ref}
            style={styles.transcript}
            contentContainerStyle={[
              styles.entries,
              !latestMessageScroll.contentVisible && styles.entriesHidden,
            ]}
            keyboardShouldPersistTaps="handled"
            onLayout={latestMessageScroll.onLayout}
            onContentSizeChange={latestMessageScroll.onContentSizeChange}
            onScroll={latestMessageScroll.onScroll}
            scrollEventThrottle={16}
          >
            <MobileAssistantTranscript
              messages={transcriptMessages}
              running={running}
              currentReasoning={currentReasoning}
              loading={threadLoading}
            />
          </ScrollView>
          <AssistantComposer
            value={prompt}
            onChangeText={setPrompt}
            onSend={() => void sendPrompt()}
            onStop={() =>
              void run('stop', async () => {
                await mesh.request(homeId, 'assistant-threads', 'thread.stop', {
                  threadId: selected.id,
                });
              })
            }
            onOpenModel={() => setModelOpen(true)}
            modelLabel={selectedModelName}
            reasoningLabel={selected.thinkingLevel}
            running={running}
            sending={busy === 'prompt'}
            editable={!running}
          />
          <AssistantModelPicker
            open={modelOpen}
            currentProvider={selected.provider || 'openai'}
            currentModel={selected.model || ''}
            currentThinkingLevel={selected.thinkingLevel}
            options={models}
            busy={modelBusy}
            onClose={() => setModelOpen(false)}
            onSelect={(choice, selection) =>
              void (async () => {
                const destinationId = homeId;
                const threadId = selected.id;
                const requestVersion = ++modelRequestVersion.current;
                setModelBusy(true);
                setError(null);
                try {
                  const result = await mesh.request(
                    destinationId,
                    'assistant-threads',
                    'thread.update',
                    {
                      threadId,
                      provider: choice.provider,
                      model: choice.id,
                      thinkingLevel: choice.thinkingLevel,
                    },
                  );
                  if (
                    homeIdRef.current !== destinationId ||
                    modelRequestVersion.current !== requestVersion
                  )
                    return;
                  if (result?.thread)
                    setThreads((current) =>
                      current.map((thread) => (thread.id === threadId ? result.thread : thread)),
                    );
                  if (selection === 'reasoning') setModelOpen(false);
                } catch (nextError: any) {
                  if (
                    homeIdRef.current === destinationId &&
                    modelRequestVersion.current === requestVersion
                  )
                    setError(nextError?.message ?? String(nextError));
                } finally {
                  if (modelRequestVersion.current === requestVersion) setModelBusy(false);
                }
              })()
            }
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  inset: { marginHorizontal: 12 },
  insetCard: { margin: 12 },
  transcript: { flex: 1 },
  entries: { flexGrow: 1, paddingVertical: 10 },
  entriesHidden: { opacity: 0 },
});
