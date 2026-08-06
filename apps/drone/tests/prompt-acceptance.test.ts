import { describe, expect, test } from 'bun:test';

import { chatPromptAcceptancePlan } from '../src/hub/prompt-acceptance';

describe('chat prompt acceptance', () => {
  test('durably queues ordinary prompts before dispatch', () => {
    expect(chatPromptAcceptancePlan('queue')).toEqual({
      enqueueMode: 'background',
      priority: 'queue',
    });
    expect(chatPromptAcceptancePlan(undefined)).toEqual({
      enqueueMode: 'background',
      priority: 'queue',
    });
  });

  test('durably queues ASAP prompts with higher dispatch priority', () => {
    expect(chatPromptAcceptancePlan('asap')).toEqual({
      enqueueMode: 'background',
      priority: 'asap',
    });
  });
});
