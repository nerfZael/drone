import React from 'react';
import { latestThinkingText } from '@drone/assistant-chat';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ConfirmDialog, ErrorBanner, Label, textStyles } from '../components/Ui';
import { colors } from '../theme';
import { useLocalAssistant } from './LocalAssistantContext';
import { LocalAssistantTranscript } from './LocalAssistantTranscript';
import { LocalWorkspaceEditor } from './LocalWorkspaceEditor';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
  type DrawerDevicePickerItem,
} from './AssistantThreadDrawer';
import { AssistantModelPicker } from './AssistantModelPicker';
import { AssistantComposer } from './AssistantComposer';
import { loadLocalAssistantSettings } from './local-assistant-settings';
import { latestAssistantThread } from './latest-assistant-thread';
import {
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
} from './local-assistant-model';
import type { AssistantAppHeaderState } from '../screens/AssistantHomeScreen';
import { useLatestMessageScroll } from './use-latest-message-scroll';

export function LocalAssistantScreen({
  drawerOpen,
  drawerOffset,
  navigationItems,
  openingGestureActive,
  onDrawerOpenChange,
  activeDeviceId,
  devicePickerItems,
  onDeviceChange,
  onHeaderChange,
}: {
  drawerOpen: boolean;
  drawerOffset: Animated.Value;
  navigationItems: AppDrawerNavigationItem[];
  openingGestureActive: boolean;
  onDrawerOpenChange(open: boolean): void;
  activeDeviceId: string;
  devicePickerItems: DrawerDevicePickerItem[];
  onDeviceChange(deviceId: string): void;
  onHeaderChange(header: AssistantAppHeaderState | null): void;
}) {
  const assistant = useLocalAssistant();
  const [prompt, setPrompt] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [accessDirty, setAccessDirty] = React.useState(false);
  const [confirmAccessDiscard, setConfirmAccessDiscard] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [localProvider, setLocalProvider] = React.useState<'openai' | 'codex'>('openai');
  const [error, setError] = React.useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = React.useState<{
    id: string;
    title: string;
  } | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const pendingAfterAccessDiscard = React.useRef<(() => void) | null>(null);
  const thread = assistant.threads.find((item) => item.id === assistant.activeThreadId) ?? null;
  const latestMessageScroll = useLatestMessageScroll(thread?.id ?? '');
  const running = assistant.runningThreadId === thread?.id;
  const lastUserIndex =
    thread?.messages.reduce(
      (latest, message, index) => (message.role === 'user' ? index : latest),
      -1,
    ) ?? -1;
  const currentRunAssistant = thread
    ? [...thread.messages.slice(lastUserIndex + 1)]
        .reverse()
        .find((message) => message.role === 'assistant')
    : null;
  const currentReasoning =
    running && currentRunAssistant ? latestThinkingText(currentRunAssistant) : '';
  React.useEffect(() => {
    setSettingsOpen(false);
    setAccessDirty(false);
    setConfirmAccessDiscard(false);
    pendingAfterAccessDiscard.current = null;
  }, [thread?.id]);
  React.useEffect(() => {
    void loadLocalAssistantSettings().then((settings) => setLocalProvider(settings.provider));
  }, []);
  React.useEffect(() => {
    void assistant
      .refreshThreads()
      .then((threads) => {
        const latest = latestAssistantThread(threads);
        if (latest) assistant.selectThread(latest.id);
      })
      .catch((nextError) => setError(nextError?.message ?? String(nextError)));
  }, [assistant.refreshThreads]);

  const runAction = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (nextError: any) {
      setError(nextError?.message ?? String(nextError));
    }
  };

  const send = async () => {
    if (!thread || !prompt.trim()) return;
    const nextPrompt = prompt;
    setPrompt('');
    setError(null);
    try {
      await assistant.sendPrompt(thread.id, nextPrompt);
    } catch (nextError: any) {
      setPrompt((current) => current || nextPrompt);
      setError(nextError?.message ?? String(nextError));
    }
  };
  const requestCloseAccess = React.useCallback(() => {
    if (accessDirty) {
      pendingAfterAccessDiscard.current = null;
      setConfirmAccessDiscard(true);
    } else setSettingsOpen(false);
  }, [accessDirty]);
  const guardAccessChanges = React.useCallback(
    (action: () => void) => {
      if (settingsOpen && accessDirty) {
        pendingAfterAccessDiscard.current = action;
        setConfirmAccessDiscard(true);
      } else action();
    },
    [accessDirty, settingsOpen],
  );
  const toggleAccess = React.useCallback(() => {
    if (settingsOpen) requestCloseAccess();
    else setSettingsOpen(true);
  }, [requestCloseAccess, settingsOpen]);
  const deleteActionRef = React.useRef<() => void>(() => {});
  deleteActionRef.current = () => {
    if (!thread) return;
    setDeleteCandidate({ id: thread.id, title: thread.title });
  };
  const deleteFromHeader = React.useCallback(() => deleteActionRef.current(), []);

  React.useEffect(() => {
    onHeaderChange(
      thread
        ? {
            title: thread.title,
            subtitle:
              thread.workspaceTargets.length === 0
                ? 'Phone only · no workspace'
                : thread.workspaceTargets.length === 1
                  ? `${thread.workspaceTargets[0].deviceName} / ${thread.workspaceTargets[0].workspaceName}`
                  : `${thread.workspaceTargets.length} workspaces · ${new Set(thread.workspaceTargets.map((target) => target.targetDeviceId)).size} devices`,
            accessOpen: settingsOpen,
            accessDisabled: running,
            onToggleAccess: toggleAccess,
            onDelete: deleteFromHeader,
          }
        : null,
    );
  }, [
    deleteFromHeader,
    onHeaderChange,
    running,
    settingsOpen,
    thread?.id,
    thread?.title,
    thread?.workspaceTargets,
    toggleAccess,
  ]);
  React.useEffect(() => () => onHeaderChange(null), [onHeaderChange]);

  if (assistant.loading)
    return (
      <View style={styles.page}>
        <AssistantThreadDrawer
          open={drawerOpen}
          title="On this phone"
          threads={assistant.threads}
          activeThreadId={assistant.activeThreadId}
          threadsLoading
          offset={drawerOffset}
          openingGestureActive={openingGestureActive}
          navigationItems={navigationItems}
          devicePickerItems={devicePickerItems}
          activeDeviceId={activeDeviceId}
          onSelectDevice={onDeviceChange}
          onClose={() => onDrawerOpenChange(false)}
          onSelect={(threadId) => {
            guardAccessChanges(() => {
              assistant.selectThread(threadId);
              onDrawerOpenChange(false);
            });
          }}
          onCreate={() => guardAccessChanges(() => void runAction(() => assistant.createThread()))}
        />
        <View style={styles.centerState}>
          <Text style={textStyles.body}>Loading phone threads…</Text>
        </View>
      </View>
    );
  if (!thread) {
    return (
      <View style={styles.page}>
        <AssistantThreadDrawer
          open={drawerOpen}
          title="On this phone"
          threads={assistant.threads}
          activeThreadId={assistant.activeThreadId}
          offset={drawerOffset}
          openingGestureActive={openingGestureActive}
          navigationItems={navigationItems}
          devicePickerItems={devicePickerItems}
          activeDeviceId={activeDeviceId}
          onSelectDevice={onDeviceChange}
          onClose={() => onDrawerOpenChange(false)}
          onSelect={(threadId) => {
            guardAccessChanges(() => {
              assistant.selectThread(threadId);
              onDrawerOpenChange(false);
            });
          }}
          onCreate={() =>
            guardAccessChanges(
              () =>
                void runAction(async () => {
                  await assistant.createThread();
                  onDrawerOpenChange(false);
                }),
            )
          }
        />
        <View style={styles.welcome}>
          <Label>Local runtime</Label>
          <Text style={styles.welcomeTitle}>A coding assistant in your pocket.</Text>
          <Text style={styles.welcomeBody}>
            The model conversation runs on this phone. File operations cross the signed device mesh
            only when this thread selects a workspace that its destination granted to this phone.
          </Text>
          <Button onPress={() => void runAction(() => assistant.createThread())}>
            Create phone thread
          </Button>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.page}>
      <AssistantThreadDrawer
        open={drawerOpen}
        title="On this phone"
        threads={assistant.threads}
        activeThreadId={thread.id}
        offset={drawerOffset}
        openingGestureActive={openingGestureActive}
        navigationItems={navigationItems}
        devicePickerItems={devicePickerItems}
        activeDeviceId={activeDeviceId}
        onSelectDevice={onDeviceChange}
        onClose={() => onDrawerOpenChange(false)}
        onSelect={(threadId) => {
          guardAccessChanges(() => {
            assistant.selectThread(threadId);
            onDrawerOpenChange(false);
          });
        }}
        onCreate={() =>
          guardAccessChanges(
            () =>
              void runAction(async () => {
                await assistant.createThread();
                onDrawerOpenChange(false);
              }),
          )
        }
      />
      {settingsOpen ? (
        <ScrollView contentContainerStyle={styles.editorScroll} keyboardShouldPersistTaps="handled">
          <LocalWorkspaceEditor
            thread={thread}
            onRequestClose={requestCloseAccess}
            onApplied={() => {
              setAccessDirty(false);
              setSettingsOpen(false);
            }}
            onDirtyChange={setAccessDirty}
          />
        </ScrollView>
      ) : (
        <>
          <ScrollView
            ref={latestMessageScroll.ref}
            style={styles.transcript}
            contentContainerStyle={[
              styles.transcriptContent,
              !latestMessageScroll.contentVisible && styles.transcriptContentHidden,
            ]}
            keyboardShouldPersistTaps="handled"
            onLayout={latestMessageScroll.onLayout}
            onContentSizeChange={latestMessageScroll.onContentSizeChange}
            onScroll={latestMessageScroll.onScroll}
            scrollEventThrottle={16}
          >
            <LocalAssistantTranscript
              thread={thread}
              running={running}
              currentReasoning={currentReasoning}
            />
            <ErrorBanner message={error ?? thread.error ?? assistant.error} />
          </ScrollView>
          <AssistantComposer
            value={prompt}
            onChangeText={setPrompt}
            onSend={() => void send()}
            onStop={() => assistant.stop(thread.id)}
            onOpenModel={() => setModelOpen(true)}
            modelLabel={thread.model}
            reasoningLabel={thread.thinkingLevel}
            running={running}
            editable={!running}
          />
          <AssistantModelPicker
            open={modelOpen}
            currentProvider={localProvider}
            currentModel={thread.model}
            currentThinkingLevel={thread.thinkingLevel}
            options={localAssistantModelOptions(localProvider)}
            onClose={() => setModelOpen(false)}
            onSelect={(choice, selection) =>
              void runAction(async () => {
                await assistant.updateThread(thread.id, {
                  model: choice.id,
                  thinkingLevel: normalizeLocalAssistantThinkingLevel(choice.thinkingLevel),
                });
                if (selection === 'reasoning') setModelOpen(false);
              })
            }
          />
        </>
      )}
      <ConfirmDialog
        visible={confirmAccessDiscard}
        title="Discard access changes?"
        message="Your unsaved workspace selections will be lost."
        confirmLabel="Discard changes"
        destructive
        onCancel={() => {
          pendingAfterAccessDiscard.current = null;
          setConfirmAccessDiscard(false);
        }}
        onConfirm={() => {
          const nextAction = pendingAfterAccessDiscard.current;
          pendingAfterAccessDiscard.current = null;
          setConfirmAccessDiscard(false);
          setAccessDirty(false);
          setSettingsOpen(false);
          nextAction?.();
        }}
      />
      <ConfirmDialog
        visible={Boolean(deleteCandidate)}
        title="Delete phone thread?"
        message={`“${deleteCandidate?.title ?? 'This thread'}” and its local conversation will be permanently removed.`}
        confirmLabel="Delete thread"
        destructive
        busy={deleting}
        onCancel={() => setDeleteCandidate(null)}
        onConfirm={() =>
          void (async () => {
            if (!deleteCandidate) return;
            setDeleting(true);
            setError(null);
            try {
              await assistant.deleteThread(deleteCandidate.id);
              setDeleteCandidate(null);
            } catch (nextError: any) {
              setDeleteCandidate(null);
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
  centerState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  welcome: { flex: 1, justifyContent: 'center', padding: 28, gap: 17 },
  welcomeTitle: {
    color: colors.text,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: '800',
    letterSpacing: -1.1,
  },
  welcomeBody: { color: colors.muted, fontSize: 15, lineHeight: 23, marginBottom: 8 },
  transcript: { flex: 1 },
  transcriptContent: { flexGrow: 1, padding: 14, paddingBottom: 20 },
  transcriptContentHidden: { opacity: 0 },
  editorScroll: { padding: 14 },
});
