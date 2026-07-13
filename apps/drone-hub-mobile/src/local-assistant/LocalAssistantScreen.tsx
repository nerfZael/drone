import React from 'react';
import { latestThinkingText } from '@drone/assistant-chat';
import { Alert, Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useLocalAssistant } from './LocalAssistantContext';
import { LocalAssistantTranscript } from './LocalAssistantTranscript';
import { LocalWorkspaceEditor } from './LocalWorkspaceEditor';
import {
  AssistantThreadDrawer,
  type AppDrawerNavigationItem,
} from './AssistantThreadDrawer';
import { AssistantModelPicker } from './AssistantModelPicker';
import { AssistantComposer } from './AssistantComposer';
import { loadLocalAssistantSettings } from './local-assistant-settings';
import { latestAssistantThread } from './latest-assistant-thread';
import {
  localAssistantModelOptions,
  normalizeLocalAssistantThinkingLevel,
} from './local-assistant-model';

export function LocalAssistantScreen({
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
  const assistant = useLocalAssistant();
  const [prompt, setPrompt] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [modelOpen, setModelOpen] = React.useState(false);
  const [localProvider, setLocalProvider] = React.useState<'openai' | 'codex'>('openai');
  const [error, setError] = React.useState<string | null>(null);
  const scroll = React.useRef<ScrollView | null>(null);
  const thread = assistant.threads.find((item) => item.id === assistant.activeThreadId) ?? null;
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
  const targetDevice = thread?.workspaceTarget
    ? mesh.devices.find((device) => device.id === thread.workspaceTarget?.targetDeviceId)
    : null;

  React.useEffect(() => setSettingsOpen(false), [thread?.id]);
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

  if (assistant.loading)
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
          onClose={() => onDrawerOpenChange(false)}
          onSelect={(threadId) => {
            assistant.selectThread(threadId);
            onDrawerOpenChange(false);
          }}
          onCreate={() => void runAction(() => assistant.createThread())}
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
          onClose={() => onDrawerOpenChange(false)}
          onSelect={(threadId) => {
            assistant.selectThread(threadId);
            onDrawerOpenChange(false);
          }}
          onCreate={() =>
            void runAction(async () => {
              await assistant.createThread();
              onDrawerOpenChange(false);
            })
          }
        />
        <View style={styles.welcome}>
          <Label>Local runtime</Label>
          <Text style={styles.welcomeTitle}>A coding assistant in your pocket.</Text>
          <Text style={styles.welcomeBody}>
            The model conversation runs on this phone. File operations cross the signed device mesh
            only when a destination has granted this exact thread access.
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
        onClose={() => onDrawerOpenChange(false)}
        onSelect={(threadId) => {
          assistant.selectThread(threadId);
          onDrawerOpenChange(false);
        }}
        onCreate={() =>
          void runAction(async () => {
            await assistant.createThread();
            onDrawerOpenChange(false);
          })
        }
      />
      <View style={styles.conversationHead}>
        <View style={styles.conversationCopy}>
          <Text numberOfLines={1} style={styles.conversationTitle}>
            {thread.title}
          </Text>
          <View style={styles.routeLine}>
            <View style={[styles.routeDot, targetDevice && styles.routeDotActive]} />
            <Text numberOfLines={1} style={styles.routeLabel}>
              {targetDevice
                ? `${targetDevice.name} / ${thread.workspaceTarget?.rootId}`
                : 'Phone only · no workspace'}
            </Text>
          </View>
        </View>
        <Pressable
          disabled={running}
          onPress={() => setSettingsOpen((value) => !value)}
          style={[styles.headerAction, running && styles.disabled]}
        >
          <Text style={styles.headerActionText}>{settingsOpen ? 'CHAT' : 'ACCESS'}</Text>
        </Pressable>
        <Pressable
          onPress={() =>
            Alert.alert('Delete phone thread?', 'Its local conversation will be removed.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Delete',
                style: 'destructive',
                onPress: () => void runAction(() => assistant.deleteThread(thread.id)),
              },
            ])
          }
          style={styles.deleteAction}
        >
          <Text style={styles.deleteActionText}>×</Text>
        </Pressable>
      </View>
      {settingsOpen ? (
        <ScrollView contentContainerStyle={styles.editorScroll} keyboardShouldPersistTaps="handled">
          <LocalWorkspaceEditor thread={thread} onClose={() => setSettingsOpen(false)} />
        </ScrollView>
      ) : (
        <>
          <ScrollView
            ref={scroll}
            style={styles.transcript}
            contentContainerStyle={styles.transcriptContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
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
  conversationHead: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    backgroundColor: colors.panel,
  },
  conversationCopy: { flex: 1, minWidth: 0 },
  conversationTitle: { color: colors.text, fontSize: 15, fontWeight: '800' },
  routeLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 5 },
  routeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  routeDotActive: { backgroundColor: colors.online },
  routeLabel: { color: colors.muted, fontSize: 9, fontWeight: '700', flex: 1 },
  headerAction: {
    height: 32,
    paddingHorizontal: 10,
    justifyContent: 'center',
    borderRadius: 9,
    borderColor: colors.border,
    borderWidth: 1,
  },
  headerActionText: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  disabled: { opacity: 0.4 },
  deleteAction: { width: 32, height: 32, justifyContent: 'center', alignItems: 'center' },
  deleteActionText: { color: colors.muted, fontSize: 22 },
  transcript: { flex: 1 },
  transcriptContent: { flexGrow: 1, padding: 14, paddingBottom: 20 },
  editorScroll: { padding: 14 },
});
