import { describe, expect, test } from 'bun:test';

import { normalizeAgentSkillUses } from '../src/agent-skill-use';

describe('agent skill use', () => {
  test('deduplicates skill names and prefers explicit invocation evidence', () => {
    expect(
      normalizeAgentSkillUses([
        { name: 'openai-docs', source: 'skill-file-read' },
        { name: 'OpenAI-Docs', source: 'explicit' },
        { name: 'frontend-design', source: 'unknown' },
        { name: 42, source: 'explicit' },
        'legacy-string-record',
      ]),
    ).toEqual([{ name: 'OpenAI-Docs', source: 'explicit' }]);
  });

  test('drops malformed values and bounds persisted skill metadata', () => {
    const uses = normalizeAgentSkillUses([
      { name: 'bad\nname', source: 'explicit' },
      ...Array.from({ length: 50 }, (_, index) => ({
        name: `skill-${index}`,
        source: 'skill-file-read',
      })),
    ]);

    expect(uses).toHaveLength(32);
    expect(uses[0]).toEqual({ name: 'skill-0', source: 'skill-file-read' });
    expect(uses.at(-1)).toEqual({ name: 'skill-31', source: 'skill-file-read' });
  });
});
