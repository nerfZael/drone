import { expect, test } from 'bun:test';
import { queuedChatNames } from '../src/hub/queued-chat-names';

test('projects waiting chats independently of delivery and excludes terminal work and actions', () => {
  expect(queuedChatNames({
    beforeDelivery: { pendingPrompts: [{ id: 'a', state: 'queued' }] },
    afterDelivery: { pendingPrompts: [{ id: 'b', state: 'sent', executionState: 'queued' }] },
    running: { pendingPrompts: [{ id: 'c', state: 'sent', executionState: 'running' }] },
    finished: { pendingPrompts: [{ id: 'd', state: 'sent', executionState: 'queued' }], turns: [{ id: 'd' }] },
    failed: { pendingPrompts: [{ id: 'e', state: 'failed', executionState: 'queued' }] },
    action: { pendingPrompts: [{ id: 'f', state: 'queued', action: { type: 'send-in-new-chat', sourceChatName: 'default' } }] },
  })).toEqual(['beforeDelivery', 'afterDelivery']);
});
