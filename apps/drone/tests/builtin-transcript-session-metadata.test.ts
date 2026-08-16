import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT,
  hasKnownBuiltinTranscriptSession,
  readBuiltinTranscriptSessionId,
  writeBuiltinTranscriptSessionId,
} from '../src/hub/builtin-transcript-session-metadata';
import type { BuiltinTranscriptAgentId } from '../src/hub/pendingPromptEnqueue';

describe('builtin transcript session metadata', () => {
  test('reads and writes every builtin agent session field', () => {
    const entry: Record<string, unknown> = {};
    const agents = Object.keys(
      BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT,
    ) as BuiltinTranscriptAgentId[];

    for (const agentId of agents) {
      expect(readBuiltinTranscriptSessionId(entry, agentId)).toBe('');
      expect(writeBuiltinTranscriptSessionId(entry, agentId, ` ${agentId}-session `)).toBe(true);
      expect(readBuiltinTranscriptSessionId(entry, agentId)).toBe(`${agentId}-session`);
      expect(writeBuiltinTranscriptSessionId(entry, agentId, `${agentId}-session`)).toBe(false);
    }

    expect(Object.keys(entry)).toEqual(Object.values(BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT));
  });

  test('ignores empty ids and invalid entries', () => {
    expect(writeBuiltinTranscriptSessionId({}, 'codex', '  ')).toBe(false);
    expect(writeBuiltinTranscriptSessionId({}, 'codex', 123)).toBe(false);
    expect(writeBuiltinTranscriptSessionId(null, 'codex', 'thread-1')).toBe(false);
    expect(readBuiltinTranscriptSessionId({ codexThreadId: 123 }, 'codex')).toBe('');
  });

  test('requires discovered session ids only for agents that need them', () => {
    expect(hasKnownBuiltinTranscriptSession({}, 'cursor')).toBe(true);
    expect(hasKnownBuiltinTranscriptSession({}, 'claude')).toBe(true);

    for (const agentId of ['codex', 'opencode', 'pi', 'blip'] as const) {
      expect(hasKnownBuiltinTranscriptSession({}, agentId)).toBe(false);
      expect(
        hasKnownBuiltinTranscriptSession(
          { [BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT[agentId]]: 'session-1' },
          agentId,
        ),
      ).toBe(true);
    }
  });
});
