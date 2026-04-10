import { describe, expect, test } from 'bun:test';
import {
  createHubShellSessionName,
  hubChatSessionName,
  hubShellSessionName,
  isHubShellSessionName,
  isHubWebTerminalSessionName,
  shouldAwaitTerminalSkillSync,
} from '../src/hub/terminal-open';

describe('terminal open gating', () => {
  test('does not block shell terminal open on skill sync', () => {
    expect(shouldAwaitTerminalSkillSync('shell')).toBe(false);
  });

  test('keeps agent terminal open gated on skill sync', () => {
    expect(shouldAwaitTerminalSkillSync('agent')).toBe(true);
  });

  test('keeps the default shell session stable', () => {
    expect(hubShellSessionName()).toBe('drone-hub-shell');
    expect(isHubShellSessionName('drone-hub-shell')).toBe(true);
  });

  test('creates unique shell sessions with the shell prefix', () => {
    const sessionName = createHubShellSessionName();
    expect(sessionName).toStartWith('drone-hub-shell-');
    expect(isHubShellSessionName(sessionName)).toBe(true);
    expect(isHubWebTerminalSessionName(sessionName)).toBe(true);
  });

  test('normalizes chat sessions into valid web terminal session names', () => {
    const sessionName = hubChatSessionName('feature / review');
    expect(sessionName).toBe('drone-hub-chat-feature-review');
    expect(isHubWebTerminalSessionName(sessionName)).toBe(true);
  });
});
