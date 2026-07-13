import React from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { latestThinkingText, type AssistantMessage } from '@drone/assistant-chat';
import { Card, ErrorBanner, textStyles } from '../components/Ui';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
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
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
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
  const [homeId, setHomeId] = React.useState(homes[0]?.id ?? '');
  const [threads, setThreads] = React.useState<Thread[]>([]);
  const [models, setModels] = React.useState<AssistantModelChoice[]>([]);
  const [selectedId, setSelectedId] = React.useState('');
  const [entries, setEntries] = React.useState<any[]>([]);
  const [streamingMessages, setStreamingMessages] = React.useState<AssistantMessage[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const realtimeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptScroll = React.useRef<ScrollView | null>(null);

  React.useEffect(() => {
    if (!homes.some((device) => device.id === homeId)) setHomeId(homes[0]?.id ?? '');
  }, [homeId, homes]);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    } finally {
      setBusy('');
    }
  };

  const loadThreads = React.useCallback(
    async (quiet = false) => {
      if (!homeId) return;
      if (!quiet) setBusy('threads');
      setError(null);
      try {
        const result = await mesh.request(homeId, 'assistant-threads', 'threads.list');
        const nextThreads = Array.isArray(result?.threads) ? result.threads : [];
        setThreads(nextThreads);
        if (Array.isArray(result?.models)) setModels(result.models);
        setSelectedId((current) =>
          nextThreads.some((thread: Thread) => thread.id === current) ? current : '',
        );
      } catch (nextError: any) {
        setError(nextError?.message ?? String(nextError));
      } finally {
        if (!quiet) setBusy('');
      }
    },
    [homeId, mesh.request],
  );

  const openThread = React.useCallback(
    async (threadId: string, quiet = false) => {
      if (!homeId) return;
      if (!quiet) {
        setBusy('thread');
        setEntries([]);
        setStreamingMessages([]);
      }
      setError(null);
      setSelectedId(threadId);
      try {
        const result = await mesh.request(homeId, 'assistant-threads', 'thread.get', { threadId });
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
        setError(nextError?.message ?? String(nextError));
      } finally {
        if (!quiet) setBusy('');
      }
    },
    [homeId, mesh.request],
  );

  const createThread = () =>
    run('create', async () => {
      const result = await mesh.request(homeId, 'assistant-threads', 'thread.create', {});
      await loadThreads(true);
      if (result?.thread?.id) await openThread(result.thread.id);
    });

  React.useEffect(() => {
    if (!homeId) return;
    void loadThreads();
  }, [homeId, loadThreads]);

  React.useEffect(() => {
    if (selectedId || threads.length === 0) return;
    const latest = latestAssistantThread(threads);
    if (latest) void openThread(latest.id);
  }, [openThread, selectedId, threads]);

  React.useEffect(() => {
    if (!homeId) return;
    return mesh.subscribe('assistant-threads', 'threads.changed', (event) => {
      if (event.sourceDeviceId !== homeId) return;
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
      realtimeTimer.current = setTimeout(() => {
        void loadThreads(true);
        if (selectedId && (!event.payload?.threadId || event.payload.threadId === selectedId))
          void openThread(selectedId, true);
      }, 250);
    });
  }, [homeId, loadThreads, mesh.subscribe, openThread, selectedId]);

  React.useEffect(
    () => () => {
      if (realtimeTimer.current) clearTimeout(realtimeTimer.current);
    },
    [],
  );

  const sendPrompt = () =>
    run('prompt', async () => {
      await mesh.request(homeId, 'assistant-threads', 'thread.prompt', {
        threadId: selectedId,
        prompt,
      });
      setThreads((current) =>
        current.map((thread) =>
          thread.id === selectedId ? { ...thread, status: 'running' } : thread,
        ),
      );
      setPrompt('');
      setTimeout(() => void openThread(selectedId, true), 1500);
    });

  const selected = threads.find((thread) => thread.id === selectedId);
  const historyMessages = React.useMemo(
    () =>
      entries.map((entry) => ({
        ...(entry?.message ?? entry),
        ...(Array.isArray(entry?.attachments) ? { attachments: entry.attachments } : {}),
      })),
    [entries],
  );
  const transcriptMessages = React.useMemo(
    () => [...historyMessages, ...streamingMessages],
    [historyMessages, streamingMessages],
  );
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

  return (
    <View style={styles.page}>
      <View style={styles.homeBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.homes}
        >
          {homes.map((home) => (
            <Pressable
              key={home.id}
              onPress={() => {
                setHomeId(home.id);
                setThreads([]);
                setSelectedId('');
                setEntries([]);
                setStreamingMessages([]);
              }}
              style={[styles.home, home.id === homeId && styles.homeActive]}
            >
              <View
                style={[styles.dot, mesh.connectedDeviceIds.includes(home.id) && styles.dotOnline]}
              />
              <Text style={[styles.homeText, home.id === homeId && styles.homeTextActive]}>
                {home.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
      {homes.length === 0 ? (
        <Card style={styles.insetCard}>
          <Text style={textStyles.body}>
            No assistant host is advertised yet. Refresh Devices after connecting to a compatible
            Hub.
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
        canCreate={Boolean(homeId)}
        offset={drawerOffset}
        openingGestureActive={openingGestureActive}
        navigationItems={navigationItems}
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
          <View style={styles.threadHead}>
            <View style={styles.threadCopy}>
              <Text numberOfLines={1} style={styles.transcriptTitle}>
                {selected.title}
              </Text>
              <Text numberOfLines={1} style={styles.threadRoute}>
                {selected.workspaceTarget
                  ? `${selected.workspaceTarget.rootId} · ${selected.workspaceTarget.write ? 'read/write' : 'read-only'}`
                  : 'Home device only'}
              </Text>
            </View>
          </View>
          <ScrollView
            ref={transcriptScroll}
            style={styles.transcript}
            contentContainerStyle={styles.entries}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => transcriptScroll.current?.scrollToEnd({ animated: true })}
          >
            <MobileAssistantTranscript
              messages={transcriptMessages}
              running={running}
              currentReasoning={currentReasoning}
              loading={busy === 'thread'}
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
                setModelBusy(true);
                setError(null);
                try {
                  const result = await mesh.request(homeId, 'assistant-threads', 'thread.update', {
                    threadId: selected.id,
                    provider: choice.provider,
                    model: choice.id,
                    thinkingLevel: choice.thinkingLevel,
                  });
                  if (result?.thread)
                    setThreads((current) =>
                      current.map((thread) => (thread.id === selected.id ? result.thread : thread)),
                    );
                  if (selection === 'reasoning') setModelOpen(false);
                } catch (nextError: any) {
                  setError(nextError?.message ?? String(nextError));
                } finally {
                  setModelBusy(false);
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
  homeBar: {
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  homes: { gap: 8, paddingHorizontal: 12, alignItems: 'center' },
  inset: { marginHorizontal: 12 },
  insetCard: { margin: 12 },
  home: {
    flexDirection: 'row',
    gap: 7,
    alignItems: 'center',
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
  },
  homeActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  homeText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  homeTextActive: { color: colors.text },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#53676d' },
  dotOnline: { backgroundColor: colors.online },
  threadHead: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  threadCopy: { flex: 1, minWidth: 0 },
  transcriptTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  threadRoute: { color: colors.muted, fontSize: 9, fontWeight: '700', marginTop: 5 },
  transcript: { flex: 1 },
  entries: { flexGrow: 1, paddingVertical: 10 },
});
