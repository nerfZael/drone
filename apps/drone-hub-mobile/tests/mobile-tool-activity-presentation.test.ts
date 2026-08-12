import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const transcriptSource = readFileSync(
  new URL('../src/local-assistant/LocalAssistantTranscript.tsx', import.meta.url),
  'utf8',
);
const dronesScreenSource = readFileSync(
  new URL('../src/screens/DronesScreen.tsx', import.meta.url),
  'utf8',
);

describe('mobile tool activity presentation', () => {
  test('uses compact readable activity rows with native disclosure and status affordances', () => {
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Arguments</Text>');
    expect(transcriptSource).toContain('<Text style={styles.detailLabel}>Result</Text>');
    expect(transcriptSource).toContain('styles.thinkingActivityText}>Thinking…</Text>');
    expect(transcriptSource).toContain("run.active || awaitingApproval ? 'auto' : 'collapsed'");
    expect(transcriptSource).toContain('limitMobileRunToolItems(activityItems)');
    expect(transcriptSource).toContain('nestedScrollEnabled');
    expect(transcriptSource).toContain('style={[styles.activityRail');
    expect(transcriptSource).toContain('maxHeight: 288');
    expect(transcriptSource).toContain('const hasRunDetails = hasActivityDetails || hasPlan');
    expect(transcriptSource).toContain('styles.runDetailsSideBySide');
    expect(transcriptSource).toContain('styles.activityRailSideBySide');
    expect(transcriptSource).toContain('styles.runPlanSideBySide');
    expect(transcriptSource.indexOf('style={[styles.activityRail')).toBeLessThan(
      transcriptSource.indexOf('style={[styles.runPlan'),
    );
    expect(transcriptSource).toContain("setToolExpansion('collapsed')");
    expect(transcriptSource).not.toContain("'Show plan'");
    expect(transcriptSource).not.toContain("'Hide plan'");
    expect(transcriptSource).not.toContain('planWithActivity');
    expect(transcriptSource).toContain('!groupedActiveRun');
    expect(transcriptSource).toContain('disabled={!expandable}');
    expect(transcriptSource).toContain(
      "accessibilityLabel={expanded ? 'Collapse run details' : 'Expand run details'}",
    );
    expect(transcriptSource).toContain("blocked ? 'blocked' : 'pending'");
    expect(transcriptSource).toContain('<Pause color={colors.warning}');
    expect(transcriptSource).toContain("'Approval required'");
    expect(transcriptSource).toContain(
      'awaitingApproval && entry.group.key === latestRunGroup?.key',
    );
    expect(transcriptSource).toContain('completedDurationMs={run.durationMs}');
    expect(transcriptSource).toContain('preRunDurationMs={preRunDurationMs}');
    expect(transcriptSource).toContain('showTimingDetail={hasRunDetails && activityExpanded}');
    expect(transcriptSource).toContain("active ? 'Working for' : 'Completed in'");
    expect(transcriptSource).toContain(
      'Started in {workingDurationLabel(normalizedPreRunDurationMs)} · agent {duration}',
    );
    expect(transcriptSource).toContain('style={styles.runTimingDetail}');
    expect(transcriptSource).toContain("'Blocked pending approval.'");
    expect(transcriptSource).toContain("'Context compacted'");
    expect(transcriptSource).toContain('<MobileCompactionRow key={item.key}');
    expect(dronesScreenSource).toContain('awaitingApproval={awaitingApproval}');
    expect(dronesScreenSource).toContain('approvalStartedAt={approvalStartedAt}');
    expect(transcriptSource).toContain('<TriangleAlert color={colors.onAccent}');
    expect(transcriptSource).toContain('<X color={colors.onAccent}');
    expect(transcriptSource).toContain('<ToolStructuredValue value={args} />');
    expect(transcriptSource).toContain('structuredToolValueFromText(result)');
    expect(transcriptSource).not.toContain('JSON.stringify(args, null, 2)');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>ARGUMENTS</Text>');
    expect(transcriptSource).not.toContain('<Text style={styles.detailLabel}>RESULT</Text>');

    const toolStyle =
      transcriptSource.match(/  tool: \{([\s\S]*?)\n  \},\n  toolNested:/)?.[1] ?? '';
    const titleStyle =
      transcriptSource.match(/  toolTitle: \{([\s\S]*?)\n  \},\n  toolCount:/)?.[1] ?? '';
    expect(toolStyle).not.toContain('borderWidth');
    expect(toolStyle).not.toContain('backgroundColor');
    expect(titleStyle).not.toContain('textTransform');
  });
});
