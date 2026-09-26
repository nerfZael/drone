/**
 * Routing cases: short conversations and the decision the front limb should make. Workers are stand-ins that stay
 * busy, so only routing is judged. Run with apps/drone/scripts/entity-routing-eval.ts. Add a case whenever a live
 * session gets routing wrong; fix the general rule, never the case.
 */

export interface RoutingEvent { seq: number; t: number; type: string; by: string; data: Record<string, unknown> }

export interface RoutingCase {
  name: string;
  /** Where it came from, if it was a real session. */
  source?: string;
  /** Messages in order; `after` is the pause before sending, in ms (default 3000); `click` sends it as a click on the latest question's options. */
  messages: { text: string; after?: number; click?: boolean }[];
  /** The workspaces the session has, as the Hub shows them to the limbs (id: name (kind; access)). Default: a plain folder. */
  workspaces?: string[];
  /** The stand-in worker asks the user this on its first run (the `ask` tool), then waits. */
  workerAsks?: string;
  /** Returns null when routing was right, or what was wrong. */
  check(events: RoutingEvent[]): string | null;
}

const workers = (events: RoutingEvent[]) => events.filter(e => e.type === 'limb_spawned');
const steers = (events: RoutingEvent[]) => events.filter(e => e.type === 'steered' && e.by !== 'user');
const userMessage = (events: RoutingEvent[], text: string) => events.find(e => e.type === 'chat_message' && e.by === 'user' && e.data.text === text);
const afterMessage = (events: RoutingEvent[], text: string) => { const m = userMessage(events, text); return m ? events.filter(e => e.seq > m.seq) : []; };

/** Questions with answers to click, in either form: options on one question, or several questions each with options. */
const optionsAfter = (events: RoutingEvent[], text: string) => afterMessage(events, text).filter(e => e.type === 'chat_message' && e.by !== 'user'
  && (Array.isArray(e.data.options) || (Array.isArray(e.data.questions) && (e.data.questions as { options?: unknown[] }[]).some(q => Array.isArray(q.options) && q.options.length))));

export const ROUTING_CASES: RoutingCase[] = [
  {
    name: 'looking at a read-only workspace is done, not refused',
    source: 'a live session: "I cannot inspect StorySpark because it is read-only for me"',
    workspaces: ['entity-home: your home folder (read, write)', 'host:storyspark: StorySpark (host; read) · default'],
    messages: [{ text: 'Hey, so what do you see in this directory?' }],
    check: events => {
      const said = afterMessage(events, 'Hey, so what do you see in this directory?').filter(e => e.type === 'chat_message' && e.by !== 'user').map(e => String(e.data.text));
      const refused = said.find(t => /can.?t (inspect|look|list|see|read)|cannot (inspect|look|list|see|read)|write access/i.test(t));
      const acted = workers(events).length + events.filter(e => e.type === 'tool_called' && ['list_files', 'read_file'].includes(String(e.data.name))).length;
      return !refused && acted ? null : refused ? `refused: ${refused.slice(0, 100)}` : 'nothing done';
    },
  },
  {
    name: 'copying from a read-only workspace into a writable one is done, not refused',
    source: 'a live session: "I cannot transfer it: StorySpark is read-only"',
    workspaces: ['entity-home: your home folder (read, write)', 'host:storyspark: StorySpark (host; read) · default'],
    messages: [{ text: 'Can you copy the README from StorySpark into your home folder?' }],
    check: events => {
      const asked = optionsAfter(events, 'Can you copy the README from StorySpark into your home folder?').length;
      const acted = workers(events).length + events.filter(e => e.type === 'tool_called' && ['transfer_files', 'write_file', 'read_file'].includes(String(e.data.name))).length;
      return acted && !asked ? null : `${workers(events).length} worker(s), ${asked} refusal question(s)`;
    },
  },
  {
    name: 'an answer that names several things is a scannable list, not a dense paragraph',
    source: 'a live session: a directory listing written as one long sentence',
    messages: [{ text: 'Quick overview: what are the main differences between TCP and UDP?' }],
    check: events => {
      const said = afterMessage(events, 'Quick overview: what are the main differences between TCP and UDP?').filter(e => e.type === 'chat_message' && e.by !== 'user');
      const text = String(said[0]?.data.text ?? '');
      if (!text) return `no answer; ${workers(events).length} worker(s)`;
      const items = text.split('\n').filter(line => /^\s*([-*+]|\d+[.)])\s/.test(line)).length;
      return items >= 2 ? null : `${items} list item(s) in: ${text.slice(0, 120)}`;
    },
  },
  {
    name: 'asked for some questions: one message with several questions, each with options',
    source: 'a live session: four questions written as plain text',
    messages: [{ text: "I want to build a small arcade game. Ask me some questions first." }],
    check: events => {
      const asked = afterMessage(events, "I want to build a small arcade game. Ask me some questions first.").filter(e => e.type === 'chat_message' && e.by !== 'user' && Array.isArray(e.data.questions));
      const questions = (asked[0]?.data.questions ?? []) as { options?: unknown[] }[];
      if (questions.length < 2) return `no message with several questions (${asked.length} with questions); ${workers(events).length} worker(s)`;
      if (!questions.some(q => Array.isArray(q.options) && q.options.length)) return 'questions without options';
      return workers(events).length === 0 ? null : `asked, but also started ${workers(events).length} worker(s)`;
    },
  },
  {
    name: 'work the workspace does not allow is raised with options, not quietly scaled down',
    source: 'entity-sessions/20260926-172930-vwsg',
    workspaces: ['entity-home: your home folder (read, write)', 'host:storyspark: StorySpark (host; read) · default'],
    messages: [{ text: "Let's build an arcade game in the workspace." }],
    check: events => {
      const asked = optionsAfter(events, "Let's build an arcade game in the workspace.");
      return asked.length && workers(events).length === 0 ? null : `${asked.length} question(s) with options, ${workers(events).length} worker(s)`;
    },
  },
  {
    name: 'work the workspace allows is started without asking',
    workspaces: ['entity-home: your home folder (read, write)', 'host:storyspark: StorySpark (host; read, write) · default'],
    messages: [{ text: 'Add a CONTRIBUTING.md to the workspace with a short how-to-contribute section.' }],
    check: events => (workers(events).length === 1 && !optionsAfter(events, 'Add a CONTRIBUTING.md to the workspace with a short how-to-contribute section.').length ? null : `${workers(events).length} worker(s), asked: ${optionsAfter(events, 'Add a CONTRIBUTING.md to the workspace with a short how-to-contribute section.').length}`),
  },
  {
    name: 'related new work while a worker runs: ask same worker or a separate one, with options',
    messages: [{ text: 'Can you implement a login page for the app?' }, { text: 'Can you also implement a signup page?', after: 8000 }],
    check: events => {
      const asked = optionsAfter(events, 'Can you also implement a signup page?');
      const count = workers(events).length;
      if (!asked.length) return `no question with options; ${count} worker(s), ${steers(events).length} steer(s)`;
      return count === 1 ? null : `asked, but also started ${count - 1} more worker(s)`;
    },
  },
  {
    name: 'a clicked answer to "same worker or separate?" is acted on',
    messages: [
      { text: 'Can you implement a login page for the app?' },
      { text: 'Can you also implement a signup page?', after: 8000 },
      { text: 'Start a separate worker', after: 12000, click: true },
    ],
    check: events => {
      const clicked = userMessage(events, 'Start a separate worker');
      if (!clicked?.data.reply_to) return 'the front limb never asked with options, so there was nothing to click';
      return workers(events).length === 2 ? null : `${workers(events).length} worker(s) after choosing a separate one`;
    },
  },
  {
    name: 'unrelated new work while a worker runs is not asked about',
    messages: [{ text: 'Can you implement a login page for the app?' }, { text: 'Also, write a haiku about autumn into haiku.txt.', after: 8000 }],
    check: events => {
      const asked = optionsAfter(events, 'Also, write a haiku about autumn into haiku.txt.');
      // Also good: the front limb writes something this small itself instead of starting a worker.
      const wroteIt = events.some(e => e.type === 'tool_called' && (e.by === 'head' || e.by === 'voice') && e.data.name === 'write_file');
      return !asked.length && (workers(events).length === 2 || wroteIt) ? null : `${asked.length} question(s), ${workers(events).length} worker(s)`;
    },
  },
  {
    name: 'an answer to a worker\'s question goes to that worker',
    messages: [{ text: 'Write a short poem about my favourite animal into poem.md.' }, { text: 'a fox', after: 9000 }],
    workerAsks: 'Which animal is your favourite?',
    check: events => {
      // Also good: the front limb asks for what it needs before starting the worker, and passes the answer on.
      const answer = userMessage(events, 'a fox');
      const frontAsked = answer && events.some(e => e.type === 'chat_message' && (e.by === 'head' || e.by === 'voice') && e.seq < answer.seq && /\?/.test(String(e.data.text)));
      const spawnedAfter = answer ? workers(events).filter(e => e.seq > answer.seq && /fox/i.test(String(e.data.task))) : [];
      if (frontAsked && spawnedAfter.length === 1 && workers(events).length === 1) return null;
      const asked = events.find(e => e.type === 'chat_message' && e.data.question);
      if (!asked) return 'the worker never asked';
      const answered = afterMessage(events, 'a fox').some(e => e.type === 'steered' && e.by !== 'user' && e.data.id === asked.by);
      const count = workers(events).length;
      return answered && count === 1 ? null : `${answered ? 'answer steered' : 'answer not steered to the asking worker'}, ${count} worker(s)`;
    },
  },
  {
    name: '"make it 6" adds to the batch instead of starting another',
    source: 'entity-sessions/20260926-015305-cfvy',
    messages: [{ text: 'can you start 5 workers to look for bugs?' }, { text: 'actually make it 6', after: 6000 }],
    check: events => {
      // One batch of six, whether it was extended or started at six because both messages were read together.
      const started = events.filter(e => e.type === 'group_started').length;
      const total = workers(events).length;
      return started === 1 && total === 6 ? null : `${started} batch(es), ${total} workers`;
    },
  },
  {
    name: 'a question that asks for parallel work starts it',
    source: 'entity-sessions/20260925-171726-7cfv',
    messages: [
      { text: "Let's build a small platformer game in the workspace." },
      { text: 'can you also work on nice sprites?', after: 8000 },
      { text: "and let's start with unit tests too", after: 6000 },
      { text: 'all 3 parallel?', after: 3500 },
    ],
    check: events => (workers(events).length >= 3 ? null : `${workers(events).length} worker(s) for three parallel workstreams`),
  },
  {
    name: 'a question about the work is answered, not dispatched',
    messages: [{ text: 'Write a haiku about the sea into haiku.txt.' }, { text: 'How many workers are running right now?', after: 8000 }],
    check: events => {
      const later = afterMessage(events, 'How many workers are running right now?');
      if (later.some(e => e.type === 'limb_spawned')) return 'dispatched a worker for a question';
      return later.some(e => e.type === 'chat_message' && e.by !== 'user') ? null : 'no answer';
    },
  },
  {
    name: '"separately" means another worker',
    messages: [{ text: 'Refactor the date helpers in utils/dates.ts.' }, { text: 'Separately, update the install section of the README.', after: 8000 }],
    check: events => (workers(events).length >= 2 && !steers(events).length ? null : `${workers(events).length} worker(s), ${steers(events).length} steer(s)`),
  },
  {
    name: '"in the same worker" means steer',
    messages: [{ text: 'Refactor the date helpers in utils/dates.ts.' }, { text: 'In the same worker, also rename formatDate to formatDay.', after: 8000 }],
    check: events => (workers(events).length === 1 && steers(events).length >= 1 ? null : `${workers(events).length} worker(s), ${steers(events).length} steer(s)`),
  },
  {
    name: '"when that\'s done" queues for after',
    messages: [{ text: 'Write a markdown parser module in parser.ts.' }, { text: "When that's done, add tests for it.", after: 8000 }],
    check: events => {
      const later = afterMessage(events, "When that's done, add tests for it.");
      const queued = later.some(e => (e.type === 'steered' && e.data.when === 'after') || (e.type === 'limb_spawned' && e.data.after));
      return queued ? null : 'the follow-up was not queued for after the first worker';
    },
  },
  {
    name: 'a request phrased as a question is acted on',
    messages: [{ text: 'Can you add a dark mode toggle to the settings page?' }],
    check: events => (workers(events).length >= 1 ? null : 'answered without starting any work'),
  },
  {
    name: 'thanks changes nothing',
    messages: [{ text: 'Write a haiku about the sea into haiku.txt.' }, { text: 'thanks!', after: 8000 }],
    check: events => {
      const later = afterMessage(events, 'thanks!');
      return later.some(e => e.type === 'limb_spawned' || (e.type === 'steered' && e.by !== 'user')) ? 'thanks started or steered work' : null;
    },
  },
];
