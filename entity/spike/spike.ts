// M0.5 throwaway spike: one LLM, a keypad, holds, code watches and a tiny
// behaviour-tree runner. Measures real latencies for scenarios 2, 3, 4 and 9.
// Run: bun entity/spike/spike.ts [--model openai-codex/gpt-6-luna | openai-codex/gpt-6-sol | cerebras/qwen-3.8-27b (speed tests only)] [--scenarios 2,3,4,9] [--repl]
import { Database } from 'bun:sqlite';
import { getModel, streamSimple, Type, type Context, type Message, type Tool } from '@mariozechner/pi-ai';

// ---------- config ----------
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const [provider, ...modelParts] = arg('model', 'openai-codex/gpt-6-luna').split('/');
const reasoning = arg('reasoning', 'medium') as 'minimal' | 'low' | 'medium' | 'high';
const modelId = modelParts.join('/');
const model = getModel(provider as never, modelId as never);
if (!model) throw new Error(`Unknown model ${provider}/${modelId}`);
const apiKey = loadApiKey(provider);
const quiet = args.includes('--quiet');

function loadApiKey(p: string): string {
  if (p === 'openai-codex') {
    // Same auth file the Hub uses. The spike doesn't refresh: run any Codex command first if the token has expired.
    const auth = JSON.parse(require('node:fs').readFileSync(`${require('node:os').homedir()}/.codex/auth.json`, 'utf8'));
    const token = auth?.tokens?.access_token;
    if (!token) throw new Error('No Codex access token in ~/.codex/auth.json');
    return token;
  }
  const db = new Database(`${import.meta.dir}/../../data/profiles/default/drone/hub.sqlite`, { readonly: true });
  const row = db.query('select value_json from hub_canonical_settings where setting_key = ?').get(`api-key.${p}`) as { value_json: string } | null;
  const key = row ? JSON.parse(row.value_json)?.apiKey : process.env[`${p.toUpperCase()}_API_KEY`];
  if (!key) throw new Error(`No API key for ${p}`);
  return key;
}

// ---------- entity core ----------
type Who = 'user' | 'entity' | 'watch' | 'program';
type Ev =
  | { type: 'chat_message'; by: Who; text: string }
  | { type: 'key_down' | 'key_up'; by: Who; key: string }
  | { type: 'hold_started'; by: Who; reason: string }
  | { type: 'hold_released'; by: Who }
  | { type: 'watch_set'; by: Who; watch: Watch }
  | { type: 'program_started' | 'program_finished' | 'program_cancelled'; by: Who; id: number };
type Logged = Ev & { t: number; seq: number };

type Watch = {
  id: number;
  on: 'key_down' | 'key_up';
  key?: string; // undefined = any key
  do: 'key_down' | 'key_up' | 'press' | 'stop_output';
  target?: string; // key for key effects; 'same' mirrors the triggering key
  reason?: string;
};

type Node =
  | { seq: Node[] }
  | { repeat: { from: number; to: number; body: Node } }
  | { say: string }
  | { press: string }
  | { wait: number };

class Entity {
  readonly t0 = performance.now();
  log: Logged[] = [];
  held = new Map<string, { by: Who; since: number }>();
  chat: { by: Who; text: string; t: number }[] = [];
  watches: Watch[] = [];
  hold: { reason: string; since: number } | null = null;
  programs = new Map<number, { cancelled: boolean; desc: string }>();
  nextId = 1;
  seenSeq = 0; // events up to here were already shown to the mind
  mindBusy = false;
  wakeQueued = false;
  wakeTimer: ReturnType<typeof setTimeout> | null = null;
  runs: { start: number; firstToken?: number; firstTool?: number; end?: number; steps: number; reason: string }[] = [];
  listeners: ((e: Logged) => void)[] = [];
  controller = new AbortController();

  now() { return performance.now() - this.t0; }

  emit(ev: Ev) {
    const logged = { ...ev, t: this.now(), seq: this.log.length + 1 } as Logged;
    this.log.push(logged);
    this.reduce(logged);
    for (const l of this.listeners) l(logged);
    this.runWatches(logged);
    if (logged.type === 'chat_message' && logged.by === 'user') this.requestWake('user message', 80);
    if (logged.type === 'hold_started') this.requestWake('hold', 0);
  }

  reduce(e: Logged) {
    if (e.type === 'key_down') this.held.set(e.key, { by: e.by, since: e.t });
    if (e.type === 'key_up') this.held.delete(e.key);
    if (e.type === 'chat_message') this.chat.push({ by: e.by, text: e.text, t: e.t });
    if (e.type === 'watch_set') this.watches.push(e.watch);
    if (e.type === 'hold_started') {
      this.hold = { reason: e.reason, since: e.t };
      for (const p of this.programs.values()) p.cancelled = true;
    }
    if (e.type === 'hold_released') this.hold = null;
  }

  // Code watches: deterministic, only react to the user's own events (echo guard).
  runWatches(e: Logged) {
    if ((e.type !== 'key_down' && e.type !== 'key_up') || e.by !== 'user') return;
    for (const w of this.watches) {
      if (w.on !== e.type || (w.key !== undefined && w.key !== e.key)) continue;
      const key = !w.target || w.target === 'same' ? e.key : w.target;
      if (w.do === 'stop_output') this.emit({ type: 'hold_started', by: 'watch', reason: w.reason ?? `user ${e.type} ${e.key}` });
      else if (w.do === 'press') this.press(key, 'watch');
      else this.emit({ type: w.do, by: 'watch', key });
    }
  }

  press(key: string, by: Who) {
    this.emit({ type: 'key_down', by, key });
    this.emit({ type: 'key_up', by, key });
  }

  // Effects requested by the mind or a program go through the hold gate.
  effect(by: Who, fn: () => void): string {
    if (this.hold && by !== 'watch') return `output stopped: ${this.hold.reason}. Effect not applied.`;
    fn();
    return 'ok';
  }

  async runProgram(tree: Node): Promise<number> {
    const id = this.nextId++;
    const state = { cancelled: false, desc: JSON.stringify(tree).slice(0, 120) };
    this.programs.set(id, state);
    this.emit({ type: 'program_started', by: 'program', id });
    const exec = async (n: Node, vars: Record<string, number>): Promise<void> => {
      if (state.cancelled) return;
      if ('seq' in n) { for (const c of n.seq) await exec(c, vars); return; }
      if ('repeat' in n) { for (let i = n.repeat.from; i <= n.repeat.to && !state.cancelled; i++) await exec(n.repeat.body, { ...vars, i }); return; }
      if ('wait' in n) { await sleep(Math.min(n.wait, 10_000)); return; }
      const sub = (s: string) => s.replace(/\{i\}/g, String(vars.i ?? ''));
      if ('say' in n) this.effect('program', () => this.emit({ type: 'chat_message', by: 'entity', text: sub(n.say) }));
      if ('press' in n) this.effect('program', () => this.press(sub(n.press), 'program'));
    };
    void exec(tree, {}).then(() => {
      this.programs.delete(id);
      this.emit({ type: state.cancelled ? 'program_cancelled' : 'program_finished', by: 'program', id });
    });
    return id;
  }

  requestWake(reason: string, debounceMs: number) {
    if (this.mindBusy) { this.wakeQueued = true; return; }
    if (this.wakeTimer) clearTimeout(this.wakeTimer);
    this.wakeTimer = setTimeout(() => { this.wakeTimer = null; void this.wake(reason); }, debounceMs);
  }

  render(): string {
    const now = this.now();
    const ago = (t: number) => `${((now - t) / 1000).toFixed(1)}s ago`;
    const fresh = this.log.filter(e => e.seq > this.seenSeq && e.by !== 'entity' && e.type !== 'watch_set');
    this.seenSeq = this.log.length;
    return JSON.stringify({
      state: {
        chat_recent: this.chat.slice(-12).map(m => `${m.by}: ${m.text} (${ago(m.t)})`),
        keys_held: [...this.held].map(([k, v]) => `${k} by ${v.by} for ${((now - v.since) / 1000).toFixed(1)}s`),
        watches: this.watches,
        hold: this.hold ? { reason: this.hold.reason, since: ago(this.hold.since) } : null,
        programs_running: [...this.programs].map(([id, p]) => ({ id, program: p.desc })),
      },
      new_events: fresh.slice(-30).map(e => ({ ...e, t: undefined, seq: undefined, at: ago(e.t) })),
      time: { session_s: +(now / 1000).toFixed(1) },
    }, null, 1);
  }

  async wake(reason: string) {
    this.mindBusy = true;
    const run = { start: this.now(), steps: 0, reason } as Entity['runs'][number];
    this.runs.push(run);
    const context: Context = { systemPrompt: SYSTEM, messages: [{ role: 'user', content: this.render(), timestamp: Date.now() }], tools: TOOLS };
    try {
      for (let step = 0; step < 5; step++) {
        run.steps++;
        const s = streamSimple(model, context, { apiKey, signal: this.controller.signal, maxTokens: 4096, ...(model.reasoning ? { reasoning } : {}) });
        const results: Message[] = [];
        for await (const ev of s) {
          if (run.firstToken === undefined && ev.type !== 'start') run.firstToken = this.now();
          if (ev.type === 'toolcall_end') {
            run.firstTool ??= this.now();
            const text = this.callTool(ev.toolCall.name, ev.toolCall.arguments as Record<string, unknown>);
            results.push({ role: 'toolResult', toolCallId: ev.toolCall.id, toolName: ev.toolCall.name, content: [{ type: 'text', text }], isError: false, timestamp: Date.now() });
          }
          if (ev.type === 'error') throw new Error(ev.error.errorMessage ?? 'stream error');
        }
        const msg = await s.result();
        context.messages.push(msg);
        const said = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
        if (said && !quiet) console.log(`${fmt(this.now())}  (mind text, not sent) ${said.slice(0, 160)}`);
        if (!results.length) break;
        context.messages.push(...results);
      }
    } catch (err) {
      if (!this.controller.signal.aborted) console.error('mind error:', (err as Error).message);
    } finally {
      run.end = this.now();
      this.mindBusy = false;
      if (this.wakeQueued) { this.wakeQueued = false; this.requestWake('queued', 0); }
    }
  }

  callTool(name: string, a: Record<string, unknown>): string {
    const key = (v: unknown) => String(v ?? '').slice(0, 1);
    switch (name) {
      case 'say': return this.effect('entity', () => this.emit({ type: 'chat_message', by: 'entity', text: String(a.text) }));
      case 'press': return this.effect('entity', () => { for (const k of String(a.keys)) if (/\d/.test(k)) this.press(k, 'entity'); });
      case 'key_down': case 'key_up': return this.effect('entity', () => this.emit({ type: name, by: 'entity', key: key(a.key) }));
      case 'set_watch': {
        if (a.on !== 'key_down' && a.on !== 'key_up') return `invalid watch: "on" must be "key_down" or "key_up", got ${JSON.stringify(a.on)}. Nothing installed.`;
        if (!['key_down', 'key_up', 'press', 'stop_output'].includes(String(a.do))) return `invalid watch: "do" must be key_down, key_up, press or stop_output, got ${JSON.stringify(a.do)}. Nothing installed.`;
        const w: Watch = { id: this.nextId++, on: a.on as Watch['on'], key: a.key ? key(a.key) : undefined, do: a.do as Watch['do'], target: a.target ? String(a.target) : undefined, reason: a.reason ? String(a.reason) : undefined };
        this.emit({ type: 'watch_set', by: 'entity', watch: w });
        return `watch ${w.id} installed`;
      }
      case 'clear_watches': this.watches = []; return 'ok';
      case 'resume_output': this.emit({ type: 'hold_released', by: 'entity' }); return 'ok';
      case 'run_program': {
        try {
          const tree = typeof a.program === 'string' ? JSON.parse(a.program) : a.program;
          return this.effect('entity', () => { void this.runProgram(tree as Node); });
        } catch (e) { return `invalid program: ${(e as Error).message}`; }
      }
      default: return `unknown tool ${name}`;
    }
  }

  close() { this.listeners = []; this.controller.abort(); for (const p of this.programs.values()) p.cancelled = true; if (this.wakeTimer) clearTimeout(this.wakeTimer); }
}

const SYSTEM = `You are an entity: a realtime agent living next to a user. You are woken whenever something happens and see a fresh snapshot of state plus new events. You have no memory beyond what the snapshot shows.
You can chat (say), use a 0-9 keypad (press, key_down, key_up), and program fast reflexes:
- set_watch installs a code watch that reacts to the USER's key events in ~0 ms, without you. Use it for anything that must be instant: mirroring keys, holding a key while the user holds one, or stopping your output on a key (do: "stop_output").
- run_program runs a behaviour tree without you. JSON nodes: {"seq":[...]}, {"repeat":{"from":1,"to":50,"body":NODE}}, {"say":"text, {i} is the loop counter"}, {"press":"5"}, {"wait":ms}. Use it for sequences and counting.
- stop_output stops all your programs and blocks your say/press effects until you call resume_output. When output was stopped, acknowledge it briefly (resume_output first, then say).
Be brief. Act with tools; plain text you write is not shown to the user. Do not repeat actions you already took; check state.`;

const TOOLS: Tool[] = [
  { name: 'say', description: 'Send a chat message to the user.', parameters: Type.Object({ text: Type.String() }) },
  { name: 'press', description: 'Press keys in order, e.g. "556".', parameters: Type.Object({ keys: Type.String() }) },
  { name: 'key_down', description: 'Press and hold a key.', parameters: Type.Object({ key: Type.String() }) },
  { name: 'key_up', description: 'Release a held key.', parameters: Type.Object({ key: Type.String() }) },
  {
    name: 'set_watch', description: 'Install a code watch on the user\'s key events.',
    parameters: Type.Object({
      on: Type.Union([Type.Literal('key_down'), Type.Literal('key_up')]),
      key: Type.Optional(Type.String({ description: 'Only this key; omit for any key' })),
      do: Type.Union([Type.Literal('key_down'), Type.Literal('key_up'), Type.Literal('press'), Type.Literal('stop_output')]),
      target: Type.Optional(Type.String({ description: 'Key to act on, or "same" for the triggering key' })),
      reason: Type.Optional(Type.String()),
    }),
  },
  { name: 'clear_watches', description: 'Remove all watches.', parameters: Type.Object({}) },
  { name: 'resume_output', description: 'Resume output after a stop_output.', parameters: Type.Object({}) },
  { name: 'run_program', description: 'Run a behaviour-tree program (JSON string).', parameters: Type.Object({ program: Type.String() }) },
];

// ---------- harness ----------
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const fmt = (t: number) => `${(t / 1000).toFixed(3).padStart(8)}s`;

function attachPrinter(e: Entity) {
  e.listeners.push(ev => {
    if (quiet) return;
    const { t, seq, type, by, ...rest } = ev;
    console.log(`${fmt(t)}  ${by.padEnd(7)} ${type} ${JSON.stringify(rest)}`);
  });
}

async function waitFor(e: Entity, pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = performance.now() + timeoutMs;
  while (performance.now() < end) { if (pred()) return true; await sleep(10); }
  return false;
}
const idle = (e: Entity) => !e.mindBusy && !e.wakeTimer && !e.wakeQueued;
const entityKeys = (e: Entity, type: 'key_down' | 'key_up', after = 0) => e.log.filter(x => x.type === type && x.by !== 'user' && x.t >= after) as (Logged & { key: string })[];

type Result = { scenario: string; pass: boolean; metrics: Record<string, string> };
const ms = (v: number | undefined) => (v === undefined ? 'n/a' : `${Math.round(v)} ms`);

function mindMetrics(e: Entity, from = 0) {
  const runs = e.runs.filter(r => r.start >= from);
  const r0 = runs[0];
  return { 'first-token': ms(r0?.firstToken !== undefined ? r0.firstToken - r0.start : undefined), 'first-tool': ms(r0?.firstTool !== undefined ? r0.firstTool - r0.start : undefined), 'mind runs': String(runs.length) };
}

const scenarios: Record<string, (e: Entity) => Promise<Result>> = {
  async '2'(e) {
    const t = e.now();
    e.emit({ type: 'chat_message', by: 'user', text: 'Press 556' });
    const ok = await waitFor(e, () => entityKeys(e, 'key_down', t).length >= 3, 20_000);
    const downs = entityKeys(e, 'key_down', t);
    return { scenario: '2 press 556', pass: ok && downs.slice(0, 3).map(d => d.key).join('') === '556', metrics: { 'msg→1st key': ms(downs[0] && downs[0].t - t), 'msg→3rd key': ms(downs[2] && downs[2].t - t), keys: downs.map(d => d.key).join(''), ...mindMetrics(e, t) } };
  },
  async '3'(e) {
    const t = e.now();
    e.emit({ type: 'chat_message', by: 'user', text: 'Repeat after me: whenever I press a key, press the same key right away.' });
    await waitFor(e, () => e.watches.length > 0 && idle(e), 20_000);
    const setup = e.now() - t;
    const lat: number[] = [];
    for (const k of ['3', '7', '1']) {
      const tk = e.now();
      e.press(k, 'user');
      const hit = await waitFor(e, () => entityKeys(e, 'key_down', tk).some(d => d.key === k), 3000);
      if (hit) lat.push(entityKeys(e, 'key_down', tk).find(d => d.key === k)!.t - tk);
      await sleep(600);
    }
    return { scenario: '3 mirror', pass: lat.length === 3, metrics: { 'setup (msg→watch ready)': ms(setup), 'mirror latency': lat.map(v => `${v.toFixed(2)}ms`).join(', ') || 'none', ...mindMetrics(e, t) } };
  },
  async '4'(e) {
    const t = e.now();
    e.emit({ type: 'chat_message', by: 'user', text: 'Count from 1 to 50, one chat message per number, about 3 numbers per second. Stop as soon as I press 5.' });
    const nums = () => e.chat.filter(m => m.by === 'entity' && /^\s*\d+\s*[.!]?\s*$/.test(m.text));
    const reached = await waitFor(e, () => nums().length >= 11, 40_000);
    const tp = e.now();
    e.press('5', 'user');
    await sleep(3000);
    const holdAt = e.log.find(x => x.type === 'hold_started' && x.t >= tp);
    const after = nums().filter(m => m.t > tp).length;
    await waitFor(e, () => idle(e), 20_000);
    const ack = e.chat.find(m => m.by === 'entity' && m.t > tp && !/^\s*\d+\s*[.!]?\s*$/.test(m.text));
    return {
      scenario: '4 count + stop on 5', pass: reached && !!holdAt && after === 0,
      metrics: { 'msg→first number': ms(nums()[0] && nums()[0].t - t), 'numbers before 5': String(nums().filter(m => m.t <= tp).length), 'press→hold': ms(holdAt && holdAt.t - tp), 'numbers after 5': String(after), 'press→ack': ms(ack ? ack.t - tp : undefined), ...mindMetrics(e, t) },
    };
  },
  async '9'(e) {
    const t = e.now();
    e.emit({ type: 'chat_message', by: 'user', text: "I'm going to hold 5. Hold 6 while I hold 5, and release 6 when I release 5." });
    await waitFor(e, () => e.watches.length >= 2 && idle(e), 20_000);
    const setup = e.now() - t;
    const td = e.now();
    e.emit({ type: 'key_down', by: 'user', key: '5' });
    await waitFor(e, () => entityKeys(e, 'key_down', td).some(d => d.key === '6'), 3000);
    const down = entityKeys(e, 'key_down', td).find(d => d.key === '6');
    await sleep(1500);
    const tu = e.now();
    e.emit({ type: 'key_up', by: 'user', key: '5' });
    await waitFor(e, () => entityKeys(e, 'key_up', tu).some(d => d.key === '6'), 3000);
    const up = entityKeys(e, 'key_up', tu).find(d => d.key === '6');
    return { scenario: '9 hold 6 while 5', pass: !!down && !!up, metrics: { 'setup (msg→watches ready)': ms(setup), '5 down→6 down': down ? `${(down.t - td).toFixed(2)}ms` : 'n/a', '5 up→6 up': up ? `${(up.t - tu).toFixed(2)}ms` : 'n/a', ...mindMetrics(e, t) } };
  },
};

async function repl() {
  const e = new Entity();
  attachPrinter(e);
  console.log('Type a message, or /p 556 (press), /d 5 (key down), /u 5 (key up), /q to quit.');
  for await (const line of console) {
    const [cmd, rest] = [line.split(' ')[0], line.split(' ').slice(1).join(' ')];
    if (cmd === '/q') break;
    else if (cmd === '/p') for (const k of rest) e.press(k, 'user');
    else if (cmd === '/d' || cmd === '/u') e.emit({ type: cmd === '/d' ? 'key_down' : 'key_up', by: 'user', key: rest.trim() });
    else if (line.trim()) e.emit({ type: 'chat_message', by: 'user', text: line });
  }
  e.close();
}

async function main() {
  console.log(`model: ${provider}/${modelId}${model.reasoning ? ` (reasoning: ${reasoning})` : ''}`);
  if (args.includes('--repl')) return repl();
  const which = arg('scenarios', '2,3,4,9').split(',');
  const results: Result[] = [];
  for (const id of which) {
    console.log(`\n=== scenario ${id} ===`);
    const e = new Entity();
    attachPrinter(e);
    try { results.push(await scenarios[id](e)); } finally { e.close(); }
  }
  console.log(`\n=== results (${provider}/${modelId}) ===`);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.scenario}\n      ${Object.entries(r.metrics).map(([k, v]) => `${k}: ${v}`).join(' | ')}`);
  process.exit(0);
}

await main();
