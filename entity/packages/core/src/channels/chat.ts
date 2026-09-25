import type { Channel } from '../channel.js';
import { isEntityActor } from '../log.js';

export interface ChatMessage { seq: number; by: string; text: string; t: number; replyTo?: number }

export interface ChatWorld {
  messages: ChatMessage[];
  /** The user's unsent input. */
  draft: { text: string; startedAt: number; lastKeyAt: number } | null;
  /** The entity's own visible "typing" text. */
  entityDraft: { by: string; text: string; t: number } | null;
}

export interface ChatChannelOptions {
  /** Messages kept in state and rendered into every context. */
  recent?: number;
}

/** Chat: messages from both sides, the user's live draft, and the entity's own draft. */
export function chatChannel(options: ChatChannelOptions = {}): Channel<ChatWorld> {
  const recent = options.recent ?? 12;
  return {
    name: 'chat',
    describe: 'A chat with the user. You see their unsent draft as they type (marked unsent). Only `say` sends a message.',
    inputs: ['chat_message', 'draft_changed'],
    init: () => ({ messages: [], draft: null, entityDraft: null }),
    reduce(world, event, { levels, now }) {
      if (event.type === 'chat_message') {
        const text = String(event.data.text ?? '');
        world.messages.push({ seq: event.seq, by: event.by, text, t: event.t, ...(typeof event.data.reply_to === 'number' ? { replyTo: event.data.reply_to } : {}) });
        if (world.messages.length > recent) world.messages.splice(0, world.messages.length - recent);
        if (event.by === 'user') { world.draft = null; levels.clear('user.typing'); }
        else if (isEntityActor(event.by)) world.entityDraft = null;
      }
      if (event.type === 'draft_changed' && event.by === 'user') {
        const text = String(event.data.text ?? '');
        if (!text) { world.draft = null; levels.clear('user.typing'); return; }
        world.draft = world.draft ? { ...world.draft, text, lastKeyAt: now } : { text, startedAt: now, lastKeyAt: now };
        levels.set('user.typing', true, 'user', world.draft.startedAt);
      }
      if (event.type === 'entity_draft') {
        const text = String(event.data.text ?? '');
        world.entityDraft = text ? { by: event.by, text, t: event.t } : null;
      }
    },
    effects: [
      {
        name: 'say', description: 'Send a chat message to the user.', risk: 'limb', voice: true, shorthand: 'text',
        parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 }, reply_to: { type: 'integer', minimum: 1, description: 'The message seq this answers (threads)' } }, required: ['text'], additionalProperties: false },
        apply(args: { text: string; reply_to?: number }, ctx) { ctx.emit('chat_message', { text: args.text, ...(args.reply_to !== undefined ? { reply_to: args.reply_to } : {}) }); return 'sent'; },
      },
      {
        name: 'set_draft', description: 'Show text as your visible, unsent draft (the user sees you typing). Empty text clears it.', risk: 'limb', voice: true, shorthand: 'text',
        parameters: { type: 'object', properties: { text: { type: 'string', maxLength: 4000 } }, required: ['text'], additionalProperties: false },
        apply(args: { text: string }, ctx) { ctx.emit('entity_draft', { text: args.text }); return 'ok'; },
      },
      {
        name: 'read_chat', description: 'Read older chat messages than the ones in state, newest last.', risk: 'reflex', readonly: true,
        parameters: { type: 'object', properties: { before_seq: { type: 'integer', minimum: 1 }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false },
        apply(args: { before_seq?: number; limit?: number }, ctx) {
          const before = args.before_seq ?? Number.MAX_SAFE_INTEGER;
          const found = ctx.events().filter(e => e.type === 'chat_message' && e.seq < before).slice(-(args.limit ?? 20));
          return JSON.stringify(found.map(e => ({ seq: e.seq, by: e.by, text: e.data.text })));
        },
      },
    ],
    render(world, { ago }) {
      return {
        volatile: {
          messages: world.messages.map(m => `#${m.seq} ${m.by}${m.replyTo ? ` (re #${m.replyTo})` : ''}: ${m.text} (${ago(m.t)})`),
          user_draft_unsent: world.draft ? { text: world.draft.text, typing_for: ago(world.draft.startedAt).replace(' ago', ''), last_key: ago(world.draft.lastKeyAt) } : null,
          your_draft: world.entityDraft?.text ?? null,
        },
      };
    },
  };
}
