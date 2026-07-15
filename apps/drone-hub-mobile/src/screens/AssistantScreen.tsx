import React from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { latestThinkingText, type AssistantMessage } from '@drone/assistant-chat';
import { Card, ConfirmDialog, ErrorBanner, textStyles } from '../components/Ui';
import { QueuedPromptRows, type MobileQueuedPrompt } from '../components/QueuedPromptRows';
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
import { clonedAssistantThreadTitle } from '../local-assistant/cloned-assistant-thread-title';
import { useLatestMessageScroll } from '../local-assistant/use-latest-message-scroll';
import {
  AssistantApprovalCard,
  type MobileAssistantApproval,
} from '../local-assistant/AssistantApprovalCard';
import type { AssistantAppHeaderState } from './AssistantHomeScreen';

type Thread = {
  id: string;
  title: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  model?: string;
  provider?: string;
  thinkingLevel?: string;
  autoApprove?: boolean;
  error: string | null;
  messageCount: number;
  promptDeliveryMode?: 'queue' | 'asap';
  queuedPromptCount?: number;
  queuedPrompts?: Array<{
    id: string;
    prompt: string;
    createdAt: string;
    status: 'queued' | 'running' | 'failed';
    error?: string | null;
    imageCount?: number;
  }>;
  workspaceTarget: null | {
    targetDeviceId: string;
    rootId: string;
    workspaceName?: string;
    read: boolean;
    write: boolean;
    execute?: boolean;
  };
  workspaceTargets?: Array<{
    targetDeviceId: string;
    rootId: string;
    workspaceName?: string;
    read: boolean;
    write: boolean;
    execute?: boolean;
  }>;
};

function workspacePermissionSummary(target: {
  read: boolean;
  write: boolean;
  execute?: boolean;
}): string {
  return [target.read && 'read', target.write && 'write', target.execute && 'commands']
    .filter(Boolean)
    .join('/');
}

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
    message.errorMessage || (Array.isArray(message.attachments) && message.attachments.length > 0),
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
  const [pendingApprovals, setPendingApprovals] = React.useState<MobileAssistantApproval[]>([]);
  const [approvalBusyId, setApprovalBusyId] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [threadsLoaded, setThreadsLoaded] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [modelBusy, setModelBusy] = React.useState(false);
  const [deleteCandidate, setDeleteCandidate] = React.useState<Thread | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [messageDeleteCandidate, setMessageDeleteCandidate] = React.useState<{
    threadId: string;
    messageId: string;
    deleteFollowing: boolean;
  } | null>(null);
  const [deletingMessage, setDeletingMessage] = React.useState(false);
  const [cancellingPromptId, setCancellingPromptId] = React.useState('');
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
    setPendingApprovals([]);
    setApprovalBusyId('');
    setPrompt('');
    setBusy('');
    setThreadsLoaded(false);
    setError(null);
    setModelOpen(false);
    setModelBusy(false);
    setDeleteCandidate(null);
    setDeleting(false);
    setMessageDeleteCandidate(null);
    setDeletingMessage(false);
    setCancellingPromptId('');
  }, [homeId]);

  const run = async (key: string, task: () => Promise<void>) => {
    const requestVersion = ++runVersion.current;
    const busyRequestVersion = ++busyVersion.current;
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (nextError: any) {
      if (runVersion.current === requestVersion) setError(nextError?.message ?? String(nextError));
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
        if (homeIdRef.current !== destinationId || threadListVersion.current !== requestVersion)
          return;
        const nextThreads = Array.isArray(result?.threads) ? result.threads : [];
        setThreads((current) =>
          nextThreads.map((thread: Thread) => {
            const previous = current.find((item) => item.id === thread.id);
            if (!previous?.queuedPrompts?.length || thread.queuedPromptCount === 0) return thread;
            if (!thread.queuedPrompts?.length)
              return { ...thread, queuedPrompts: previous.queuedPrompts };
            return {
              ...thread,
              queuedPrompts: thread.queuedPrompts.map((queued) => ({
                ...queued,
                prompt:
                  queued.prompt ||
                  previous.queuedPrompts?.find((item) => item.id === queued.id)?.prompt ||
                  '',
              })),
            };
          }),
        );
        if (Array.isArray(result?.models)) setModels(result.models);
        setSelectedId((current) =>
          nextThreads.some((thread: Thread) => thread.id === current) ? current : '',
        );
      } catch (nextError: any) {
        if (homeIdRef.current === destinationId && threadListVersion.current === requestVersion)
          setError(nextError?.message ?? String(nextError));
      } finally {
        if (homeIdRef.current === destinationId && threadListVersion.current === requestVersion)
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
        if (homeIdRef.current !== destinationId || threadReadVersion.current !== requestVersion)
          return;
        const nextEntries = Array.isArray(result?.history?.entries) ? result.history.entries : [];
        const nextStreaming = Array.isArray(result?.streamingMessages)
          ? result.streamingMessages
          : [];
        setPendingApprovals(Array.isArray(result?.pendingApprovals) ? result.pendingApprovals : []);
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
        if (homeIdRef.current === destinationId && threadReadVersion.current === requestVersion)
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
      const result = await mesh.request(destinationId, 'assistant-threads', 'thread.create', {
        title: nextAssistantThreadTitle(threads),
      });
      if (homeIdRef.current !== destinationId) return;
      await loadThreads(true);
      if (result?.thread?.id) await openThread(result.thread.id);
    });

  const cloneThread = React.useCallback(
    (thread: Thread) =>
      run('clone', async () => {
        const destinationId = homeId;
        const result = await mesh.request(destinationId, 'assistant-threads', 'thread.clone', {
          title: clonedAssistantThreadTitle(thread.title, threads),
          threadId: thread.id,
        });
        if (homeIdRef.current !== destinationId) return;
        await loadThreads(true);
        if (result?.thread?.id) await openThread(result.thread.id);
      }),
    [homeId, loadThreads, mesh.request, openThread, threads],
  );

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

  const sendPrompt = (promptOverride?: string) => {
    const nextPrompt = String(promptOverride ?? prompt);
    if (!nextPrompt.trim()) return;
    return run('prompt', async () => {
      const destinationId = homeId;
      const threadId = selectedId;
      const result = await mesh.request(destinationId, 'assistant-threads', 'thread.prompt', {
        threadId,
        prompt: nextPrompt,
      });
      if (homeIdRef.current !== destinationId) return;
      const queuedPrompt = result?.queuedPrompt;
      setThreads((current) =>
        current.map((thread) =>
          thread.id === threadId
            ? {
                ...thread,
                status: 'running',
                ...(queuedPrompt?.id
                  ? {
                      queuedPrompts: [
                        ...(thread.queuedPrompts ?? []).filter(
                          (item) => item.id !== String(queuedPrompt.id),
                        ),
                        {
                          id: String(queuedPrompt.id),
                          prompt: String(queuedPrompt.prompt ?? nextPrompt.trim()),
                          createdAt: String(queuedPrompt.createdAt ?? new Date().toISOString()),
                          status:
                            queuedPrompt.status === 'failed'
                              ? ('failed' as const)
                              : ('queued' as const),
                          error: queuedPrompt.error ? String(queuedPrompt.error) : null,
                          imageCount: Math.max(0, Number(queuedPrompt.imageCount ?? 0) || 0),
                        },
                      ],
                    }
                  : {}),
              }
            : thread,
        ),
      );
      setPrompt('');
      setTimeout(() => {
        if (homeIdRef.current === destinationId) void openThread(threadId, true);
      }, 1500);
    });
  };

  const cancelQueuedPrompt = (promptId: string) => {
    if (!selected || !promptId || cancellingPromptId) return;
    const destinationId = homeId;
    const threadId = selected.id;
    setCancellingPromptId(promptId);
    setError(null);
    void mesh
      .request(destinationId, 'assistant-threads', 'thread.stop', {
        threadId,
        promptId,
      })
      .then((result) => {
        if (homeIdRef.current !== destinationId) return;
        if (result?.thread) {
          setThreads((current) =>
            current.map((thread) => (thread.id === threadId ? result.thread : thread)),
          );
        } else {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === threadId
                ? {
                    ...thread,
                    queuedPrompts: (thread.queuedPrompts ?? []).filter(
                      (item) => item.id !== promptId,
                    ),
                  }
                : thread,
            ),
          );
        }
      })
      .catch((nextError: any) => {
        if (homeIdRef.current === destinationId) setError(nextError?.message ?? String(nextError));
      })
      .finally(() => setCancellingPromptId((current) => (current === promptId ? '' : current)));
  };

  const selected = threads.find((thread) => thread.id === selectedId);
  const historyMessages = React.useMemo(
    () =>
      entries.map((entry) => {
        const message = entry?.message ?? entry;
        return {
          ...message,
          ...(entry?.id ? { id: String(entry.id) } : {}),
          ...(Number.isFinite(Number(entry?.sequence)) ? { sequence: Number(entry.sequence) } : {}),
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
    selected?.queuedPrompts?.some((item) => item.status === 'running') ||
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
  const visibleQueuedPrompts = React.useMemo<MobileQueuedPrompt[]>(
    () =>
      (selected?.queuedPrompts ?? [])
        .filter((item) => item.status !== 'running')
        .map((item) => ({
          id: item.id,
          prompt: item.prompt,
          status: item.status === 'failed' ? 'failed' : 'queued',
          error: item.error,
          imageCount: item.imageCount,
          cancelable: true,
        })),
    [selected?.queuedPrompts],
  );
  const activeHome = homes.find((home) => home.id === homeId);
  const updateAutoApprove = React.useCallback(
    async (thread: Thread) => {
      const destinationId = homeId;
      const result = await mesh.request(destinationId, 'assistant-threads', 'thread.update', {
        threadId: thread.id,
        autoApprove: !thread.autoApprove,
      });
      if (homeIdRef.current !== destinationId || !result?.thread) return;
      setThreads((current) =>
        current.map((item) => (item.id === thread.id ? result.thread : item)),
      );
      if (result.thread.autoApprove) setPendingApprovals([]);
    },
    [homeId, mesh.request],
  );
  const selectedWorkspaceTargets = React.useMemo(
    () =>
      (
        selected?.workspaceTargets ?? (selected?.workspaceTarget ? [selected.workspaceTarget] : [])
      ).map((target) => ({ ...target, execute: 'execute' in target && target.execute === true })),
    [selected?.workspaceTarget, selected?.workspaceTargets],
  );

  React.useEffect(() => {
    onHeaderChange(
      selected
        ? {
            title: selected.title,
            subtitle: `${selectedWorkspaceTargets.length > 1 ? `${selectedWorkspaceTargets.length} workspaces` : selectedWorkspaceTargets[0] ? `${selectedWorkspaceTargets[0].workspaceName ?? 'Workspace'} · ${workspacePermissionSummary(selectedWorkspaceTargets[0])}` : 'Home device only'}${activeHome ? ` · ${activeHome.name}` : ''}`,
            onNewThread: () => void createThread(),
            onCloneThread: () => void cloneThread(selected),
            cloneDisabled: running,
            autoApprove: selected.autoApprove === true,
            onToggleAutoApprove: () => void run('auto-approve', () => updateAutoApprove(selected)),
            onDelete: () => setDeleteCandidate(selected),
          }
        : null,
    );
  }, [
    activeHome?.name,
    homeId,
    cloneThread,
    running,
    onHeaderChange,
    selected?.id,
    selected?.title,
    selected?.autoApprove,
    selectedWorkspaceTargets,
    updateAutoApprove,
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
              messageActionsDisabled={running || threadLoading}
              onDeleteMessageRequest={({ message, deleteFollowing }) => {
                const messageId = String((message as any)?.id ?? '').trim();
                if (!messageId || !selected) return;
                setMessageDeleteCandidate({
                  threadId: selected.id,
                  messageId,
                  deleteFollowing,
                });
              }}
            />
            <QueuedPromptRows
              prompts={visibleQueuedPrompts}
              cancellingId={cancellingPromptId}
              onCancel={cancelQueuedPrompt}
            />
            {pendingApprovals.map((approval) => (
              <AssistantApprovalCard
                key={approval.id}
                approval={approval}
                busy={approvalBusyId === approval.id}
                onResolve={(approved) => {
                  if (!selected || approvalBusyId) return;
                  setApprovalBusyId(approval.id);
                  setError(null);
                  void mesh
                    .request(homeId, 'assistant-threads', 'approval.resolve', {
                      threadId: selected.id,
                      approvalId: approval.id,
                      approved,
                    })
                    .then(() => {
                      setPendingApprovals((current) =>
                        current.filter((item) => item.id !== approval.id),
                      );
                      return openThread(selected.id, true);
                    })
                    .catch((nextError: any) => setError(nextError?.message ?? String(nextError)))
                    .finally(() => setApprovalBusyId(''));
                }}
              />
            ))}
          </ScrollView>
          <AssistantComposer
            voiceResetKey={`${homeId}:${selected.id}`}
            value={prompt}
            onChangeText={setPrompt}
            onSend={(promptOverride) => void sendPrompt(promptOverride)}
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
            editable
            queueWhileRunning
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
      <ConfirmDialog
        visible={Boolean(messageDeleteCandidate)}
        title={
          messageDeleteCandidate?.deleteFollowing
            ? 'Delete this message and everything below it?'
            : 'Delete this message?'
        }
        message={
          messageDeleteCandidate?.deleteFollowing
            ? 'This message and every later message in the conversation will be permanently removed.'
            : 'This message will be permanently removed from the conversation.'
        }
        confirmLabel={
          messageDeleteCandidate?.deleteFollowing ? 'Delete messages' : 'Delete message'
        }
        destructive
        busy={deletingMessage}
        onCancel={() => setMessageDeleteCandidate(null)}
        onConfirm={() =>
          void (async () => {
            if (!messageDeleteCandidate) return;
            const destinationId = homeId;
            const candidate = messageDeleteCandidate;
            setDeletingMessage(true);
            setError(null);
            try {
              await mesh.request(destinationId, 'assistant-threads', 'thread.message.delete', {
                threadId: candidate.threadId,
                messageId: candidate.messageId,
                deleteFollowing: candidate.deleteFollowing,
              });
              if (homeIdRef.current !== destinationId) return;
              setMessageDeleteCandidate(null);
              await Promise.all([openThread(candidate.threadId, true), loadThreads(true)]);
            } catch (nextError: any) {
              if (homeIdRef.current === destinationId)
                setError(nextError?.message ?? String(nextError));
            } finally {
              setDeletingMessage(false);
            }
          })()
        }
      />
      <ConfirmDialog
        visible={Boolean(deleteCandidate)}
        title="Delete assistant thread?"
        message={`“${deleteCandidate?.title ?? 'This thread'}” and its conversation will be permanently removed from ${activeHome?.name ?? 'the selected device'}.`}
        confirmLabel="Delete thread"
        destructive
        busy={deleting}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() =>
          void (async () => {
            if (!deleteCandidate) return;
            const destinationId = homeId;
            const threadId = deleteCandidate.id;
            setDeleting(true);
            setError(null);
            try {
              await mesh.request(destinationId, 'assistant-threads', 'thread.delete', { threadId });
              if (homeIdRef.current !== destinationId) return;
              setDeleteCandidate(null);
              setThreads((current) => current.filter((thread) => thread.id !== threadId));
              if (selectedId === threadId) {
                setSelectedId('');
                setEntries([]);
                setStreamingMessages([]);
              }
              await loadThreads(true);
            } catch (nextError: any) {
              if (homeIdRef.current === destinationId)
                setError(nextError?.message ?? String(nextError));
            } finally {
              setDeleting(false);
            }
          })()
        }
      />
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
