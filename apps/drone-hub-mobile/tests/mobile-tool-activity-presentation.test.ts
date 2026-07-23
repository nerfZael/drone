import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const transcriptSource = readFileSync(
  new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
  'utf8',
);

describe('mobile tool activity presentation', () => {
  test('uses flat sentence-case tool rows with a trailing thinking state', () => {
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Arguments</Text>');
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Result</Text>');
    expect(transcriptSource).toContain('styles.thinkingActivityText}>Thinking…</Text>');
    expect(transcriptSource).toContain("run.active ? 'auto' : 'collapsed'");
    expect(transcriptSource).toContain('limitMobileRunToolItems(run.items)');
    expect(transcriptSource).toContain('!groupedActiveRun');
    expect(transcriptSource).toContain('disabled={!expandable}');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>ARGUMENTS</Text>');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>RESULT</Text>');

    const toolStyle = transcriptSource.match(/  tool: \{([\s\S]*?)\n  \},\n  toolNested:/)?.[1] ?? '';
    const titleStyle = transcriptSource.match(/  toolTitle: \{([\s\S]*?)\n  \},\n  toolCount:/)?.[1] ?? '';
    expect(toolStyle).not.toContain('borderWidth');
    expect(toolStyle).not.toContain('backgroundColor');
    expect(titleStyle).not.toContain('textTransform');
  });
});
