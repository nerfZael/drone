import { describe, expect, test } from 'bun:test';
import { shouldAwaitTerminalSkillSync } from '../src/hub/terminal-open';

describe('terminal open gating', () => {
  test('does not block shell terminal open on skill sync', () => {
    expect(shouldAwaitTerminalSkillSync('shell')).toBe(false);
  });

  test('keeps agent terminal open gated on skill sync', () => {
    expect(shouldAwaitTerminalSkillSync('agent')).toBe(true);
  });
});
