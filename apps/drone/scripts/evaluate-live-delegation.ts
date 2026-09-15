/** Paid, opt-in experiment: bun apps/drone/scripts/evaluate-live-delegation.ts prepare|run <output-dir> [scenario] [prompt] [repeat]
 * Uses OPENAI_API_KEY or reads only api-key.openai from HUB_SETTINGS_DB (default local Hub DB).
 * Delegations are recorded, never executed. No Hub settings are changed.
 */
import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const [mode, dirArg, scenarioArg, promptArg, repeatArg = '1'] = process.argv.slice(2);
if (!['prepare', 'run'].includes(mode) || !dirArg) throw new Error('Expected prepare|run <output-dir> [scenario] [prompt] [repeat]');
const dir = resolve(dirArg);
mkdirSync(dir, { recursive: true });
const db = new Database(process.env.HUB_SETTINGS_DB ?? 'data/profiles/default/drone/hub.sqlite', { readonly: true });
function setting(key: string) {
  const row = db.query('SELECT value_json FROM hub_canonical_settings WHERE setting_key = ?').get(key) as { value_json: string } | null;
  return row ? JSON.parse(row.value_json) : {};
}
const apiKey = process.env.OPENAI_API_KEY || setting('api-key.openai').apiKey;
const savedPrompt = setting('companion-live-voice').systemPrompt;
db.close();
if (!apiKey) throw new Error('No configured OpenAI API key.');
const json = (name: string, value: unknown) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');

// Treat energy below -42 dBFS in 10 ms frames as quiet. Cap interior quiet runs
// at 100 ms; trim edge quiet. This rules out a one-second acoustic pause, not
// semantic turn detection. Preserve raw audio alongside the transformed copy.
function tighten(raw: Buffer) {
  const frame = 480;
  const frames: { data: Buffer; quiet: boolean }[] = [];
  for (let i = 0; i < raw.length; i += frame) {
    const data = raw.subarray(i, Math.min(i + frame, raw.length));
    let power = 0;
    for (let j = 0; j + 1 < data.length; j += 2) power += (data.readInt16LE(j) / 32768) ** 2;
    frames.push({ data, quiet: Math.sqrt(power / (data.length / 2)) < 10 ** (-42 / 20) });
  }
  while (frames[0]?.quiet) frames.shift();
  while (frames.at(-1)?.quiet) frames.pop();
  const kept: Buffer[] = [];
  let quiet = 0;
  for (const f of frames) { quiet = f.quiet ? quiet + 1 : 0; if (quiet <= 10) kept.push(f.data); }
  return Buffer.concat(kept);
}
function wav(pcm: Buffer) {
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(pcm.length + 36, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
  h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
if (mode === 'prepare') {
  const texts = {
    command: 'Please edit the current chat composer now so the first line contains the digit one and the second line contains the digit two.',
    continuation: 'While you do that I will keep talking about why this is useful because I want to see changes appear as I speak and I want the assistant to keep listening at the same time and the reason for this example is that two short lines make it easy to see what happened on the screen and I am continuing this explanation for a little longer so there is time for the action to begin before I finish speaking.',
    dictation: 'I am only thinking aloud and dictating notes so do not edit anything or delegate any work yet because I have not decided what I want to do and one possibility is to put the digit one on the first line and the digit two on the second line but another possibility is to use letters instead and I might want a completely different layout so these are just ideas that I am considering and I will give you an explicit instruction when I have decided what to do.',
  };
  const clips: Record<string, Buffer> = {};
  for (const [name, input] of Object.entries(texts)) {
    const path = join(dir, `${name}.raw.pcm`);
    if (!existsSync(path)) {
      const response = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: 'cedar', input, response_format: 'pcm',
          instructions: 'Read the text exactly as written, in a natural conversational English voice at a steady pace. Use continuous flowing speech, minimal pauses, and no dramatic pauses.' }),
        signal: AbortSignal.timeout(120000),
      });
      if (!response.ok) throw new Error(`Speech synthesis HTTP ${response.status}: ${(await response.text()).replaceAll(apiKey, '[redacted]').slice(0,1000)}`);
      writeFileSync(path, Buffer.from(await response.arrayBuffer()));
    }
    clips[name] = tighten(readFileSync(path));
    writeFileSync(join(dir, `${name}.wav`), wav(clips[name]));
    console.log(JSON.stringify({ prepared: name, seconds: clips[name].length / 48000 }));
  }
  const commandEndMs = clips.command.length / 48;
  const scenarios = {
    continuous: { pcm: Buffer.concat([clips.command, clips.continuation]), commandEndMs, pauseMs: 0 },
    paused: { pcm: Buffer.concat([clips.command, Buffer.alloc(48000 * 2), clips.continuation]), commandEndMs, pauseMs: 2000 },
    dictation: { pcm: clips.dictation, commandEndMs: null, pauseMs: 0 },
  };
  const manifest: Record<string, unknown> = {};
  for (const [name, { pcm, ...meta }] of Object.entries(scenarios)) {
    writeFileSync(join(dir, `${name}.pcm`), pcm); writeFileSync(join(dir, `${name}.wav`), wav(pcm));
    manifest[name] = { ...meta, speechEndMs: pcm.length / 48, trailingSilenceMs: 8000 };
  }
  json('audio-manifest.json', { tts: { model: 'gpt-4o-mini-tts', voice: 'cedar' }, quietThresholdDb: -42, maxQuietMs: 100, texts, scenarios: manifest });
  const base = savedPrompt.split('Delegation policy:')[0];
  json('prompts.json', {
    saved: savedPrompt,
    early: base + `Delegation policy:\nBackend tools: inspect the current app and edit the current chat composer.\nDelegate to the backend immediately once an explicitly requested action has enough information to start. Decide this while listening. Do not wait for silence, the end of the sentence, or the end of the user's turn. If the user says to start now and continues explaining why, delegate while the explanation continues.\nDo not delegate for brainstorming, dictation without an action, incomplete specifications, or when the user asks you to wait. Continue listening to those. Never report an edit complete without a backend result.`,
    wait: base + `Delegation policy:\nBackend tools: inspect the current app and edit the current chat composer.\nDo not delegate while the user is still speaking. Wait until the user finishes the entire thought and pauses before delegating an explicitly requested action.\nDo not delegate for brainstorming, dictation without an action, incomplete specifications, or when the user asks you to wait. Never report an edit complete without a backend result.`,
    minimal: `You are a voice interface to a backend that can edit the current chat composer.
Delegate to the backend as soon as an explicitly requested edit is sufficiently specified. You can delegate while the user is still speaking. Do not wait for a pause or silence when the user has authorized starting now and is continuing with an explanation. Keep listening after delegation.
Do not delegate when the user is merely thinking aloud, dictating notes without requesting an action, or says not to act yet. Do not guess missing requirements.
Do not claim the backend completed an edit until it returns a result.`,
  });
  console.log(JSON.stringify({ prepared: manifest }));
} else {
  const prompts = JSON.parse(readFileSync(join(dir, 'prompts.json'), 'utf8'));
  const manifest = JSON.parse(readFileSync(join(dir, 'audio-manifest.json'), 'utf8'));
  const scenario = manifest.scenarios[scenarioArg];
  if (!scenario || !prompts[promptArg]) throw new Error('Unknown scenario or prompt');
  const runId = `${scenarioArg}-${promptArg}-${repeatArg}`;
  const logPath = join(dir, `${runId}.jsonl`);
  if (existsSync(logPath)) throw new Error(`Refusing to overwrite ${runId}`);
  const source = readFileSync(join(dir, `${scenarioArg}.pcm`));
  const pcm = Buffer.concat([source, Buffer.alloc(scenario.trailingSilenceMs * 48)]);
  const start = performance.now();
  let audioStart = 0, sentMs = 0, closed = false, finalized = false, closing = false;
  let maxSendGapMs = 0, lastSendAt = 0;
  const delegations: unknown[] = [], output: Buffer[] = [];
  const write = (entry: Record<string, unknown>) => appendFileSync(logPath, JSON.stringify({ wallMs: Math.round(performance.now() - start), audioElapsedMs: audioStart ? Math.round(performance.now() - audioStart) : null, sentMs, ...entry }) + '\n');
  const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${apiKey}` } });
  const send = (event: unknown) => { if (!closed && socket.readyState === 1) socket.send(JSON.stringify(event)); };
  let resolveDone!: () => void;
  const done = new Promise<void>(r => { resolveDone = r; });
  const forceTimer = setTimeout(() => { write({ type: 'experiment.timeout' }); socket.close(); resolveDone(); }, 100000);
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  function close() {
    if (closing) return; closing = true;
    send({ type: 'session.close' });
    closeTimer = setTimeout(() => { socket.close(); resolveDone(); }, 15000);
  }
  process.on('SIGINT', close); process.on('SIGTERM', close);
  socket.onopen = () => send({ type: 'session.start', session: { model: 'gpt-live-1', delegation: { type: 'client' }, store: false,
    instructions: prompts[promptArg], audio: { format: { type: 'audio/pcm', rate: 24000 } } } });
  socket.onerror = () => { write({ type: 'experiment.transport_error' }); close(); };
  socket.onclose = (event) => { closed = true; write({ type: 'experiment.socket_closed', code: event.code, reason: event.reason }); resolveDone(); };
  socket.onmessage = ({ data }) => {
    const event = JSON.parse(String(data));
    if (event.type === 'session.output_audio.delta') { output.push(Buffer.from(event.delta, 'base64')); return; }
    write({ type: 'server_event', event });
    if (event.type === 'session.delegation.created') {
      const item = { offsetMs: event.offset_ms, receivedAudioMs: Math.round(performance.now() - audioStart), sentMs, speechEndMs: scenario.speechEndMs, delegation: event.delegation };
      delegations.push(item); console.log(JSON.stringify({ runId, delegation: item }));
    }
    if (event.type === 'session.started') {
      if (audioStart) return;
      console.log(JSON.stringify({ runId, started: true, speechEndMs: scenario.speechEndMs }));
      audioStart = performance.now();
      void (async () => {
        for (let i = 0; i < pcm.length && !closed && !closing; i += 4800) {
          await Bun.sleep(Math.max(0, audioStart + i / 48 - performance.now()));
          if (closed || closing) break;
          const now = performance.now();
          if (lastSendAt) maxSendGapMs = Math.max(maxSendGapMs, now - lastSendAt);
          lastSendAt = now;
          const chunk = pcm.subarray(i, i + 4800); sentMs = (i + chunk.length) / 48;
          send({ type: 'session.input_audio.append', audio: chunk.toString('base64') });
          write({ type: 'experiment.audio_sent', fromMs: i / 48, toMs: sentMs });
        }
        await Bun.sleep(100); close();
      })().catch(() => { write({ type: 'experiment.sender_error' }); close(); });
    }
    if (event.type === 'session.closed') { finalized = true; socket.close(); resolveDone(); }
    if (event.type === 'error') close();
  };
  await done;
  clearTimeout(forceTimer); clearTimeout(closeTimer);
  writeFileSync(join(dir, `${runId}.output.wav`), wav(Buffer.concat(output)));
  const result = { runId, scenario: scenarioArg, prompt: promptArg, repeat: repeatArg, ...scenario, delegations, finalized, maxSendGapMs: Math.round(maxSendGapMs) };
  json(`${runId}.summary.json`, result); console.log(JSON.stringify(result));
  socket.close();
  if (!finalized) process.exitCode = 1;
}
