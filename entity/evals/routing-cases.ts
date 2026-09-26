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
  /** Messages in order; `after` is the pause before sending, in ms (default 3000). */
  messages: { text: string; after?: number }[];
  /** Returns null when routing was right, or what was wrong. */
  check(events: RoutingEvent[]): string | null;
}

const workers = (events: RoutingEvent[]) => events.filter(e => e.type === 'limb_spawned');
const steers = (events: RoutingEvent[]) => events.filter(e => e.type === 'steered' && e.by !== 'user');
const userMessage = (events: RoutingEvent[], text: string) => events.find(e => e.type === 'chat_message' && e.by === 'user' && e.data.text === text);
const afterMessage = (events: RoutingEvent[], text: string) => { const m = userMessage(events, text); return m ? events.filter(e => e.seq > m.seq) : []; };

export const ROUTING_CASES: RoutingCase[] = [
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
