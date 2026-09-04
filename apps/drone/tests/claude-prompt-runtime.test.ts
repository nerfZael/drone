import { describe, expect, test } from 'bun:test';

import {
  claudeSandboxEnvironmentLines,
  resolveClaudeSessionLaunch,
} from '../src/hub/chat-prompt-runtime';

describe('claudeSandboxEnvironmentLines', () => {
  test('declares the Claude root sandbox only for container drones', () => {
    expect(claudeSandboxEnvironmentLines('container')).toEqual(['export IS_SANDBOX=1']);
    expect(claudeSandboxEnvironmentLines('host')).toEqual([]);
  });
});

describe('resolveClaudeSessionLaunch', () => {
  test('creates the first Claude session with the allocated id', () => {
    expect(resolveClaudeSessionLaunch({ newSessionId: ' session-new ' })).toEqual({
      mode: 'create',
      sessionId: 'session-new',
    });
  });

  test('resumes a persisted Claude session on later turns', () => {
    expect(
      resolveClaudeSessionLaunch({
        existingSessionId: ' session-existing ',
        newSessionId: 'session-unused',
      }),
    ).toEqual({ mode: 'resume', sessionId: 'session-existing' });
  });

  test('forks from the source session instead of reusing chat metadata', () => {
    expect(
      resolveClaudeSessionLaunch({
        forkSessionId: ' session-source ',
        existingSessionId: 'session-existing',
        newSessionId: 'session-unused',
      }),
    ).toEqual({ mode: 'fork', sessionId: 'session-source' });
  });

  test('rejects a launch without any session id', () => {
    expect(() => resolveClaudeSessionLaunch({})).toThrow('missing Claude session id');
  });
});
