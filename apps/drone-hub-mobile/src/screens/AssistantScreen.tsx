import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

type Thread = {
  id: string;
  title: string;
  status: string;
  error: string | null;
  messageCount: number;
  workspaceTarget: null | { targetDeviceId: string; rootId: string; read: boolean; write: boolean };
};

function messageText(message: any): string {
  if (typeof message?.content === 'string') return message.content;
  if (Array.isArray(message?.content))
    return message.content
      .map((item: any) => (typeof item?.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n');
  return String(message?.text ?? message?.message ?? '');
}

function targetDetails(message: any): any {
  return message?.details?.target ?? message?.toolResult?.details?.target ?? null;
}

function meshRouteDetails(message: any): any {
  return message?.details?.meshRoute ?? message?.toolResult?.details?.meshRoute ?? null;
}

export function AssistantScreen() {
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
  const [selectedId, setSelectedId] = React.useState('');
  const [entries, setEntries] = React.useState<any[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

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

  const loadThreads = () =>
    run('threads', async () => {
      const result = await mesh.request(homeId, 'assistant-threads', 'threads.list');
      setThreads(Array.isArray(result?.threads) ? result.threads : []);
    });

  const openThread = (threadId: string) =>
    run('thread', async () => {
      setSelectedId(threadId);
      const result = await mesh.request(homeId, 'assistant-threads', 'thread.get', { threadId });
      setEntries(Array.isArray(result?.history?.entries) ? result.history.entries : []);
      if (result?.thread)
        setThreads((current) =>
          current.map((item) => (item.id === threadId ? result.thread : item)),
        );
    });

  const createThread = () =>
    run('create', async () => {
      const result = await mesh.request(homeId, 'assistant-threads', 'thread.create', { title });
      setTitle('');
      await loadThreads();
      if (result?.thread?.id) await openThread(result.thread.id);
    });

  const sendPrompt = () =>
    run('prompt', async () => {
      await mesh.request(homeId, 'assistant-threads', 'thread.prompt', {
        threadId: selectedId,
        prompt,
      });
      setPrompt('');
      setTimeout(() => void openThread(selectedId), 1500);
    });

  const selected = threads.find((thread) => thread.id === selectedId);

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View>
        <Label>Cross-device assistant</Label>
        <Text style={[textStyles.title, styles.title]}>One thread. A precise reach.</Text>
        <Text style={textStyles.body}>
          The home device runs the assistant. A remote workspace appears only when both devices hold
          the same thread-specific rule.
        </Text>
      </View>
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
      {homes.length === 0 ? (
        <Card>
          <Text style={textStyles.body}>
            No assistant host is advertised yet. Refresh Devices after connecting to a compatible
            Hub.
          </Text>
        </Card>
      ) : null}
      <ErrorBanner message={error} />
      {homeId ? (
        <>
          <View style={styles.createRow}>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="New thread title"
              placeholderTextColor="#5f767d"
              style={styles.input}
            />
            <Button onPress={() => void createThread()} loading={busy === 'create'}>
              Create
            </Button>
          </View>
          <Button tone="quiet" onPress={() => void loadThreads()} loading={busy === 'threads'}>
            Refresh threads
          </Button>
        </>
      ) : null}
      <View style={styles.threadList}>
        {threads.map((thread) => (
          <Pressable key={thread.id} onPress={() => void openThread(thread.id)}>
            <Card style={thread.id === selectedId ? styles.selectedCard : undefined}>
              <View style={styles.threadHead}>
                <Text style={textStyles.heading}>{thread.title}</Text>
                <Text style={styles.status}>{thread.status}</Text>
              </View>
              <Text style={[textStyles.mono, styles.threadId]}>{thread.id}</Text>
              <Text style={styles.workspace}>
                {thread.workspaceTarget
                  ? `${thread.workspaceTarget.rootId} on ${thread.workspaceTarget.targetDeviceId} · ${thread.workspaceTarget.write ? 'read/write' : 'read-only'}`
                  : 'Home device only'}
              </Text>
            </Card>
          </Pressable>
        ))}
      </View>
      {selected ? (
        <Card>
          <View style={styles.threadHead}>
            <View>
              <Label>Transcript</Label>
              <Text style={[textStyles.heading, styles.transcriptTitle]}>{selected.title}</Text>
            </View>
            <Button
              tone="quiet"
              onPress={() =>
                void run('stop', async () => {
                  await mesh.request(homeId, 'assistant-threads', 'thread.stop', {
                    threadId: selected.id,
                  });
                })
              }
            >
              Stop
            </Button>
          </View>
          <View style={styles.entries}>
            {entries.map((entry, index) => {
              const message = entry?.message ?? entry;
              const target = targetDetails(message);
              const route = meshRouteDetails(message);
              return (
                <View key={String(entry?.id ?? index)} style={styles.entry}>
                  <View style={styles.entryHead}>
                    <Text style={styles.role}>
                      {String(message?.role ?? message?.type ?? 'event')}
                    </Text>
                    {route || target ? (
                      <Text style={styles.targetBadge}>
                        {route
                          ? `${route.assistantHomeDeviceId} → ${route.targetDeviceId} / ${route.rootId}`
                          : `${target.label} / ${target.rootLabel}`}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={styles.message}>
                    {messageText(message).slice(0, 3000) || '(tool event)'}
                  </Text>
                </View>
              );
            })}
          </View>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Ask the assistant…"
            placeholderTextColor="#5f767d"
            multiline
            style={styles.prompt}
          />
          <Button
            disabled={!prompt.trim()}
            loading={busy === 'prompt'}
            onPress={() => void sendPrompt()}
          >
            Send prompt
          </Button>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  title: { marginTop: 6, marginBottom: 8 },
  homes: { gap: 8 },
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
  createRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    backgroundColor: colors.panel,
  },
  threadList: { gap: 9 },
  selectedCard: { borderColor: colors.accent },
  threadHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  status: {
    color: colors.online,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  threadId: { marginTop: 5 },
  workspace: { color: colors.warning, fontSize: 10, marginTop: 10 },
  transcriptTitle: { marginTop: 4 },
  entries: { gap: 8, marginVertical: 14 },
  entry: { backgroundColor: colors.background, borderRadius: 11, padding: 11 },
  entryHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  role: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  targetBadge: {
    color: colors.warning,
    fontSize: 8,
    fontWeight: '800',
    flexShrink: 1,
    textAlign: 'right',
  },
  message: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 5 },
  prompt: {
    minHeight: 86,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
});
