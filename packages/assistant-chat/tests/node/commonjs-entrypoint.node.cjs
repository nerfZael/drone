const assert = require('node:assert/strict');
const test = require('node:test');

test('loads the assistant chat package from CommonJS', () => {
  const assistantChat = require('@drone/assistant-chat');

  assert.equal(typeof assistantChat.normalizePromptQueueInterruption, 'function');
});
