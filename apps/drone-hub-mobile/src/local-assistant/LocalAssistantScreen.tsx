import React from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';
import { useLocalAssistant } from './LocalAssistantContext';
import { LocalAssistantTranscript } from './LocalAssistantTranscript';
import { LocalWorkspaceEditor } from './LocalWorkspaceEditor';

export function LocalAssistantScreen() {
  const mesh = useMesh();
  const assistant = useLocalAssistant();
  const [prompt, setPrompt] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const scroll = React.useRef<ScrollView | null>(null);
  const thread = assistant.threads.find((item) => item.id === assistant.activeThreadId) ?? null;
  const running = assistant.runningThreadId === thread?.id;
  const targetDevice = thread?.workspaceTarget
    ? mesh.devices.find((device) => device.id === thread.workspaceTarget?.targetDeviceId)
    : null;

  React.useEffect(() => setSettingsOpen(false), [thread?.id]);

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
      <View style={styles.centerState}>
        <Text style={textStyles.body}>Loading phone threads…</Text>
      </View>
    );
  if (!thread) {
    return (
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
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.page}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.threadBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.threadChips}
        >
          {assistant.threads.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => assistant.selectThread(item.id)}
              style={[styles.threadChip, item.id === thread.id && styles.threadChipActive]}
            >
              <View
                style={[styles.threadStatus, item.status === 'running' && styles.statusRunning]}
              />
              <Text numberOfLines={1} style={styles.threadChipText}>
                {item.title}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => void runAction(() => assistant.createThread())}
            style={styles.newThread}
          >
            <Text style={styles.newThreadText}>＋</Text>
          </Pressable>
        </ScrollView>
      </View>
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
            <LocalAssistantTranscript thread={thread} />
            {running ? <Text style={styles.thinking}>PHONE ASSISTANT IS WORKING…</Text> : null}
            <ErrorBanner message={error ?? thread.error ?? assistant.error} />
          </ScrollView>
          <View style={styles.composer}>
            <TextInput
              value={prompt}
              onChangeText={setPrompt}
              editable={!running}
              multiline
              maxLength={32_000}
              placeholder="Ask about the selected workspace…"
              placeholderTextColor={colors.muted}
              style={styles.promptInput}
            />
            {running ? (
              <Button
                tone="danger"
                onPress={() => assistant.stop(thread.id)}
                style={styles.sendButton}
              >
                Stop
              </Button>
            ) : (
              <Button
                disabled={!prompt.trim()}
                onPress={() => void send()}
                style={styles.sendButton}
              >
                Send
              </Button>
            )}
          </View>
        </>
      )}
    </KeyboardAvoidingView>
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
  threadBar: { minHeight: 50, borderBottomColor: colors.border, borderBottomWidth: 1 },
  threadChips: { alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 8 },
  threadChip: {
    maxWidth: 165,
    height: 33,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: colors.panel,
  },
  threadChipActive: {
    backgroundColor: colors.panelRaised,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  threadStatus: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted },
  statusRunning: { backgroundColor: colors.warning },
  threadChipText: { color: colors.text, fontSize: 11, fontWeight: '700', flexShrink: 1 },
  newThread: {
    width: 33,
    height: 33,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    borderColor: colors.border,
    borderWidth: 1,
  },
  newThreadText: { color: colors.accent, fontSize: 17 },
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
  thinking: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '900',
    letterSpacing: 1.2,
    marginTop: 14,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    backgroundColor: colors.panel,
  },
  promptInput: {
    flex: 1,
    maxHeight: 130,
    minHeight: 46,
    color: colors.text,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 13,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 14,
    textAlignVertical: 'top',
  },
  sendButton: { width: 76, minHeight: 46 },
  editorScroll: { padding: 14 },
});
