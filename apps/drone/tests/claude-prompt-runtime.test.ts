import { describe, expect, test } from 'bun:test';

import { claudeSandboxEnvironmentLines } from '../src/hub/chat-prompt-runtime';

describe('claudeSandboxEnvironmentLines', () => {
  test('declares the Claude root sandbox only for container drones', () => {
    expect(claudeSandboxEnvironmentLines('container')).toEqual(['export IS_SANDBOX=1']);
    expect(claudeSandboxEnvironmentLines('host')).toEqual([]);
  });
});
