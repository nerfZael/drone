import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const transcriptSource = readFileSync(
  new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
  'utf8',
);

describe('mobile tool activity presentation', () => {
  test('uses compact readable activity rows with native disclosure and status affordances', () => {
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Arguments</Text>');
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Result</Text>');
    expect(transcriptSource).toContain('styles.thinkingActivityText}>Thinking…</Text>');
    expect(transcriptSource).toContain("run.active ? 'auto' : 'collapsed'");
    expect(transcriptSource).toContain('limitMobileRunToolItems(activityItems)');
    expect(transcriptSource).toContain('!groupedActiveRun');
    expect(transcriptSource).toContain('disabled={!expandable}');
    expect(transcriptSource).toContain("accessibilityLabel={expanded ? 'Collapse activity' : 'Expand activity'}");
    expect(transcriptSource).toContain("status={pending ? 'pending' : partial ? 'partial-error'");
    expect(transcriptSource).toContain('<TriangleAlert color={colors.onAccent}');
    expect(transcriptSource).toContain('<X color={colors.onAccent}');
    expect(transcriptSource).toContain('<ToolStructuredValue value={args} />');
    expect(transcriptSource).toContain('structuredToolValueFromText(result)');
    expect(transcriptSource).not.toContain('JSON.stringify(args, null, 2)');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>ARGUMENTS</Text>');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>RESULT</Text>');

    const toolStyle = transcriptSource.match(/  tool: \{([\s\S]*?)\n  \},\n  toolNested:/)?.[1] ?? '';
    const titleStyle = transcriptSource.match(/  toolTitle: \{([\s\S]*?)\n  \},\n  toolCount:/)?.[1] ?? '';
    expect(toolStyle).not.toContain('borderWidth');
    expect(toolStyle).not.toContain('backgroundColor');
    expect(titleStyle).not.toContain('textTransform');
  });
});
