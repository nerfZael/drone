import type { Channel } from '../channel.js';

export interface KeypadWorld {
  /** Keys currently held, and by whom. */
  held: Record<string, { by: string; since: number }>;
  /** When each key was last released, for gap_ms. */
  lastUp: Record<string, number>;
  recent: { key: string; type: 'key_down' | 'key_up'; by: string; t: number }[];
}

const KEY: { type: 'string'; enum: string[] } = { type: 'string', enum: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'] };

/** A 0-9 keypad both sides can press and hold. Every keypad effect is reflex-safe. */
export function keypadChannel(): Channel<KeypadWorld> {
  return {
    name: 'keypad',
    describe: 'A 0-9 keypad shared with the user. Keys go down and up; holding is a key_down without a key_up yet. key_up events carry held_ms (how long the key was held); key_down events carry gap_ms (time since that key was last released).',
    inputs: ['key_down', 'key_up'],
    init: () => ({ held: {}, lastUp: {}, recent: [] }),
    enrich(world, type, data, now) {
      const key = String(data.key);
      if (type === 'key_up' && world.held[key]) return { ...data, held_ms: Math.round(now - world.held[key].since) };
      if (type === 'key_down' && world.lastUp[key] !== undefined) return { ...data, gap_ms: Math.round(now - world.lastUp[key]) };
      return data;
    },
    reduce(world, event, { levels, now }) {
      if (event.type !== 'key_down' && event.type !== 'key_up') return;
      const key = String(event.data.key);
      world.recent.push({ key, type: event.type, by: event.by, t: event.t });
      if (world.recent.length > 20) world.recent.shift();
      if (event.type === 'key_down') {
        world.held[key] = { by: event.by, since: now };
        levels.set(`key.${key}.held`, event.by, event.by, now);
      } else {
        delete world.held[key];
        world.lastUp[key] = now;
        levels.clear(`key.${key}.held`);
      }
    },
    effects: [
      {
        name: 'press', description: 'Press keys in order (down then up each), e.g. "556".', risk: 'reflex', shorthand: 'keys',
        parameters: { type: 'object', properties: { keys: { type: 'string', maxLength: 64 } }, required: ['keys'], additionalProperties: false },
        apply(args: { keys: string }, ctx) {
          const keys = [...args.keys].filter(k => /\d/.test(k));
          if (!keys.length) return 'no digit keys in "keys"';
          for (const key of keys) { ctx.emit('key_down', { key }); ctx.emit('key_up', { key }); }
          return `pressed ${keys.join('')}`;
        },
      },
      {
        name: 'key_down', description: 'Press and hold a key.', risk: 'reflex', shorthand: 'key',
        parameters: { type: 'object', properties: { key: KEY }, required: ['key'], additionalProperties: false },
        apply(args: { key: string }, ctx) { ctx.emit('key_down', { key: args.key }); return `holding ${args.key}`; },
      },
      {
        name: 'key_up', description: 'Release a held key.', risk: 'reflex', shorthand: 'key',
        parameters: { type: 'object', properties: { key: KEY }, required: ['key'], additionalProperties: false },
        apply(args: { key: string }, ctx) { ctx.emit('key_up', { key: args.key }); return `released ${args.key}`; },
      },
    ],
    render(world, { ago }) {
      return {
        volatile: {
          held: Object.entries(world.held).map(([key, h]) => `${key} held by ${h.by} for ${ago(h.since).replace(' ago', '')}`),
          recent: world.recent.slice(-10).map(r => `${r.by} ${r.type} ${r.key} (${ago(r.t)})`),
        },
      };
    },
  };
}
