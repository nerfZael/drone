import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorBanner, Label, textStyles } from '../components/Ui';
import { useMesh } from '../mesh/MeshContext';
import { colors } from '../theme';

type Drone = { id: string; name: string; runtime: string; phase: string; status: string };

export function DronesScreen() {
  const mesh = useMesh();
  const targets = mesh.devices.filter(
    (device) =>
      device.id !== mesh.identity?.id &&
      !device.revokedAt &&
      (mesh.profile?.capabilitiesByDevice[device.id] ?? []).some(
        (capability) => capability.id === 'drone-control',
      ),
  );
  const [targetId, setTargetId] = React.useState(targets[0]?.id ?? '');
  const [drones, setDrones] = React.useState<Drone[]>([]);
  const [selected, setSelected] = React.useState<Drone | null>(null);
  const [chats, setChats] = React.useState<string[]>([]);
  const [chatName, setChatName] = React.useState('default');
  const [turns, setTurns] = React.useState<any[]>([]);
  const [prompt, setPrompt] = React.useState('');
  const [createName, setCreateName] = React.useState('');
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!targets.some((target) => target.id === targetId)) setTargetId(targets[0]?.id ?? '');
  }, [targetId, targets]);

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

  const loadDrones = () =>
    run('drones', async () => {
      const result = await mesh.request(targetId, 'drone-control', 'drones.list');
      setDrones(Array.isArray(result?.drones) ? result.drones : []);
      setSelected(null);
    });

  const openDrone = (drone: Drone) =>
    run('chats', async () => {
      setSelected(drone);
      const result = await mesh.request(targetId, 'drone-control', 'chats.list', {
        droneId: drone.id,
      });
      const nextChats = Array.isArray(result?.chats) ? result.chats : ['default'];
      setChats(nextChats);
      setChatName(nextChats[0] ?? 'default');
      setTurns([]);
    });

  const loadChat = () =>
    selected &&
    run('chat', async () => {
      const result = await mesh.request(targetId, 'drone-control', 'chat.read', {
        droneId: selected.id,
        chatName,
      });
      setTurns(Array.isArray(result?.turns) ? result.turns : []);
    });

  const sendPrompt = () =>
    selected &&
    run('prompt', async () => {
      await mesh.request(targetId, 'drone-control', 'chat.prompt', {
        droneId: selected.id,
        chatName,
        prompt,
      });
      setPrompt('');
      await loadChat();
    });

  const createDrone = (runtime: 'host' | 'container') =>
    run(`create-${runtime}`, async () => {
      await mesh.request(targetId, 'drone-control', `drone.create.${runtime}`, {
        name: createName || undefined,
      });
      setCreateName('');
      await loadDrones();
    });

  return (
    <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
      <View>
        <Label>Drone control</Label>
        <Text style={[textStyles.title, styles.title]}>Choose the target first.</Text>
        <Text style={textStyles.body}>
          Every action below is signed by this phone and checked against permissions on the
          destination.
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.targets}
      >
        {targets.map((target) => (
          <Pressable
            key={target.id}
            onPress={() => {
              setTargetId(target.id);
              setDrones([]);
              setSelected(null);
            }}
            style={[styles.target, target.id === targetId && styles.targetActive]}
          >
            <View
              style={[
                styles.targetDot,
                mesh.connectedDeviceIds.includes(target.id) && styles.targetDotOnline,
              ]}
            />
            <Text style={[styles.targetText, target.id === targetId && styles.targetTextActive]}>
              {target.name}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {targets.length === 0 ? (
        <Card>
          <Text style={textStyles.body}>
            No destination devices are known yet. Pair a Hub first.
          </Text>
        </Card>
      ) : null}
      <ErrorBanner message={error} />
      {targetId ? (
        <Button onPress={() => void loadDrones()} loading={busy === 'drones'}>
          Load drones
        </Button>
      ) : null}

      {drones.length > 0 ? (
        <View style={styles.grid}>
          {drones.map((drone) => (
            <Pressable key={drone.id} onPress={() => void openDrone(drone)}>
              <Card style={selected?.id === drone.id ? styles.selectedCard : undefined}>
                <View style={styles.droneHead}>
                  <Text style={textStyles.heading}>{drone.name}</Text>
                  <Text style={styles.runtime}>{drone.runtime}</Text>
                </View>
                <Text style={[textStyles.mono, styles.droneMeta]}>
                  {drone.phase || drone.status || 'ready'}
                </Text>
              </Card>
            </Pressable>
          ))}
        </View>
      ) : null}

      {selected ? (
        <Card>
          <View style={styles.sectionHead}>
            <View>
              <Label>Chat</Label>
              <Text style={[textStyles.heading, { marginTop: 4 }]}>{selected.name}</Text>
            </View>
            <Button
              tone="quiet"
              onPress={() =>
                void mesh
                  .request(targetId, 'drone-control', 'chat.stop', {
                    droneId: selected.id,
                    chatName,
                  })
                  .catch((nextError) => setError(nextError.message))
              }
            >
              Stop
            </Button>
          </View>
          <ScrollView horizontal contentContainerStyle={styles.chats}>
            {chats.map((chat) => (
              <Pressable
                key={chat}
                onPress={() => {
                  setChatName(chat);
                  setTurns([]);
                }}
                style={[styles.chatPill, chat === chatName && styles.chatPillActive]}
              >
                <Text style={styles.chatText}>{chat}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Button tone="quiet" onPress={() => void loadChat()} loading={busy === 'chat'}>
            Refresh transcript
          </Button>
          <View style={styles.turns}>
            {turns.slice(-8).map((turn, index) => (
              <View key={String(turn?.id ?? index)} style={styles.turn}>
                <Text style={styles.turnRole}>{String(turn?.role ?? turn?.type ?? 'turn')}</Text>
                <Text style={styles.turnText}>
                  {String(
                    turn?.text ?? turn?.content ?? turn?.prompt ?? turn?.response ?? '',
                  ).slice(0, 1800)}
                </Text>
              </View>
            ))}
          </View>
          <TextInput
            value={prompt}
            onChangeText={setPrompt}
            placeholder="Send a prompt…"
            placeholderTextColor="#5f767d"
            multiline
            style={styles.prompt}
          />
          <Button
            onPress={() => void sendPrompt()}
            disabled={!prompt.trim()}
            loading={busy === 'prompt'}
          >
            Send prompt
          </Button>
        </Card>
      ) : null}

      {targetId ? (
        <Card>
          <Label>Create</Label>
          <Text style={[textStyles.heading, styles.createTitle]}>New drone on this device</Text>
          <TextInput
            value={createName}
            onChangeText={setCreateName}
            placeholder="Optional name"
            placeholderTextColor="#5f767d"
            style={styles.nameInput}
          />
          <View style={styles.createButtons}>
            <Button
              style={styles.flex}
              tone="quiet"
              onPress={() => void createDrone('container')}
              loading={busy === 'create-container'}
            >
              Container
            </Button>
            <Button
              style={styles.flex}
              onPress={() => void createDrone('host')}
              loading={busy === 'create-host'}
            >
              Host
            </Button>
          </View>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 14 },
  title: { marginTop: 6, marginBottom: 8 },
  targets: { gap: 8 },
  target: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    height: 38,
    borderRadius: 20,
    backgroundColor: colors.panel,
    borderColor: colors.border,
    borderWidth: 1,
  },
  targetActive: { borderColor: colors.accent, backgroundColor: colors.accentDark },
  targetDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#53676d' },
  targetDotOnline: { backgroundColor: colors.online },
  targetText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  targetTextActive: { color: colors.text },
  grid: { gap: 9 },
  selectedCard: { borderColor: colors.accent },
  droneHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  runtime: { color: colors.accent, fontSize: 9, fontWeight: '800', textTransform: 'uppercase' },
  droneMeta: { marginTop: 7 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  chats: { gap: 7, paddingVertical: 14 },
  chatPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
    backgroundColor: colors.background,
  },
  chatPillActive: {
    backgroundColor: colors.accentDark,
    borderColor: colors.accent,
    borderWidth: 1,
  },
  chatText: { color: colors.text, fontSize: 11 },
  turns: { gap: 8, marginVertical: 12 },
  turn: { backgroundColor: colors.background, padding: 11, borderRadius: 10 },
  turnRole: {
    color: colors.accent,
    fontSize: 8,
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  turnText: { color: colors.text, fontSize: 12, lineHeight: 18, marginTop: 4 },
  prompt: {
    minHeight: 82,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  createTitle: { marginTop: 4, marginBottom: 12 },
  nameInput: {
    color: colors.text,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  createButtons: { flexDirection: 'row', gap: 8 },
  flex: { flex: 1 },
});
