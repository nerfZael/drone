import { describe, expect, test } from 'bun:test';
import {
  BUILTIN_TRANSCRIPT_SESSION_FIELD_BY_AGENT,
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
    expect(writeBuiltinTranscriptSessionId(null, 'codex', 'thread-1')).toBe(false);
  });
});
